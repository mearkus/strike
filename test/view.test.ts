import { describe, expect, it } from 'vitest';
import { applyAction, battingTeam, newGame, pitchingTeam } from '../src/engine/game';
import { advance } from '../src/engine/situation';
import type { GameState } from '../src/engine/types';
import { chooseAction } from '../src/ai/ai';
import { Rng } from '../src/engine/rng';
import { atBatHtml, atBatPlays, halfInningLine, recapHtml, scoreBugHtml, stageHtml } from '../src/ui/view';

const take = (s: GameState) => {
  s = applyAction(s, { type: 'pitch', player: pitchingTeam(s), choice: { card: 0 } });
  return applyAction(s, { type: 'bat', player: battingTeam(s), choice: { action: 'take' } });
};

describe('at-bat tracker', () => {
  it('lists the pitches of the current at-bat, then the last one once it ends', () => {
    let s = newGame({ names: ['A', 'B'], ai: [null, null], innings: 3, seed: 5 });
    expect(atBatPlays(s)).toEqual({ plays: [], current: true });
    s = take(s);
    let ab = atBatPlays(s);
    // One pitch in: either the at-bat is still going, or it ended on that pitch.
    expect(ab.plays).toHaveLength(1);
    for (let i = 0; i < 12 && atBatPlays(s).current; i++) s = take(s);
    ab = atBatPlays(s);
    expect(ab.current).toBe(false);
    expect(ab.plays.length).toBeGreaterThan(0);
    expect(atBatHtml(s)).toContain('Last at-bat');
    // The next pitch starts a fresh at-bat.
    s = take(s);
    ab = atBatPlays(s);
    expect(ab.plays).toHaveLength(1);
    expect(ab.plays[0]).toBe(s.history[s.history.length - 1]);
  });

  it('score bug shows both teams, the inning and the count', () => {
    const s = newGame({ names: ['Cubs', 'Sox'], ai: [null, null], innings: 3, seed: 1 });
    const html = scoreBugHtml(s, false);
    expect(html).toContain('Cubs');
    expect(html).toContain('Sox');
    expect(html).toContain('1st');
    expect(html.match(/dot ball/g)).toHaveLength(3);
  });
});

describe('field animation markup', () => {
  /** Force a specific outcome onto the last play, as if it just happened. */
  function after(outcome: GameState['history'][number]['outcome'], bases: [boolean, boolean, boolean]): GameState {
    let s = newGame({ names: ['A', 'B'], ai: [null, null], innings: 3, seed: 2 });
    s = take(s);
    s = structuredClone(s);
    const before = { bases, outs: 0, balls: 0, strikes: 0 };
    const adv = advance(before, outcome);
    s.lastPlay = { ...s.lastPlay!, outcome, situationBefore: before, moves: adv.moves };
    s.sit = adv.sit;
    return s;
  }

  it('a single with a runner on second: batter runs to first, runner scores, ball flies', () => {
    const html = stageHtml(after({ kind: 'inPlay', hit: 'single' }, [false, true, false]), true);
    const runners = [...html.matchAll(/class="runner[^"]*" r="7" data-path="([^"]+)"[^>]*data-end="(\w+)"/g)].map((m) => [m[1].split(' ').pop(), m[2]]);
    expect(runners).toContainEqual(['182.0,82.0,1', 'stay']); // batter ends on first
    expect(runners).toContainEqual(['100.0,162.0,1', 'score']); // runner from second comes home
    expect(html).toContain('+1');
    expect(html.match(/class="ball"/g)!.length).toBe(2); // the pitch and the batted ball
  });

  it('a called third strike gets a backwards K; no animation when not animating', () => {
    const s = after({ kind: 'calledStrike' }, [false, false, false]);
    s.lastPlay!.situationBefore.strikes = 2;
    expect(stageHtml(s, true)).toContain('stamp k looking');
    expect(stageHtml(s, false)).not.toContain('data-path');
  });

  it('runners who stay put are drawn on their bases', () => {
    const s = after({ kind: 'foul' }, [true, false, true]);
    const html = stageHtml(s, false);
    expect(html.match(/class="runner"/g)!.length).toBe(2);
  });
});

describe('inning recap', () => {
  it('summarizes the half-inning that just ended', () => {
    let s = newGame({ names: ['Cubs', 'Sox'], ai: ['veteran', 'veteran'], innings: 3, seed: 8 });
    const rng = new Rng(8);
    while (s.phase === 'pitch') {
      const p = s.pending.pitch ? battingTeam(s) : pitchingTeam(s);
      s = applyAction(s, chooseAction(s, p, 'veteran', rng));
    }
    expect(s.phase).toBe('shop');
    const line = halfInningLine(s, 1, 'top');
    expect(line.runs).toBe(s.players[0].runsByInning[0]);
    expect(line.hits).toBeLessThanOrEqual(s.players[0].hits);
    const html = recapHtml(s);
    expect(html).toContain('Three outs');
    expect(html).toContain('End of the top of the 1st');
    expect(html).toContain('the bottom of the 1st');
    expect(html).toContain('data-act="nextInning"');
  });
});
