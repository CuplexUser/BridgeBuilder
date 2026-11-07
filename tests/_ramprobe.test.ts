import { it } from 'vitest';
import { levelById } from '../src/chapters';
import { Design } from '../src/design';
import { balancedLeaf, SOLUTIONS } from '../src/solutions';
import { TestRun, testSeconds } from '../src/physics/testrun';
import type { LevelDef } from '../src/levels';
import type { MaterialId } from '../src/physics/materials';

const STEELY = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' } as const;

type Part = { p: [number, number]; q: [number, number]; mat: MaterialId };
const parts = (d: Design): Part[] => d.members.map((m) => ({ p: [d.nodes[m.a].x, d.nodes[m.a].y], q: [d.nodes[m.b].x, d.nodes[m.b].y], mat: m.mat }));
function build(level: LevelDef, list: Part[]): Design {
  const d = new Design(level);
  for (const m of list) d.add(m.p, m.q, m.mat);
  return d;
}

interface Result { label: string; status: string; reason: string; first: string; firstAt: string; drive: number; lift: number }

function trace(label: string, d: Design, level: LevelDef): Result {
  const run = new TestRun(d, level);
  const until = testSeconds(level);
  let first = '';
  let firstAt = '';
  let lift = 0;
  let drive = 0;
  const seen = new Set<unknown>();
  while (run.status === 'running' && run.time < until) {
    run.step();
    for (const l of run.world.links) {
      if (l.mat === 'ram' && !l.broken) {
        const f = Math.abs(l.stress) * (l.stress > 0 ? l.tensionLimit : l.compressionLimit);
        if (run.phase === 'driving') drive = Math.max(drive, f);
        else if (run.phase !== 'settle') lift = Math.max(lift, f);
      }
      if (l.broken && l.bridge && !seen.has(l)) {
        seen.add(l);
        if (!first) {
          first = l.mat ?? '?';
          firstAt = `${run.phase} t=${run.time.toFixed(1)} x=${run.convoyX.toFixed(1)}`;
        }
      }
    }
  }
  return { label, status: run.status, reason: run.reason ?? '', first, firstAt, drive, lift };
}

it('searches', () => {
  const level = levelById(93);
  const bases: [string, Part[]][] = [['hand', parts(SOLUTIONS[93](level))], ['steel', parts(balancedLeaf(level, 2, STEELY))]];
  const out: Result[] = [];
  for (const [name, base] of bases) {
    out.push(trace(`${name} as is`, build(level, base), level));
    base.forEach((m, i) => {
      if (m.mat === 'ram' || m.mat === 'ballast') return;
      if (m.mat !== 'road') out.push(trace(`${name} minus ${m.mat} ${m.p}-${m.q}`, build(level, base.filter((_, k) => k !== i)), level));
      if (m.mat === 'steel') out.push(trace(`${name} wood ${m.p}-${m.q}`, build(level, base.map((x, k) => (k === i ? { ...x, mat: 'wood' as const } : x))), level));
      if (m.mat === 'wood') out.push(trace(`${name} steel ${m.p}-${m.q}`, build(level, base.map((x, k) => (k === i ? { ...x, mat: 'steel' as const } : x))), level));
    });
    // The ram moved to other joints along the deck, from the same low bolt.
    for (const top of [[7, 0], [3, 0]] as [number, number][]) {
      out.push(trace(`${name} ram to ${top}`, build(level, base.map((x) => (x.mat === 'ram' ? { ...x, q: top } : x))), level));
    }
  }
  const crossed = out.filter((r) => r.status === 'success');
  const ramInTraffic = out.filter((r) => r.first === 'ram' && r.firstAt.startsWith('driving'));
  const liftFail = out.filter((r) => r.first === 'ram' && !r.firstAt.startsWith('driving'));
  const otherInTraffic = out.filter((r) => r.first && r.first !== 'ram' && r.firstAt.startsWith('driving'));
  console.log(`RESULT ${out.length} designs: ${crossed.length} cross; ram first to break in traffic ${ramInTraffic.length}; ram breaks before traffic ${liftFail.length}; other part first in traffic ${otherInTraffic.length}`);
  for (const r of ramInTraffic) console.log(`RAM ${r.label}: ${r.firstAt}, lift peak ${(r.lift / 1000).toFixed(1)} kN, ${r.reason}`);
  const top = [...crossed].sort((a, b) => b.drive - a.drive).slice(0, 8);
  for (const r of top) console.log(`OK ${r.label}: traffic ${(r.drive / 1000).toFixed(1)} kN, lift ${(r.lift / 1000).toFixed(1)} kN`);
}, 600000);
