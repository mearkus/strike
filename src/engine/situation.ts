import { stealTarget } from './resolve';
import type { Bases, PitchOutcome, RunnerDest, RunnerId, RunnerMove, Situation } from './types';

export type { RunnerDest, RunnerId, RunnerMove };

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
  /** Every runner (and the batter) who changed place, for animating the play. */
  moves: RunnerMove[];
}

export const BALLS_FOR_WALK = 4;
export const STRIKES_FOR_OUT = 3;
/** Fouls add a strike only while the count has fewer strikes than this. */
export const FOUL_STRIKE_LIMIT = 2;

export const emptyBases = (): Bases => [false, false, false];

export function freshSituation(): Situation {
  return { bases: emptyBases(), outs: 0, balls: 0, strikes: 0 };
}

type Occupancy = [RunnerId | null, RunnerId | null, RunnerId | null];

/** Apply a pitch outcome to the situation. Pure. */
export function advance(before: Situation, outcome: PitchOutcome): AdvanceResult {
  // Track runners by who they are, so the play can be animated runner by runner.
  let occ: Occupancy = before.bases.map((on, i) => (on ? (i as RunnerId) : null)) as Occupancy;
  const scored: RunnerId[] = [];
  const retired: RunnerId[] = [];
  let outs = before.outs;
  let balls = before.balls;
  let strikes = before.strikes;
  let steal: AdvanceResult['steal'] = null;

  /** Every runner moves up `n` bases. */
  const moveAll = (n: number) => {
    const next: Occupancy = [null, null, null];
    for (let i = 2; i >= 0; i--) {
      const r = occ[i];
      if (r === null) continue;
      if (i + n >= 3) scored.push(r);
      else next[i + n] = r;
    }
    occ = next;
  };
  /** Batter to first; forced runners move up. */
  const force = () => {
    if (occ[0] !== null) {
      if (occ[1] !== null) {
        if (occ[2] !== null) scored.push(occ[2]);
        occ[2] = occ[1];
      }
      occ[1] = occ[0];
    }
    occ[0] = 'B';
  };
  const retire = (r: RunnerId) => {
    retired.push(r);
    outs++;
  };
  const finish = (result: AtBatResult | null, opts: { batterDone?: boolean } = {}): AdvanceResult => {
    const atBatOver = result !== null;
    const inningOver = outs >= 3;
    const moves: RunnerMove[] = [];
    const starters: RunnerId[] = ['B', 2, 1, 0];
    for (const r of starters) {
      if (r !== 'B' && !before.bases[r]) continue;
      const at = occ.indexOf(r);
      let to: RunnerDest | null = null;
      if (scored.includes(r)) to = 'home';
      else if (retired.includes(r)) to = 'out';
      else if (at >= 0 && at !== r) to = at as 0 | 1 | 2;
      if (to !== null) moves.push({ runner: r, to });
    }
    const bases: Bases = inningOver ? emptyBases() : [occ[0] !== null, occ[1] !== null, occ[2] !== null];
    return {
      sit: { bases, outs, balls: atBatOver || inningOver ? 0 : balls, strikes: atBatOver || inningOver ? 0 : strikes },
      runs: scored.length,
      atBatOver: atBatOver || inningOver,
      batterDone: opts.batterDone ?? atBatOver,
      inningOver,
      result,
      steal,
      moves,
    };
  };

  // Steals happen first, while the pitch is on its way.
  if ('steal' in outcome && outcome.steal) {
    const to = stealTarget(before.bases);
    steal = { result: outcome.steal, to };
    const from = to - 2; // base index of the runner
    const runner = occ[from]!;
    occ[from] = null;
    if (outcome.steal === 'safe') occ[from + 1] = runner;
    else retire(runner);
    // On a steal of third, the runner behind moves up to second either way.
    if (to === 3 && occ[0] !== null) {
      occ[1] = occ[0];
      occ[0] = null;
    }
    if (outs >= 3) return finish(null, { batterDone: false });
  }

  let result: AtBatResult | null = null;
  switch (outcome.kind) {
    case 'ball':
      if (outcome.wild) moveAll(1);
      balls++;
      if (balls >= BALLS_FOR_WALK) {
        force();
        result = 'walk';
      }
      break;
    case 'calledStrike':
    case 'swingingStrike':
    case 'buntFoul':
      strikes++;
      if (strikes >= STRIKES_FOR_OUT) {
        outs++; // the batter stays at the plate; no runner move to animate
        result = 'strikeout';
      }
      break;
    case 'foul':
      if (strikes < FOUL_STRIKE_LIMIT) strikes++;
      break;
    case 'sacrifice':
      retire('B');
      if (outs < 3) moveAll(1);
      result = 'sacrifice';
      break;
    case 'buntHit':
      moveAll(1);
      occ[0] = 'B';
      result = 'buntHit';
      break;
    case 'buntOut':
      retire('B');
      result = 'buntOut';
      break;
    case 'inPlay': {
      const hnr = outcome.hitAndRun === true;
      const [r1, r2, r3] = occ;
      switch (outcome.hit) {
        case 'groundout':
          retire('B');
          if (outs < 3) moveAll(1);
          result = 'groundout';
          break;
        case 'doublePlay':
          occ[0] = null;
          if (r1 !== null) retire(r1);
          retire('B');
          if (outs < 3) moveAll(1);
          result = 'doublePlay';
          break;
        case 'popout':
          retire('B');
          result = 'popout';
          break;
        case 'flyout':
          retire('B');
          result = 'flyout';
          if (outs < 3) {
            if (r3 !== null) {
              occ[2] = null;
              scored.push(r3);
              result = 'sacFly';
            }
            if (occ[1] !== null && occ[2] === null) {
              occ[2] = occ[1];
              occ[1] = null;
            }
          }
          break;
        case 'single':
          if (r3 !== null) scored.push(r3);
          if (r2 !== null) scored.push(r2);
          occ = ['B', hnr ? null : r1, hnr ? r1 : null];
          result = 'single';
          break;
        case 'double':
          if (r3 !== null) scored.push(r3);
          if (r2 !== null) scored.push(r2);
          if (r1 !== null && hnr) scored.push(r1);
          occ = [null, 'B', hnr ? null : r1];
          result = 'double';
          break;
        case 'triple':
          for (const r of [r3, r2, r1]) if (r !== null) scored.push(r);
          occ = [null, null, 'B'];
          result = 'triple';
          break;
        case 'homeRun':
          for (const r of [r3, r2, r1]) if (r !== null) scored.push(r);
          scored.push('B');
          occ = [null, null, null];
          result = 'homeRun';
          break;
      }
      break;
    }
  }
  return finish(result);
}
