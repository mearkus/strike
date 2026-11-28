import { describe, expect, it } from 'vitest';
import { cardRating, chooseBat, choosePitch, fatigueCost, solveZeroSum, staminaCost } from '../src/ai/ai';
import { outcomeValue, situationValue } from '../src/ai/value';
import { pitchCard } from '../src/engine/cards';
import { isBatChoiceLegal, legalPitchChoices, newGame } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import type { Situation } from '../src/engine/types';

describe('solveZeroSum', () => {
  it('finds the uniform equilibrium of rock-paper-scissors', () => {
    const { row, col, value } = solveZeroSum([
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ]);
    for (const p of [...row, ...col]) expect(p).toBeCloseTo(1 / 3, 1);
    expect(value).toBeCloseTo(0, 1);
  });

  it('plays a dominant strategy', () => {
    const { row } = solveZeroSum([
      [3, 2],
      [1, 0],
    ]);
    expect(row[0]).toBeGreaterThan(0.99);
  });
});

describe('value model', () => {
  const s = (bases: [boolean, boolean, boolean], outs: number, balls = 0, strikes = 0): Situation => ({ bases, outs, balls, strikes });
  it('runners and fewer outs are worth more', () => {
    expect(situationValue(s([true, false, false], 0))).toBeGreaterThan(situationValue(s([false, false, false], 0)));
    expect(situationValue(s([false, false, false], 0))).toBeGreaterThan(situationValue(s([false, false, false], 1)));
    expect(situationValue(s([true, true, true], 2))).toBeGreaterThan(situationValue(s([false, false, false], 2)));
  });
  it('a home run beats a strikeout', () => {
    const sit = s([true, false, false], 1, 1, 2);
    expect(outcomeValue(sit, { kind: 'inPlay', hit: 'homeRun' })).toBeGreaterThan(1.5);
    expect(outcomeValue(sit, { kind: 'swingingStrike' })).toBeLessThan(0);
  });
});

describe('AI choices', () => {
  const game = newGame({ names: ['A', 'B'], ai: ['allstar', 'allstar'], innings: 3, seed: 21 });
  it.each(['rookie', 'veteran', 'allstar'] as const)('%s picks legal pitches and swings', (d) => {
    const rng = new Rng(1);
    for (let i = 0; i < 20; i++) {
      expect(legalPitchChoices(game)).toContain(choosePitch(game, 1, d, rng).card);
      expect(isBatChoiceLegal(game, chooseBat(game, 0, d, rng))).toBe(true);
    }
  });

  it.each(['rookie', 'veteran', 'allstar'] as const)('%s never goes max effort without stamina', (d) => {
    const g = structuredClone(game);
    g.players[1].stamina = 0;
    const rng = new Rng(3);
    for (let i = 0; i < 40; i++) expect(choosePitch(g, 1, d, rng).maxEffort).toBeFalsy();
  });

  it('stamina is dearer when it is scarce', () => {
    // Late in the game, with only a few big spots left to save it for.
    const late = structuredClone(game);
    late.inning = late.config.innings;
    late.sit.outs = 1;
    const scarce = structuredClone(late);
    scarce.players[1].stamina = 1;
    const plenty = structuredClone(late);
    plenty.players[1].stamina = 3;
    expect(staminaCost(scarce, 1)).toBeGreaterThan(staminaCost(plenty, 1));
    scarce.players[1].stamina = 0;
    expect(staminaCost(scarce, 1)).toBe(Infinity);
  });

  it('fatigue matters less as the game runs out', () => {
    const late = structuredClone(game);
    late.inning = late.config.innings;
    expect(fatigueCost(game, 1)).toBeGreaterThan(fatigueCost(late, 1));
    expect(fatigueCost(late, 1)).toBeGreaterThan(0);
  });

  it('the Veteran pitches into the zone more against a hitter it has seen take everything', () => {
    const zoneRate = (g: typeof game) => {
      const rng = new Rng(11);
      let inZone = 0;
      for (let i = 0; i < 300; i++) {
        const c = choosePitch(g, 1, 'veteran', rng).card;
        const id = c === null ? 'tiredArm' : g.players[1].pitching.hand[c];
        if (pitchCard(id).zone === 'strike') inZone++;
      }
      return inZone / 300;
    };
    const patient = structuredClone(game);
    const sample = { pitcher: 1, batter: 0, pitchCard: 'fourSeam', maxEffort: false, landed: 'strike', batChoice: { action: 'take' }, batCard: null, outcome: { kind: 'calledStrike' }, runs: 0, text: '', result: '', situationBefore: game.sit } as const;
    patient.history = Array.from({ length: 20 }, () => structuredClone(sample)) as typeof patient.history;
    patient.players[1].pitching.hand = ['fourSeam', 'highHeat', 'slider', 'dirtCurve', 'curveball'];
    const fresh = structuredClone(game);
    fresh.players[1].pitching.hand = [...patient.players[1].pitching.hand];
    expect(zoneRate(patient)).toBeGreaterThan(zoneRate(fresh) + 0.1);
  });

  it('rates premium cards above starters', () => {
    expect(cardRating(game, 0, 'hammer')).toBeGreaterThan(cardRating(game, 0, 'curveball'));
    expect(cardRating(game, 0, 'barrel')).toBeGreaterThan(cardRating(game, 0, 'swingAway'));
    expect(cardRating(game, 0, 'tiredArm')).toBeLessThan(cardRating(game, 0, 'fourSeam'));
  });
});
