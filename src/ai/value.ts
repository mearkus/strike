import { BALLS_FOR_WALK, advance } from '../engine/situation';
import { outcomeDistribution, type PitchContext } from '../engine/resolve';
import type { PitchOutcome, Situation } from '../engine/types';

/**
 * Run expectancy: expected runs from this base/out state to the end of the half-inning.
 * Index: [outs][bases bitmask: 1B=1, 2B=2, 3B=4], i.e. ---, 1--, -2-, 12-, --3, 1-3, -23, 123.
 * Calibrated for Strike's rules with `npm run sim -- --calibrate` (rare states smoothed by hand).
 */
export const RUN_EXPECTANCY: number[][] = [
  [0.63, 1.13, 1.34, 1.77, 1.49, 1.95, 2.38, 2.6],
  [0.31, 0.63, 0.8, 1.16, 1.11, 1.39, 1.45, 1.7],
  [0.1, 0.25, 0.36, 0.47, 0.47, 0.52, 0.67, 0.8],
];

/** Run value of each ball-strike count relative to 0-0. Index: [balls][strikes]. Calibrated the same way. */
export const COUNT_VALUE: number[][] = [
  [0, -0.048, -0.085],
  [0.121, 0.048, -0.015],
  [0.297, 0.19, 0.036],
  [0.36, 0.261, 0.09],
];

export function basesMask(sit: Situation): number {
  return (sit.bases[0] ? 1 : 0) | (sit.bases[1] ? 2 : 0) | (sit.bases[2] ? 4 : 0);
}

/** Expected runs for the batting side from this situation (including count). */
export function situationValue(sit: Situation): number {
  if (sit.outs >= 3) return 0;
  return RUN_EXPECTANCY[sit.outs][basesMask(sit)] + COUNT_VALUE[Math.min(sit.balls, BALLS_FOR_WALK - 1)][Math.min(sit.strikes, 2)];
}

/** Change in batting side's expected runs caused by an outcome. Positive is good for the batter. */
export function outcomeValue(sit: Situation, outcome: PitchOutcome): number {
  const adv = advance(sit, outcome);
  return adv.runs + situationValue(adv.sit) - situationValue(sit);
}

/** Expected run value (batter's perspective) of a pitch/bat pairing. */
export function expectedValue(ctx: PitchContext): number {
  let ev = 0;
  for (const { outcome, p } of outcomeDistribution(ctx)) ev += p * outcomeValue(ctx.sit, outcome);
  return ev;
}
