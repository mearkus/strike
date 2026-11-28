import {
  BAT_HAND_SIZE,
  HACK,
  MARKET_ROW_SIZE,
  MARKET_SUPPLY,
  MEATBALL,
  PITCH_HAND_SIZE,
  STARTER_BATTING,
  STARTER_PITCHING,
  TYPE_LABEL,
  ZONE_LABEL,
  batCard,
  card,
  pitchCard,
} from './cards';
import { type BatAction, MAX_EFFORT_STUFF, canSteal, throwPitch } from './resolve';
import { Rng } from './rng';
import { type AdvanceResult, advance, freshSituation } from './situation';
import type {
  Action,
  BatChoice,
  DeckName,
  Difficulty,
  GameState,
  Landing,
  Pile,
  PitchCardDef,
  PitchOutcome,
  PlayerId,
  PlayerState,
} from './types';

const TIRED_ARM = 'tiredArm';

/** Extra innings stop after this many and the game is a tie. */
export const MAX_EXTRA_INNINGS = 6;
/** A deck can't be released below this many cards. */
export const MIN_DECK_SIZE = 6;
export const RELEASE_COST = 1;
/** Mid-at-bat, a pitcher whose hand drops below this many cards draws back up to it. */
export const PITCHER_MIN_HAND = 2;
/**
 * Stamina, the pitcher's Max Effort fuel (like the engine in Heat). Each Max Effort spends one;
 * Easy pitches and releasing a Tired Arm in the market win one back, up to this cap.
 */
export const STAMINA = 4;

/**
 * The star economy. Mutable so balance experiments (scripts/sim.ts) can try variants; the game
 * itself never changes it.
 */
export const ECONOMY = {
  /** Stars each manager starts with, to spend in the pre-game market. */
  startingStars: 3,
  /** Stars both managers earn at the end of every half-inning. */
  halfInningStars: 3,
  /** Signed players report immediately: new cards go straight into your hand. */
  signedToHand: true,
};

const gainStamina = (p: PlayerState) => {
  p.stamina = Math.min(STAMINA, (p.stamina ?? STAMINA) + 1);
};

export interface NewGameOptions {
  names: [string, string];
  ai: [Difficulty | null, Difficulty | null];
  innings: number;
  seed: number;
  /** Open with a spring-training market visit before the first pitch (the real game does). */
  pregame?: boolean;
}

function newPile(cards: string[], rng: Rng): Pile {
  return { draw: rng.shuffle([...cards]), hand: [], discard: [] };
}

function drawCards(pile: Pile, n: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (pile.draw.length === 0) {
      if (pile.discard.length === 0) return;
      pile.draw = rng.shuffle(pile.discard);
      pile.discard = [];
    }
    pile.hand.push(pile.draw.pop()!);
  }
}

function refill(pile: Pile, size: number, rng: Rng): void {
  if (pile.hand.length < size) drawCards(pile, size - pile.hand.length, rng);
}

export function deckList(pile: Pile): string[] {
  return [...pile.draw, ...pile.hand, ...pile.discard];
}

export const battingTeam = (s: GameState): PlayerId => (s.half === 'top' ? 0 : 1);
export const pitchingTeam = (s: GameState): PlayerId => (s.half === 'top' ? 1 : 0);
export const score = (s: GameState, p: PlayerId): number => s.players[p].runsByInning.reduce((a, b) => a + b, 0);

export function newGame(opts: NewGameOptions): GameState {
  const rng = new Rng(opts.seed);
  const mkPlayer = (i: 0 | 1): PlayerState => {
    const p: PlayerState = {
      name: opts.names[i],
      ai: opts.ai[i],
      pitching: newPile(STARTER_PITCHING, rng),
      batting: newPile(STARTER_BATTING, rng),
      stars: opts.pregame ? ECONOMY.startingStars : 0,
      stamina: STAMINA,
      runsByInning: [],
      hits: 0,
      lineupPos: 0,
    };
    refill(p.pitching, PITCH_HAND_SIZE, rng);
    refill(p.batting, BAT_HAND_SIZE, rng);
    return p;
  };
  const players: [PlayerState, PlayerState] = [mkPlayer(0), mkPlayer(1)];
  players[0].runsByInning.push(0);
  const supply = rng.shuffle(Object.entries(MARKET_SUPPLY).flatMap(([id, n]) => Array<string>(n).fill(id)));
  const row = supply.splice(0, MARKET_ROW_SIZE);
  return {
    config: { innings: opts.innings, seed: opts.seed },
    players,
    inning: 1,
    half: 'top',
    sit: freshSituation(),
    abPitches: [],
    phase: opts.pregame ? 'shop' : 'pitch',
    pending: {},
    // Spring training: the home team signs first, since the away team bats first.
    shop: opts.pregame ? { order: [1, 0], current: 0, released: false, pregame: true } : null,
    market: { row, supply },
    lastPlay: null,
    history: [],
    log: opts.pregame
      ? [{ inning: 1, half: 'top', text: `Spring training: each manager has ${ECONOMY.startingStars}★ to sign players before the first pitch.` }]
      : [{ inning: 1, half: 'top', text: `Play ball! ${verb(opts.names[0], 'bats')} first.` }],
    rng: rng.state,
    winner: null,
  };
}

// ---------------------------------------------------------------- validation

export function legalPitchChoices(s: GameState): Array<number | null> {
  const hand = s.players[pitchingTeam(s)].pitching.hand;
  return hand.length === 0 ? [null] : hand.map((_, i) => i);
}

export function isBatChoiceLegal(s: GameState, choice: BatChoice): boolean {
  if (choice.action !== 'play') return true;
  const id = s.players[battingTeam(s)].batting.hand[choice.card];
  if (id === undefined) return false;
  const c = batCard(id);
  if (c.kind === 'tactic' && c.tactic === 'steal') return canSteal(s.sit.bases);
  return true;
}

export function legalBatChoices(s: GameState): BatChoice[] {
  const hand = s.players[battingTeam(s)].batting.hand;
  const all: BatChoice[] = [{ action: 'take' }, { action: 'hack' }, ...hand.map((_, card) => ({ action: 'play' as const, card }))];
  return all.filter((c) => isBatChoiceLegal(s, c));
}

/** Whose input the game is waiting on. In the pitch phase both may be pending. */
export function waitingOn(s: GameState): PlayerId[] {
  if (s.phase === 'pitch') {
    const w: PlayerId[] = [];
    if (!s.pending.pitch) w.push(pitchingTeam(s));
    if (!s.pending.bat) w.push(battingTeam(s));
    return w;
  }
  if (s.phase === 'shop' && s.shop) return [s.shop.order[s.shop.current]];
  return [];
}

// ---------------------------------------------------------------- reducer

export class IllegalAction extends Error {}

export function applyAction(prev: GameState, action: Action): GameState {
  const s = structuredClone(prev);
  const rng = new Rng(s.rng);
  const fail = (msg: string): never => {
    throw new IllegalAction(msg);
  };

  switch (action.type) {
    case 'pitch': {
      if (s.phase !== 'pitch') fail('Not pitching now');
      if (action.player !== pitchingTeam(s)) fail('Not your turn to pitch');
      if (s.pending.pitch) fail('Pitch already chosen');
      if (!legalPitchChoices(s).includes(action.choice.card)) fail('Illegal pitch');
      if (action.choice.maxEffort && action.choice.card === null) fail('No max effort on a Tired Arm with an empty hand');
      if (action.choice.maxEffort && s.players[action.player].stamina <= 0) fail('No stamina left for max effort');
      s.pending.pitch = action.choice;
      break;
    }
    case 'bat': {
      if (s.phase !== 'pitch') fail('Not batting now');
      if (action.player !== battingTeam(s)) fail('Not your turn to bat');
      if (s.pending.bat) fail('Already chosen');
      if (!isBatChoiceLegal(s, action.choice)) fail('Illegal batting choice');
      s.pending.bat = action.choice;
      break;
    }
    case 'buy': {
      const shopper = currentShopper(s) ?? fail('Not shopping');
      if (shopper !== action.player) fail('Not your turn to shop');
      const id = s.market.row[action.marketIndex] ?? fail('No such card');
      const c = card(id);
      const p = s.players[shopper];
      if (p.stars < c.cost) fail('Not enough stars');
      p.stars -= c.cost;
      s.market.row.splice(action.marketIndex, 1);
      if (s.market.supply.length > 0) s.market.row.splice(action.marketIndex, 0, s.market.supply.shift()!);
      // Signed players report immediately (into the hand), or join the discard pile.
      (c.kind === 'pitch' ? p.pitching : p.batting)[ECONOMY.signedToHand ? 'hand' : 'discard'].push(id);
      log(s, `${verb(p.name, 'signs')} ${c.name}.`);
      break;
    }
    case 'release': {
      const shopper = currentShopper(s) ?? fail('Not shopping');
      if (shopper !== action.player) fail('Not your turn to shop');
      if (s.shop!.released) fail('Already released a card this visit');
      const p = s.players[shopper];
      if (p.stars < RELEASE_COST) fail('Not enough stars');
      const pile = p[action.deck];
      if (deckList(pile).length <= MIN_DECK_SIZE) fail('Deck too small');
      const zone = (['discard', 'draw', 'hand'] as const).find((z) => pile[z].includes(action.cardId)) ?? fail('Card not in deck');
      pile[zone].splice(pile[zone].indexOf(action.cardId), 1);
      p.stars -= RELEASE_COST;
      if (action.cardId === TIRED_ARM) gainStamina(p);
      s.shop!.released = true;
      log(s, `${verb(p.name, 'releases')} ${card(action.cardId).name}.`);
      break;
    }
    case 'endShop': {
      const shopper = currentShopper(s) ?? fail('Not shopping');
      if (shopper !== action.player) fail('Not your turn to shop');
      if (s.shop!.current === 0) {
        s.shop = { ...s.shop!, current: 1, released: false };
      } else if (s.shop!.pregame) {
        s.phase = 'pitch';
        s.shop = null;
        log(s, `Play ball! ${verb(s.players[0].name, 'bats')} first.`);
      } else {
        startNextHalf(s, rng);
      }
      break;
    }
  }

  if (s.phase === 'pitch' && s.pending.pitch && s.pending.bat) resolve(s, rng);
  s.rng = rng.state;
  return s;
}

function currentShopper(s: GameState): PlayerId | null {
  return s.phase === 'shop' && s.shop ? s.shop.order[s.shop.current] : null;
}

function log(s: GameState, text: string, runs?: number): void {
  s.log.push({ inning: s.inning, half: s.half, text, ...(runs ? { runs } : {}) });
}

function resolve(s: GameState, rng: Rng): void {
  const pid = pitchingTeam(s);
  const bid = battingTeam(s);
  const pitcher = s.players[pid];
  const batter = s.players[bid];
  const pc = s.pending.pitch!;
  const bc = s.pending.bat!;

  let pitchId = MEATBALL;
  if (pc.card !== null) {
    pitchId = pitcher.pitching.hand.splice(pc.card, 1)[0];
    pitcher.pitching.discard.push(pitchId);
  }
  const maxEffort = pc.maxEffort === true && pc.card !== null;
  const base = pitchCard(pitchId);
  const pitch = maxEffort ? { ...base, stuff: base.stuff + MAX_EFFORT_STUFF } : base;
  const notes: string[] = [];
  if (maxEffort) {
    // Like Heat: spend stamina, and the strain comes back around soon in the draw pile.
    pitcher.stamina -= 1;
    pitcher.pitching.draw.splice(rng.int(pitcher.pitching.draw.length + 1), 0, TIRED_ARM);
    notes.push(`Max effort: a Tired Arm is shuffled into the draw pile (stamina ${pitcher.stamina}/${STAMINA}).`);
  }
  if (pitch.effects.includes('easy') && pitcher.pitching.hand.includes(TIRED_ARM)) {
    pitcher.pitching.hand.splice(pitcher.pitching.hand.indexOf(TIRED_ARM), 1);
    gainStamina(pitcher);
    notes.push(`Easy on the arm: a Tired Arm goes back to stamina (${pitcher.stamina}/${STAMINA}).`);
  }

  let batId: string | null = null;
  let bat: BatAction = { kind: 'take' };
  if (bc.action === 'hack') bat = { kind: 'swing', card: HACK };
  if (bc.action === 'play') {
    batId = batter.batting.hand.splice(bc.card, 1)[0];
    batter.batting.discard.push(batId);
    const c = batCard(batId);
    bat = c.kind === 'swing' ? { kind: 'swing', card: c } : { kind: 'tactic', card: c };
  }

  const before = structuredClone(s.sit);
  const { outcome, landed } = throwPitch({ pitch, bat, sit: s.sit, abPitches: s.abPitches }, () => rng.d6());
  const adv = advance(s.sit, outcome);

  // No swing happened (checked swing, or a pitch in the dirt): a swing or bunt card goes back to the hand.
  const noSwing = outcome.kind === 'ball' && (outcome.checkSwing || (outcome.dirt && (bat.kind === 'swing' || (bat.kind === 'tactic' && bat.card.tactic === 'bunt'))));
  if (noSwing && batId !== null) {
    batter.batting.discard.pop();
    batter.batting.hand.push(batId);
  }

  // Good Eye draws.
  if (bat.kind === 'tactic' && bat.card.tactic === 'goodEye') {
    const n = outcome.kind === 'ball' ? 2 : 1;
    drawCards(batter.batting, n, rng);
  }

  awardStars(s, adv, pid, bid);
  batter.runsByInning[s.inning - 1] += adv.runs;
  if (adv.result && ['single', 'double', 'triple', 'homeRun', 'buntHit'].includes(adv.result)) batter.hits++;

  const result = [landingText(base, landed), outcomeText(outcome, adv), ...notes].filter(Boolean).join(' ');
  const text = `${maxEffort ? 'MAX EFFORT ' : ''}${describePitch(pitchId)} vs ${describeBat(bat)}: ${result}`;
  s.lastPlay = { inning: s.inning, half: s.half, pitcher: pid, batter: bid, pitchCard: pitchId, maxEffort, landed, batChoice: bc, batCard: batId, outcome, runs: adv.runs, text, result, moves: adv.moves, situationBefore: before };
  s.history.push(s.lastPlay);
  log(s, text, adv.runs);

  s.sit = adv.sit;
  s.pending = {};
  s.abPitches = adv.atBatOver ? [] : [...s.abPitches, pitch.type];
  if (adv.batterDone) batter.lineupPos = (batter.lineupPos + 1) % 9;

  // Walk-off.
  if (s.half === 'bottom' && s.inning >= s.config.innings && score(s, 1) > score(s, 0)) {
    endGame(s, 1, `Walk-off! ${verb(s.players[1].name, 'wins')}.`);
    return;
  }
  if (adv.inningOver) {
    endHalfInning(s);
  } else if (adv.atBatOver) {
    refill(pitcher.pitching, PITCH_HAND_SIZE, rng);
    refill(batter.batting, BAT_HAND_SIZE, rng);
  } else if (pitcher.pitching.hand.length < PITCHER_MIN_HAND) {
    // A long at-bat: the pitcher draws to keep options, so a patient hitter can't wait out a known hand.
    refill(pitcher.pitching, PITCHER_MIN_HAND, rng);
  }
}

function awardStars(s: GameState, adv: AdvanceResult, pid: PlayerId, bid: PlayerId): void {
  const outs = (adv.inningOver ? 3 : adv.sit.outs) - s.sit.outs;
  let p = outs;
  if (adv.result === 'strikeout') p += 1;
  if (adv.result === 'doublePlay') p += 1;
  let b = adv.runs;
  if (adv.steal?.result === 'safe') b += 1;
  switch (adv.result) {
    case 'walk':
    case 'single':
    case 'buntHit':
      b += 1;
      break;
    case 'double':
    case 'triple':
      b += 2;
      break;
    case 'homeRun':
      b += 3;
      break;
    default:
  }
  s.players[pid].stars += p;
  s.players[bid].stars += b;
}

function endGame(s: GameState, winner: PlayerId | 'tie', text: string): void {
  s.phase = 'gameOver';
  s.winner = winner;
  s.pending = {};
  s.shop = null;
  log(s, text);
}

function endHalfInning(s: GameState): void {
  const pid = pitchingTeam(s);
  s.players[pid].pitching.discard.push(TIRED_ARM);
  s.players[0].stars += ECONOMY.halfInningStars;
  s.players[1].stars += ECONOMY.halfInningStars;
  const away = score(s, 0);
  const home = score(s, 1);
  const last = s.inning >= s.config.innings;
  log(s, `End of the ${s.half} of the ${ordinal(s.inning)}. ${s.players[0].name} ${away}, ${s.players[1].name} ${home}.`);
  if (last && s.half === 'top' && home > away) return endGame(s, 1, `${verb(s.players[1].name, 'wins')} ${home}-${away}.`);
  if (last && s.half === 'bottom') {
    if (away !== home) return endGame(s, away > home ? 0 : 1, `${verb(s.players[away > home ? 0 : 1].name, 'wins')} ${Math.max(away, home)}-${Math.min(away, home)}.`);
    if (s.inning >= s.config.innings + MAX_EXTRA_INNINGS) return endGame(s, 'tie', `Called a tie after ${s.inning} innings.`);
  }
  // Trailing team shops first; if tied, the team about to bat.
  const nextBat: PlayerId = s.half === 'top' ? 1 : 0;
  const first: PlayerId = away === home ? nextBat : away < home ? 0 : 1;
  s.phase = 'shop';
  s.shop = { order: [first, (1 - first) as PlayerId], current: 0, released: false };
  s.pending = {};
}

function startNextHalf(s: GameState, rng: Rng): void {
  if (s.half === 'top') s.half = 'bottom';
  else {
    s.half = 'top';
    s.inning++;
  }
  s.phase = 'pitch';
  s.shop = null;
  s.sit = freshSituation();
  s.abPitches = [];
  const bid = battingTeam(s);
  s.players[bid].runsByInning[s.inning - 1] = 0;
  if (s.inning > s.config.innings) {
    s.sit.bases[1] = true;
    log(s, `Extra innings: a runner starts on 2nd.`);
  }
  log(s, `${s.half === 'top' ? 'Top' : 'Bottom'} of the ${ordinal(s.inning)}: ${s.players[bid].name} batting.`);
  refill(s.players[pitchingTeam(s)].pitching, PITCH_HAND_SIZE, rng);
  refill(s.players[bid].batting, BAT_HAND_SIZE, rng);
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suf}`;
}

// ---------------------------------------------------------------- text

const RESULT_TEXT: Record<string, string> = {
  walk: 'Ball four. Take your base.',
  strikeout: 'Strike three!',
  groundout: 'Grounded out.',
  doublePlay: 'Into a double play!',
  popout: 'Popped up. Out.',
  flyout: 'Flied out.',
  sacFly: 'Sacrifice fly!',
  single: 'Base hit!',
  double: 'Into the gap, a double!',
  triple: 'Off the wall, a triple!',
  homeRun: 'GONE! Home run!',
  sacrifice: 'Sacrifice bunt. Runners move up.',
  buntHit: 'Bunt single!',
  buntOut: 'Bunt, thrown out.',
};

export function outcomeText(outcome: PitchOutcome, adv: AdvanceResult): string {
  const parts: string[] = [];
  if (adv.steal) parts.push(adv.steal.result === 'safe' ? `Stolen base: safe at ${ordinal(adv.steal.to)}!` : `Caught stealing ${ordinal(adv.steal.to)}!`);
  if (adv.result) parts.push(RESULT_TEXT[adv.result]);
  else if (!adv.inningOver || !adv.steal) {
    parts.push(
      {
        ball: outcome.kind === 'ball' && outcome.checkSwing ? 'Checked swing! Ball.' : outcome.kind === 'ball' && outcome.wild ? 'Ball, and it gets away: wild pitch! Runners move up.' : 'Ball.',
        calledStrike: 'Called strike.',
        swingingStrike: 'Swing and a miss.',
        foul: 'Fouled off.',
        buntFoul: 'Bunt fouled off.',
        inPlay: '',
        sacrifice: '',
        buntHit: '',
        buntOut: '',
      }[outcome.kind],
    );
  }
  if (adv.runs > 0) parts.push(adv.runs === 1 ? '1 run scores.' : `${adv.runs} runs score.`);
  return parts.filter(Boolean).join(' ');
}

/** "Missed its spot" text when the command roll failed. */
export function landingText(pitch: PitchCardDef, landed: Landing): string {
  if (landed === pitch.zone) return '';
  if (landed === 'dirt') return 'In the dirt!';
  return `Missed its spot: ${ZONE_LABEL[landed].toLowerCase()}.`;
}

function describePitch(pitchId: string): string {
  const p = pitchCard(pitchId);
  return `${p.name} (${TYPE_LABEL[p.type]}, ${ZONE_LABEL[p.zone].toLowerCase()})`;
}

function describeBat(bat: BatAction): string {
  if (bat.kind === 'take') return 'Take';
  return bat.card.name;
}

/** "You sign" vs "Rival signs". */
export function verb(name: string, thirdPerson: string): string {
  return name === 'You' ? `${name} ${thirdPerson.replace(/s$/, '').replace(/ie$/, 'y')}` : `${name} ${thirdPerson}`;
}

export function deckOf(s: GameState, p: PlayerId, deck: DeckName): string[] {
  return deckList(s.players[p][deck]);
}
