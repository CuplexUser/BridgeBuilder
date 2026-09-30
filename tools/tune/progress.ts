/**
 * Progress for a long tuning run, measured in planned simulations. Each stage books the
 * simulations it expects; a stage that stops early books the rest as done, so the
 * estimate of time left corrects itself as the run goes.
 */
export class Progress {
  private total = 0;
  private done = 0;
  private stageLeft = 0;
  private readonly started = Date.now();
  private lastDraw = 0;
  private lastLog = 0;
  private label = '';
  private detail = '';
  private sims = 0;
  private readonly tty = process.stdout.isTTY === true;

  /** Adds planned work, e.g. when a level starts or has to try more geometry. */
  plan(units: number): void {
    this.total += units;
  }

  /** Starts a stage expected to take `units` simulations. */
  stage(label: string, units: number): void {
    this.finish();
    this.label = label;
    this.detail = '';
    this.stageLeft = units;
    this.draw(true);
  }

  /** Extra detail on the current stage, e.g. the generation and best cost so far. */
  note(detail: string): void {
    this.detail = detail;
    this.draw();
  }

  /** One simulation finished (or came from the cache). */
  tick(): void {
    this.sims++;
    if (this.stageLeft > 0) {
      this.stageLeft--;
      this.done++;
    }
    this.draw();
  }

  /** Ends the current stage; whatever it didn't use counts as done. */
  finish(): void {
    this.done += this.stageLeft;
    this.stageLeft = 0;
  }

  /** Prints a line above the status line. */
  log(line: string): void {
    if (this.tty) process.stdout.write('\r\x1b[2K');
    console.log(line);
    this.draw(true);
  }

  elapsed(): number {
    return (Date.now() - this.started) / 1000;
  }

  /** Seconds left at the current pace, or null before there is anything to go on. */
  eta(): number | null {
    const t = this.elapsed();
    if (this.done < 1 || t < 5) return null;
    return (t / this.done) * Math.max(0, this.total - this.done);
  }

  status(): string {
    const pct = this.total ? Math.min(100, (this.done / this.total) * 100) : 0;
    const t = this.elapsed();
    const rate = t > 0 ? this.sims / t : 0;
    const eta = this.eta();
    const parts = [`[${pct.toFixed(1).padStart(5)}%]`, this.label, this.detail, `${rate.toFixed(0)} sims/s`, `elapsed ${clock(t)}`, `left ${eta === null ? '…' : clock(eta)}`];
    return parts.filter(Boolean).join(' · ');
  }

  private draw(force = false): void {
    const now = Date.now();
    if (this.tty) {
      if (!force && now - this.lastDraw < 250) return;
      this.lastDraw = now;
      const cols = process.stdout.columns || 120;
      process.stdout.write(`\r\x1b[2K${this.status().slice(0, cols - 1)}`);
    } else if (now - this.lastLog > 30_000) {
      // Piped to a file: a line every half minute instead of a live status line.
      this.lastLog = now;
      console.log(this.status());
    }
  }

  /** Clears the status line before the program ends. */
  close(): void {
    if (this.tty) process.stdout.write('\r\x1b[2K');
  }
}

/** Seconds as h:mm:ss, or m:ss under an hour. */
export function clock(s: number): string {
  const sec = Math.round(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}
