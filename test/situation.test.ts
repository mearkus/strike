import { describe, expect, it } from 'vitest';
import { advance, BALLS_FOR_WALK, freshSituation } from '../src/engine/situation';
import type { Bases, PitchOutcome, Situation } from '../src/engine/types';

const sit = (bases: Bases, outs = 0, balls = 0, strikes = 0): Situation => ({ bases, outs, balls, strikes });
const play = (hit: Extract<PitchOutcome, { kind: 'inPlay' }>['hit'], hitAndRun = false): PitchOutcome =>
  hitAndRun ? { kind: 'inPlay', hit, hitAndRun } : { kind: 'inPlay', hit };

describe('count', () => {
  it('walks on ball three-ish and forces runners', () => {
    const r = advance(sit([true, true, true], 1, BALLS_FOR_WALK - 1), { kind: 'ball' });
    expect(r.result).toBe('walk');
    expect(r.runs).toBe(1);
    expect(r.sit.bases).toEqual([true, true, true]);
    expect(r.sit.balls).toBe(0);
  });

  it('does not force a runner who is not forced', () => {
    const r = advance(sit([false, false, true], 0, BALLS_FOR_WALK - 1), { kind: 'ball' });
    expect(r.runs).toBe(0);
    expect(r.sit.bases).toEqual([true, false, true]);
  });

  it('strikes out on strike three', () => {
    const r = advance(sit([false, false, false], 0, 1, 2), { kind: 'swingingStrike' });
    expect(r.result).toBe('strikeout');
    expect(r.sit.outs).toBe(1);
    expect(r.atBatOver).toBe(true);
  });

  it('two-strike fouls do not add a strike, but foul bunts do', () => {
    expect(advance(sit([false, false, false], 0, 0, 2), { kind: 'foul' }).sit.strikes).toBe(2);
    expect(advance(sit([false, false, false], 0, 0, 2), { kind: 'buntFoul' }).result).toBe('strikeout');
  });

  it('third out ends the inning and clears the bases', () => {
    const r = advance(sit([true, true, false], 2, 0, 2), { kind: 'calledStrike' });
    expect(r.inningOver).toBe(true);
    expect(r.sit.bases).toEqual([false, false, false]);
  });
});

describe('balls in play', () => {
  it('single scores runners from second and third, runner on first to second', () => {
    const r = advance(sit([true, true, true]), play('single'));
    expect(r.runs).toBe(2);
    expect(r.sit.bases).toEqual([true, true, false]);
  });

  it('hit and run sends the runner from first to third on a single', () => {
    const r = advance(sit([true, false, false]), play('single', true));
    expect(r.sit.bases).toEqual([true, false, true]);
  });

  it('double: runner on first to third', () => {
    const r = advance(sit([true, true, false]), play('double'));
    expect(r.runs).toBe(1);
    expect(r.sit.bases).toEqual([false, true, true]);
  });

  it('grand slam', () => {
    const r = advance(sit([true, true, true]), play('homeRun'));
    expect(r.runs).toBe(4);
    expect(r.sit.bases).toEqual([false, false, false]);
  });

  it('sacrifice fly scores the runner on third with less than two outs', () => {
    const r = advance(sit([false, false, true], 1), play('flyout'));
    expect(r.result).toBe('sacFly');
    expect(r.runs).toBe(1);
  });

  it('no run scores on a fly ball for the third out', () => {
    const r = advance(sit([false, false, true], 2), play('flyout'));
    expect(r.runs).toBe(0);
    expect(r.inningOver).toBe(true);
  });

  it('double play removes the runner on first and the batter', () => {
    const r = advance(sit([true, false, true], 0), play('doublePlay'));
    expect(r.sit.outs).toBe(2);
    expect(r.runs).toBe(1);
    expect(r.sit.bases).toEqual([false, false, false]);
  });

  it('sacrifice bunt moves everyone up', () => {
    const r = advance(sit([true, true, false], 0), { kind: 'sacrifice' });
    expect(r.sit.outs).toBe(1);
    expect(r.sit.bases).toEqual([false, true, true]);
  });
});

describe('runner moves', () => {
  it('single: runner from second scores, runner from first to second, batter to first', () => {
    const r = advance(sit([true, true, false]), play('single'));
    expect(r.moves).toEqual([
      { runner: 'B', to: 0 },
      { runner: 1, to: 'home' },
      { runner: 0, to: 1 },
    ]);
  });

  it('double play: runner from first and batter out, runner from third scores', () => {
    const r = advance(sit([true, false, true], 0), play('doublePlay'));
    expect(r.moves).toEqual([
      { runner: 'B', to: 'out' },
      { runner: 2, to: 'home' },
      { runner: 0, to: 'out' },
    ]);
  });

  it('grand slam: everyone comes home', () => {
    expect(advance(sit([true, true, true]), play('homeRun')).moves.map((m) => m.to)).toEqual(['home', 'home', 'home', 'home']);
  });

  it('walk with the bases loaded forces everyone up one', () => {
    const r = advance(sit([true, true, true], 0, BALLS_FOR_WALK - 1), { kind: 'ball' });
    expect(r.moves).toEqual([
      { runner: 'B', to: 0 },
      { runner: 2, to: 'home' },
      { runner: 1, to: 2 },
      { runner: 0, to: 1 },
    ]);
  });

  it('a runner who is not forced stays put on a walk', () => {
    expect(advance(sit([false, true, false], 0, BALLS_FOR_WALK - 1), { kind: 'ball' }).moves).toEqual([{ runner: 'B', to: 0 }]);
  });

  it('sac fly: batter out, runner from third scores', () => {
    expect(advance(sit([false, false, true], 1), play('flyout')).moves).toEqual([
      { runner: 'B', to: 'out' },
      { runner: 2, to: 'home' },
    ]);
  });

  it('strikeouts and plain balls move nobody', () => {
    expect(advance(sit([true, false, false], 0, 0, 2), { kind: 'swingingStrike' }).moves).toEqual([]);
    expect(advance(sit([true, false, false]), { kind: 'ball' }).moves).toEqual([]);
  });

  it('steals: safe at second, or caught at third with the trailing runner moving up', () => {
    expect(advance(sit([true, false, false]), { kind: 'ball', steal: 'safe' }).moves).toEqual([{ runner: 0, to: 1 }]);
    expect(advance(sit([true, true, false]), { kind: 'ball', steal: 'caught' }).moves).toEqual([
      { runner: 1, to: 'out' },
      { runner: 0, to: 1 },
    ]);
  });
});

describe('wild pitches', () => {
  it('move every runner up a base and still count as a ball', () => {
    const r = advance(sit([true, false, true], 1, 1, 1), { kind: 'ball', dirt: true, wild: true });
    expect(r.runs).toBe(1);
    expect(r.sit.bases).toEqual([false, true, false]);
    expect(r.sit.balls).toBe(2);
  });

  it('a wild ball four scores the runner from third and puts the batter on first', () => {
    const r = advance(sit([false, false, true], 0, BALLS_FOR_WALK - 1, 0), { kind: 'ball', wild: true });
    expect(r.result).toBe('walk');
    expect(r.runs).toBe(1);
    expect(r.sit.bases).toEqual([true, false, false]);
  });
});

describe('steals', () => {
  it('a safe steal moves the lead runner and the count still applies', () => {
    const r = advance(sit([true, false, false], 0, 0, 0), { kind: 'calledStrike', steal: 'safe' });
    expect(r.sit.bases).toEqual([false, true, false]);
    expect(r.sit.strikes).toBe(1);
    expect(r.steal).toEqual({ result: 'safe', to: 2 });
  });

  it('a double steal moves both runners', () => {
    const r = advance(sit([true, true, false]), { kind: 'ball', steal: 'safe' });
    expect(r.sit.bases).toEqual([false, true, true]);
  });

  it('caught stealing for the third out ends the inning without finishing the at-bat', () => {
    const r = advance(sit([true, false, false], 2, 1, 1), { kind: 'ball', steal: 'caught' });
    expect(r.inningOver).toBe(true);
    expect(r.batterDone).toBe(false);
  });

  it('fresh situation is empty', () => {
    expect(freshSituation()).toEqual(sit([false, false, false]));
  });
});
