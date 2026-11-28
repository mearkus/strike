import { HACK, MEATBALL, PITCH_HAND_SIZE, batCard, card, pitchCard } from '../engine/cards';
import { ECONOMY, RELEASE_COST, MIN_DECK_SIZE, STAMINA, battingTeam, deckList, isBatChoiceLegal, pitchingTeam, score } from '../engine/game';
import { type BatAction, MAX_EFFORT_STUFF, canSteal } from '../engine/resolve';
import { BALLS_FOR_WALK } from '../engine/situation';
import { Rng } from '../engine/rng';
import type { Action, BatChoice, DeckName, Difficulty, GameState, PitchCardDef, PitchChoice, PlayerId, Situation, ThrownType, Zone } from '../engine/types';
import { expectedValue, outcomeValue } from './value';

// ---------------------------------------------------------------- options

interface PitchOption {
  key: string;
  choice: PitchChoice;
  pitch: PitchCardDef;
  /** Thrown with max effort: more stuff, one more Tired Arm. */
  effort: boolean;
  /** Prior weight when this is the opponent's option (copies in their unseen pool). */
  weight: number;
}

interface BatOption {
  key: string;
  choice: BatChoice;
  bat: BatAction;
  weight: number;
}

function toBatAction(id: string): BatAction {
  const c = batCard(id);
  return c.kind === 'swing' ? { kind: 'swing', card: c } : { kind: 'tactic', card: c };
}

function countIds(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** Walk a batter on purpose only when it's this many runs better than pitching to him. */
const IBB_MARGIN = 0.02;
/** Take a mound visit only when a fresh hand looks at least this many runs better. */
const MOUND_VISIT_MARGIN = 0.03;

/** Run value (to the batting side) of an intentional walk right now; Infinity when it isn't allowed. */
function intentionalWalkValue(s: GameState): number {
  return s.sit.bases[0] ? Infinity : outcomeValue(s.sit, { kind: 'intentionalWalk' });
}

/** The Veteran's picture of a hitter: its prior, blended with what it has seen once it has seen enough. */
function veteranBatModel(s: GameState, opp: PlayerId, bats: BatOption[]): number[] {
  const prior = normalize(bats.map((b) => b.weight));
  const t = tendencies(s, opp, 'bat');
  return t.samples >= VETERAN_SCOUTING_PITCHES ? mix(prior, empiricalBatDist(bats, t, s.sit), 0.7) : prior;
}

/**
 * Should the pitcher use its once-per-half-inning mound visit? Compares the best pitch in the
 * current hand with the expected best pitch of a fresh hand drawn from what's left.
 */
export function shouldVisitMound(s: GameState, me: PlayerId, difficulty: Difficulty, rng: Rng): boolean {
  if (difficulty === 'rookie' || s.moundVisitUsed) return false;
  const pile = s.players[me].pitching;
  if (pile.hand.length === 0) return false;
  const opp = (1 - me) as PlayerId;
  const bats = oppBatOptions(s, opp);
  const model = veteranBatModel(s, opp, bats);
  const value = new Map<string, number>();
  const pitcherValue = (id: string) => {
    if (!value.has(id)) {
      const p = pitchCard(id);
      value.set(id, -bats.reduce((a, b, j) => a + model[j] * expectedValue({ pitch: p, bat: b.bat, sit: s.sit, abPitches: s.abPitches }), 0));
    }
    return value.get(id)!;
  };
  const current = Math.max(...pile.hand.map(pitcherValue));
  // A fresh hand comes from the draw pile, reshuffling the discards (and this hand) if it runs short.
  const pool = pile.draw.length >= PITCH_HAND_SIZE ? [...pile.draw] : [...pile.draw, ...pile.discard, ...pile.hand];
  const size = Math.min(PITCH_HAND_SIZE, pool.length);
  let total = 0;
  const samples = 24;
  for (let k = 0; k < samples; k++) {
    const hand = rng.shuffle([...pool]).slice(0, size);
    total += Math.max(...hand.map(pitcherValue));
  }
  return total / samples - current > MOUND_VISIT_MARGIN;
}

/** The Veteran starts using what it has seen of an opponent after this many of their pitches. */
const VETERAN_SCOUTING_PITCHES = 8;
/** The All-Star: when it starts exploiting, how much it trusts what it saw, and how hard it leans in. */
const ALLSTAR_SCOUTING_PITCHES = 12;
const ALLSTAR_TRUST = 0.5;
const ALLSTAR_EXPLOIT = 0.4;

/** How likely the AI thinks an opponent is to go max effort on a given pitch. */
const EFFORT_PRIOR = 0.2;

/** Add a max-effort variant of every real card. */
function withEffort(opts: PitchOption[], weight = 1): PitchOption[] {
  const out: PitchOption[] = [];
  for (const o of opts) {
    out.push(o);
    out.push({
      ...o,
      key: `${o.key}!`,
      choice: { ...o.choice, maxEffort: true },
      pitch: { ...o.pitch, stuff: o.pitch.stuff + MAX_EFFORT_STUFF },
      effort: true,
      weight: o.weight * weight,
    });
  }
  return out;
}

/** The AI's own pitching options: one per distinct card in hand, each with and without max effort. */
function ownPitchOptions(s: GameState, p: PlayerId): PitchOption[] {
  const hand = s.players[p].pitching.hand;
  if (hand.length === 0) return [{ key: MEATBALL, choice: { card: null }, pitch: pitchCard(MEATBALL), effort: false, weight: 1 }];
  const seen = new Map<string, PitchOption>();
  hand.forEach((id, i) => {
    const e = seen.get(id);
    if (e) e.weight++;
    else seen.set(id, { key: id, choice: { card: i }, pitch: pitchCard(id), effort: false, weight: 1 });
  });
  const plain = [...seen.values()];
  return s.players[p].stamina > 0 ? withEffort(plain) : plain;
}

/** What the opposing pitcher might throw: everything not in their discard pile, sometimes with max effort. */
function oppPitchOptions(s: GameState, opp: PlayerId): PitchOption[] {
  const pile = s.players[opp].pitching;
  if (pile.hand.length === 0) return [{ key: MEATBALL, choice: { card: null }, pitch: pitchCard(MEATBALL), effort: false, weight: 1 }];
  const base = [...countIds([...pile.draw, ...pile.hand])].map(([id, n]) => ({ key: id, choice: { card: 0 }, pitch: pitchCard(id), effort: false, weight: n }));
  return s.players[opp].stamina > 0 ? withEffort(base, EFFORT_PRIOR) : base;
}

/** Runs a Tired Arm thrown in place of a typical pitch costs, roughly. */
export const TIRED_ARM_THROW_COST = 0.07;
const PITCHES_PER_HALF = 16;

/**
 * Expected cost of shuffling one Tired Arm into `me`'s draw pile: the chance it comes up during
 * the rest of this half-inning, plus how often it will come up in the half-innings this player
 * still has to pitch (capped, since it can be released or shaken off).
 */
export function fatigueCost(s: GameState, me: PlayerId): number {
  const pile = s.players[me].pitching;
  const cardsLeftThisHalf = (3 - s.sit.outs) * 5;
  const now = Math.min(1, cardsLeftThisHalf / (pile.draw.length + 1));
  const halvesLeft = Math.max(0, s.config.innings - s.inning);
  const later = Math.min(2, (halvesLeft * PITCHES_PER_HALF) / (deckList(pile).length + 1));
  return TIRED_ARM_THROW_COST * (now + later);
}

/** What one point of stamina is worth when spent in a really big spot, in runs. */
export const STAMINA_POINT_VALUE = 0.06;
/** Roughly the share of pitches that are big enough spots to want max effort. */
const BIG_SPOT_SHARE = 0.1;

/**
 * Opportunity cost of spending one point of stamina now: stamina is limited, so a point spent
 * on this pitch can't be spent on a bigger one later. Cheap when stamina is plentiful compared
 * with the big spots still to come; dear when it's scarce.
 */
export function staminaCost(s: GameState, me: PlayerId): number {
  const stamina = s.players[me].stamina;
  if (stamina <= 0) return Infinity;
  const pitchesLeft = (3 - s.sit.outs) * 5 + Math.max(0, s.config.innings - s.inning) * PITCHES_PER_HALF;
  const bigSpotsLeft = pitchesLeft * BIG_SPOT_SHARE;
  // With full stamina, the next refill (an Easy pitch or a release) would be wasted, so spending is cheaper.
  const full = stamina >= STAMINA ? 0.5 : 1;
  return STAMINA_POINT_VALUE * full * Math.min(1, bigSpotsLeft / stamina);
}

function ownBatOptions(s: GameState, p: PlayerId): BatOption[] {
  const opts: BatOption[] = [
    { key: 'take', choice: { action: 'take' }, bat: { kind: 'take' }, weight: 1 },
    { key: 'hack', choice: { action: 'hack' }, bat: { kind: 'swing', card: HACK }, weight: 1 },
  ];
  const seen = new Set<string>();
  s.players[p].batting.hand.forEach((id, i) => {
    if (seen.has(id)) return;
    const choice: BatChoice = { action: 'play', card: i };
    if (!isBatChoiceLegal(s, choice)) return;
    seen.add(id);
    opts.push({ key: id, choice, bat: toBatAction(id), weight: 1 });
  });
  return opts;
}

function takePrior(sit: Situation): number {
  if (sit.balls === BALLS_FOR_WALK - 1 && sit.strikes < 2) return 0.45;
  if (sit.strikes === 2) return 0.15;
  return 0.3;
}

function oppBatOptions(s: GameState, opp: PlayerId): BatOption[] {
  const pile = s.players[opp].batting;
  const counts = countIds([...pile.draw, ...pile.hand]);
  const cards: BatOption[] = [];
  for (const [id, n] of counts) {
    const c = batCard(id);
    if (c.kind === 'tactic' && c.tactic === 'steal' && !canSteal(s.sit.bases)) continue;
    cards.push({ key: id, choice: { action: 'take' }, bat: toBatAction(id), weight: c.kind === 'tactic' ? n * 0.5 : n });
  }
  const take = takePrior(s.sit);
  const total = cards.reduce((a, o) => a + o.weight, 0) || 1;
  const swingShare = 1 - take - 0.05;
  return [
    { key: 'take', choice: { action: 'take' }, bat: { kind: 'take' }, weight: take },
    { key: 'hack', choice: { action: 'hack' }, bat: { kind: 'swing', card: HACK }, weight: 0.05 },
    ...cards.map((o) => ({ ...o, weight: (o.weight / total) * swingShare })),
  ];
}

const normalize = (w: number[]): number[] => {
  const t = w.reduce((a, b) => a + b, 0);
  return t > 0 ? w.map((x) => x / t) : w.map(() => 1 / w.length);
};

/** Payoff matrix in batter run value. Rows: pitches. Columns: bat options. */
export function payoffMatrix(s: GameState, pitches: PitchOption[], bats: BatOption[]): number[][] {
  return pitches.map((p) => bats.map((b) => expectedValue({ pitch: p.pitch, bat: b.bat, sit: s.sit, abPitches: s.abPitches })));
}

/**
 * Approximate Nash equilibrium of a zero-sum matrix game by fictitious play.
 * Row player maximizes M. Returns mixed strategies for both players.
 */
export function solveZeroSum(M: number[][], iterations = 3000): { row: number[]; col: number[]; value: number } {
  const m = M.length;
  const n = M[0].length;
  const rowCounts = new Array<number>(m).fill(0);
  const colCounts = new Array<number>(n).fill(0);
  const rowPayoff = new Array<number>(m).fill(0); // vs col history
  const colPayoff = new Array<number>(n).fill(0); // vs row history
  let r = 0;
  let c = 0;
  for (let t = 0; t < iterations; t++) {
    rowCounts[r]++;
    colCounts[c]++;
    for (let i = 0; i < m; i++) rowPayoff[i] += M[i][c];
    for (let j = 0; j < n; j++) colPayoff[j] += M[r][j];
    r = argmax(rowPayoff);
    c = argmin(colPayoff);
  }
  const row = normalize(rowCounts);
  const col = normalize(colCounts);
  let value = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) value += row[i] * col[j] * M[i][j];
  return { row, col, value };
}

function argmax(a: number[]): number {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}
function argmin(a: number[]): number {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] < a[b]) b = i;
  return b;
}

function sample(rng: Rng, probs: number[]): number {
  let x = rng.next();
  for (let i = 0; i < probs.length; i++) {
    x -= probs[i];
    if (x <= 0) return i;
  }
  return probs.length - 1;
}

function softmax(u: number[], temperature: number): number[] {
  const mx = Math.max(...u);
  return normalize(u.map((x) => Math.exp((x - mx) / temperature)));
}

// ---------------------------------------------------------------- leverage & card economy

function highLeverage(s: GameState): boolean {
  const late = s.inning >= s.config.innings;
  const close = Math.abs(score(s, 0) - score(s, 1)) <= 2;
  return s.sit.bases[1] || s.sit.bases[2] || (late && close);
}

/** Small cost for spending a good card now rather than saving it. In runs. */
function cardSpendPenalty(s: GameState, cost: number): number {
  return 0.006 * cost * (highLeverage(s) ? 0.3 : 1);
}

// ---------------------------------------------------------------- opponent tendencies

interface Tendencies {
  samples: number;
  takeRate: { normal: number; twoStrike: number };
  sitShare: Record<string, number>;
  typeShare: Record<string, number>;
  zoneShare: Record<string, number>;
}

/** What the AI has learned about a player from their previous choices. */
export function tendencies(s: GameState, who: PlayerId, role: 'bat' | 'pitch'): Tendencies {
  const plays = s.history.filter((h) => (role === 'bat' ? h.batter === who : h.pitcher === who) && h.outcome.kind !== 'intentionalWalk');
  const t: Tendencies = { samples: plays.length, takeRate: { normal: 0.3, twoStrike: 0.15 }, sitShare: {}, typeShare: {}, zoneShare: {} };
  if (role === 'bat') {
    const bucket = (two: boolean) => plays.filter((h) => (h.situationBefore.strikes === 2) === two);
    const rate = (arr: typeof plays, prior: number) => (arr.filter((h) => h.batChoice.action === 'take').length + prior * 4) / (arr.length + 4);
    t.takeRate = { normal: rate(bucket(false), 0.3), twoStrike: rate(bucket(true), 0.15) };
    const swings = plays.filter((h) => h.batCard && card(h.batCard).kind === 'swing');
    for (const h of swings) {
      const c = card(h.batCard!);
      const sit = c.kind === 'swing' ? c.sit : 'any';
      t.sitShare[sit] = (t.sitShare[sit] ?? 0) + 1 / swings.length;
    }
  } else {
    for (const h of plays) {
      const p = pitchCard(h.pitchCard);
      t.typeShare[p.type] = (t.typeShare[p.type] ?? 0) + 1 / plays.length;
      t.zoneShare[p.zone] = (t.zoneShare[p.zone] ?? 0) + 1 / plays.length;
    }
  }
  return t;
}

function shares<T extends string>(items: Array<{ key: T; w: number }>): Record<string, number> {
  const tot = items.reduce((a, b) => a + b.w, 0) || 1;
  const out: Record<string, number> = {};
  for (const { key, w } of items) out[key] = (out[key] ?? 0) + w / tot;
  return out;
}

/** Reweight an opponent's pitch options by what they've actually been throwing. */
function empiricalPitchDist(opts: PitchOption[], t: Tendencies): number[] {
  const priorType = shares(opts.map((o) => ({ key: o.pitch.type as ThrownType, w: o.weight })));
  const priorZone = shares(opts.map((o) => ({ key: o.pitch.zone as Zone, w: o.weight })));
  const k = 6; // smoothing strength
  const ratio = (obs: number | undefined, prior: number) => ((obs ?? 0) * t.samples + prior * k) / (prior * (t.samples + k));
  return normalize(opts.map((o) => o.weight * ratio(t.typeShare[o.pitch.type], priorType[o.pitch.type]) * ratio(t.zoneShare[o.pitch.zone], priorZone[o.pitch.zone])));
}

function empiricalBatDist(opts: BatOption[], t: Tendencies, sit: Situation): number[] {
  const take = sit.strikes === 2 ? t.takeRate.twoStrike : t.takeRate.normal;
  const swingOpts = opts.filter((o) => o.key !== 'take');
  const priorSit = shares(swingOpts.map((o) => ({ key: o.bat.kind === 'swing' ? o.bat.card.sit : 'tactic', w: o.weight })));
  const k = 6;
  const n = Object.values(t.sitShare).length ? t.samples : 0;
  const w = opts.map((o) => {
    if (o.key === 'take') return 0;
    const key = o.bat.kind === 'swing' ? o.bat.card.sit : 'tactic';
    const r = ((t.sitShare[key] ?? 0) * n + priorSit[key] * k) / (priorSit[key] * (n + k));
    return o.weight * r;
  });
  const swingNorm = normalize(w).map((x) => x * (1 - take));
  return opts.map((o, i) => (o.key === 'take' ? take : swingNorm[i]));
}

// ---------------------------------------------------------------- decisions

export interface Decision {
  action: Action;
  /** Short explanation of the AI's thinking, for the UI's "scouting" readout. */
  note?: string;
}

export function chooseAction(s: GameState, player: PlayerId, difficulty: Difficulty, rng: Rng): Action {
  if (s.phase === 'pitch') {
    if (player === pitchingTeam(s) && !s.pending.pitch) {
      if (shouldVisitMound(s, player, difficulty, rng)) return { type: 'moundVisit', player };
      return { type: 'pitch', player, choice: choosePitch(s, player, difficulty, rng) };
    }
    if (player === battingTeam(s) && !s.pending.bat) return { type: 'bat', player, choice: chooseBat(s, player, difficulty, rng) };
  }
  if (s.phase === 'shop') return chooseShop(s, player, difficulty, rng);
  throw new Error('AI has nothing to do');
}

export function choosePitch(s: GameState, me: PlayerId, difficulty: Difficulty, rng: Rng): PitchChoice {
  const mine = ownPitchOptions(s, me);
  if (mine.length === 1) return mine[0].choice;
  if (difficulty === 'rookie') {
    const plain = mine.filter((o) => !o.effort);
    const pick = rng.pick(plain).choice;
    return s.players[me].stamina > 0 && rng.next() < 0.15 ? { ...pick, maxEffort: true } : pick;
  }

  const opp = (1 - me) as PlayerId;
  const bats = oppBatOptions(s, opp);
  const M = payoffMatrix(s, mine, bats);
  const fatigue = fatigueCost(s, me) + staminaCost(s, me);
  const penalty = mine.map((o) => cardSpendPenalty(s, o.pitch.cost) + (o.effort ? fatigue : 0));
  // Pitcher wants to minimize batter value.
  const util = (dist: number[]) => mine.map((_, i) => -dot(M[i], dist) - penalty[i]);

  const walk = intentionalWalkValue(s);

  if (difficulty === 'veteran') {
    // Plays the percentages against what it has seen: after a few pitches it uses the hitter's
    // real take rate and favorite reads instead of assuming every hitter swings 70% of the time.
    const model = veteranBatModel(s, opp, bats);
    const u = util(model);
    if (walk < -Math.max(...u) - IBB_MARGIN) return { card: null, intentionalWalk: true };
    return mine[sample(rng, softmax(u, 0.035))].choice;
  }
  // All-Star: equilibrium play, leaning toward exploiting observed tendencies.
  const neg = M.map((row, i) => row.map((v) => -v - penalty[i]));
  const eq = solveZeroSum(neg);
  // The equilibrium value assumes the hitter holds whichever card hurts most, which overrates
  // walking him; judge the walk against a realistic picture of his hand instead.
  if (walk < -Math.max(...util(veteranBatModel(s, opp, bats))) - IBB_MARGIN) return { card: null, intentionalWalk: true };
  let strategy = eq.row;
  const t = tendencies(s, opp, 'bat');
  if (t.samples >= ALLSTAR_SCOUTING_PITCHES) {
    const model = mix(eq.col, empiricalBatDist(bats, t, s.sit), ALLSTAR_TRUST);
    const br = argmax(util(model));
    strategy = mix(strategy, oneHot(mine.length, br), ALLSTAR_EXPLOIT);
  }
  return mine[sample(rng, strategy)].choice;
}

export function chooseBat(s: GameState, me: PlayerId, difficulty: Difficulty, rng: Rng): BatChoice {
  const mine = ownBatOptions(s, me);
  if (difficulty === 'rookie') return rookieBat(s, mine, rng);

  const opp = (1 - me) as PlayerId;
  const pitches = oppPitchOptions(s, opp);
  const M = payoffMatrix(s, pitches, mine); // rows: pitches, cols: my options
  const penalty = mine.map((o) => {
    let pen = o.bat.kind === 'take' ? 0 : o.key === 'hack' ? 0 : cardSpendPenalty(s, card(o.key).cost);
    if (o.bat.kind === 'tactic' && o.bat.card.tactic === 'goodEye') pen -= 0.03; // card draw is worth something
    return pen;
  });
  const util = (dist: number[]) => mine.map((_, j) => pitches.reduce((a, _p, i) => a + dist[i] * M[i][j], 0) - penalty[j]);

  if (difficulty === 'veteran') {
    const prior = normalize(pitches.map((p) => p.weight));
    const t = tendencies(s, opp, 'pitch');
    const model = t.samples >= VETERAN_SCOUTING_PITCHES ? mix(prior, empiricalPitchDist(pitches, t), 0.7) : prior;
    return mine[sample(rng, softmax(util(model), 0.035))].choice;
  }
  // Batter maximizes: transpose so rows are my options.
  const T = mine.map((_, j) => pitches.map((_p, i) => M[i][j] - penalty[j]));
  const eq = solveZeroSum(T);
  let strategy = eq.row;
  const t = tendencies(s, opp, 'pitch');
  if (t.samples >= ALLSTAR_SCOUTING_PITCHES) {
    const model = mix(eq.col, empiricalPitchDist(pitches, t), ALLSTAR_TRUST);
    const br = argmax(util(model));
    strategy = mix(strategy, oneHot(mine.length, br), ALLSTAR_EXPLOIT);
  }
  return mine[sample(rng, strategy)].choice;
}

function rookieBat(s: GameState, mine: BatOption[], rng: Rng): BatChoice {
  const takeChance = s.sit.balls === BALLS_FOR_WALK - 1 ? 0.4 : s.sit.strikes === 2 ? 0.12 : 0.25;
  if (rng.next() < takeChance) return { action: 'take' };
  const cards = mine.filter((o) => o.choice.action === 'play' && !(o.bat.kind === 'tactic' && o.bat.card.tactic === 'steal' && rng.next() < 0.5));
  return cards.length ? rng.pick(cards).choice : { action: 'hack' };
}

const dot = (a: number[], b: number[]) => a.reduce((t, x, i) => t + x * b[i], 0);
const mix = (a: number[], b: number[], w: number) => a.map((x, i) => (1 - w) * x + w * b[i]);
const oneHot = (n: number, i: number) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));

// ---------------------------------------------------------------- shopping

/** How good a card is for `me` against the opponent's current decks. In runs per use. */
export function cardRating(s: GameState, me: PlayerId, id: string): number {
  const c = card(id);
  const opp = (1 - me) as PlayerId;
  const sits: Situation[] = [
    { bases: [false, false, false], outs: 0, balls: 0, strikes: 0 },
    { bases: [true, false, false], outs: 1, balls: 1, strikes: 1 },
    { bases: [false, true, false], outs: 1, balls: 0, strikes: 2 },
    { bases: [false, false, false], outs: 2, balls: 2, strikes: 1 },
  ];
  let total = 0;
  for (const sit of sits) {
    const sub = { ...s, sit, abPitches: [] as ThrownType[] };
    if (c.kind === 'pitch') {
      const bats = oppBatOptions(sub, opp);
      const w = normalize(bats.map((b) => b.weight));
      total -= bats.reduce((a, b, j) => a + w[j] * expectedValue({ pitch: c, bat: b.bat, sit, abPitches: [] }), 0);
    } else {
      if (c.kind === 'tactic' && c.tactic === 'steal' && !canSteal(sit.bases)) continue;
      const pitches = oppPitchOptions(sub, opp);
      const w = normalize(pitches.map((p) => p.weight));
      total += pitches.reduce((a, p, i) => a + w[i] * expectedValue({ pitch: p.pitch, bat: toBatAction(id), sit, abPitches: [] }), 0);
    }
  }
  return total / sits.length;
}

function deckAverage(s: GameState, me: PlayerId, deck: DeckName): number {
  const ids = deckList(s.players[me][deck]);
  const cache = new Map<string, number>();
  let tot = 0;
  for (const id of ids) {
    if (!cache.has(id)) cache.set(id, cardRating(s, me, id));
    tot += cache.get(id)!;
  }
  return tot / Math.max(1, ids.length);
}

function chooseShop(s: GameState, me: PlayerId, difficulty: Difficulty, rng: Rng): Action {
  const p = s.players[me];
  const affordable = s.market.row.map((id, i) => ({ id, i })).filter(({ id }) => card(id).cost <= p.stars);
  const end: Action = { type: 'endShop', player: me };

  if (difficulty === 'rookie') {
    if (affordable.length && rng.next() < 0.6) return { type: 'buy', player: me, marketIndex: rng.pick(affordable).i };
    return end;
  }

  // Release fatigue first if we can afford it and still buy something reasonable.
  const canRelease = !s.shop!.released && p.stars >= RELEASE_COST;
  if (canRelease && p.pitching.draw.concat(p.pitching.hand, p.pitching.discard).includes('tiredArm') && deckList(p.pitching).length > MIN_DECK_SIZE) {
    const keepStars = difficulty === 'allstar' ? p.stars >= 3 || affordable.length === 0 : p.stars >= 4;
    if (keepStars) return { type: 'release', player: me, deck: 'pitching', cardId: 'tiredArm' };
  }

  if (difficulty === 'veteran') {
    if (!affordable.length) return end;
    const best = affordable.reduce((a, b) => (card(b.id).cost > card(a.id).cost ? b : a));
    return card(best.id).cost >= 2 ? { type: 'buy', player: me, marketIndex: best.i } : end;
  }

  // All-Star: buy the card that improves its deck the most, or save up for a better one,
  // but only while there is a later market visit to spend the savings on.
  const visitsLeft = marketVisitsLeft(s);
  const scored = s.market.row.map((id, i) => {
    const c = card(id);
    const deck: DeckName = c.kind === 'pitch' ? 'pitching' : 'batting';
    const gain = cardRating(s, me, id) - deckAverage(s, me, deck);
    return { id, i, gain, cost: c.cost };
  });
  // Signings report straight to the hand, so even a modest upgrade gets used; on the last visit
  // stars are worth nothing afterwards, so take anything that isn't a downgrade.
  const threshold = visitsLeft === 0 ? -0.005 : 0.002;
  const buyable = scored.filter((x) => x.cost <= p.stars && x.gain > threshold);
  if (!buyable.length) {
    // Nothing worth buying: consider releasing the weakest starter instead.
    if (canRelease && visitsLeft > 0) {
      const rel = worstCard(s, me);
      if (rel) return { type: 'release', player: me, deck: rel.deck, cardId: rel.id };
    }
    return end;
  }
  const best = buyable.reduce((a, b) => (b.gain > a.gain ? b : a));
  // Save for a clearly better card we can afford by the next visit.
  const income = ECONOMY.halfInningStars + 1;
  const dream = visitsLeft > 0 ? scored.filter((x) => x.cost > p.stars && x.cost <= p.stars + income && x.gain > best.gain * 1.6) : [];
  if (dream.length && best.cost >= 2 && p.stars - best.cost < dream[0].cost - income) return end;
  return { type: 'buy', player: me, marketIndex: best.i };
}

/** Market visits this manager gets after the current one (0 on the last visit of regulation). */
export function marketVisitsLeft(s: GameState): number {
  if (s.shop?.pregame) return 2 * s.config.innings - 1;
  const halfJustEnded = (s.inning - 1) * 2 + (s.half === 'bottom' ? 1 : 0);
  return Math.max(0, 2 * s.config.innings - 2 - halfJustEnded);
}

function worstCard(s: GameState, me: PlayerId): { deck: DeckName; id: string } | null {
  let worst: { deck: DeckName; id: string; gap: number } | null = null;
  for (const deck of ['pitching', 'batting'] as DeckName[]) {
    const ids = deckList(s.players[me][deck]);
    if (ids.length <= MIN_DECK_SIZE + 2) continue;
    const avg = deckAverage(s, me, deck);
    for (const id of new Set(ids)) {
      const gap = cardRating(s, me, id) - avg;
      if (gap < -0.02 && (!worst || gap < worst.gap)) worst = { deck, id, gap };
    }
  }
  return worst ? { deck: worst.deck, id: worst.id } : null;
}
