import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { scoreLevel } from '../src/scoring';
import { SOLUTIONS } from '../src/solutions';
import { insertHigh, MAX_HIGHS, type HighScore } from '../src/storage';

describe('scoreLevel', () => {
  const level = LEVELS[0];
  const design = SOLUTIONS[1](level);

  it('adds base, unused-part and safety bonuses', () => {
    const s = scoreLevel(level, design, 0.25);
    expect(s.used).toBe(4);
    expect(s.unused).toBe(1);
    expect(s.partsBonus).toBe(100);
    expect(s.safetyBonus).toBe(300);
    expect(s.total).toBe(500 + 100 + 300);
  });

  it('awards three stars for an under-par, low-stress bridge', () => {
    expect(scoreLevel(level, design, 0.3).stars).toBe(3);
  });

  it('drops the safety star when stress runs hot', () => {
    const s = scoreLevel(level, design, 0.9);
    expect(s.stars).toBe(2);
    expect(s.safetyBonus).toBe(40);
  });

  it('never gives a negative safety bonus', () => {
    expect(scoreLevel(level, design, 1.2).safetyBonus).toBe(0);
  });
});

const mk = (score: number): HighScore => ({ name: 'AAA', score, levels: 1, date: '' });

describe('high-score table', () => {

  it('keeps entries sorted and trimmed', () => {
    const highs: HighScore[] = [];
    for (let i = 1; i <= 12; i++) insertHigh(highs, mk(i * 100));
    expect(highs.length).toBe(MAX_HIGHS);
    expect(highs[0].score).toBe(1200);
    expect(highs[MAX_HIGHS - 1].score).toBe(300);
  });

  it('reports rank, or -1 when a score falls off the table', () => {
    const highs = Array.from({ length: MAX_HIGHS }, (_, i) => mk(1000 - i * 10));
    expect(insertHigh(highs, mk(5))).toBe(-1);
    expect(insertHigh(highs, mk(995))).toBe(1);
  });
});
