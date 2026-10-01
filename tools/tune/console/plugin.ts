/**
 * The tuner page on the dev server: `npm run tuner` opens it. It lists every level's tuning,
 * edits the difficulty, and runs the tuner with options picked on the page, streaming its
 * progress back. Dev server only: production builds and `vite preview` never include it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { EFFORTS } from '../efforts.ts';
import { tuneArgs, type Job, type RunOptions, type TunerEvent } from './protocol.ts';

const PAGE = '/tools/tune/console/index.html';
const SERVER_MODULE = '/tools/tune/console/server.ts';
/** The same command as `npm run tune`. */
const TUNE = ['--import', 'tsx', '--import', './tools/tune/res-register.mjs', 'tools/tune/tune.ts'];
const LOG_LINES = 1000;
/** How long a stopping run gets to save its work before it is killed. */
const STOP_GRACE_MS = 15_000;

type ServerModule = typeof import('./server');

export function tunerConsole(): Plugin {
  return {
    name: 'bridgebuilder-tuner-console',
    apply: 'serve',
    configureServer(server) {
      const runner = new Runner(server.config.root);
      server.httpServer?.on('close', () => runner.stop());
      const load = () => server.ssrLoadModule(SERVER_MODULE) as Promise<ServerModule>;

      server.middlewares.use((req, res, next) => {
        if (req.url !== '/tuner' && req.url !== '/tuner/') return next();
        res.writeHead(302, { Location: PAGE }).end();
      });

      server.middlewares.use('/__tuner', (req, res) => {
        const route = `${req.method} ${req.url?.split('?')[0]}`;
        const handle = async () => {
          switch (route) {
            case 'GET /info':
              return json(res, 200, { ...(await load()).info(), job: runner.job, log: runner.log });
            case 'GET /events':
              return runner.subscribe(req, res);
            case 'POST /difficulty':
              if (runner.job?.running) return json(res, 409, { error: 'A tuning run is in progress; save the difficulty once it ends.' });
              return json(res, 200, (await load()).saveDifficulty(await body(req)));
            case 'POST /run': {
              const opts = runOptions(await body(req));
              if (!opts) return json(res, 400, { error: 'Bad run options.' });
              if (runner.job?.running) return json(res, 409, { error: 'A tuning run is already in progress.' });
              return json(res, 200, { job: runner.start(opts) });
            }
            case 'POST /stop':
              runner.stop();
              return json(res, 200, { job: runner.job });
            default:
              return json(res, 404, { error: `No route ${route}` });
          }
        };
        handle().catch((e: Error) => json(res, 500, { error: e.message }));
      });
    },
  };
}

/** Runs one tuner process at a time and fans its output out to every open page. */
class Runner {
  job: Job | null = null;
  log: string[] = [];
  private child: ChildProcess | null = null;
  private clients = new Set<ServerResponse>();

  constructor(private root: string) {}

  start(opts: RunOptions): Job {
    const args = tuneArgs(opts);
    this.job = { running: true, args, started: Date.now(), ended: null, code: null, status: null, estimate: null };
    this.log = [];
    this.line(`$ npm run tune${args.length ? ` -- ${args.join(' ')}` : ''}`);
    const child = spawn(process.execPath, [...TUNE, ...args], { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, FORCE_COLOR: '0' } });
    this.child = child;
    for (const stream of [child.stdout!, child.stderr!]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop()!;
        for (const l of lines) this.line(l);
      });
      stream.on('end', () => rest && this.line(rest));
    }
    child.on('message', (m: TunerEvent) => {
      if (!this.job) return;
      if (m.type === 'status') this.job.status = m.status;
      else if (m.type === 'estimate') this.job.estimate = m.estimate;
      this.send(m);
    });
    child.on('exit', (code) => {
      this.child = null;
      if (!this.job) return;
      Object.assign(this.job, { running: false, ended: Date.now(), code });
      this.line(code === 0 ? 'Finished.' : code === 130 ? 'Stopped. Finished levels are saved.' : `The tuner exited with code ${code}.`);
      this.send({ type: 'job', job: this.job });
    });
    this.send({ type: 'job', job: this.job });
    return this.job;
  }

  /** Asks the run to save and stop; kills it if it doesn't. */
  stop(): void {
    const child = this.child;
    if (!child) return;
    this.line('Stopping after saving finished levels…');
    child.send('stop');
    setTimeout(() => child.exitCode === null && child.kill(), STOP_GRACE_MS).unref();
  }

  subscribe(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  private line(text: string): void {
    this.log.push(text);
    if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
    this.send({ type: 'log', line: text });
  }

  private send(e: TunerEvent): void {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of this.clients) c.write(data);
  }
}

/** Run options from a request, checked, or null. */
function runOptions(b: Partial<RunOptions>): RunOptions | null {
  const levels = b.levels === null ? null : Array.isArray(b.levels) && b.levels.length && b.levels.every((n) => Number.isInteger(n) && n > 0) ? b.levels : undefined;
  const minutes = b.minutes === null || b.minutes === undefined ? null : Number(b.minutes);
  if (levels === undefined || typeof b.effort !== 'string' || !EFFORTS[b.effort]) return null;
  if (minutes !== null && !(minutes > 0 && minutes <= 24 * 60)) return null;
  return { levels, effort: b.effort, minutes, fresh: b.fresh === true, estimate: b.estimate === true };
}

function body<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (text += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}') as T);
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}
