/** Builds the physical world from a design: joints, members, blocks, seats on the anchors, and the vehicles. */
import type { Design } from '../design';
import { bankY, mudAt, seatPiers, START_X, type LevelDef } from '../levels';
import { blockOf, compressionLimit, MAST, MATERIALS } from './materials';
import { VEHICLES, type VehicleDef, type VehicleId } from './vehicles';
import { CONVOY_GAP, COUPLER, JOINT_MASS, LOGS, RAIL_GAP, TUNNEL_HEIGHT, World, type Link } from './world';

export interface VehicleHandle {
  def: VehicleDef;
  /** Particles that are wheels, rear to front. */
  wheels: number[];
  rearWheel: number;
  frontWheel: number;
  rearTop: number;
  frontTop: number;
  /** Extra wheels between the rear and front ones, rear to front. */
  midWheels: number[];
}

/** Builds the physical bridge from a design; world particle i === design node i. */
export function buildWorld(design: Design, level: LevelDef): { world: World; vehicles: VehicleHandle[] } {
  const defs = convoyLayout(level).map((c) => c.def);
  const { ends, extra, seats, locked } = seatJoints(design, level);
  const split = cellSplit(design);
  const joints = design.nodes.length + extra.length;
  const masts = level.masts ?? [];
  const world = new World(joints + masts.length + split.copies.length + 6 * defs.length + 2 + (level.flood ? LOGS : 0), level.waterY - 8);
  const mass = new Float64Array(joints).fill(JOINT_MASS);
  design.members.forEach((m, i) => {
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const half = (Math.hypot(b.x - a.x, b.y - a.y) * MATERIALS[m.mat].density) / 2;
    mass[ends[i][0]] += half;
    mass[ends[i][1]] += half;
  });
  // A block's weight sits on its corners, its own where it has them.
  const copyMass = new Float64Array(split.copies.length);
  design.cells.forEach((c, k) => {
    const share = (design.cellArea(k) * MATERIALS[c.mat].density) / c.n.length;
    for (const i of c.n) {
      const o = split.own.get(`${k} ${i}`);
      if (o === undefined) mass[i] += share;
      else copyMass[o] += share;
    }
  });
  // Road ends on sliding bearings, or on a swing bridge, move with the bridge, so they have mass.
  const slides = (n: { x: number; y: number; anchor: boolean }) => (!!level.sliding || !!level.swing) && n.anchor && ((n.x === 0 && n.y === 0) || (n.x === level.width && n.y === bankY(level)));
  design.nodes.forEach((n, i) => world.addParticle(n.x, n.y, n.mast ? mass[i] + MAST.mass : n.anchor && !slides(n) ? 0 : mass[i]));
  // The center lock: the leaves' own joints on the lock line, or failing that the deck joints
  // nearest it either side, within a meter of it.
  if (locked.length >= 2) world.lock = [locked[0], locked[1]];
  else if (level.lock !== undefined) {
    const lock = level.lock;
    const deck = new Set(design.members.flatMap((m) => (MATERIALS[m.mat].drivable ? [m.a, m.b] : [])));
    const nearest = (side: number) => [...deck].filter((i) => side * (design.nodes[i].x - lock) >= 0 && Math.abs(design.nodes[i].x - lock) <= 1).toSorted((a, b) => Math.abs(design.nodes[a].x - lock) - Math.abs(design.nodes[b].x - lock))[0];
    const [p, q] = [nearest(-1), nearest(1)];
    if (p !== undefined && q !== undefined && p !== q && !design.members.some((m) => (m.a === p && m.b === q) || (m.a === q && m.b === p))) world.lock = [p, q];
  }
  design.nodes.forEach((n, p) => {
    if (!slides(n)) return;
    if (level.swing) world.swingEnds.push({ p, y: n.y, seated: true });
    else world.bearings.push({ p, y: n.y });
  });
  world.banks = { width: level.width, rightY: bankY(level) };
  world.block = blockOf(level);
  design.nodes.forEach((n, p) => {
    if (n.block) world.blocks.push({ p, x0: n.x, ground: n.y, util: 0, peak: 0, loose: false });
  });
  extra.forEach((node, k) => world.addParticle(design.nodes[node].x, design.nodes[node].y, mass[design.nodes.length + k]));
  // Each mast's foot is a fixed hinge, joined to its top by one very stiff strut.
  for (const [x, base, top] of masts) {
    const foot = world.addParticle(x, base, 0);
    const head = design.findNode(x, top);
    world.addLink(foot, head, (top - base) / MAST.EA);
    world.masts.push({ base: foot, top: head });
  }
  const firstCopy = world.count;
  split.copies.forEach((i, o) => world.addParticle(design.nodes[i].x, design.nodes[i].y, copyMass[o]));
  world.bridgeCount = world.count;
  for (const p of seats) {
    world.seats.push({ p, x: world.x[p], y: world.y[p] });
    if (level.lift?.some((x) => Math.abs(x - world.x[p]) < 1e-6)) world.guides.push({ p, x: world.x[p] });
  }
  design.members.forEach((m, i) => {
    const mat = MATERIALS[m.mat];
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    world.addLink(ends[i][0], ends[i][1], len / mat.EA, {
      bridge: true,
      mat: m.mat,
      stroke: mat.stroke,
      pre: mat.prestress ? mat.prestress / mat.EA : 0,
      viscous: mat.viscous ?? 0,
      tensionOnly: mat.tensionOnly,
      drivable: mat.drivable,
      member: i,
      tensionLimit: mat.tension,
      compressionLimit: compressionLimit(mat, len),
      age: 10,
    });
  });

  const corner = (k: number, i: number) => {
    const o = split.own.get(`${k} ${i}`);
    return o === undefined ? i : firstCopy + o;
  };
  addCells(world, design, corner);
  addFaces(world, design, split.joints, corner);
  world.setRock(world.rock);
  for (const [px, py] of level.piers) world.rockPiers.push([px, py]);
  world.rockMasses = (level.rocks ?? []).map(([x0, x1, top]): [number, number, number] => [x0, x1, top]);
  addSeatRests(world, level);
  addDeckBends(world);
  world.indexJoints((p) => p < design.nodes.length && design.nodes[p].anchor);

  const W = level.width;
  const deep = level.waterY - 8;
  const rY = bankY(level);
  const low = level.lower?.y;
  if (low === undefined) world.terrain.push(-60, 0, 0, 0, 0, 0, 0, deep, W, deep, W, rY, W, rY, W + 60, rY);
  else {
    // A tunnel through each bank for the lower deck: a floor, and the walls open above it.
    const roof = low + TUNNEL_HEIGHT;
    world.terrain.push(-60, 0, 0, 0, 0, 0, 0, roof, 0, low, 0, deep, -60, low, 0, low);
    world.terrain.push(W, deep, W, low, W, roof, W, rY, W, rY, W + 60, rY, W, low, W + 60, low);
  }
  for (const [px, py] of level.piers) {
    world.terrain.push(px - 0.45, py, px + 0.45, py);
    world.terrain.push(px - 0.45, py, px - 0.45, deep, px + 0.45, py, px + 0.45, deep);
  }
  for (const [x0, x1, top] of level.rocks ?? []) world.terrain.push(x0, deep, x0, top, x0, top, x1, top, x1, top, x1, deep);
  // Overhang undersides, in case a bouncing vehicle reaches them.
  for (const o of level.overhangs ?? []) {
    const edge = o.side === 'left' ? o.reach : W - o.reach;
    const back = o.side === 'left' ? -60 : W + 60;
    world.terrain.push(back, o.bottom, edge, o.bottom);
  }

  // A convoy keeps to its slowest vehicle's speed, so the gaps hold.
  const speed = Math.min(...defs.map((d) => d.speed));
  const layout = convoyLayout(level);
  const vehicles = layout.map(({ def, x, y }) => addVehicle(world, def, x, speed, y));
  // Couplers: each rail vehicle to the one ahead in its lane, at the buffers and at the axles.
  for (let i = 1; i < vehicles.length; i++) {
    const [ahead, behind] = [vehicles[i - 1], vehicles[i]];
    if (!ahead.def.rail || !behind.def.rail || layout[i - 1].y !== layout[i].y) continue;
    world.addLink(behind.frontTop, ahead.rearTop, COUPLER);
    world.addLink(behind.frontWheel, ahead.rearWheel, COUPLER);
  }
  world.waterY = world.water0 = level.waterY;
  world.flood = level.flood ?? null;
  // Driftwood waits upstream, out of the way, until the flood sends it down.
  if (level.flood) for (let k = 0; k < LOGS; k++) world.logs.push({ p: world.addParticle(-100, level.waterY, 0), afloat: false });
  // Bolts on mud, other than piles: the members built on each, so the mud feels what it carries.
  design.nodes.forEach((n, p) => {
    if (!n.anchor || n.pile || n.block || n.mast || !mudAt(level, n.x, n.y)) return;
    world.soft.push({ p, y0: n.y, sunk: 0, links: world.links.filter((l) => l.bridge && (l.a === p || l.b === p)), out: false });
  });
  world.wind = level.wind ?? null;
  world.quake = level.quake ?? null;
  if (level.march) {
    world.march = level.march;
    for (const v of vehicles) if (v.def.marches) world.marchers.push(...v.wheels, v.rearTop, v.frontTop);
  }
  return { world, vehicles };
}

/** Where each vehicle waits at the start: its rear wheel's x, lead vehicle first. */
export function convoyLayout(level: LevelDef): { def: VehicleDef; x: number; y: number }[] {
  const out: { def: VehicleDef; x: number; y: number }[] = [];
  const lanes: [VehicleId[], number][] = [[[level.vehicle, ...(level.convoy ?? [])], 0]];
  if (level.lower) lanes.push([[level.lower.vehicle, ...(level.lower.convoy ?? [])], level.lower.y]);
  for (const [ids, y] of lanes) {
    let x = START_X;
    ids.forEach((id, i) => {
      const def = VEHICLES[id];
      // Rail vehicles couple up close behind the one ahead.
      if (i > 0) {
        const ahead = out[out.length - 1].def;
        x -= def.rail && ahead.rail ? RAIL_GAP + def.wheelbase : CONVOY_GAP + def.wheelbase + def.wheelR;
      }
      out.push({ def, x, y });
    });
  }
  return out;
}

/** Most a deck may kink at a joint and still act as one continuous beam there, radians. */
const MAX_BEND_KINK = 0.6;
/**
 * Joints built on a seat, a pier with no bolt, rest on it and can lift off. Each part of the
 * bridge meeting there gets a joint of its own, so a drawbridge leaf lifts away from the span
 * beside it instead of dragging it along. Parts are the joints linked to one another without
 * passing through a bolt or a seat. Returns each member's end joints, the design node each
 * extra joint copies (they follow the design's own), and every seated joint.
 */
function seatJoints(design: Design, level: LevelDef): { ends: [number, number][]; extra: number[]; seats: number[]; locked: number[] } {
  const { nodes, members } = design;
  const ends = members.map((m): [number, number] => [m.a, m.b]);
  const pads = seatPiers(level);
  // A deck joint on a double bascule's lock line is split like one on a seat: a joint per leaf.
  const deck = new Set(members.flatMap((m) => (MATERIALS[m.mat].drivable ? [m.a, m.b] : [])));
  const onLock = nodes.map((n, i) => level.lock !== undefined && !n.anchor && deck.has(i) && Math.abs(n.x - level.lock) < 1e-6);
  const onSeat = nodes.map((n, i) => onLock[i] || (!n.anchor && pads.some(([x, y]) => Math.abs(x - n.x) < 1e-6 && Math.abs(y - n.y) < 1e-6)));
  if (!onSeat.some(Boolean)) return { ends, extra: [], seats: [], locked: [] };
  const root = nodes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const fixed = (i: number) => nodes[i].anchor || onSeat[i];
  for (const m of members) if (!fixed(m.a) && !fixed(m.b)) root[find(m.a)] = find(m.b);
  const extra: number[] = [];
  const seats: number[] = [];
  const locked: number[] = [];
  onSeat.forEach((seated, s) => {
    if (!seated) return;
    const list = onLock[s] ? locked : seats;
    list.push(s);
    const joint = new Map<string, number>();
    members.forEach((m, i) => {
      for (const end of [0, 1] as const) {
        if (ends[i][end] !== s) continue;
        const other = end === 0 ? m.b : m.a;
        const part = fixed(other) ? `member ${i}` : `part ${find(other)}`;
        let p = joint.get(part);
        if (p === undefined) {
          p = joint.size ? nodes.length + extra.push(s) - 1 : s;
          if (joint.size) list.push(p);
          joint.set(part, p);
        }
        ends[i][end] = p;
      }
    });
  });
  return { ends, extra, seats, locked };
}

/**
 * Each concrete block as a stiff frame: links along its edges, shared with the block beside it,
 * and across its diagonals. Its corners that aren't bolted bear on rock.
 */
function addCells(world: World, design: Design, corner: (k: number, i: number) => number): void {
  const edges = new Map<string, Link>();
  const rock = new Set<number>();
  design.cells.forEach((c, k) => {
    const mat = MATERIALS[c.mat];
    const links: Link[] = [];
    const link = (a: number, b: number) => {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      let l = edges.get(key);
      if (!l) {
        const len = Math.hypot(world.x[b] - world.x[a], world.y[b] - world.y[a]);
        l = world.addLink(a, b, len / mat.EA, { bridge: true, mat: c.mat, member: -1, cell: k, tensionLimit: mat.tension, compressionLimit: compressionLimit(mat, len), age: 10 });
        edges.set(key, l);
      }
      links.push(l);
    };
    const n = c.n.map((i) => corner(k, i));
    const sides = n.map((a, i) => (link(a, n[(i + 1) % n.length]), links[links.length - 1]));
    // A four-sided block keeps its corners square with angle constraints rather than diagonal
    // braces: a squeezed braced frame would push its own sides apart, which no solid block does.
    if (n.length === 4) {
      for (let i = 0; i < 4; i++) {
        const [a, b, cc] = [n[(i + 3) % 4], n[i], n[(i + 1) % 4]];
        const { x, y } = world;
        const ux = x[cc] - x[a];
        const uy = y[cc] - y[a];
        const L = Math.hypot(ux, uy);
        const rest = ((x[b] - x[a]) * -uy + (y[b] - y[a]) * ux) / L;
        world.bends.push({ a, b, c: cc, rest, compliance: 1 / mat.bend, limit: mat.bendLimit, ab: sides[(i + 3) % 4], bc: sides[i] });
      }
    }
    world.cells.push({ n: [...n], links });
    c.n.forEach((i, j) => {
      if (!design.nodes[i].anchor) rock.add(n[j]);
    });
  });
  world.rock = [...rock];
}

/**
 * Mortared blocks each get corners of their own, so the joints between them can crack and open.
 * `copies` lists the design node each new corner stands on, and `own` maps "cell node" to the
 * copy that block uses in place of the node. `joints` pairs the blocks that share a side. Blocks
 * that only touch at a corner, like an arch ring springing from a tower, share it: a pin.
 */
function cellSplit(design: Design): { copies: number[]; own: Map<string, number>; joints: { a: number; b: number; on: [number, number] }[] } {
  const copies: number[] = [];
  const own = new Map<string, number>();
  const joints: { a: number; b: number; on: [number, number] }[] = [];
  const mortared = (k: number) => !!MATERIALS[design.cells[k].mat].hinged;
  // The blocks on each corner, in order, and the blocks along each side.
  const users = new Map<number, number[]>();
  const sides = new Map<string, number[]>();
  design.cells.forEach((c, k) => {
    if (!mortared(k)) return;
    c.n.forEach((i, j) => {
      users.set(i, [...(users.get(i) ?? []), k]);
      const e = c.n[(j + 1) % c.n.length];
      const key = i < e ? `${i} ${e}` : `${e} ${i}`;
      sides.set(key, [...(sides.get(key) ?? []), k]);
    });
  });
  for (const [key, ks] of sides) {
    if (ks.length !== 2) continue;
    const [i, e] = key.split(' ').map(Number);
    joints.push({ a: ks[0], b: ks[1], on: [i, e] });
  }
  for (const [i, ks] of users) {
    // A bolted corner holds every block on it already.
    if (ks.length < 2 || design.nodes[i].anchor) continue;
    // Blocks that meet across a side at this corner each get a corner of their own there, but the
    // first of each such group keeps the node itself: groups that only touch here share it, a pin.
    const group = new Map(ks.map((k) => [k, k]));
    const root = (k: number): number => (group.get(k) === k ? k : root(group.get(k)!));
    for (const j of joints) if (j.on.includes(i) && group.has(j.a) && group.has(j.b)) group.set(root(j.a), root(j.b));
    const firsts = new Set<number>();
    for (const k of ks) {
      const r = root(k);
      if (!firsts.has(r)) {
        firsts.add(r);
        continue;
      }
      own.set(`${k} ${i}`, copies.length);
      copies.push(i);
    }
  }
  return { copies, own, joints };
}

/** The mortared faces between blocks that share a side: see Face. */
function addFaces(world: World, design: Design, joints: { a: number; b: number; on: [number, number] }[], corner: (k: number, i: number) => number): void {
  const center = (k: number): [number, number] => {
    const n = design.cells[k].n;
    return [n.reduce((sum, i) => sum + design.nodes[i].x, 0) / n.length, n.reduce((sum, i) => sum + design.nodes[i].y, 0) / n.length];
  };
  for (const { a, b, on } of joints) {
    const [p, r] = on.map((i) => design.nodes[i]);
    const len = Math.hypot(r.x - p.x, r.y - p.y);
    const mat = MATERIALS[design.cells[a].mat];
    const [ca, cb] = [center(a), center(b)];
    const sign = (r.y - p.y) * (cb[0] - ca[0]) - (r.x - p.x) * (cb[1] - ca[1]) > 0 ? 1 : -1;
    world.faces.push({ a1: corner(a, on[0]), a2: corner(a, on[1]), b1: corner(b, on[0]), b2: corner(b, on[1]), sign, compliance: len / mat.EA, gap1: 0, gap2: 0, apart: false, bond: mat.mortar ?? mat.tension, crack1: false, crack2: false });
  }
}

/**
 * Members built straight across a seat rest on it there, just as a joint built on it would,
 * so a deck laid over a seat in long pieces is carried without needing a joint on top.
 */
function addSeatRests(world: World, level: LevelDef): void {
  const { x, y } = world;
  for (const [sx, sy] of seatPiers(level)) {
    for (const link of world.links) {
      const { a, b } = link;
      const lo = Math.min(x[a], x[b]);
      const hi = Math.max(x[a], x[b]);
      if (sx <= lo + 1e-6 || sx >= hi - 1e-6) continue;
      const at = y[a] + ((y[b] - y[a]) * (sx - x[a])) / (x[b] - x[a]);
      if (Math.abs(at - sy) < 1e-6) world.rests.push({ link, x: sx, y: sy });
    }
  }
}

/**
 * Bending stiffness at every joint where two pieces that bend continue one another: deck with
 * deck, and arch with arch.
 */
function addDeckBends(world: World): void {
  const deckAt: number[][] = Array.from({ length: world.bridgeCount }, () => []);
  world.links.forEach((l, i) => {
    if (!l.bridge || !l.mat || MATERIALS[l.mat].bend <= 0) return;
    deckAt[l.a].push(i);
    deckAt[l.b].push(i);
  });
  const { x, y } = world;
  deckAt.forEach((ids, b) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ab = world.links[ids[i]];
        const bc = world.links[ids[j]];
        if (ab.drivable !== bc.drivable) continue;
        const a = ab.a === b ? ab.b : ab.a;
        const c = bc.a === b ? bc.b : bc.a;
        const k1 = Math.atan2(y[b] - y[a], x[b] - x[a]);
        const k2 = Math.atan2(y[c] - y[b], x[c] - x[b]);
        let kink = Math.abs(k2 - k1);
        if (kink > Math.PI) kink = 2 * Math.PI - kink;
        if (kink > MAX_BEND_KINK) continue;
        // The softer of the two pieces sets the joint's stiffness and strength.
        const m1 = MATERIALS[ab.mat!];
        const m2 = MATERIALS[bc.mat!];
        const stiff = Math.min(m1.bend, m2.bend);
        const limit = Math.min(m1.bendLimit, m2.bendLimit);
        if (stiff <= 0 || limit <= 0) continue;
        const ux = x[c] - x[a];
        const uy = y[c] - y[a];
        const L = Math.hypot(ux, uy);
        const rest = ((x[b] - x[a]) * -uy + (y[b] - y[a]) * ux) / L;
        world.bends.push({ a, b, c, rest, compliance: 1 / stiff, limit, ab, bc });
      }
    }
  });
}

function addVehicle(world: World, def: VehicleDef, x0: number, speed: number, y0 = 0): VehicleHandle {
  const r = def.wheelR;
  const axles = def.midAxles ?? [];
  // Wheels share 60% of the weight and the body the rest.
  const wheelMass = (def.mass * 0.6) / (2 + axles.length);
  const bodyMass = def.mass * 0.2;
  const topY = y0 + r + def.height * 0.6;
  const rearWheel = world.addParticle(x0, y0 + r, wheelMass, r);
  const frontWheel = world.addParticle(x0 + def.wheelbase, y0 + r, wheelMass, r);
  const rearTop = world.addParticle(x0, topY, bodyMass, 0.22);
  const frontTop = world.addParticle(x0 + def.wheelbase, topY, bodyMass, 0.22);
  const midWheels = axles.map((ax) => world.addParticle(x0 + ax, y0 + r, wheelMass, r));
  const wheels = [rearWheel, ...midWheels, frontWheel];
  for (const w of wheels) {
    world.drive[w] = speed;
    world.accel[w] = def.accel;
  }
  for (const p of [...wheels, rearTop, frontTop]) world.tonnes[p] = def.tonnes;
  if (def.rail) for (const w of wheels) world.rail[w] = 1;
  const rigid = 1e-8;
  const spring = 4e-6 * (1500 / def.mass);
  world.addLink(rearWheel, frontWheel, rigid);
  world.addLink(rearTop, frontTop, rigid);
  world.addLink(rearWheel, rearTop, spring);
  world.addLink(frontWheel, frontTop, spring);
  world.addLink(rearWheel, frontTop, spring);
  world.addLink(frontWheel, rearTop, spring);
  // A middle axle rides on its own springs, so it takes a share of the load wherever the deck dips.
  for (const w of midWheels) for (const p of [rearWheel, frontWheel, rearTop, frontTop]) world.addLink(w, p, spring);
  return { def, wheels, rearWheel, frontWheel, rearTop, frontTop, midWheels };
}
