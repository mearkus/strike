import { describe, expect, it } from 'vitest';
import { HACK, batCard, pitchCard, readMod } from '../src/engine/cards';
import {
  type BatAction,
  CHECK_SWING_ROLL,
  type PitchContext,
  WILD_PITCH_ROLL,
  landing,
  landingDistribution,
  outcomeDistribution,
  resolvePitch,
  stealResult,
  throwPitch,
} from '../src/engine/resolve';
import { Rng } from '../src/engine/rng';
import type { Situation } from '../src/engine/types';

const empty: Situation = { bases: [false, false, false], outs: 0, balls: 0, strikes: 0 };
const swing = (id: string): BatAction => {
  const c = batCard(id);
  return c.kind === 'swing' ? { kind: 'swing', card: c } : { kind: 'tactic', card: c };
};
const ctx = (pitch: string, bat: BatAction, sit: Situation = empty): PitchContext => ({ pitch: pitchCard(pitch), bat, sit, abPitches: [] });
/** A pitch with perfect command, to test zone rules without the command roll. */
const pinpoint = (pitch: string, bat: BatAction, sit: Situation = empty): PitchContext => ({ ...ctx(pitch, bat, sit), pitch: { ...pitchCard(pitch), control: 6 } });

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
    ['dirtCurve', swing('steal'), { ...empty, bases: [true, false, true] }],
    ['knuckleball', swing('sitHeat')],
    ['tiredArm', { kind: 'take' }, { ...empty, bases: [false, true, false] }],
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

  it('a correct read squares the ball up: far more extra-base hits than a neutral swing', () => {
    const xbh = (bat: BatAction) =>
      outcomeDistribution(pinpoint('fourSeam', bat))
        .filter((o) => o.outcome.kind === 'inPlay' && ['double', 'triple', 'homeRun'].includes(o.outcome.hit))
        .reduce((a, o) => a + o.p, 0);
    expect(xbh(swing('sitHeat'))).toBeGreaterThan(xbh(swing('swingAway')) * 4);
  });

  it('chasing is worse than swinging at strikes', () => {
    expect(pInPlay('fourSeam', swing('swingAway'))).toBeGreaterThan(pInPlay('highHeat', swing('swingAway')));
  });

  it('check swings turn some chases into balls, but not on deceptive pitches', () => {
    const checked = (pitch: string) =>
      outcomeDistribution(ctx(pitch, swing('swingAway'))).filter((o) => o.outcome.kind === 'ball').reduce((a, o) => a + o.p, 0);
    expect(checked('highHeat')).toBeCloseTo((7 - CHECK_SWING_ROLL) / 6, 6);
    // Sweeper: deceptive, so the only balls are its misses into the dirt.
    expect(checked('sweeper')).toBeCloseTo(2 / 6, 6);
  });

  it('a located chase pitch taken is a ball, a located strike taken is a strike', () => {
    expect(outcomeDistribution(pinpoint('highHeat', { kind: 'take' }))).toEqual([{ outcome: { kind: 'ball' }, p: 1 }]);
    expect(outcomeDistribution(pinpoint('fourSeam', { kind: 'take' }))).toEqual([{ outcome: { kind: 'calledStrike' }, p: 1 }]);
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
    expect(sac).toBeGreaterThan(0.55);
  });
});

describe('command', () => {
  it('a pitch hits its spot on a roll at or under its control, otherwise drifts one zone wider', () => {
    const p = { ...pitchCard('fourSeam'), control: 4 }; // strike zone, control 4
    expect(landing(p, 4)).toBe('strike');
    expect(landing(p, 5)).toBe('edge');
    expect(landing(pitchCard('slider'), 6)).toBe('chase');
    expect(landing(pitchCard('dirtCurve'), 6)).toBe('dirt');
    expect(landingDistribution(p)).toEqual([
      ['strike', 4 / 6],
      ['edge', 2 / 6],
    ]);
    expect(landingDistribution(pitchCard('highHeat'))).toEqual([['chase', 1]]);
  });

  it('a pitch in the dirt is a ball whatever the batter does', () => {
    const rolls = [6, 1, 1]; // command miss, then anything
    const r = throwPitch(ctx('dirtCurve', swing('moonshot')), () => rolls.shift() ?? 1);
    expect(r.landed).toBe('dirt');
    expect(r.outcome).toEqual({ kind: 'ball', dirt: true });
  });

  it('with runners on, a pitch in the dirt can be a wild pitch', () => {
    const wild = outcomeDistribution(ctx('dirtCurve', { kind: 'take' }, { ...empty, bases: [true, false, false] }))
      .filter((o) => o.outcome.kind === 'ball' && o.outcome.wild)
      .reduce((a, o) => a + o.p, 0);
    expect(wild).toBeCloseTo((1 / 6) * (WILD_PITCH_ROLL / 6), 9);
  });

  it('wild control produces more balls on takes', () => {
    const ballP = (id: string) => outcomeDistribution(ctx(id, { kind: 'take' })).filter((o) => o.outcome.kind === 'ball').reduce((a, o) => a + o.p, 0);
    expect(ballP('tiredArm')).toBeGreaterThan(ballP('cutter'));
  });
});
