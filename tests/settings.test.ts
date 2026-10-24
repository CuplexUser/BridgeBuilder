import { afterEach, describe, expect, it } from 'vitest';
import { Shake } from '../src/fx/particles';
import { motion } from '../src/motion';
import { setStressPalette, stressColor, stressLook } from '../src/render/palette';

afterEach(() => {
  setStressPalette('classic');
  motion.reduced = false;
});

describe('settings: stress colors', () => {
  it('draws stress green to red by default', () => {
    expect(stressColor(0)).toBe('rgba(57,217,138,1)');
    expect(stressColor(1)).toBe('rgba(255,59,59,1)');
    expect(stressLook.dashed).toBe(false);
  });

  it('draws it blue to vermillion, with overload dashed, for colorblind players', () => {
    setStressPalette('colorblind');
    expect(stressColor(0)).toBe('rgba(86,180,233,1)');
    expect(stressColor(0.5)).toBe('rgba(240,228,66,1)');
    expect(stressColor(1, 0.5)).toBe('rgba(255,111,26,0.5)');
    expect(stressLook.dashed).toBe(true);
  });
});

describe('settings: reduce motion', () => {
  it('keeps the camera still', () => {
    motion.reduced = true;
    const shake = new Shake();
    shake.add(1);
    shake.update(0.1);
    expect([shake.trauma, shake.x, shake.y].map(Math.abs)).toEqual([0, 0, 0]);
  });

  it('shakes it otherwise', () => {
    const shake = new Shake();
    shake.add(1);
    shake.update(0.1);
    expect(shake.trauma).toBeGreaterThan(0);
  });
});
