import { BALLS_FOR_WALK, advance } from '../engine/situation';
import { outcomeDistribution, type PitchContext } from '../engine/resolve';
import type { PitchOutcome, Situation } from '../engine/types';

/**
 * Run expectancy: expected runs from this base/out state to the end of the half-inning.
 * Index: [outs][bases bitmask: 1B=1, 2B=2, 3B=4], i.e. ---, 1--, -2-, 12-, --3, 1-3, -23, 123.
 * Calibrated for Strike's rules with `npm run sim -- --calibrate` (rare states smoothed by hand).
 */
export const RUN_EXPECTANCY: number[][] = [
  [0.7, 1.18, 1.42, 1.78, 1.6, 2.06, 2.48, 2.6],
  [0.34, 0.7, 0.93, 1.17, 1.19, 1.54, 1.55, 1.74],
  [0.12, 0.33, 0.45, 0.69, 0.46, 0.7, 0.89, 0.98],
];

/**
 * Run value of each ball-strike count relative to 0-0. Index: [balls][strikes]. Calibrated the
 * same way; because these values change how often the AI takes, they were updated in damped steps
 * (halfway toward each new measurement) until stats and tables settled.
 */
export const COUNT_VALUE: number[][] = [
  [0, -0.095, -0.183],
  [0.091, -0.022, -0.132],
  [0.261, 0.074, -0.1],
  [0.385, 0.161, -0.008],
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
