import { describe, expect, it } from 'vitest';
import { applyAction, battingTeam, newGame, pitchingTeam } from '../src/engine/game';
import type { GameState } from '../src/engine/types';
import { atBatHtml, atBatPlays, scoreBugHtml } from '../src/ui/view';

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
