import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { BASE_SCORE, bonusLabel, bonusMet, GOAL_SCORE, SAVINGS_MAX, scoreLevel } from '../src/scoring';
import { SOLUTIONS } from '../src/solutions';
import { insertHigh, MAX_HIGHS, type HighScore } from '../src/storage';

describe('scoreLevel', () => {
  const level = LEVELS[0];
  const design = SOLUTIONS[1](level);
  const spent = design.cost();

  it('adds base, savings and safety bonuses', () => {
    const s = scoreLevel(level, design, 0.25);
    expect(s.spent).toBe(spent);
    expect(s.savingsBonus).toBe(Math.round(SAVINGS_MAX * (1 - spent / level.money)));
    expect(s.safetyBonus).toBe(300);
    // The reference also meets level 1's bonus goal (four parts or fewer).
    expect(s.bonus).toBe(true);
    expect(s.total).toBe(BASE_SCORE + s.savingsBonus + 300 + GOAL_SCORE);
  });

  it('keeps the bonus goal apart from the three stars', () => {
    const s = scoreLevel({ ...level, bonus: { kind: 'parts', max: 3 } }, design, 0.3);
    expect(s.stars).toBe(3);
    expect(s.bonus).toBe(false);
    expect(s.goalBonus).toBe(0);
  });

  it('awards three stars for an on-target, low-stress bridge', () => {
    expect(spent).toBeLessThanOrEqual(level.target);
    expect(scoreLevel(level, design, 0.3).stars).toBe(3);
  });

  it('drops the cost star when the bridge runs over target', () => {
    const s = scoreLevel({ ...level, target: spent - 1 }, design, 0.3);
    expect(s.underTarget).toBe(false);
    expect(s.stars).toBe(2);
  });

  it('drops the safety star when stress runs hot', () => {
    const s = scoreLevel(level, design, 0.9);
    expect(s.stars).toBe(2);
    expect(s.safetyBonus).toBe(40);
  });

  it('never gives a negative bonus', () => {
    const s = scoreLevel({ ...level, money: spent / 2 }, design, 1.2);
    expect(s.savingsBonus).toBe(0);
    expect(s.safetyBonus).toBe(0);
  });
});

describe('bonus goals', () => {
  const level = LEVELS[3];
  const design = SOLUTIONS[4](level);

  it('check each kind of goal', () => {
    expect(bonusMet({ kind: 'cost', max: design.cost() }, design, 0.5)).toBe(true);
    expect(bonusMet({ kind: 'cost', max: design.cost() - 1 }, design, 0.5)).toBe(false);
    expect(bonusMet({ kind: 'stress', max: 0.5 }, design, 0.49)).toBe(true);
    expect(bonusMet({ kind: 'stress', max: 0.5 }, design, 0.5)).toBe(false);
    expect(bonusMet({ kind: 'parts', max: design.parts() }, design, 0)).toBe(true);
    expect(bonusMet({ kind: 'parts', max: design.parts() - 1 }, design, 0)).toBe(false);
    expect(bonusMet({ kind: 'without', mat: 'cable' }, design, 0)).toBe(true);
    expect(bonusMet({ kind: 'without', mat: 'steel' }, design, 0)).toBe(false);
  });

  it('read as short sentences', () => {
    expect(bonusLabel({ kind: 'cost', max: 9500 })).toBe('Build for $9,500 or less');
    expect(bonusLabel({ kind: 'stress', max: 0.35 })).toBe('Peak stress below 35%');
    expect(bonusLabel({ kind: 'parts', max: 26 })).toBe('26 parts or fewer');
    expect(bonusLabel({ kind: 'without', mat: 'heavy' })).toBe('No heavy deck');
  });
});

const mk = (score: number): HighScore => ({ name: 'AAA', score, levels: 1, chapter: 1, date: '' });

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
