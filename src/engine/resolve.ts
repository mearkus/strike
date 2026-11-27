import { readMod } from './cards';
import type {
  BallInPlay,
  Bases,
  PitchCardDef,
  PitchOutcome,
  Situation,
  StealResult,
  SwingCardDef,
  TacticCardDef,
  ThrownType,
  Zone,
} from './types';

/** What the batter actually does on this pitch, with the card looked up. */
export type BatAction =
  | { kind: 'take' }
  | { kind: 'swing'; card: SwingCardDef }
  | { kind: 'tactic'; card: TacticCardDef };

export interface PitchContext {
  pitch: PitchCardDef;
  bat: BatAction;
  sit: Situation;
  /** Pitch types already thrown this at-bat, oldest first. */
  abPitches: ThrownType[];
}

export const ZONE_CONTACT: Record<Zone, number> = { strike: 1, edge: -1, chase: -3 };
/** Taken edge pitches are called strikes on a d6 roll of this or higher (a coin flip). */
export const EDGE_STRIKE_ROLL = 4;

/** Swinging at a non-deceptive chase pitch: hold up on a d6 roll of this or higher. */
export const CHECK_SWING_ROLL = 4;
export const MISS_MAX = 3; // contact <= 3: swing and miss
export const FOUL_MAX = 7; // contact 4-7: foul; 8+: in play

export function effectiveStuff(pitch: PitchCardDef, abPitches: ThrownType[]): number {
  let stuff = pitch.stuff;
  if (pitch.effects.includes('tunnel') && abPitches[abPitches.length - 1] === 'heat') stuff += 2;
  return stuff;
}

export function swingRead(pitch: PitchCardDef, swing: SwingCardDef): number {
  const r = readMod(swing.sit, pitch.type);
  return pitch.effects.includes('eephus') ? r * 2 : r;
}

const risp = (b: Bases) => b[1] || b[2];

/** Everything about a swing except the dice: added to 2d6 for contact, and to 1d6 for quality. */
export function swingModifiers(ctx: PitchContext, swing: SwingCardDef): { contact: number; quality: number; read: number } {
  const { pitch, sit, abPitches } = ctx;
  const read = swingRead(pitch, swing);
  let contact = swing.contact + read - effectiveStuff(pitch, abPitches) + ZONE_CONTACT[pitch.zone];
  let quality = swing.power;

  if (swing.effects.includes('protect') && sit.strikes === 2) contact += 3;
  if (swing.effects.includes('clutch') && risp(sit.bases)) {
    contact += 2;
    quality += 1;
  }
  if (swing.effects.includes('timing') && pitch.type !== 'knuckle' && abPitches.includes(pitch.type)) contact += 3;
  if (swing.effects.includes('ambush') && sit.balls === 0 && sit.strikes === 0) quality += 2;

  if (pitch.effects.includes('cutter')) quality -= 1;
  if (pitch.effects.includes('sinker')) quality -= 1;
  if (pitch.effects.includes('weakContact')) quality -= 1;
  if (pitch.effects.includes('meatball')) quality += 1;
  return { contact, quality, read };
}

/** Quality (2d6 + modifiers) of a ball in play. Contact hitters (power <= 0) leg out triples instead of homers. */
export function qualityToHit(q: number, power: number): BallInPlay {
  if (q <= 5) return 'groundout';
  if (q === 6) return 'popout';
  if (q <= 8) return 'flyout';
  if (q <= 10) return 'single';
  if (q === 11) return 'double';
  return power <= 0 ? 'triple' : 'homeRun';
}

export function canDoublePlay(sit: Situation): boolean {
  return sit.bases[0] && sit.outs < 2;
}

/** Steal eligibility: the lead runner needs an open base ahead (no steals of home). */
export function canSteal(bases: Bases): boolean {
  return (bases[0] && !bases[1]) || (bases[1] && !bases[2]);
}

export function stealTarget(bases: Bases): 2 | 3 {
  return bases[1] && !bases[2] ? 3 : 2;
}

export function stealSuccessNeeded(pitch: PitchCardDef, bases: Bases, bonus: number): number {
  // Roll d6 + bonus + mods >= 4.
  let mods = bonus;
  if (pitch.type !== 'heat') mods += 1;
  if (stealTarget(bases) === 3) mods -= 1;
  return 4 - mods;
}

export function stealResult(pitch: PitchCardDef, bases: Bases, bonus: number, d6: number): StealResult {
  if (pitch.effects.includes('pitchout')) return 'caught';
  return d6 >= stealSuccessNeeded(pitch, bases, bonus) ? 'safe' : 'caught';
}

export function canCheckSwing(pitch: PitchCardDef): boolean {
  return pitch.zone === 'chase' && !pitch.effects.includes('deceptive');
}

/** `sum2d6` is the contact roll, `quality2d6` the quality roll. */
export function swingOutcome(ctx: PitchContext, swing: SwingCardDef, sum2d6: number, quality2d6: number): PitchOutcome {
  const mods = swingModifiers(ctx, swing);
  const contact = sum2d6 + mods.contact;
  if (contact <= MISS_MAX) {
    if (swing.effects.includes('spoil') && ctx.sit.strikes === 2 && contact >= MISS_MAX - 2) return { kind: 'foul' };
    return { kind: 'swingingStrike' };
  }
  if (contact <= FOUL_MAX) return { kind: 'foul' };
  let q = quality2d6 + mods.quality;
  if (contact >= 11) q += 1;
  if (contact >= 14) q += 1;
  let hit = qualityToHit(q, swing.power);
  const hitAndRun = swing.effects.includes('hitAndRun');
  if (hit === 'groundout' && !hitAndRun && canDoublePlay(ctx.sit)) {
    const dpMax = ctx.pitch.effects.includes('sinker') ? 4 : 3;
    if (q <= dpMax) hit = 'doublePlay';
  }
  return hitAndRun ? { kind: 'inPlay', hit, hitAndRun: true } : { kind: 'inPlay', hit };
}

export function buntScore(ctx: PitchContext, bonus: number, d6: number): number {
  const zone = { strike: 0, edge: -1, chase: -2 }[ctx.pitch.zone];
  return d6 + bonus + zone - (effectiveStuff(ctx.pitch, ctx.abPitches) >= 3 ? 1 : 0);
}

export function isSacrificeSpot(sit: Situation): boolean {
  return sit.outs < 2 && (sit.bases[0] || sit.bases[1] || sit.bases[2]);
}

export function buntOutcome(ctx: PitchContext, bonus: number, d6: number): PitchOutcome {
  const score = buntScore(ctx, bonus, d6);
  if (isSacrificeSpot(ctx.sit)) {
    if (score >= 3) return { kind: 'sacrifice' };
    return score <= 0 ? { kind: 'buntOut' } : { kind: 'buntFoul' };
  }
  if (score >= 6) return { kind: 'buntHit' };
  if (score >= 3) return { kind: 'buntOut' };
  return { kind: 'buntFoul' };
}

/** A taken pitch: strikes are strikes, chases are balls, the edge is the umpire's call. */
function takeOutcome(pitch: PitchCardDef, umpire: number): PitchOutcome {
  if (pitch.zone === 'strike') return { kind: 'calledStrike' };
  if (pitch.zone === 'chase') return { kind: 'ball' };
  return umpire >= EDGE_STRIKE_ROLL ? { kind: 'calledStrike' } : { kind: 'ball' };
}

/** Called-strike chance for a taken pitch. */
export function calledStrikeChance(zone: Zone): number {
  return zone === 'strike' ? 1 : zone === 'chase' ? 0 : (7 - EDGE_STRIKE_ROLL) / 6;
}

function takeDistribution(pitch: PitchCardDef): Array<[PitchOutcome, number]> {
  const p = calledStrikeChance(pitch.zone);
  const out: Array<[PitchOutcome, number]> = [];
  if (p > 0) out.push([{ kind: 'calledStrike' }, p]);
  if (p < 1) out.push([{ kind: 'ball' }, 1 - p]);
  return out;
}

/**
 * Resolve one pitch. `d6` supplies dice; it is called in a fixed order
 * (2d6 then 1d6 for swings, 1d6 for steals and bunts, 1d6 umpire for takes) so outcomes are reproducible.
 */
export function resolvePitch(ctx: PitchContext, d6: () => number): PitchOutcome {
  const { bat, pitch, sit } = ctx;
  if (bat.kind === 'take') return takeOutcome(pitch, d6());
  if (bat.kind === 'swing') {
    if (canCheckSwing(pitch) && d6() >= CHECK_SWING_ROLL) return { kind: 'ball', checkSwing: true };
    const sum = d6() + d6();
    const q = d6() + d6();
    const out = swingOutcome(ctx, bat.card, sum, q);
    if (out.kind === 'swingingStrike' && bat.card.effects.includes('hitAndRun') && canSteal(sit.bases)) {
      return { ...out, steal: stealResult(pitch, sit.bases, 0, d6()) };
    }
    return out;
  }
  const t = bat.card;
  if (t.tactic === 'bunt') return buntOutcome(ctx, t.bonus, d6());
  if (t.tactic === 'steal' && canSteal(sit.bases)) {
    const steal = stealResult(pitch, sit.bases, t.bonus, d6());
    return { ...takeOutcome(pitch, d6()), steal } as PitchOutcome;
  }
  return takeOutcome(pitch, d6());
}

const TWO_D6: Array<[number, number]> = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => [s, (6 - Math.abs(s - 7)) / 36]);

export interface WeightedOutcome {
  outcome: PitchOutcome;
  p: number;
}

/** Exact probability distribution of outcomes for a pitch/bat pairing. Used by the AI. */
export function outcomeDistribution(ctx: PitchContext): WeightedOutcome[] {
  const { bat, pitch, sit } = ctx;
  const acc = new Map<string, WeightedOutcome>();
  const add = (o: PitchOutcome, p: number) => {
    const key = JSON.stringify(o);
    const e = acc.get(key);
    if (e) e.p += p;
    else acc.set(key, { outcome: o, p });
  };
  if (bat.kind === 'take') {
    for (const [o, p] of takeDistribution(pitch)) add(o, p);
  } else if (bat.kind === 'swing') {
    let pSwing = 1;
    if (canCheckSwing(pitch)) {
      const pCheck = (7 - CHECK_SWING_ROLL) / 6;
      add({ kind: 'ball', checkSwing: true }, pCheck);
      pSwing = 1 - pCheck;
    }
    for (const [sum, pSum] of TWO_D6) {
      const p2 = pSum * pSwing;
      if (sum + swingModifiers(ctx, bat.card).contact <= FOUL_MAX) {
        // Miss or foul: the quality roll doesn't matter.
        const o = swingOutcome(ctx, bat.card, sum, 7);
        if (o.kind === 'swingingStrike' && bat.card.effects.includes('hitAndRun') && canSteal(sit.bases)) {
          for (let r = 1; r <= 6; r++) add({ ...o, steal: stealResult(pitch, sit.bases, 0, r) }, p2 / 6);
        } else add(o, p2);
        continue;
      }
      for (const [q, pq] of TWO_D6) add(swingOutcome(ctx, bat.card, sum, q), p2 * pq);
    }
  } else if (bat.card.tactic === 'bunt') {
    for (let r = 1; r <= 6; r++) add(buntOutcome(ctx, bat.card.bonus, r), 1 / 6);
  } else if (bat.card.tactic === 'steal' && canSteal(sit.bases)) {
    for (let r = 1; r <= 6; r++) {
      const steal = stealResult(pitch, sit.bases, bat.card.bonus, r);
      for (const [o, p] of takeDistribution(pitch)) add({ ...o, steal } as PitchOutcome, p / 6);
    }
  } else {
    for (const [o, p] of takeDistribution(pitch)) add(o, p);
  }
  return [...acc.values()];
}
