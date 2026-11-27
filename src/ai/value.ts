import { advance } from '../engine/situation';
import { outcomeDistribution, type PitchContext } from '../engine/resolve';
import type { PitchOutcome, Situation } from '../engine/types';

/**
 * Run expectancy: expected runs from this base/out state to the end of the half-inning.
 * Index: [outs][bases bitmask: 1B=1, 2B=2, 3B=4], i.e. ---, 1--, -2-, 12-, --3, 1-3, -23, 123.
 * Calibrated for Strike's rules with `npm run sim -- --calibrate` (rare states smoothed by hand).
 */
export const RUN_EXPECTANCY: number[][] = [
  [0.6, 1.03, 1.26, 1.69, 1.43, 2.05, 2.21, 2.7],
  [0.33, 0.61, 0.78, 0.98, 1.15, 1.31, 1.48, 1.6],
  [0.11, 0.26, 0.42, 0.5, 0.46, 0.52, 0.68, 0.75],
];

/** Run value of each ball-strike count relative to 0-0 (three balls is a walk). Index: [balls][strikes]. */
export const COUNT_VALUE: number[][] = [
  [0, -0.073, -0.104],
  [0.1, 0.02, 0.003],
  [0.263, 0.19, 0.122],
];

export function basesMask(sit: Situation): number {
  return (sit.bases[0] ? 1 : 0) | (sit.bases[1] ? 2 : 0) | (sit.bases[2] ? 4 : 0);
}

/** Expected runs for the batting side from this situation (including count). */
export function situationValue(sit: Situation): number {
  if (sit.outs >= 3) return 0;
  return RUN_EXPECTANCY[sit.outs][basesMask(sit)] + COUNT_VALUE[Math.min(sit.balls, 2)][Math.min(sit.strikes, 2)];
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
