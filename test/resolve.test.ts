import { describe, expect, it } from 'vitest';
import { HACK, batCard, pitchCard, readMod } from '../src/engine/cards';
import { type BatAction, type PitchContext, outcomeDistribution, resolvePitch, stealResult } from '../src/engine/resolve';
import { Rng } from '../src/engine/rng';
import type { Situation } from '../src/engine/types';

const empty: Situation = { bases: [false, false, false], outs: 0, balls: 0, strikes: 0 };
const swing = (id: string): BatAction => {
  const c = batCard(id);
  return c.kind === 'swing' ? { kind: 'swing', card: c } : { kind: 'tactic', card: c };
};
const ctx = (pitch: string, bat: BatAction, sit: Situation = empty): PitchContext => ({ pitch: pitchCard(pitch), bat, sit, abPitches: [] });

describe('read triangle', () => {
  it('rewards the right guess and punishes the counter', () => {
    expect(readMod('heat', 'heat')).toBe(3);
    expect(readMod('heat', 'change')).toBeLessThan(0);
    expect(readMod('curve', 'heat')).toBeLessThan(0);
    expect(readMod('change', 'curve')).toBeLessThan(0);
    expect(readMod('heat', 'curve')).toBe(0);
    expect(readMod('any', 'heat')).toBe(0);
    expect(readMod('heat', 'knuckle')).toBe(0);
  });
});

describe('outcomeDistribution', () => {
  const cases: Array<[string, BatAction, Situation?]> = [
    ['fourSeam', swing('sitHeat')],
    ['highHeat', swing('swingAway')],
    ['sweeper', swing('swingAway')],
    ['slider', { kind: 'take' }],
    ['curveball', swing('hitAndRun'), { ...empty, bases: [true, false, false] }],
    ['changeup', swing('bunt'), { ...empty, bases: [true, false, false] }],
    ['fourSeam', swing('steal'), { ...empty, bases: [true, false, false] }],
    ['twoSeam', { kind: 'swing', card: HACK }, { ...empty, bases: [true, false, false] }],
  ];

  it.each(cases)('sums to 1 (%s)', (p, b, s) => {
    const total = outcomeDistribution(ctx(p, b, s)).reduce((a, o) => a + o.p, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it.each(cases)('matches Monte Carlo of resolvePitch (%s)', (p, b, s) => {
    const c = ctx(p, b, s);
    const exact = new Map(outcomeDistribution(c).map((o) => [JSON.stringify(o.outcome), o.p]));
    const rng = new Rng(42);
    const counts = new Map<string, number>();
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const k = JSON.stringify(resolvePitch(c, () => rng.d6()));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) {
      expect(exact.has(k), `missing outcome ${k}`).toBe(true);
      expect(Math.abs(n / N - exact.get(k)!)).toBeLessThan(0.012);
    }
  });
});

describe('matchups', () => {
  const pInPlay = (pitch: string, bat: BatAction) =>
    outcomeDistribution(ctx(pitch, bat)).filter((o) => o.outcome.kind === 'inPlay').reduce((a, o) => a + o.p, 0);

  it('sitting on the right pitch makes more contact than being fooled', () => {
    expect(pInPlay('fourSeam', swing('sitHeat'))).toBeGreaterThan(pInPlay('changeup', swing('sitHeat')) + 0.3);
  });

  it('chasing is worse than swinging at strikes', () => {
    expect(pInPlay('fourSeam', swing('swingAway'))).toBeGreaterThan(pInPlay('highHeat', swing('swingAway')));
  });

  it('check swings turn some chases into balls, but not on deceptive pitches', () => {
    const checked = (pitch: string) =>
      outcomeDistribution(ctx(pitch, swing('swingAway'))).filter((o) => o.outcome.kind === 'ball').reduce((a, o) => a + o.p, 0);
    expect(checked('highHeat')).toBeCloseTo(0.5, 6);
    expect(checked('sweeper')).toBe(0);
  });

  it('taking a chase pitch is always a ball, a strike is always a strike', () => {
    expect(outcomeDistribution(ctx('highHeat', { kind: 'take' }))).toEqual([{ outcome: { kind: 'ball' }, p: 1 }]);
    expect(outcomeDistribution(ctx('fourSeam', { kind: 'take' }))).toEqual([{ outcome: { kind: 'calledStrike' }, p: 1 }]);
  });

  it('pitchouts always catch stealers', () => {
    for (let r = 1; r <= 6; r++) expect(stealResult(pitchCard('pitchout'), [true, false, false], 5, r)).toBe('caught');
  });

  it('steals are easier on breaking balls than on heat', () => {
    const safe = (pitch: string) => [1, 2, 3, 4, 5, 6].filter((r) => stealResult(pitchCard(pitch), [true, false, false], 0, r) === 'safe').length;
    expect(safe('curveball')).toBeGreaterThan(safe('fourSeam'));
  });

  it('sinkers produce more double plays', () => {
    const dp = (pitch: string) =>
      outcomeDistribution(ctx(pitch, swing('swingAway'), { ...empty, bases: [true, false, false] }))
        .filter((o) => o.outcome.kind === 'inPlay' && o.outcome.hit === 'doublePlay')
        .reduce((a, o) => a + o.p, 0);
    expect(dp('heavySinker')).toBeGreaterThan(dp('cutter'));
  });

  it('a sacrifice bunt usually succeeds on a strike with a runner on', () => {
    const sac = outcomeDistribution(ctx('fourSeam', swing('bunt'), { ...empty, bases: [true, false, false] }))
      .filter((o) => o.outcome.kind === 'sacrifice')
      .reduce((a, o) => a + o.p, 0);
    expect(sac).toBeGreaterThan(0.6);
  });
});
