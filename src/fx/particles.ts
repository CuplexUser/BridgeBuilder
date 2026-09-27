import type { MaterialId } from '../physics/materials';

export const PK = {
  Dust: 0,
  Splinter: 1,
  Spark: 2,
  Water: 3,
  Confetti: 4,
  Ring: 5,
  Chalk: 6,
} as const;
export type PK = (typeof PK)[keyof typeof PK];

const CAP = 700;

/** Fixed-size particle pool in world units; no allocation after construction. */
export class Particles {
  n = 0;
  x = new Float32Array(CAP);
  y = new Float32Array(CAP);
  vx = new Float32Array(CAP);
  vy = new Float32Array(CAP);
  life = new Float32Array(CAP);
  max = new Float32Array(CAP);
  size = new Float32Array(CAP);
  rot = new Float32Array(CAP);
  spin = new Float32Array(CAP);
  kind = new Uint8Array(CAP);
  color: string[] = Array.from({ length: CAP }, () => '#fff');

  spawn(kind: PK, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): void {
    let i = this.n;
    if (i >= CAP) i = (Math.random() * CAP) | 0;
    else this.n++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = this.max[i] = life;
    this.size[i] = size;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 16;
    this.color[i] = color;
  }

  burst(kind: PK, x: number, y: number, count: number, speed: number, life: number, size: number, colors: string[], upBias = 0): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(
        kind,
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s + upBias,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        colors[(Math.random() * colors.length) | 0],
      );
    }
  }

  update(dt: number, waterY: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const k = this.kind[i];
      let g = -9.8;
      let drag = 0.5;
      if (k === PK.Dust || k === PK.Chalk) {
        g = 0.6;
        drag = 3;
      } else if (k === PK.Confetti) {
        g = -3.5;
        drag = 2.2;
        this.vx[i] += Math.sin(this.life[i] * 9 + i) * 6 * dt;
      } else if (k === PK.Ring) {
        g = 0;
        drag = 0;
      } else if (k === PK.Spark) {
        drag = 1.2;
      }
      this.vy[i] += g * dt;
      const f = Math.max(0, 1 - drag * dt);
      this.vx[i] *= f;
      this.vy[i] *= f;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      if ((k === PK.Water || k === PK.Splinter || k === PK.Spark) && this.y[i] < waterY && this.vy[i] < 0) {
        this.life[i] = Math.min(this.life[i], 0.15);
        this.vy[i] *= 0.2;
        this.vx[i] *= 0.5;
      }
      i++;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.kind[i] = this.kind[j];
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.size[i] = this.size[j];
    this.rot[i] = this.rot[j];
    this.spin[i] = this.spin[j];
    this.color[i] = this.color[j];
  }

  clear(): void {
    this.n = 0;
  }
}

/** A snapped half-member tumbling into the river. */
export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  spin: number;
  len: number;
  mat: MaterialId;
  life: number;
  wet: boolean;
}

export class DebrisField {
  items: Debris[] = [];

  add(ax: number, ay: number, bx: number, by: number, vx: number, vy: number, mat: MaterialId): void {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const ang = Math.atan2(by - ay, bx - ax);
    const len = Math.hypot(bx - ax, by - ay) / 2;
    for (const side of [-1, 1]) {
      const cx = mx + (Math.cos(ang) * len * side) / 2;
      const cy = my + (Math.sin(ang) * len * side) / 2;
      this.items.push({
        x: cx,
        y: cy,
        vx: vx + side * (1 + Math.random() * 2) * Math.cos(ang),
        vy: vy + 1 + Math.random() * 2,
        ang,
        spin: side * (2 + Math.random() * 5),
        len: len * 0.96,
        mat,
        life: 6,
        wet: false,
      });
    }
  }

  update(dt: number, waterY: number, onSplash: (x: number, y: number, size: number) => void): void {
    for (const d of this.items) {
      d.life -= dt;
      if (d.y < waterY) {
        if (!d.wet) {
          d.wet = true;
          onSplash(d.x, waterY, d.len);
        }
        // Floaty wood bobs, everything else sinks.
        const buoy = d.mat === 'wood' ? 14 : 4;
        d.vy += (buoy * (waterY - d.y) - 9.8) * dt;
        d.vx *= 1 - 2 * dt;
        d.vy *= 1 - 3 * dt;
        d.spin *= 1 - 3 * dt;
      } else {
        d.vy -= 9.8 * dt;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.ang += d.spin * dt;
    }
    this.items = this.items.filter((d) => d.life > 0);
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** Trauma-based screen shake: add trauma, offset scales with trauma². */
export class Shake {
  trauma = 0;
  x = 0;
  y = 0;
  angle = 0;
  private t = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    this.x = s * 22 * (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7)) * 0.5;
    this.y = s * 22 * (Math.sin(t * 1.3 + 0.5) + Math.sin(t * 2.9 + 3.1)) * 0.5;
    this.angle = s * 0.03 * Math.sin(t * 0.9 + 2.2);
  }
}
