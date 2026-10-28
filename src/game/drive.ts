import { sfx } from '../audio';
import { PK } from '../fx/particles';
import { bankY, goalX } from '../levels';
import type { VehicleHandle } from '../physics/build';
import { marchAccel, quakeAccel, windGust } from '../physics/hazards';
import { TestRun } from '../physics/testrun';
import { STEP } from '../physics/world';
import { PAL } from '../render/palette';
import type { Game } from './game';
import { t } from '../i18n';

/** How long a finished test drive plays on before its card comes up, s: after a crossing, and after a collapse. */
const RESULT_DELAY = 1.5;
const COLLAPSE_DELAY = 1.7;

/** A test drive as it runs: stepping it, breaks and splashes, engine and wheel sounds, and the hazards called out. */
export class Drive {
  private splashed = new WeakSet<TestRun>();
  /** Squads already called out as thrown into the river. */
  private overboard = new WeakSet<VehicleHandle>();
  acc = 0;
  /** Drawbridge phase last announced, so each is called out once. */
  lastPhase = '';
  /** Brake stop step last announced. */
  lastBrake = 'none';
  /** Weather and ground on dynamics levels: whether the quake was called out, the last footfall's sign, and the last gust's. */
  quakeSaid = false;
  stepSaid = false;
  floodSaid = false;
  lastStep = 0;
  gustSaid = false;
  /** Wheel spin and last wheel x per vehicle: rear, front. */
  wheelAngles: [number, number][] = [[0, 0]];
  private lastWheelX: [number, number][] = [[0, 0]];
  /** Fastest downward speed of each wheel since it last touched something. */
  private wheelFall: [number, number][] = [[0, 0]];

  constructor(private game: Game) {}

  stepSim(sim: TestRun, dt: number): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      sim.step();
      this.acc -= STEP;
      steps++;
      this.handleBreaks(sim);
    }
    if (steps === 4) this.acc = 0;
    // Wheel spin follows the distance each wheel actually traveled.
    const w = sim.world;
    sim.vehicles.forEach((v, k) => {
      const angles = (this.wheelAngles[k] ??= [0, 0]);
      const last = (this.lastWheelX[k] ??= [w.x[v.rearWheel], w.x[v.frontWheel]]);
      [v.rearWheel, v.frontWheel].forEach((p, i) => {
        angles[i] += (w.x[p] - last[i]) / v.def.wheelR;
        last[i] = w.x[p];
      });
    });

    // Dust kicked up by the tires, and a puff when a wheel lands hard.
    sim.vehicles.forEach((v, k) => {
      const fall = (this.wheelFall[k] ??= [0, 0]);
      [v.rearWheel, v.frontWheel].forEach((p, i) => {
        const onGround = w.contact[p] === 1;
        const speed = Math.abs(w.vx[p]);
        const r = v.def.wheelR;
        if (onGround && fall[i] < -3) {
          this.game.particles.burst(PK.Dust, w.x[p], w.y[p] - r, 10, 2.2, 0.8, 0.14, ['#d9cbb8', '#efe4d2']);
          if (!this.game.demo) this.game.shake.add(0.08);
        }
        if (onGround && speed > 1.5 && Math.random() < dt * 5) {
          this.game.particles.spawn(PK.Dust, w.x[p] - r * 0.8, w.y[p] - r * 0.8, -0.6 - Math.random(), 0.3 + Math.random() * 0.4, 0.7, 0.1, '#e3d6c2');
        }
        fall[i] = onGround ? 0 : Math.min(fall[i], w.vy[p]);
      });
    });

    if (sim.splashed && !this.splashed.has(sim)) {
      this.splashed.add(sim);
      // Splash where the lowest vehicle went in.
      const v = sim.vehicles.reduce((a, b) => (w.y[b.rearWheel] < w.y[a.rearWheel] ? b : a));
      const x = (w.x[v.rearWheel] + w.x[v.frontWheel]) / 2;
      const T = this.game.renderer.theme;
      this.game.particles.burst(PK.Water, x, w.waterY, 70, 9, 1.4, 0.12, [T.foam, '#ffffff', T.waterTop], 7);
      this.game.particles.spawn(PK.Ring, x, w.waterY, 0, 0, 0.8, 4, T.foam);
      this.game.shake.add(0.7);
      if (!this.game.demo) sfx.splash(true);
    }

    if (this.game.demo) {
      this.game.demoTimer += dt;
      if (sim.status === 'running') this.game.demoEnd = this.game.demoTimer;
      if (this.game.demoTimer - this.game.demoEnd > 1.2 || this.game.demoTimer > 16) this.game.startDemo();
    }
  }

  private handleBreaks(sim: TestRun): void {
    this.handleLooseBlocks(sim);
    const breaks = sim.world.breaks;
    if (breaks.length === 0) return;
    for (const b of breaks) {
      const mat = b.link.mat!;
      if (mat === 'heavy' || mat === 'concrete' || mat === 'masonry' || mat === 'arch') this.game.debris.crumble(b.ax, b.ay, b.bx, b.by, b.vx, b.vy, mat);
      else if (mat === 'cable' || mat === 'main') this.game.debris.whip(b.link.a, b.link.b, b.ax, b.ay, b.bx, b.by);
      else this.game.debris.add(b.ax, b.ay, b.bx, b.by, b.vx, b.vy, mat);
      if (mat === 'wood') {
        this.game.particles.burst(PK.Splinter, b.x, b.y, 22, 7, 1.2, 0.18, [PAL.wood, PAL.woodDark, '#e8b27a'], 2);
      } else if (mat === 'steel' || mat === 'cable' || mat === 'main' || mat === 'ram' || mat === 'damper' || mat === 'tendon') {
        this.game.particles.burst(PK.Spark, b.x, b.y, mat === 'cable' ? 18 : mat === 'main' ? 40 : 30, 12, 0.6, 0.04, ['#fff3b0', PAL.gold, '#ff9d3b'], 2);
      } else if (mat === 'heavy' || mat === 'concrete' || mat === 'masonry' || mat === 'arch') {
        this.game.particles.burst(PK.Splinter, b.x, b.y, 22, 6, 1.3, 0.22, [PAL.concrete, PAL.concreteDark, PAL.heavy], 2);
        this.game.particles.burst(PK.Dust, b.x, b.y, 16, 2.2, 1.4, 0.35, ['#b9b4aa', '#d8d2c6'], 0.6);
      } else {
        this.game.particles.burst(PK.Splinter, b.x, b.y, 16, 5, 1.2, 0.2, [PAL.road, '#555a63', PAL.roadLine], 2);
      }
      this.game.particles.burst(PK.Dust, b.x, b.y, 10, 1.6, 0.9, 0.25, ['#d9cbb8', '#ffffff']);
      this.game.particles.spawn(PK.Ring, b.x, b.y, 0, 0, 0.45, 2.2, '#ffffff');
      if (!this.game.demo) {
        sfx.crack(mat);
        this.game.haptics.snap();
        this.game.shake.add(0.45);
        this.game.flash = Math.max(this.game.flash, 0.25);
        const word = t(
          b.link.crushed
            ? 'fx.tooHeavy'
            : mat === 'steel' || mat === 'ram' || mat === 'damper'
              ? 'fx.clang'
              : mat === 'cable' || mat === 'tendon'
                ? 'fx.ping'
                : mat === 'main'
                  ? 'fx.twang'
                  : mat === 'heavy' || mat === 'concrete' || mat === 'masonry' || mat === 'arch'
                    ? 'fx.crack'
                    : 'fx.snap',
        );
        this.game.float(b.x, b.y + 0.8, word, PAL.bad, 24, 0.9);
        if (!this.game.anyBreak) this.game.slowmo = 0.7;
      }
      this.game.anyBreak = true;
    }
    breaks.length = 0;
  }

  /** A concrete anchor tearing out of the bank: soil and dust thrown up, and a heavy thud. */
  private handleLooseBlocks(sim: TestRun): void {
    const w = sim.world;
    for (const i of w.loosened) {
      const b = w.blocks[i];
      const x = w.x[b.p];
      const y = w.y[b.p];
      this.game.particles.burst(PK.Splinter, x, y, 20, 5, 1.3, 0.22, ['#6b4f36', '#8a6a4a', PAL.concrete], 3);
      this.game.particles.burst(PK.Dust, x, y, 18, 2.4, 1.5, 0.4, ['#b9a88f', '#d8cbb4'], 1);
      if (!this.game.demo) {
        sfx.crack('heavy');
        this.game.haptics.snap();
        this.game.shake.add(0.5);
        this.game.float(x, y + 1.2, t('fx.pulledOut'), PAL.bad, 24, 0.9);
        if (!this.game.anyBreak) this.game.slowmo = 0.7;
      }
      this.game.anyBreak = true;
    }
    w.loosened.length = 0;
  }

  trackRun(dt: number): void {
    const run = this.game.run!;
    const w = run.world;
    const v = run.vehicle;
    const speed = Math.hypot(w.vx[v.rearWheel], w.vy[v.rearWheel]);
    sfx.engineUpdate(this.engineBase(), speed);

    // Drawbridge levels call out each step of the opening.
    const L = this.game.level;
    if (L.ship && run.phase !== this.lastPhase && run.status === 'running') {
      this.lastPhase = run.phase;
      const words: Record<string, string> = { opening: t('fx.opening'), ship: t('fx.shipPassing'), closing: t('fx.closing'), driving: t('fx.go') };
      const c = L.channels?.[0];
      const x = c ? (c[0] + c[1]) / 2 : L.width / 2;
      if (words[run.phase]) this.game.float(x, L.ship.mast + 1, words[run.phase], run.phase === 'driving' ? PAL.ok : PAL.gold, 26, 1.4);
    }

    // A brake stop calls out the signal, the stop and the restart, with sparks off the rails while it brakes.
    if (L.brake && run.brakeState !== this.lastBrake && run.status === 'running') {
      this.lastBrake = run.brakeState;
      const words: Record<string, [string, string]> = { braking: [t('fx.redSignal'), PAL.bad], held: [t('fx.stopped'), PAL.gold], done: [t('fx.greenGo'), PAL.ok] };
      const said = words[run.brakeState];
      if (said) this.game.float(w.x[v.frontWheel], w.y[v.frontWheel] + 4, said[0], said[1], 24, 1.4);
    }
    if (run.brakeState === 'braking' && Math.random() < dt * 30) {
      for (const veh of run.vehicles) {
        const p = veh.wheels[Math.floor(Math.random() * veh.wheels.length)];
        this.game.particles.burst(PK.Spark, w.x[p], w.y[p] - veh.def.wheelR, 2, 4, 0.3, 0.03, ['#fff3b0', PAL.gold], 1.5);
      }
    }

    this.trackDynamics(dt);

    // Creaks and dust from heavily loaded members.
    for (const l of w.links) {
      if (!l.bridge || l.broken) continue;
      const s = Math.abs(l.stress);
      if (s > 0.7 && Math.random() < dt * 6 * s) {
        sfx.creak(s);
        this.game.haptics.creak(s);
        const f = Math.random();
        this.game.particles.spawn(PK.Dust, w.x[l.a] + (w.x[l.b] - w.x[l.a]) * f, w.y[l.a] + (w.y[l.b] - w.y[l.a]) * f, (Math.random() - 0.5) * 0.4, -0.5, 0.8, 0.08, '#e8dcc8');
      }
    }

    // Keep the vehicle in frame when the level is wider than the screen.
    this.game.frameTest(run, this.game.viewRect());

    if (run.status !== 'running') {
      if (this.game.endTimer < 0) {
        this.game.endTimer = 0;
        if (run.status === 'success') {
          sfx.engineStop();
          sfx.success();
          const x = goalX(this.game.level);
          const y = bankY(this.game.level);
          this.game.confetti(x, y + 3, 90);
          this.game.float(x - 2, y + 3.5, t('result.banner'), PAL.ok, 30, 1.6);
          this.game.shake.add(0.2);
        } else {
          sfx.fail();
          sfx.engineStop();
          this.game.haptics.collapse();
        }
      }
      this.game.endTimer += dt;
      if (this.game.example) {
        if (this.game.endTimer > RESULT_DELAY) this.game.backToBuild();
      } else if (run.status === 'success' && this.game.endTimer > RESULT_DELAY) this.game.results.finishSuccess();
      else if (run.status === 'fail' && this.game.endTimer > COLLAPSE_DELAY) this.game.results.finishCollapse();
    }
  }

  stopEngine(): void {
    sfx.engineStop();
  }

  /** Dynamics levels: callouts, sound and dust for the march, the wind and the quake. */
  private trackDynamics(dt: number): void {
    const run = this.game.run!;
    const w = run.world;
    const L = this.game.level;
    if (run.status !== 'running' || this.game.demo) return;
    const v = run.vehicle;
    // Every boot lands at once: a tramp on each footfall, and a callout as the column steps on.
    if (L.march) {
      const a = marchAccel(L.march, w.time);
      for (const m of run.lost) {
        if (this.overboard.has(m)) continue;
        this.overboard.add(m);
        this.game.float(w.x[m.frontWheel], w.y[m.frontWheel] + 3.5, t('fx.overboard'), PAL.bad, 24, 1.6);
        sfx.splash(false);
      }
      const marching = run.vehicles.filter((m) => m.def.marches && !run.lost.has(m) && w.x[m.frontWheel] > -2 && w.x[m.rearWheel] < L.width + 2);
      if (a > 0 && this.lastStep <= 0 && marching.length) {
        sfx.tramp(Math.min(1, marching.length / 3));
        if (!this.stepSaid) {
          this.stepSaid = true;
          this.game.float(w.x[marching[0].frontWheel], w.y[marching[0].frontWheel] + 3.5, t('fx.inStep'), PAL.gold, 24, 1.4);
        }
      }
      this.lastStep = a;
    }
    if (L.wind) {
      const g = windGust(L.wind, w.time);
      if (g > 0.9 && !this.gustSaid) {
        this.gustSaid = true;
        this.game.float(L.width / 2, 6, t('fx.gust'), PAL.chalk, 24, 1.1);
      } else if (g < 0.5) this.gustSaid = false;
    }
    // The river rises, and bolts on the mud wash out from under the bridge.
    if (L.flood && w.floodStart < Infinity && !this.floodSaid) {
      this.floodSaid = true;
      sfx.rumble(3);
      this.game.float(L.width / 2, w.water0 + L.flood.rise + 2, t('fx.flood'), PAL.cyan, 28, 1.6);
    }
    for (const p of w.washed) {
      this.game.particles.burst(PK.Water, w.x[p], w.y[p], 40, 6, 1.2, 0.1, [this.game.renderer.theme.foam, '#ffffff', this.game.renderer.theme.waterTop], 5);
      this.game.float(w.x[p], w.y[p] + 2, t('fx.washedOut'), PAL.bad, 24, 1.2);
      sfx.crack('heavy');
    }
    w.washed.length = 0;
    if (L.quake && w.quakeStart < Infinity) {
      const [ax] = quakeAccel(L.quake, w.time - w.quakeStart);
      if (!this.quakeSaid) {
        this.quakeSaid = true;
        sfx.rumble(L.quake.dur);
        this.game.float(w.x[v.frontWheel], w.y[v.frontWheel] + 4, t('fx.quake'), PAL.bad, 28, 1.6);
      }
      const k = Math.abs(ax) / 9.81;
      this.game.shake.add(k * dt * 2);
      if (Math.random() < dt * 40 * k) {
        const x = Math.random() < 0.5 ? -Math.random() * 3 : L.width + Math.random() * 3;
        this.game.particles.spawn(PK.Dust, x, x < 0 ? 0.1 : bankY(L) + 0.1, (Math.random() - 0.5) * 1.2, 0.4, 1.2, 0.12, '#cdbb9c');
      }
    }
  }

  engineBase(): number {
    return { car: 70, van: 58, truck: 44, bus: 40, semi: 34, loco: 30, wagon: 30, troop: 0, transporter: 26 }[this.game.level.vehicle];
  }

  resetWheels(run: TestRun): void {
    const w = run.world;
    this.lastWheelX = run.vehicles.map((v): [number, number] => [w.x[v.rearWheel], w.x[v.frontWheel]]);
    this.wheelFall = run.vehicles.map((): [number, number] => [0, 0]);
  }
}
