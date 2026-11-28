/**
 * The interactive tutorial: a short scripted game on the real table. Each step can build a game
 * state, ask the player for one specific action, script the opponent's answer, and pick dice so
 * the lesson's outcome happens (a correct read really does produce a hit).
 */
import { applyAction, newGame } from '../engine/game';
import { advance } from '../engine/situation';
import type { Action, GameState, PitchOutcome } from '../engine/types';

export const ME = 0 as const;
export const COACH = 1 as const;

export interface TutorialStep {
  title: string;
  /** Static, trusted HTML. */
  body: string;
  /** CSS selector of the part of the screen to highlight. */
  target?: string;
  /** Put the coach card on the left (when the target is on the right, like scouting). */
  placeLeft?: boolean;
  /** Build (or adjust) the game state when the step starts. */
  setup?: (prev: GameState | null) => GameState;
  /** The one action this step asks for. Steps without it just need Next. */
  expect?: { matches: (a: Action, s: GameState) => boolean; hint: string };
  /** The coach's scripted answer to the player's action. */
  opponent?: (s: GameState) => Action;
  /** The outcome the lesson needs; dice are chosen to produce it. */
  want?: (after: GameState) => boolean;
  /** Shown once the action has played out. */
  after?: string;
  /** The action the step wants, for the "Show me" button and tests. */
  demo?: (s: GameState) => Action;
}

// ---------------------------------------------------------------- state helpers

function fresh(): GameState {
  return newGame({ names: ['You', 'Coach'], ai: [null, null], innings: 3, seed: 2024 });
}

/** Put exact cards in a hand (and optionally a draw pile), clearing the discard pile. */
function deal(s: GameState, who: 0 | 1, deck: 'pitching' | 'batting', hand: string[], draw: string[] = []): void {
  s.players[who][deck] = { hand: [...hand], draw: [...draw], discard: [] };
}

const handIndex = (s: GameState, who: 0 | 1, deck: 'pitching' | 'batting', id: string) => s.players[who][deck].hand.indexOf(id);

const playedCard = (a: Action, s: GameState, id: string) =>
  a.type === 'bat' && a.choice.action === 'play' && s.players[ME].batting.hand[a.choice.card] === id;
const threwCard = (a: Action, s: GameState, id: string, effort = false) =>
  a.type === 'pitch' && a.choice.card !== null && s.players[ME].pitching.hand[a.choice.card] === id && !!a.choice.maxEffort === effort;

const coachPitches = (id: string) => (s: GameState): Action => ({ type: 'pitch', player: COACH, choice: { card: handIndex(s, COACH, 'pitching', id) } });
const coachSwings = (id: string) => (s: GameState): Action => ({ type: 'bat', player: COACH, choice: { action: 'play', card: handIndex(s, COACH, 'batting', id) } });

const lastResult = (s: GameState) => (s.lastPlay ? advance(s.lastPlay.situationBefore, s.lastPlay.outcome).result : null);
const lastKind = (s: GameState): PitchOutcome['kind'] | undefined => s.lastPlay?.outcome.kind;

/**
 * Play the player's action and the coach's answer, trying dice until the lesson's outcome
 * happens. The engine is pure and seeded, so this just searches seeds.
 */
export function playScripted(s: GameState, mine: Action, theirs: Action | undefined, want?: (after: GameState) => boolean): GameState {
  let last = s;
  for (let seed = 1; seed <= 5000; seed++) {
    let t = applyAction({ ...s, rng: seed }, mine);
    if (theirs) t = applyAction(t, theirs);
    if (!want || want(t)) return t;
    last = t;
  }
  return last;
}

// ---------------------------------------------------------------- the lessons

const batting = (prev: GameState | null): GameState => {
  const s = prev ? structuredClone(prev) : fresh();
  s.phase = 'pitch';
  s.half = 'top';
  s.pending = {};
  return s;
};

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Welcome to Strike',
    body: `<p>Strike is baseball as a card game. Every pitch, you and your opponent each pick a card <b>in secret</b>, then both are revealed.</p>
      <p>You bat in the top of each inning and pitch in the bottom. Up top is the <b>score bug</b>: the score, the inning, the runners, and the count (balls, strikes, outs).</p>`,
    target: '.bug',
    setup: () => {
      const s = batting(null);
      deal(s, ME, 'batting', ['sitHeat', 'sitCurve', 'swingAway', 'steal'], ['sitChange', 'bunt', 'swingAway', 'sitHeat']);
      deal(s, COACH, 'pitching', ['fourSeam', 'highHeat', 'curveball', 'twoSeam', 'changeup'], ['slider', 'dirtCurve', 'cornerChange']);
      return s;
    },
  },
  {
    title: 'The field',
    body: `<p>The <b>field</b> replays every pitch: the ball, the runners, the result. Beside it you'll see both cards that were played.</p>
      <p>Below, the <b>at-bat tracker</b> lists every pitch of the current at-bat, so you never lose track of the count.</p>`,
    target: '.stage',
  },
  {
    title: 'Your hand',
    body: `<p>This is your <b>hand</b>. When you bat, you play a swing card, or <b>Take</b> (don't swing), or <b>Hack</b> (a weak swing that saves your cards).</p>
      <p>Your hand refills at the start of each at-bat.</p>`,
    target: '.dock',
  },
  {
    title: 'Read the pitch',
    body: `<p><b>Scouting</b> shows what's left in the pitcher's deck. You never see their hand, but you can count cards. This pitcher has lots of <b>Heat</b>.</p>
      <p>Swing cards <b>sit</b> on a pitch type. Guess right and you get +3 contact and square it up. Guess wrong and you're fooled (−2). Sit Fastball crushes Heat.</p>
      <p><b>Select Sit Fastball, then press Swing.</b></p>`,
    target: '.scouting',
    placeLeft: true,
    expect: { matches: (a, s) => playedCard(a, s, 'sitHeat'), hint: 'Select the Sit Fastball card, then press Swing.' },
    demo: (s) => ({ type: 'bat', player: ME, choice: { action: 'play', card: handIndex(s, ME, 'batting', 'sitHeat') } }),
    opponent: coachPitches('fourSeam'),
    want: (t) => lastResult(t) === 'single',
    after: `<p><b>Base hit!</b> The coach threw a Four-Seamer and you were sitting on it.</p>
      <p>The read triangle: <b>Sit Heat</b> is fooled by Offspeed, <b>Sit Breaking</b> by Heat, <b>Sit Offspeed</b> by Breaking. "Any" swings never gain or lose.</p>`,
  },
  {
    title: 'Take a pitch',
    body: `<p>Every pitch has a <b>zone</b>. <b>Strike</b>: taken, it's a strike. <b>Edge</b>: the umpire's call. <b>Chase</b>: taken, it's a ball, but swinging at one hurts your contact.</p>
      <p>Pitchers like to waste a High Heat up out of the zone here. <b>Press Take.</b></p>`,
    target: '[data-act=take]',
    setup: (prev) => {
      const s = batting(prev);
      deal(s, COACH, 'pitching', ['highHeat', 'curveball', 'twoSeam', 'slider'], ['changeup', 'dirtCurve']);
      return s;
    },
    expect: { matches: (a) => a.type === 'bat' && a.choice.action === 'take', hint: 'Press the Take button.' },
    demo: () => ({ type: 'bat', player: ME, choice: { action: 'take' } }),
    opponent: coachPitches('highHeat'),
    want: (t) => lastKind(t) === 'ball',
    after: `<p><b>Ball one.</b> Good eye.</p>
      <p>Four balls is a walk, three strikes is a strikeout, and fouls with two strikes don't count. Pitchers can miss their spot, too: a pitch can drift wider than its card says, even into the dirt.</p>`,
  },
  {
    title: 'Steal a base',
    body: `<p>You have a runner on first. A <b>Steal</b> card takes the pitch and sends the runner: roll a die plus the card's speed, +1 against Breaking or Offspeed. Four or more is safe.</p>
      <p>The coach is about to throw a breaking ball. <b>Select Steal and play it.</b></p>`,
    target: '.dock .hand',
    setup: (prev) => {
      const s = batting(prev);
      s.sit.bases = [true, false, false];
      deal(s, ME, 'batting', ['steal', 'swingAway', 'sitCurve', 'sitChange'], ['bunt', 'sitHeat']);
      deal(s, COACH, 'pitching', ['curveball', 'twoSeam', 'slider', 'changeup'], ['fourSeam']);
      return s;
    },
    expect: { matches: (a, s) => playedCard(a, s, 'steal'), hint: 'Select the Steal card, then press Play.' },
    demo: (s) => ({ type: 'bat', player: ME, choice: { action: 'play', card: handIndex(s, ME, 'batting', 'steal') } }),
    opponent: coachPitches('curveball'),
    want: (t) => t.lastPlay?.outcome.kind !== undefined && 'steal' in t.lastPlay.outcome && t.lastPlay.outcome.steal === 'safe',
    after: `<p><b>Safe at second!</b> A runner on second scores on almost any single.</p>
      <p>Other ways to move runners: <b>Bunt</b> (sacrifice them over), <b>Hit &amp; Run</b>, and sacrifice flies.</p>`,
  },
  {
    title: 'Now you pitch',
    body: `<p>In the bottom of the inning, you're on the mound. Scouting now shows the <b>batter's</b> deck: it's full of <b>Sit Fastball</b>.</p>
      <p>Offspeed fools a fastball sitter. <b>Select the Changeup, then press Throw.</b></p>`,
    target: '.scouting',
    placeLeft: true,
    setup: (prev) => {
      const s = structuredClone(prev ?? fresh());
      s.phase = 'pitch';
      s.half = 'bottom';
      s.pending = {};
      s.sit = { bases: [false, false, false], outs: 0, balls: 0, strikes: 0 };
      s.abPitches = [];
      // A fresh at-bat on the mound: the tracker shouldn't carry pitches from the batting lessons.
      s.history = [];
      s.lastPlay = null;
      s.players[COACH].runsByInning[0] ??= 0;
      deal(s, ME, 'pitching', ['fourSeam', 'changeup', 'curveball', 'highHeat', 'slider'], ['twoSeam', 'dirtCurve', 'cornerChange']);
      deal(s, COACH, 'batting', ['sitHeat', 'sitHeat', 'swingAway', 'sitHeat'], ['sitHeat', 'bunt']);
      return s;
    },
    expect: { matches: (a, s) => threwCard(a, s, 'changeup'), hint: 'Select the Changeup card, then press Throw.' },
    demo: (s) => ({ type: 'pitch', player: ME, choice: { card: handIndex(s, ME, 'pitching', 'changeup') } }),
    opponent: coachSwings('sitHeat'),
    want: (t) => lastKind(t) === 'swingingStrike',
    after: `<p><b>Swing and a miss!</b> He was sitting on Heat and you pulled the string.</p>
      <p>As a pitcher you're guessing too: what is the batter sitting on, and will he swing or take?</p>`,
  },
  {
    title: 'Max effort',
    body: `<p><b>🔥 Max effort</b> gives any pitch +2 stuff. It costs 1 of your 4 <b>stamina</b> and shuffles a <b>Tired Arm</b> (a flat, wild pitch) into your deck, so the strain comes back. Easy pitches and the market win stamina back.</p>
      <p><b>Select the Four-Seamer, turn on Max effort, then Throw.</b></p>`,
    target: '.effort',
    setup: (prev) => {
      const s = structuredClone(prev!);
      s.players[COACH].batting.hand = ['swingAway', 'sitCurve', 'bunt', 'swingAway'];
      return s;
    },
    expect: { matches: (a, s) => threwCard(a, s, 'fourSeam', true), hint: 'Select the Four-Seamer, press Max effort so it says ON, then press Throw.' },
    demo: (s) => ({ type: 'pitch', player: ME, choice: { card: handIndex(s, ME, 'pitching', 'fourSeam'), maxEffort: true } }),
    opponent: coachSwings('swingAway'),
    want: (t) => lastKind(t) === 'swingingStrike' || lastKind(t) === 'foul',
    after: `<p>Overpowering. Notice your stamina pips went down by one.</p>
      <p>Save max effort for big spots: two strikes, or runners in scoring position.</p>`,
  },
  {
    title: 'Two free tools',
    body: `<p><b>Mound visit</b>: once per half-inning, before the first pitch of an at-bat, throw back your whole hand and draw a fresh one, then pitch. Use it when your hand is all wrong for the count.</p>
      <p><b>Intentional walk</b>: with first base open, put the batter on first without a pitch, to set up a force or a double play.</p>`,
    target: '.tools',
  },
  {
    title: 'The market',
    body: `<p>Between half-innings you visit the <b>market</b>. You earn stars for hits, runs, walks, outs and strikeouts, plus 3 every half-inning, and you start each game with a spring-training visit.</p>
      <p>Signed players report immediately: the card goes <b>straight into your hand</b>. <b>Sign any card you can afford.</b></p>`,
    target: '.shop .market',
    setup: (prev) => {
      const s = structuredClone(prev!);
      s.phase = 'shop';
      s.pending = {};
      s.shop = { order: [ME, COACH], current: 0, released: false };
      s.players[ME].stars = 5;
      s.market.row = ['barrel', 'paintedHeater', 'goodEye', 'gas', 'waitHook', 'protect'];
      return s;
    },
    expect: { matches: (a) => a.type === 'buy', hint: 'Click a card you can afford in the top row to sign it.' },
    demo: () => ({ type: 'buy', player: ME, marketIndex: 1 }),
    after: `<p><b>Signed!</b> That card is already in your hand.</p>
      <p>Below the market you can also <b>release</b> one card per visit for 1★. Thinning out weak cards and Tired Arms makes your good ones come around more often.</p>`,
  },
  {
    title: "You're ready",
    setup: (prev) => {
      const s = batting(prev);
      s.shop = null;
      s.sit = { bases: [false, false, false], outs: 0, balls: 0, strikes: 0 };
      s.abPitches = [];
      return s;
    },
    body: `<p>That's the whole game: read the pitch, work the count, run the bases, manage your arm, and build a better roster.</p>
      <p>Start against the <b>Rookie</b>, then try the <b>Veteran</b> and the <b>All-Star</b>, who adapts to your habits. <b>Rules</b> has every detail.</p>`,
  },
];
