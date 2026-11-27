import { stealTarget } from './resolve';
import type { Bases, PitchOutcome, Situation } from './types';

export type AtBatResult =
  | 'walk'
  | 'strikeout'
  | 'groundout'
  | 'doublePlay'
  | 'popout'
  | 'flyout'
  | 'sacFly'
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  | 'sacrifice'
  | 'buntHit'
  | 'buntOut';

export interface AdvanceResult {
  sit: Situation;
  runs: number;
  /** The plate appearance ended (count resets). */
  atBatOver: boolean;
  /** The batter completed a plate appearance (next batter up). False if the inning ended on a caught stealing. */
  batterDone: boolean;
  inningOver: boolean;
  result: AtBatResult | null;
  steal: { result: 'safe' | 'caught'; to: 2 | 3 } | null;
}

export const BALLS_FOR_WALK = 4;
export const STRIKES_FOR_OUT = 3;
/** Fouls add a strike only while the count has fewer strikes than this. */
export const FOUL_STRIKE_LIMIT = 2;

export const emptyBases = (): Bases => [false, false, false];

export function freshSituation(): Situation {
  return { bases: emptyBases(), outs: 0, balls: 0, strikes: 0 };
}

/** Every runner moves up `n` bases. Returns runs scored. Batter placement is separate. */
function advanceRunners(b: Bases, n: number): { bases: Bases; runs: number } {
  const out = emptyBases();
  let runs = 0;
  for (let i = 2; i >= 0; i--) {
    if (!b[i]) continue;
    const to = i + n;
    if (to >= 3) runs++;
    else out[to] = true;
  }
  return { bases: out, runs };
}

function forceAdvance(b: Bases): { bases: Bases; runs: number } {
  const out: Bases = [true, b[1], b[2]];
  let runs = 0;
  if (b[0]) {
    out[1] = true;
    if (b[1]) {
      out[2] = true;
      if (b[2]) runs = 1;
    }
  }
  return { bases: out, runs };
}

/** Apply a pitch outcome to the situation. Pure. */
export function advance(before: Situation, outcome: PitchOutcome): AdvanceResult {
  const sit: Situation = { bases: [...before.bases] as Bases, outs: before.outs, balls: before.balls, strikes: before.strikes };
  let runs = 0;
  let steal: AdvanceResult['steal'] = null;

  // Steals happen first, while the pitch is on its way.
  if ('steal' in outcome && outcome.steal) {
    const to = stealTarget(sit.bases);
    steal = { result: outcome.steal, to };
    const from = to - 2; // index of the runner
    if (outcome.steal === 'safe') {
      sit.bases[from + 1] = true;
      sit.bases[from] = false;
      if (to === 3 && sit.bases[0]) {
        sit.bases[0] = false;
        sit.bases[1] = true;
      }
    } else {
      sit.bases[from] = false;
      sit.outs++;
      if (to === 3 && sit.bases[0]) {
        sit.bases[0] = false;
        sit.bases[1] = true;
      }
      if (sit.outs >= 3) {
        return { sit: { ...sit, balls: 0, strikes: 0 }, runs: 0, atBatOver: true, batterDone: false, inningOver: true, result: null, steal };
      }
    }
  }

  let result: AtBatResult | null = null;
  const out = (n = 1) => {
    sit.outs += n;
  };
  const move = (n: number) => {
    const r = advanceRunners(sit.bases, n);
    sit.bases = r.bases;
    runs += r.runs;
  };

  switch (outcome.kind) {
    case 'ball':
      if (outcome.wild) move(1);
      sit.balls++;
      if (sit.balls >= BALLS_FOR_WALK) {
        const r = forceAdvance(sit.bases);
        sit.bases = r.bases;
        runs += r.runs;
        result = 'walk';
      }
      break;
    case 'calledStrike':
    case 'swingingStrike':
    case 'buntFoul':
      sit.strikes++;
      if (sit.strikes >= STRIKES_FOR_OUT) {
        out();
        result = 'strikeout';
      }
      break;
    case 'foul':
      if (sit.strikes < FOUL_STRIKE_LIMIT) sit.strikes++;
      break;
    case 'sacrifice':
      out();
      if (sit.outs < 3) move(1);
      result = 'sacrifice';
      break;
    case 'buntHit':
      move(1);
      sit.bases[0] = true;
      result = 'buntHit';
      break;
    case 'buntOut':
      out();
      result = 'buntOut';
      break;
    case 'inPlay': {
      const hr = outcome.hitAndRun === true;
      switch (outcome.hit) {
        case 'groundout':
          out();
          if (sit.outs < 3) move(1);
          result = 'groundout';
          break;
        case 'doublePlay':
          sit.bases[0] = false;
          out(2);
          if (sit.outs < 3) move(1);
          result = 'doublePlay';
          break;
        case 'popout':
          out();
          result = 'popout';
          break;
        case 'flyout': {
          out();
          result = 'flyout';
          if (sit.outs < 3) {
            if (sit.bases[2]) {
              sit.bases[2] = false;
              runs++;
              result = 'sacFly';
            }
            if (sit.bases[1] && !sit.bases[2]) {
              sit.bases[1] = false;
              sit.bases[2] = true;
            }
          }
          break;
        }
        case 'single': {
          const b = sit.bases;
          runs += (b[1] ? 1 : 0) + (b[2] ? 1 : 0);
          sit.bases = [true, b[0] && !hr, b[0] && hr];
          result = 'single';
          break;
        }
        case 'double': {
          const b = sit.bases;
          runs += (b[1] ? 1 : 0) + (b[2] ? 1 : 0) + (b[0] && hr ? 1 : 0);
          sit.bases = [false, true, b[0] && !hr];
          result = 'double';
          break;
        }
        case 'triple':
          runs += sit.bases.filter(Boolean).length;
          sit.bases = [false, false, true];
          result = 'triple';
          break;
        case 'homeRun':
          runs += sit.bases.filter(Boolean).length + 1;
          sit.bases = emptyBases();
          result = 'homeRun';
          break;
      }
      break;
    }
  }

  const atBatOver = result !== null;
  if (atBatOver) {
    sit.balls = 0;
    sit.strikes = 0;
  }
  const inningOver = sit.outs >= 3;
  if (inningOver) sit.bases = emptyBases();
  return { sit, runs, atBatOver: atBatOver || inningOver, batterDone: atBatOver, inningOver, result, steal };
}
