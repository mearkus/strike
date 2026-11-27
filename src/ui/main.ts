import './style.css';
import { chooseAction } from '../ai/ai';
import { IllegalAction, applyAction, battingTeam, newGame, pitchingTeam, score, verb, waitingOn } from '../engine/game';
import { Rng, randomSeed } from '../engine/rng';
import type { Action, DeckName, Difficulty, GameState, PlayerId } from '../engine/types';
import {
  DIFFICULTY_LABEL,
  esc,
  fieldHtml,
  handHtml,
  lastPlayHtml,
  logHtml,
  rulesHtml,
  scoreboardHtml,
  scoutingHtml,
  shopHtml,
} from './view';

type Mode = 'ai' | 'hotseat';

interface Settings {
  mode: Mode;
  difficulty: Difficulty;
  innings: number;
  side: 'away' | 'home';
  names: [string, string];
}

interface Ui {
  game: GameState | null;
  settings: Settings;
  humans: PlayerId[];
  selected: number | null;
  /** Hot-seat: whose hand is currently on screen. */
  viewer: PlayerId | null;
  showRules: boolean;
  releaseDeck: DeckName;
  revealKey: number;
  /** The reveal key that has already been animated, so re-renders don't replay it. */
  animatedKey: number;
  aiTimer: ReturnType<typeof setTimeout> | null;
  error: string | null;
  /** Showing the "abandon this game?" bar. */
  confirmQuit: boolean;
}

const SAVE_KEY = 'strike.save.v1';
const AI_SHOP_DELAY = 550;

const ui: Ui = {
  game: null,
  settings: { mode: 'ai', difficulty: 'veteran', innings: 3, side: 'away', names: ['You', 'Rival'] },
  humans: [],
  selected: null,
  viewer: null,
  showRules: false,
  releaseDeck: 'pitching',
  revealKey: 0,
  animatedKey: 0,
  aiTimer: null,
  error: null,
  confirmQuit: false,
};
const aiRng = new Rng(randomSeed());
const root = document.getElementById('app')!;

// ---------------------------------------------------------------- persistence

function save(): void {
  try {
    if (ui.game && ui.game.phase !== 'gameOver') localStorage.setItem(SAVE_KEY, JSON.stringify({ game: ui.game, settings: ui.settings, humans: ui.humans }));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function loadSave(): { game: GameState; settings: Settings; humans: PlayerId[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- flow

function startGame(): void {
  const st = ui.settings;
  const names: [string, string] = [st.names[0].trim() || 'Player 1', st.names[1].trim() || 'Player 2'];
  let ai: [Difficulty | null, Difficulty | null] = [null, null];
  let humans: PlayerId[] = [0, 1];
  if (st.mode === 'ai') {
    const humanSide: PlayerId = st.side === 'away' ? 0 : 1;
    const aiSide = (1 - humanSide) as PlayerId;
    names[aiSide] = `${DIFFICULTY_LABEL[st.difficulty]} AI`;
    names[humanSide] = st.names[0].trim() || 'You';
    ai = humanSide === 0 ? [null, st.difficulty] : [st.difficulty, null];
    humans = [humanSide];
  }
  ui.game = newGame({ names, ai, innings: st.innings, seed: randomSeed() });
  ui.humans = humans;
  ui.viewer = null;
  ui.selected = null;
  ui.revealKey = 0;
  ui.animatedKey = 0;
  step();
}

function act(action: Action): void {
  if (!ui.game) return;
  const before = ui.game.history.length;
  try {
    ui.game = applyAction(ui.game, action);
    ui.error = null;
  } catch (e) {
    if (e instanceof IllegalAction) ui.error = e.message;
    else throw e;
  }
  if (ui.game.history.length !== before) ui.revealKey++;
  ui.selected = null;
}

/** Advance the game: let AIs move, decide whose screen this is, render. */
function step(): void {
  if (ui.aiTimer) {
    clearTimeout(ui.aiTimer);
    ui.aiTimer = null;
  }
  const g = ui.game;
  if (g && g.phase === 'pitch') {
    // AIs choose instantly and in secret.
    for (const p of waitingOn(g)) if (g.players[p].ai) act(chooseAction(ui.game!, p, g.players[p].ai!, aiRng));
  }
  const g2 = ui.game;
  if (g2 && g2.phase === 'shop') {
    const shopper = waitingOn(g2)[0];
    if (g2.players[shopper].ai) {
      ui.aiTimer = setTimeout(() => {
        act(chooseAction(ui.game!, shopper, ui.game!.players[shopper].ai!, aiRng));
        step();
      }, AI_SHOP_DELAY);
    }
  }
  save();
  render();
}

/** The human who should act now (pitcher before batter in hot-seat). */
function actor(): PlayerId | null {
  const g = ui.game;
  if (!g) return null;
  const w = waitingOn(g).filter((p) => ui.humans.includes(p));
  if (!w.length) return null;
  if (g.phase === 'pitch' && w.includes(pitchingTeam(g))) return pitchingTeam(g);
  return w[0];
}

/** Whose private hand to show. In hot-seat, nobody until they confirm they have the device. */
function viewer(): PlayerId | null {
  const a = actor();
  if (a === null) return null;
  if (ui.humans.length === 1) return a;
  return ui.viewer === a ? a : null;
}

// ---------------------------------------------------------------- render

function render(): void {
  const g = ui.game;
  if (!g) {
    root.innerHTML = setupHtml();
    return;
  }
  const a = actor();
  const v = viewer();
  let center: string;
  if (g.phase === 'gameOver') center = gameOverHtml(g);
  else if (a === null) center = `<div class="hand-area"><p class="waiting">${g.phase === 'shop' ? `${esc(g.players[waitingOn(g)[0]].name)} is shopping…` : 'Thinking…'}</p></div>`;
  else if (v === null) center = passHtml(g, a);
  else if (g.phase === 'shop') center = shopHtml(g, v, ui.releaseDeck);
  else center = handHtml(g, v, ui.selected);

  const scoutFor = v ?? (ui.humans.length === 1 ? ui.humans[0] : null);
  root.innerHTML = `
  <header class="top">
    <div class="logo">STRIKE<span>⚾</span></div>
    <div class="actions">
      <button data-act="rules">How to play</button>
      <button data-act="quit">New game</button>
    </div>
  </header>
  ${ui.error ? `<div class="error">${esc(ui.error)}</div>` : ''}
  ${
    ui.confirmQuit
      ? `<div class="confirm-bar">Abandon this game? <button class="primary" data-act="quitYes">Yes, new game</button><button data-act="quitNo">Keep playing</button></div>`
      : ''
  }
  ${scoreboardHtml(g)}
  <div class="board">
    <div class="col left">
      ${fieldHtml(g)}
      ${g.phase === 'pitch' && scoutFor !== null ? scoutingHtml(g, scoutFor) : ''}
      ${roleHtml(g)}
    </div>
    <div class="col center">
      ${g.phase === 'pitch' || g.phase === 'gameOver' ? lastPlayHtml(g, ui.animatedKey !== ui.revealKey) : ''}
      ${center}
    </div>
    <div class="col right">
      <div class="panel"><h3>Play-by-play</h3>${logHtml(g)}</div>
    </div>
  </div>
  ${ui.showRules ? `<div class="modal" data-act="rules"><div class="modal-body" data-stop>${rulesHtml()}<button class="primary" data-act="rules">Got it</button></div></div>` : ''}`;
  if (g.phase === 'pitch' || g.phase === 'gameOver') ui.animatedKey = ui.revealKey;
}

function roleHtml(g: GameState): string {
  if (g.phase !== 'pitch') return '';
  return `<div class="panel roles">
    <div><span class="mini t-heat">Pitching</span> ${esc(g.players[pitchingTeam(g)].name)}</div>
    <div><span class="mini t-curve">Batting</span> ${esc(g.players[battingTeam(g)].name)} <span class="muted">(#${g.players[battingTeam(g)].lineupPos + 1} in the order)</span></div>
  </div>`;
}

function passHtml(g: GameState, a: PlayerId): string {
  const what = g.phase === 'shop' ? 'visit the market' : pitchingTeam(g) === a ? 'pick a pitch' : 'pick a swing';
  return `<div class="pass">
    <h2>Pass to ${esc(g.players[a].name)}</h2>
    <p>${esc(g.players[a].name)}, it's your turn to ${what}. Everyone else, look away.</p>
    <button class="primary" data-act="reveal" data-p="${a}">I'm ${esc(g.players[a].name)}: show my cards</button>
  </div>`;
}

function gameOverHtml(g: GameState): string {
  const w = g.winner;
  const title = w === 'tie' ? "It's a tie!" : `${esc(verb(g.players[w!].name, 'wins'))}!`;
  return `<div class="pass gameover">
    <h2>${title}</h2>
    <p class="final">${esc(g.players[0].name)} ${score(g, 0)} · ${esc(g.players[1].name)} ${score(g, 1)}</p>
    <div class="controls"><button class="primary" data-act="rematch">Rematch</button><button data-act="quit">New game</button></div>
  </div>`;
}

function setupHtml(): string {
  const st = ui.settings;
  const saved = loadSave();
  const opt = (v: string | number, cur: string | number, label: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `<div class="setup">
    <div class="logo big">STRIKE<span>⚾</span></div>
    <p class="tag">A two-player baseball deck-builder. Out-guess the pitcher, out-think the hitter, build a better roster.</p>
    ${saved ? `<button class="primary wide" data-act="continue">Continue: ${esc(saved.game.players[0].name)} ${score(saved.game, 0)} – ${score(saved.game, 1)} ${esc(saved.game.players[1].name)}, ${saved.game.half === 'top' ? 'top' : 'bottom'} ${saved.game.inning}</button>` : ''}
    <form class="setup-form" data-form="setup">
      <fieldset>
        <legend>Opponent</legend>
        <label><input type="radio" name="mode" value="ai" ${st.mode === 'ai' ? 'checked' : ''}> Computer</label>
        <label><input type="radio" name="mode" value="hotseat" ${st.mode === 'hotseat' ? 'checked' : ''}> Friend (pass and play)</label>
      </fieldset>
      <div class="grid">
        ${
          st.mode === 'ai'
            ? `<label>Difficulty
          <select name="difficulty">${opt('rookie', st.difficulty, 'Rookie: plays on gut feel')}${opt('veteran', st.difficulty, 'Veteran: plays the percentages')}${opt('allstar', st.difficulty, 'All-Star: game theory and scouting')}</select>
        </label>
        <label>You
          <select name="side">${opt('away', st.side, 'Bat first (away)')}${opt('home', st.side, 'Pitch first (home)')}</select>
        </label>`
            : ''
        }
        <label>Innings
          <select name="innings">${[3, 5, 7, 9].map((n) => opt(n, st.innings, `${n} innings${n === 3 ? ' (about 15 min)' : ''}`)).join('')}</select>
        </label>
        <label>${st.mode === 'ai' ? 'Your name' : 'Away team'} <input name="name0" maxlength="20" value="${esc(st.names[0])}"></label>
        ${st.mode === 'hotseat' ? `<label>Home team <input name="name1" maxlength="20" value="${esc(st.names[1])}"></label>` : ''}
      </div>
      <div class="controls">
        <button class="primary" type="submit">Play ball!</button>
        <button type="button" data-act="rules">How to play</button>
      </div>
    </form>
  </div>
  ${ui.showRules ? `<div class="modal" data-act="rules"><div class="modal-body" data-stop>${rulesHtml()}<button class="primary" data-act="rules">Got it</button></div></div>` : ''}`;
}

// ---------------------------------------------------------------- input

function readSetupForm(form: HTMLFormElement): void {
  const f = new FormData(form);
  ui.settings = {
    mode: (f.get('mode') as Mode) ?? 'ai',
    difficulty: (f.get('difficulty') as Difficulty | null) ?? ui.settings.difficulty,
    innings: Number(f.get('innings') ?? 3),
    side: (f.get('side') as 'away' | 'home' | null) ?? ui.settings.side,
    names: [String(f.get('name0') ?? ''), String(f.get('name1') ?? ui.settings.names[1])],
  };
}

root.addEventListener('submit', (e) => {
  e.preventDefault();
  readSetupForm(e.target as HTMLFormElement);
  startGame();
});

root.addEventListener('change', (e) => {
  const form = (e.target as HTMLElement).closest('form[data-form="setup"]') as HTMLFormElement | null;
  if (!form) return;
  readSetupForm(form);
  if ((e.target as HTMLInputElement).name === 'mode') {
    ui.settings.names = ui.settings.mode === 'ai' ? ['You', 'Rival'] : ['Away', 'Home'];
    render();
  }
});

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const el = target.closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  if (el.classList.contains('modal') && target.closest('[data-stop]')) return;
  handle(el.dataset.act!, el);
});

root.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if ((e.key === 'Enter' || e.key === ' ') && el.dataset.act && el.tagName !== 'BUTTON') {
    e.preventDefault();
    handle(el.dataset.act, el);
  }
});

document.addEventListener('keydown', (e) => {
  if (!ui.game || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const v = viewer();
  if (v === null || ui.game.phase !== 'pitch') return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9) handle('select', { dataset: { i: String(n - 1) } } as unknown as HTMLElement);
  else if (e.key === 'Enter' && ui.selected !== null) handle(pitchingTeam(ui.game) === v ? 'throw' : 'play', null);
  else if (e.key.toLowerCase() === 't' && battingTeam(ui.game) === v) handle('take', null);
});

function handle(actName: string, el: HTMLElement | null): void {
  const g = ui.game;
  const v = viewer();
  switch (actName) {
    case 'rules':
      ui.showRules = !ui.showRules;
      return render();
    case 'continue': {
      const s = loadSave();
      if (s) {
        ui.game = s.game;
        ui.settings = s.settings;
        ui.humans = s.humans;
        ui.viewer = null;
      }
      return step();
    }
    case 'quit':
      if (g && g.phase !== 'gameOver') {
        ui.confirmQuit = true;
        return render();
      }
      ui.game = null;
      save();
      return render();
    case 'quitYes':
      if (ui.aiTimer) clearTimeout(ui.aiTimer);
      ui.confirmQuit = false;
      ui.game = null;
      save();
      return render();
    case 'quitNo':
      ui.confirmQuit = false;
      return render();
    case 'rematch':
      return startGame();
    case 'reveal':
      ui.viewer = Number(el!.dataset.p) as PlayerId;
      return render();
    case 'relDeck':
      ui.releaseDeck = el!.dataset.deck as DeckName;
      return render();
  }
  if (!g || v === null) return;
  switch (actName) {
    case 'select': {
      const i = Number(el!.dataset.i);
      const hand = pitchingTeam(g) === v ? g.players[v].pitching.hand : g.players[v].batting.hand;
      if (i < 0 || i >= hand.length) return;
      ui.selected = ui.selected === i ? null : i;
      return render();
    }
    case 'throw':
      if (ui.selected === null) return;
      act({ type: 'pitch', player: v, choice: { card: ui.selected } });
      break;
    case 'meatball':
      act({ type: 'pitch', player: v, choice: { card: null } });
      break;
    case 'play':
      if (ui.selected === null) return;
      act({ type: 'bat', player: v, choice: { action: 'play', card: ui.selected } });
      break;
    case 'take':
      act({ type: 'bat', player: v, choice: { action: 'take' } });
      break;
    case 'hack':
      act({ type: 'bat', player: v, choice: { action: 'hack' } });
      break;
    case 'buy':
      act({ type: 'buy', player: v, marketIndex: Number(el!.dataset.i) });
      break;
    case 'release':
      act({ type: 'release', player: v, deck: ui.releaseDeck, cardId: el!.dataset.id! });
      break;
    case 'endShop':
      act({ type: 'endShop', player: v });
      break;
    default:
      return;
  }
  // In hot-seat, hide hands again once this player has acted.
  if (ui.humans.length > 1 && actor() !== v) ui.viewer = null;
  step();
}

// Resume straight into a saved game's setup screen.
render();
