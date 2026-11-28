import { describe, expect, it } from 'vitest';
import { card } from '../src/engine/cards';
import type { GameState } from '../src/engine/types';
import { ME, TUTORIAL, playScripted } from '../src/ui/tutorial';

describe('tutorial', () => {
  it('every lesson plays out the way its coach text says', () => {
    let s: GameState | null = null;
    for (const step of TUTORIAL) {
      if (step.setup) s = step.setup(s);
      expect(s, step.title).not.toBeNull();
      if (!step.expect) continue;
      expect(step.demo, `${step.title} needs a demo`).toBeDefined();
      const action = step.demo!(s!);
      expect(step.expect.matches(action, s!), `${step.title}: demo matches`).toBe(true);
      const opp = step.opponent?.(s!);
      s = playScripted(s!, action, opp, step.want);
      if (step.want) expect(step.want(s), `${step.title}: outcome rigged`).toBe(true);
    }
  });

  it('the market lesson has something affordable, and wrong moves do not count', () => {
    let s: GameState | null = null;
    for (const step of TUTORIAL) {
      if (step.setup) s = step.setup(s);
      if (step.title === 'The market') {
        expect(s!.market.row.some((id) => card(id).cost <= s!.players[ME].stars)).toBe(true);
        expect(step.expect!.matches({ type: 'endShop', player: ME }, s!)).toBe(false);
      }
      if (step.title === 'Read the pitch') {
        expect(step.expect!.matches({ type: 'bat', player: ME, choice: { action: 'take' } }, s!)).toBe(false);
      }
      if (step.expect && step.demo) s = playScripted(s!, step.demo(s!), step.opponent?.(s!), step.want);
    }
  });
});
