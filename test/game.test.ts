import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/ai/ai';
import { BAT_HAND_SIZE, PITCH_HAND_SIZE, STARTER_BATTING, STARTER_PITCHING, card } from '../src/engine/cards';
import {
  IllegalAction,
  MIN_DECK_SIZE,
  applyAction,
  battingTeam,
  deckList,
  legalBatChoices,
  newGame,
  pitchingTeam,
  score,
  waitingOn,
} from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import type { BatChoice, Difficulty, GameState } from '../src/engine/types';

const start = (seed = 1, innings = 3) => newGame({ names: ['Away', 'Home'], ai: [null, null], innings, seed });

/** Pitch a given card index vs a given batting choice. */
function pitch(s: GameState, card: number | null, bat: BatChoice) {
  s = applyAction(s, { type: 'pitch', player: pitchingTeam(s), choice: { card } });
  return applyAction(s, { type: 'bat', player: battingTeam(s), choice: bat });
}

function autoplay(s: GameState, diff: [Difficulty, Difficulty], seed = 5, stopWhen?: (s: GameState) => boolean): GameState {
  const rng = new Rng(seed);
  for (let guard = 0; s.phase !== 'gameOver' && guard < 5000; guard++) {
    if (stopWhen?.(s)) return s;
    const p = waitingOn(s)[0];
    s = applyAction(s, chooseAction(s, p, diff[p], rng));
  }
  return s;
}

describe('new game', () => {
  it('deals starter decks and hands', () => {
    const s = start();
    for (const p of s.players) {
      expect(p.pitching.hand).toHaveLength(PITCH_HAND_SIZE);
      expect(p.batting.hand).toHaveLength(BAT_HAND_SIZE);
      expect(deckList(p.pitching).sort()).toEqual([...STARTER_PITCHING].sort());
      expect(deckList(p.batting).sort()).toEqual([...STARTER_BATTING].sort());
    }
    expect(s.market.row).toHaveLength(6);
    expect(waitingOn(s).sort()).toEqual([0, 1]);
  });

  it('is deterministic for a seed', () => {
    const a = autoplay(start(9), ['veteran', 'veteran']);
    const b = autoplay(start(9), ['veteran', 'veteran']);
    expect(a.log).toEqual(b.log);
  });
});

describe('pitching and batting', () => {
  it('waits for both sides, then resolves and moves cards to discard', () => {
    let s = start();
    const pid = pitchingTeam(s);
    const thrown = s.players[pid].pitching.hand[0];
    s = applyAction(s, { type: 'pitch', player: pid, choice: { card: 0 } });
    expect(s.lastPlay).toBeNull();
    expect(waitingOn(s)).toEqual([battingTeam(s)]);
    s = applyAction(s, { type: 'bat', player: battingTeam(s), choice: { action: 'take' } });
    expect(s.lastPlay?.pitchCard).toBe(thrown);
    expect(s.players[pid].pitching.discard).toContain(thrown);
    expect(s.history).toHaveLength(1);
  });

  it('rejects out-of-turn and illegal actions', () => {
    const s = start();
    expect(() => applyAction(s, { type: 'pitch', player: battingTeam(s), choice: { card: 0 } })).toThrow(IllegalAction);
    expect(() => applyAction(s, { type: 'pitch', player: pitchingTeam(s), choice: { card: 99 } })).toThrow(IllegalAction);
    expect(() => applyAction(s, { type: 'pitch', player: pitchingTeam(s), choice: { card: null } })).toThrow(IllegalAction);
    expect(() => applyAction(s, { type: 'buy', player: 0, marketIndex: 0 })).toThrow(IllegalAction);
  });

  it('does not allow a steal with nobody on base', () => {
    const s = start();
    const hand = s.players[battingTeam(s)].batting.hand;
    const steal = hand.findIndex((id) => id === 'steal');
    const legal = legalBatChoices(s);
    if (steal >= 0) expect(legal).not.toContainEqual({ action: 'play', card: steal });
    expect(legal).toContainEqual({ action: 'take' });
    expect(legal).toContainEqual({ action: 'hack' });
  });

  it('a pitcher with an empty hand must throw a meatball', () => {
    let s = start();
    const pid = pitchingTeam(s);
    s = structuredClone(s);
    s.players[pid].pitching.discard.push(...s.players[pid].pitching.hand);
    s.players[pid].pitching.hand = [];
    s = pitch(s, null, { action: 'take' });
    expect(s.lastPlay?.pitchCard).toBe('tiredArm');
    expect(['calledStrike', 'ball']).toContain(s.lastPlay?.outcome.kind);
    expect(() => applyAction(s, { type: 'pitch', player: pitchingTeam(s), choice: { card: null, maxEffort: true } })).toThrow(IllegalAction);
  });

  it('max effort adds stuff and shuffles a Tired Arm into the draw pile', () => {
    let s = start(2);
    const pid = pitchingTeam(s);
    const tiredBefore = deckList(s.players[pid].pitching).filter((id) => id === 'tiredArm').length;
    const drawBefore = s.players[pid].pitching.draw.length;
    s = applyAction(s, { type: 'pitch', player: pid, choice: { card: 0, maxEffort: true } });
    s = applyAction(s, { type: 'bat', player: battingTeam(s), choice: { action: 'take' } });
    expect(s.lastPlay?.maxEffort).toBe(true);
    expect(s.lastPlay?.text).toMatch(/^MAX EFFORT/);
    const pile = s.players[pid].pitching;
    expect(deckList(pile).filter((id) => id === 'tiredArm').length).toBe(tiredBefore + 1);
    // The at-bat may not be over, so no refill: the draw pile grew by exactly one.
    if (s.history.length === 1 && !s.lastPlay?.result.includes('Strike three')) expect(pile.draw.length).toBe(drawBefore + 1);
  });

  it('an Easy pitch removes a Tired Arm from the hand for good', () => {
    let s = structuredClone(start(3));
    const pid = pitchingTeam(s);
    s.players[pid].pitching.hand = ['changeup', 'tiredArm', 'fourSeam'];
    const before = deckList(s.players[pid].pitching).filter((id) => id === 'tiredArm').length;
    s = pitch(s, 0, { action: 'take' });
    expect(s.players[pid].pitching.hand).not.toContain('tiredArm');
    expect(deckList(s.players[pid].pitching).filter((id) => id === 'tiredArm').length).toBe(before - 1);
    expect(s.lastPlay?.result).toMatch(/Easy on the arm/);
  });

  it('a swing card comes back when the pitch ends up in the dirt', () => {
    for (let seed = 1; seed < 400; seed++) {
      let s = structuredClone(start(seed));
      const pid = pitchingTeam(s);
      const bid = battingTeam(s);
      s.players[pid].pitching.hand = ['dirtCurve'];
      s.players[bid].batting.hand = ['moonshot'];
      s = pitch(s, 0, { action: 'play', card: 0 });
      if (s.lastPlay?.landed === 'dirt') {
        expect(s.lastPlay.outcome).toMatchObject({ kind: 'ball', dirt: true });
        expect(s.players[bid].batting.hand).toContain('moonshot');
        expect(s.lastPlay.result).toMatch(/In the dirt/);
        return;
      }
    }
    throw new Error('never landed in the dirt');
  });
});

describe('innings and shopping', () => {
  it('three outs lead to the shop, then the other team bats', () => {
    let s = autoplay(start(3), ['veteran', 'veteran'], 3, (g) => g.phase === 'shop');
    expect(s.phase).toBe('shop');
    expect(s.half).toBe('top');
    // The pitcher picked up a fatigue card.
    expect(deckList(s.players[1].pitching)).toContain('tiredArm');
    const first = s.shop!.order[0];
    s = applyAction(s, { type: 'endShop', player: first });
    s = applyAction(s, { type: 'endShop', player: s.shop!.order[1] });
    expect(s.phase).toBe('pitch');
    expect(s.half).toBe('bottom');
    expect(battingTeam(s)).toBe(1);
    expect(s.sit).toEqual({ bases: [false, false, false], outs: 0, balls: 0, strikes: 0 });
  });

  it('buying spends stars and adds the card to the right deck; releasing removes one', () => {
    let s = autoplay(start(4), ['veteran', 'veteran'], 4, (g) => g.phase === 'shop');
    s = structuredClone(s);
    const who = s.shop!.order[0];
    s.players[who].stars = 20;
    const id = s.market.row[0];
    const c = card(id);
    const before = s.market.row.length;
    s = applyAction(s, { type: 'buy', player: who, marketIndex: 0 });
    expect(s.players[who].stars).toBe(20 - c.cost);
    expect(s.market.row).toHaveLength(before);
    expect(deckList(s.players[who][c.kind === 'pitch' ? 'pitching' : 'batting'])).toContain(id);

    const size = deckList(s.players[who].batting).length;
    s = applyAction(s, { type: 'release', player: who, deck: 'batting', cardId: 'swingAway' });
    expect(deckList(s.players[who].batting)).toHaveLength(size - 1);
    expect(() => applyAction(s, { type: 'release', player: who, deck: 'batting', cardId: 'swingAway' })).toThrow(/Already released/);
  });

  it('cannot release below the minimum deck size', () => {
    let s = autoplay(start(4), ['veteran', 'veteran'], 4, (g) => g.phase === 'shop');
    s = structuredClone(s);
    const who = s.shop!.order[0];
    const pile = s.players[who].batting;
    pile.draw = pile.draw.slice(0, Math.max(0, MIN_DECK_SIZE - pile.hand.length));
    pile.discard = [];
    s.players[who].stars = 5;
    const id = deckList(pile)[0];
    expect(() => applyAction(s, { type: 'release', player: who, deck: 'batting', cardId: id })).toThrow(/too small/);
  });
});

describe('full games', () => {
  it.each([
    ['rookie', 'rookie'],
    ['veteran', 'allstar'],
    ['allstar', 'rookie'],
  ] as Array<[Difficulty, Difficulty]>)('%s vs %s plays to a legal finish', (a, b) => {
    const s = autoplay(start(11, 3), [a, b], 11);
    expect(s.phase).toBe('gameOver');
    const away = score(s, 0);
    const home = score(s, 1);
    if (s.winner === 0) expect(away).toBeGreaterThan(home);
    if (s.winner === 1) expect(home).toBeGreaterThan(away);
    if (s.winner === 'tie') expect(home).toBe(away);
    expect(s.inning).toBeGreaterThanOrEqual(3);
  });

  it('skips the bottom of the last inning when the home team leads, and walks off', () => {
    for (let seed = 1; seed < 16; seed++) {
      const s = autoplay(start(seed, 3), ['veteran', 'veteran'], seed);
      const last = s.log[s.log.length - 1].text;
      if (s.winner === 1 && s.half === 'top') expect(score(s, 1)).toBeGreaterThan(score(s, 0));
      if (/Walk-off/.test(last)) {
        expect(s.half).toBe('bottom');
        expect(score(s, 1) - score(s, 0)).toBeGreaterThan(0);
        expect(score(s, 1) - score(s, 0)).toBeLessThanOrEqual(4);
      }
    }
  }, 30_000);

  it('extra innings start with a runner on second', { timeout: 30_000 }, () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = autoplay(start(seed, 1), ['rookie', 'rookie'], seed, (g) => g.inning === 2 && g.phase === 'pitch');
      if (s.phase === 'pitch' && s.inning === 2) {
        expect(s.log.some((e) => /Extra innings/.test(e.text))).toBe(true);
        return;
      }
    }
    throw new Error('no extra-inning game found');
  });
});
