export type PitchType = 'heat' | 'curve' | 'change';
/** Knuckleballs have no type: no batter can sit on one. */
export type ThrownType = PitchType | 'knuckle';
export type Zone = 'strike' | 'edge' | 'chase';
export type Sit = PitchType | 'any';
export type PlayerId = 0 | 1;
export type Difficulty = 'rookie' | 'veteran' | 'allstar';
export type DeckName = 'pitching' | 'batting';

export type PitchEffect =
  | 'sinker' // weaker contact, easier double plays
  | 'cutter' // jams hitters: -1 power
  | 'pitchout' // steals fail automatically
  | 'eephus' // read bonuses and penalties are doubled
  | 'meatball' // +1 quality on contact
  | 'tunnel' // +2 stuff if the previous pitch this at-bat was Heat
  | 'weakContact' // -1 quality on contact
  | 'deceptive' // chase pitch with no check swing
  | 'easy'; // when thrown, shakes a Tired Arm out of the pitcher's hand

export type SwingEffect =
  | 'protect' // +3 contact with two strikes
  | 'spoil' // with two strikes, near-misses become fouls
  | 'ambush' // +2 power on an 0-0 count
  | 'clutch' // +2 contact, +1 power with a runner in scoring position
  | 'timing' // +3 contact if this pitch type was already seen this at-bat
  | 'hitAndRun'; // runners go: extra base on singles, no double plays

export type TacticKind = 'steal' | 'bunt' | 'goodEye';

export interface PitchCardDef {
  kind: 'pitch';
  id: string;
  name: string;
  type: ThrownType;
  zone: Zone;
  stuff: number;
  /** Command: the pitch hits its spot on a d6 roll of this or lower, otherwise it drifts one zone wider. */
  control: number;
  cost: number;
  effects: PitchEffect[];
  text: string;
}

export interface SwingCardDef {
  kind: 'swing';
  id: string;
  name: string;
  sit: Sit;
  contact: number;
  power: number;
  cost: number;
  effects: SwingEffect[];
  text: string;
}

export interface TacticCardDef {
  kind: 'tactic';
  id: string;
  name: string;
  tactic: TacticKind;
  /** Bonus to steal or bunt rolls. */
  bonus: number;
  cost: number;
  text: string;
}

export type BatCardDef = SwingCardDef | TacticCardDef;
export type CardDef = PitchCardDef | BatCardDef;

export type Bases = [boolean, boolean, boolean];

/** The parts of the game state that decide what a pitch is worth. */
export interface Situation {
  bases: Bases;
  outs: number;
  balls: number;
  strikes: number;
}

export type BallInPlay =
  | 'groundout'
  | 'doublePlay'
  | 'popout'
  | 'flyout'
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun';

export type StealResult = 'safe' | 'caught';

/** Where a pitch actually ended up after the command roll. 'dirt' is a chase pitch that missed. */
export type Landing = Zone | 'dirt';

export type PitchOutcome =
  | { kind: 'ball'; steal?: StealResult; checkSwing?: boolean; dirt?: boolean; wild?: boolean }
  | { kind: 'calledStrike'; steal?: StealResult }
  | { kind: 'swingingStrike'; steal?: StealResult }
  | { kind: 'foul' }
  | { kind: 'inPlay'; hit: BallInPlay; hitAndRun?: boolean }
  | { kind: 'sacrifice' }
  | { kind: 'buntHit' }
  | { kind: 'buntOut' }
  | { kind: 'buntFoul' };

/** `card: null` throws a Tired Arm when the hand is empty. Max effort adds stuff and fatigue. */
export type PitchChoice = { card: number | null; maxEffort?: boolean };

export type BatChoice =
  | { action: 'take' }
  | { action: 'hack' }
  | { action: 'play'; card: number };

export interface Pile {
  draw: string[];
  hand: string[];
  discard: string[];
}

export interface PlayerState {
  name: string;
  ai: Difficulty | null;
  pitching: Pile;
  batting: Pile;
  stars: number;
  /** Max-effort fuel, like the engine in Heat: Tired Arms set aside that Max Effort pushes into the deck. */
  stamina: number;
  runsByInning: number[];
  hits: number;
  lineupPos: number;
}

export interface LogEntry {
  inning: number;
  half: 'top' | 'bottom';
  text: string;
  runs?: number;
}

export interface PlayRecord {
  pitcher: PlayerId;
  batter: PlayerId;
  pitchCard: string;
  maxEffort: boolean;
  landed: Landing;
  batChoice: BatChoice;
  batCard: string | null;
  outcome: PitchOutcome;
  runs: number;
  /** Full log line: pitch vs bat and the result. */
  text: string;
  /** Just the result, e.g. "Base hit! 1 run scores." */
  result: string;
  situationBefore: Situation;
}

export interface ShopState {
  order: [PlayerId, PlayerId];
  current: 0 | 1;
  released: boolean;
}

export interface GameConfig {
  innings: number;
  seed: number;
}

export interface GameState {
  config: GameConfig;
  players: [PlayerState, PlayerState];
  inning: number;
  half: 'top' | 'bottom';
  sit: Situation;
  /** Pitch types thrown so far in the current at-bat. */
  abPitches: ThrownType[];
  phase: 'pitch' | 'shop' | 'gameOver';
  pending: { pitch?: PitchChoice; bat?: BatChoice };
  shop: ShopState | null;
  market: { row: string[]; supply: string[] };
  lastPlay: PlayRecord | null;
  history: PlayRecord[];
  log: LogEntry[];
  rng: number;
  winner: PlayerId | 'tie' | null;
}

export type Action =
  | { type: 'pitch'; player: PlayerId; choice: PitchChoice }
  | { type: 'bat'; player: PlayerId; choice: BatChoice }
  | { type: 'buy'; player: PlayerId; marketIndex: number }
  | { type: 'release'; player: PlayerId; deck: DeckName; cardId: string }
  | { type: 'endShop'; player: PlayerId };
