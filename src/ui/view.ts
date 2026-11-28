import { FOOLED_BY, PITCH_HAND_SIZE, PITCH_TYPES, TYPE_LABEL, ZONE_LABEL, card } from '../engine/cards';
import { ECONOMY, MIN_DECK_SIZE, RELEASE_COST, STAMINA, battingTeam, deckList, ordinal, pitchingTeam, score } from '../engine/game';
import { CHECK_SWING_ROLL, EDGE_STRIKE_ROLL, MAX_EFFORT_STUFF, READ_QUALITY_BONUS, WILD_PITCH_ROLL, ZONE_CONTACT, canSteal } from '../engine/resolve';
import { BALLS_FOR_WALK, STRIKES_FOR_OUT, advance } from '../engine/situation';
import type { CardDef, DeckName, Difficulty, GameState, PlayRecord, PlayerId } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { rookie: 'Rookie', veteran: 'Veteran', allstar: 'All-Star' };

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// ---------------------------------------------------------------- cards

export interface CardOpts {
  selectable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  act?: string;
  index?: number;
  /** Card id to attach as data-id (for release buttons). */
  dataId?: string;
  footer?: string;
  small?: boolean;
  /** Smallest variant (no rules text) for the pitch reveal. */
  mini?: boolean;
}

export function cardHtml(id: string, o: CardOpts = {}): string {
  const c = card(id);
  const cls = ['card', c.kind, colorClass(c), o.selected ? 'selected' : '', o.disabled ? 'disabled' : '', o.selectable ? 'selectable' : '', o.small ? 'small' : '', o.mini ? 'tiny' : '']
    .filter(Boolean)
    .join(' ');
  const attrs = o.act && !o.disabled ? `data-act="${o.act}" data-i="${o.index ?? ''}"${o.dataId ? ` data-id="${o.dataId}"` : ''} tabindex="0" role="button"` : '';
  return `<div class="${cls}" ${attrs} title="${esc(c.name)}: ${esc(c.text)}">
    <div class="card-head"><span class="badge">${headLabel(c)}</span>${c.cost > 0 && !o.mini ? `<span class="cost">${c.cost}★</span>` : ''}</div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-stats">${statsHtml(c)}</div>
    <div class="card-text">${esc(c.text)}</div>
    ${o.footer ?? ''}
  </div>`;
}

function colorClass(c: CardDef): string {
  if (c.kind === 'pitch') return `t-${c.type}`;
  if (c.kind === 'swing') return `t-${c.sit}`;
  return 't-tactic';
}

function headLabel(c: CardDef): string {
  if (c.kind === 'pitch') return `${TYPE_LABEL[c.type]} · ${ZONE_LABEL[c.zone]}`;
  if (c.kind === 'swing') return c.sit === 'any' ? 'Swing' : `Sit ${TYPE_LABEL[c.sit]}`;
  return 'Tactic';
}

function statsHtml(c: CardDef): string {
  if (c.kind === 'pitch')
    return `<span class="zone z-${c.zone}">${ZONE_LABEL[c.zone]}</span><span>Stuff ${c.stuff}</span><span title="Hits its spot on a d6 roll of ${c.control} or less">Ctrl ${c.control}</span>`;
  if (c.kind === 'swing') return `<span>Contact ${signed(c.contact)}</span><span>Power ${signed(c.power)}</span>`;
  const label = { steal: 'Steal', bunt: 'Bunt', goodEye: 'Take + draw' }[c.tactic];
  return `<span>${label}</span>${c.bonus ? `<span>${signed(c.bonus)}</span>` : ''}`;
}

// ---------------------------------------------------------------- scoreboard

export function scoreboardHtml(s: GameState): string {
  const n = Math.max(s.config.innings, s.inning);
  const cols = Array.from({ length: n }, (_, i) => i);
  const row = (p: PlayerId) => {
    const pl = s.players[p];
    const cells = cols
      .map((i) => {
        const v = pl.runsByInning[i];
        const live = s.phase !== 'gameOver' && s.inning === i + 1 && battingTeam(s) === p;
        return `<td class="${live ? 'live' : ''}">${v === undefined ? '' : v}</td>`;
      })
      .join('');
    const bat = s.phase === 'pitch' && battingTeam(s) === p ? '<span class="bat-dot" title="Batting">●</span>' : '';
    return `<tr><th class="team">${bat}${esc(pl.name)}${pl.ai ? ` <small>${DIFFICULTY_LABEL[pl.ai]}</small>` : ''}</th>${cells}<td class="r">${score(s, p)}</td><td class="h">${pl.hits}</td><td class="stars" title="Stars to spend in the market">${pl.stars}★</td></tr>`;
  };
  return `<table class="scoreboard">
    <thead><tr><th></th>${cols.map((i) => `<th>${i + 1}</th>`).join('')}<th>R</th><th>H</th><th>★</th></tr></thead>
    <tbody>${row(0)}${row(1)}</tbody>
  </table>`;
}

// ---------------------------------------------------------------- score bug

const dots = (n: number, max: number, cls: string) => Array.from({ length: max }, (_, i) => `<span class="dot ${cls} ${i < n ? 'on' : ''}"></span>`).join('');

function miniBases(b: [boolean, boolean, boolean]): string {
  const d = (x: number, y: number, on: boolean) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" class="${on ? 'on' : ''}"/>`;
  return `<svg viewBox="0 0 40 28" class="mini-bases" aria-label="Runners">${d(32, 16, b[0])}${d(20, 6, b[1])}${d(8, 16, b[2])}</svg>`;
}

/** Broadcast-style one-line score bug: everything you need between pitches. */
export function scoreBugHtml(s: GameState, flashRuns: boolean): string {
  const team = (p: PlayerId) => {
    const pl = s.players[p];
    const bat = s.phase === 'pitch' && battingTeam(s) === p;
    const scored = flashRuns && s.lastPlay && s.lastPlay.runs > 0 && s.lastPlay.batter === p;
    return `<div class="bug-team ${bat ? 'bat' : ''}" title="${esc(pl.name)}: ${pl.stars} stars to spend">
      <span class="bug-name">${bat ? '<span class="bat-dot">●</span>' : ''}${esc(pl.name)}</span>
      <span class="bug-stars">${pl.stars}★</span>
      <span class="bug-runs ${scored ? 'flash' : ''}">${score(s, p)}</span>
    </div>`;
  };
  const live = s.phase !== 'gameOver';
  return `<div class="bug">
    <div class="bug-teams">${team(0)}${team(1)}</div>
    <div class="bug-inning">${s.half === 'top' ? '▲' : '▼'} ${ordinal(s.inning)}</div>
    ${miniBases(s.sit.bases)}
    <div class="bug-count" aria-label="Count">
      <span class="lbl">B</span>${dots(live ? s.sit.balls : 0, BALLS_FOR_WALK - 1, 'ball')}
      <span class="lbl">S</span>${dots(live ? s.sit.strikes : 0, STRIKES_FOR_OUT - 1, 'strike')}
      <span class="lbl">O</span>${dots(live ? Math.min(s.sit.outs, 2) : 0, 2, 'out')}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- stage (field + last pitch + at-bat)

// Field geometry (SVG user units). Bases: 0 = 1st, 1 = 2nd, 2 = 3rd, 3 = home.
const HOME: [number, number] = [100, 162];
const BASE_XY: Array<[number, number]> = [[182, 82], [100, 16], [18, 82], HOME];
const MOUND: [number, number] = [100, 92];
/** Milliseconds: when the field animation starts (after the cards flip) and per base run. */
export const FIELD_TIMING = { pitchStart: 250, pitch: 320, perBase: 340 };

const pt = ([x, y]: [number, number], s = 1) => `${x.toFixed(1)},${y.toFixed(1)},${s}`;

/** Sample a ball flight from a to b with an arc of the given height (and a little growth at the apex). */
function flight(a: [number, number], b: [number, number], height: number, steps = 14): string {
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lift = 4 * t * (1 - t);
    out.push(pt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - height * lift], 1 + (height / 40) * lift));
  }
  return out.join(' ');
}

/** Where batted balls go. `lane` (0 = left, 1 = center, 2 = right) varies the spray. */
function landing(hit: string, lane: number): { to: [number, number]; height: number; ms: number } {
  const pick = <T,>(a: T[]) => a[lane % a.length];
  switch (hit) {
    case 'groundout':
    case 'doublePlay':
      return { to: pick<[number, number]>([[58, 102], [112, 70], [142, 102]]), height: 0, ms: 420 };
    case 'popout':
      return { to: pick<[number, number]>([[78, 118], [100, 100], [124, 118]]), height: 70, ms: 800 };
    case 'flyout':
      return { to: pick<[number, number]>([[38, 6], [100, -16], [162, 6]]), height: 55, ms: 820 };
    case 'single':
      return { to: pick<[number, number]>([[46, 34], [100, -4], [154, 34]]), height: 18, ms: 560 };
    case 'double':
      return { to: pick<[number, number]>([[40, 8], [100, -22], [160, 8]]), height: 30, ms: 680 };
    case 'triple':
      return { to: pick<[number, number]>([[8, 40], [192, 40], [8, 40]]), height: 28, ms: 720 };
    case 'homeRun':
      return { to: pick<[number, number]>([[4, -40], [100, -62], [196, -40]]), height: 75, ms: 950 };
    default:
      return { to: pick<[number, number]>([[86, 140], [114, 140]]), height: 0, ms: 380 }; // bunts
  }
}

/** Waypoints for a runner from base `from` (-1 = batter at home) to a destination. */
function runnerPath(from: number, to: number | 'home' | 'out'): { pts: [number, number][]; bases: number } {
  const start: [number, number] = from < 0 ? HOME : BASE_XY[from];
  if (to === 'out') {
    const next = BASE_XY[from + 1];
    return { pts: [start, [(start[0] + next[0]) / 2, (start[1] + next[1]) / 2]], bases: 0.6 };
  }
  const end = to === 'home' ? 3 : to;
  const pts: [number, number][] = [start];
  for (let b = from + 1; b <= end; b++) pts.push(BASE_XY[b]);
  return { pts, bases: Math.max(1, end - from) };
}

function diamondHtml(s: GameState, animate: boolean): string {
  const lp = s.lastPlay;
  const moves = animate && lp?.moves ? lp.moves : null;
  const base = ([x, y]: [number, number], label: string) =>
    `<polygon points="${x},${y - 11} ${x + 11},${y} ${x},${y + 11} ${x - 11},${y}" class="base"><title>${label}</title></polygon>`;

  // Runners: static tokens for anyone who didn't move; animated tokens for the play.
  const movers = new Set(moves?.map((m) => m.runner) ?? []);
  const tokens: string[] = [];
  const startBases = moves && lp ? lp.situationBefore.bases : s.sit.bases;
  const endBases = s.sit.bases;
  [0, 1, 2].forEach((i) => {
    const stays = moves ? startBases[i] && !movers.has(i as 0 | 1 | 2) && endBases[i] : endBases[i];
    if (stays) tokens.push(`<circle class="runner" r="7" transform="translate(${BASE_XY[i][0]} ${BASE_XY[i][1]})"><title>Runner on ${['first', 'second', 'third'][i]}</title></circle>`);
  });

  const fx: string[] = [];
  if (animate && lp) {
    const T = FIELD_TIMING;
    const o = lp.outcome;
    const contactAt = T.pitchStart + T.pitch;
    let runAt = contactAt + 120;
    // The pitch: mound to plate (or past it into the dirt).
    const plate: [number, number] = o.kind === 'ball' && o.dirt ? [100, 178] : HOME;
    fx.push(`<circle class="ball" r="3.6" data-path="${flight(MOUND, plate, 6, 6)}" data-delay="${T.pitchStart}" data-dur="${T.pitch}" data-end="hide"/>`);
    if (o.kind === 'inPlay' || o.kind === 'buntHit' || o.kind === 'sacrifice' || o.kind === 'buntOut') {
      const hit = o.kind === 'inPlay' ? o.hit : 'bunt';
      const l = landing(hit, s.history.length);
      fx.push(`<circle class="ball" r="3.6" data-path="${flight(HOME, l.to, l.height)}" data-delay="${contactAt}" data-dur="${l.ms}" data-end="${hit === 'homeRun' ? 'hide' : 'stay'}"/>`);
      runAt = contactAt + Math.min(260, l.ms * 0.4);
      if (hit === 'homeRun') fx.push(`<text class="stamp gone" x="100" y="-30" style="animation-delay:${contactAt + l.ms - 200}ms">GONE!</text>`);
    } else if (o.kind === 'foul') {
      const side: [number, number] = s.history.length % 2 ? [-8, 120] : [208, 120];
      fx.push(`<circle class="ball" r="3.6" data-path="${flight(HOME, side, 40, 10)}" data-delay="${contactAt}" data-dur="520" data-end="hide"/>`);
    } else if (o.kind === 'ball' && o.wild) {
      fx.push(`<circle class="ball" r="3.6" data-path="${flight([100, 178], [70, 172], 0, 4)}" data-delay="${contactAt}" data-dur="380" data-end="hide"/>`);
    }
    // Scorekeeping stamps.
    const r = moves ? advanceResultName(lp) : null;
    if (r === 'strikeout') fx.push(`<text class="stamp k ${o.kind === 'calledStrike' ? 'looking' : ''}" x="100" y="112" style="animation-delay:${contactAt}ms">K</text>`);
    if (r === 'walk') fx.push(`<text class="stamp bb" x="100" y="110" style="animation-delay:${contactAt}ms">BB</text>`);
    // Runners on the move.
    for (const m of moves ?? []) {
      const from = m.runner === 'B' ? -1 : m.runner;
      const path = runnerPath(from, m.to);
      const dur = Math.round(path.bases * T.perBase);
      const end = m.to === 'home' ? 'score' : m.to === 'out' ? 'out' : 'stay';
      fx.push(`<circle class="runner ${end === 'out' ? 'retired' : ''}" r="7" data-path="${path.pts.map((p) => pt(p)).join(' ')}" data-delay="${runAt}" data-dur="${dur}" data-end="${end}"/>`);
      if (end === 'score') fx.push(`<text class="stamp run" x="${HOME[0] + 18}" y="${HOME[1] - 6}" style="animation-delay:${runAt + dur - 80}ms">+1</text>`);
    }
  }

  return `<svg viewBox="-12 -70 224 250" class="diamond" aria-label="Field">
    <path d="M100 162 L-8 54 Q100 -112 208 54 Z" class="grass"/>
    <path d="M100 162 L182 82 L100 12 L18 82 Z" class="infield"/>
    <circle cx="${MOUND[0]}" cy="${MOUND[1]}" r="9" class="mound"/>
    ${base(BASE_XY[0], 'First')}
    ${base(BASE_XY[1], 'Second')}
    ${base(BASE_XY[2], 'Third')}
    <path d="M90 152 L110 152 L110 162 L100 170 L90 162 Z" class="plate"/>
    ${tokens.join('')}
    ${fx.join('')}
  </svg>`;
}

function advanceResultName(lp: PlayRecord): string | null {
  return advance(lp.situationBefore, lp.outcome).result;
}

function resultClass(lp: PlayRecord): string {
  if (lp.runs > 0) return 'runs';
  if (/Home run|triple|double|Base hit|Bunt single|Ball four|Stolen|wild pitch/.test(lp.result)) return 'good';
  if (/Strike three|double play|Caught/.test(lp.result)) return 'bad';
  return '';
}

/** The last pitch: both cards and what happened. */
export function lastPlayHtml(s: GameState, animate: boolean): string {
  const lp: PlayRecord | null = s.lastPlay;
  if (!lp) return `<div class="reveal empty"><p>Both sides pick a card in secret, then the pitch is revealed here.</p></div>`;
  const batCard = lp.batCard
    ? cardHtml(lp.batCard, { mini: true })
    : `<div class="card tiny blank"><div class="card-name">${lp.batChoice.action === 'take' ? 'Take' : 'Hack'}</div><div class="card-text">${lp.batChoice.action === 'take' ? 'No swing.' : 'A swing with no card.'}</div></div>`;
  return `<div class="reveal${animate ? ' animate' : ''}">
    <div class="duel">
      <div class="side"><div class="who">${esc(s.players[lp.pitcher].name)}${lp.maxEffort ? ' <span class="effort-tag">MAX EFFORT</span>' : ''}</div>${cardHtml(lp.pitchCard, { mini: true })}</div>
      <div class="vs">vs</div>
      <div class="side"><div class="who">${esc(s.players[lp.batter].name)}</div>${batCard}</div>
    </div>
    <div class="result ${resultClass(lp)}">${esc(lp.result)}</div>
  </div>`;
}

const ended = (h: PlayRecord) => advance(h.situationBefore, h.outcome).atBatOver;

/** The pitches of the current at-bat, or of the one that just ended. */
export function atBatPlays(s: GameState): { plays: PlayRecord[]; current: boolean } {
  const H = s.history;
  const i = H.length - 1;
  if (i < 0) return { plays: [], current: true };
  let j = ended(H[i]) ? i - 1 : i;
  while (j >= 0 && !ended(H[j])) j--;
  return ended(H[i]) ? { plays: H.slice(j + 1, i + 1), current: false } : { plays: H.slice(j + 1), current: true };
}

function shortOutcome(h: PlayRecord): string {
  const o = h.outcome;
  const r = advance(h.situationBefore, o).result;
  if (r) return ({ walk: 'Walk', strikeout: 'Strikeout', groundout: 'Groundout', doublePlay: 'Double play', popout: 'Popout', flyout: 'Flyout', sacFly: 'Sac fly', single: 'Single', double: 'Double', triple: 'Triple', homeRun: 'Home run', sacrifice: 'Sac bunt', buntHit: 'Bunt hit', buntOut: 'Bunt out' } as Record<string, string>)[r];
  if (o.kind === 'ball') return o.wild ? 'Wild pitch' : o.dirt ? 'In the dirt' : o.checkSwing ? 'Checked swing' : 'Ball';
  return ({ calledStrike: 'Called strike', swingingStrike: 'Swinging strike', foul: 'Foul', buntFoul: 'Foul bunt' } as Record<string, string>)[o.kind] ?? o.kind;
}

/** Pitch-by-pitch list of the current at-bat. */
export function atBatHtml(s: GameState): string {
  const { plays, current } = atBatPlays(s);
  const who = plays.length ? s.players[plays[0].batter].name : s.players[battingTeam(s)].name;
  const rows = plays
    .map((h, k) => {
      const p = card(h.pitchCard);
      const type = p.kind === 'pitch' ? p.type : 'any';
      const after = advance(h.situationBefore, h.outcome).sit;
      const bat = h.outcome.kind === 'intentionalWalk' ? '—' : h.batCard ? card(h.batCard).name : h.batChoice.action === 'take' ? 'Take' : 'Hack';
      const count = advance(h.situationBefore, h.outcome).atBatOver ? '' : `<span class="ab-count">${after.balls}-${after.strikes}</span>`;
      return `<li class="${k === plays.length - 1 ? 'latest' : ''}"><span class="ab-n">${k + 1}</span><span class="mini t-${type}">${esc(card(h.pitchCard).name)}${h.maxEffort ? ' 🔥' : ''}</span><span class="ab-bat">${esc(bat)}</span><b class="ab-out">${shortOutcome(h)}</b>${count}</li>`;
    })
    .join('');
  return `<div class="atbat">
    <h3>${current ? 'This at-bat' : 'Last at-bat'} <span class="muted">· ${esc(who)}</span></h3>
    ${rows ? `<ol>${rows}</ol>` : '<p class="muted">No pitches yet.</p>'}
  </div>`;
}

/** Box-score line for one half-inning, from the pitch history. */
export function halfInningLine(s: GameState, inning: number, half: 'top' | 'bottom'): { runs: number; hits: number; walks: number; strikeouts: number } {
  const line = { runs: 0, hits: 0, walks: 0, strikeouts: 0 };
  for (const h of s.history) {
    if (h.inning !== inning || h.half !== half) continue;
    line.runs += h.runs;
    const r = advance(h.situationBefore, h.outcome).result;
    if (r === 'single' || r === 'double' || r === 'triple' || r === 'homeRun' || r === 'buntHit') line.hits++;
    if (r === 'walk') line.walks++;
    if (r === 'strikeout') line.strikeouts++;
  }
  return line;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Shown after the third out, before the market opens, so the last play can be seen.
 * `s` is the state right after the out (still the half-inning that just ended).
 */
export function recapHtml(s: GameState): string {
  const batting = battingTeam(s);
  const line = halfInningLine(s, s.inning, s.half);
  const how = s.lastPlay ? shortOutcome(s.lastPlay) : '';
  const nextHalf = s.half === 'top' ? `the bottom of the ${ordinal(s.inning)}` : `the top of the ${ordinal(s.inning + 1)}`;
  return `<div class="recap" role="status">
    <h2>Three outs${how ? ` <span class="muted">· ${esc(how)}</span>` : ''}</h2>
    <p><b>End of the ${s.half} of the ${ordinal(s.inning)}.</b> ${esc(s.players[batting].name)}: ${plural(line.runs, 'run')}, ${plural(line.hits, 'hit')}, ${plural(line.walks, 'walk')}, ${plural(line.strikeouts, 'strikeout')}.</p>
    <p class="muted">${esc(s.players[0].name)} ${score(s, 0)}, ${esc(s.players[1].name)} ${score(s, 1)}. Next: the market, then ${nextHalf}.</p>
    <button class="primary" data-act="nextInning">Continue to the market</button>
  </div>`;
}

export function rolesHtml(s: GameState): string {
  if (s.phase !== 'pitch') return '';
  const b = battingTeam(s);
  return `<div class="roles"><span class="mini t-heat">Pitching</span> ${esc(s.players[pitchingTeam(s)].name)} <span class="mini t-curve">Batting</span> ${esc(s.players[b].name)} <span class="muted">#${s.players[b].lineupPos + 1}</span></div>`;
}

/** The middle of the table: field, last pitch and at-bat tracker. */
export function stageHtml(s: GameState, animate: boolean): string {
  return `<div class="stage-top">
      <div class="stage-field">${diamondHtml(s, animate)}${rolesHtml(s)}</div>
      <div class="stage-play">${lastPlayHtml(s, animate)}</div>
    </div>
    ${atBatHtml(s)}`;
}

export function logHtml(s: GameState): string {
  const items = s.log
    .slice(-60)
    .reverse()
    .map((e) => `<li class="${e.runs ? 'scored' : ''}"><span class="inn">${e.half === 'top' ? '▲' : '▼'}${e.inning}</span> ${esc(e.text)}</li>`)
    .join('');
  return `<ol class="log">${items}</ol>`;
}

// ---------------------------------------------------------------- scouting

/** Public information about the opponent's unplayed cards: the AI sees exactly this much too. */
export function scoutingHtml(s: GameState, viewer: PlayerId): string {
  const opp = (1 - viewer) as PlayerId;
  const pitching = pitchingTeam(s) === opp;
  const pile = pitching ? s.players[opp].pitching : s.players[opp].batting;
  const unseen = [...pile.draw, ...pile.hand];
  const pct = (n: number) => `${Math.round((n / Math.max(1, unseen.length)) * 100)}%`;
  let rows = '';
  if (pitching) {
    const by = (f: (id: string) => string) => {
      const m = new Map<string, number>();
      for (const id of unseen) m.set(f(id), (m.get(f(id)) ?? 0) + 1);
      return m;
    };
    const types = by((id) => {
      const c = card(id);
      return c.kind === 'pitch' ? c.type : '';
    });
    const zones = by((id) => {
      const c = card(id);
      return c.kind === 'pitch' ? c.zone : '';
    });
    rows += `<div class="bars">${[...PITCH_TYPES, 'knuckle'].filter((t) => types.get(t)).map((t) => `<span class="mini t-${t}">${TYPE_LABEL[t]} ${pct(types.get(t)!)}</span>`).join('')}</div>`;
    rows += `<div class="bars">${['strike', 'edge', 'chase'].filter((z) => zones.get(z)).map((z) => `<span class="mini zone z-${z}">${ZONE_LABEL[z]} ${pct(zones.get(z)!)}</span>`).join('')}</div>`;
    const tired = tiredCount(deckList(s.players[opp].pitching));
    rows += `<p class="muted">Fatigue: ${tired} Tired Arm${tired === 1 ? '' : 's'} in their deck. Stamina ${staminaPips(s.players[opp].stamina)}</p>`;
  } else {
    const sits = new Map<string, number>();
    for (const id of unseen) {
      const c = card(id);
      const k = c.kind === 'swing' ? (c.sit === 'any' ? 'any' : c.sit) : 'tactic';
      sits.set(k, (sits.get(k) ?? 0) + 1);
    }
    rows += `<div class="bars">${['heat', 'curve', 'change', 'any', 'tactic'].filter((k) => sits.get(k)).map((k) => `<span class="mini t-${k}">${k === 'tactic' ? 'Tactics' : k === 'any' ? 'Any' : `Sit ${TYPE_LABEL[k]}`} ${pct(sits.get(k)!)}</span>`).join('')}</div>`;
  }
  return `<div class="panel scouting">
    <h3>Scouting ${esc(s.players[opp].name)}</h3>
    <p class="muted">Unplayed ${pitching ? 'pitches' : 'batting cards'} (${unseen.length}), ${s.players[opp][pitching ? 'pitching' : 'batting'].hand.length} in hand:</p>
    ${rows}
  </div>`;
}

/** Stamina meter: filled pips for each Max Effort left. */
export function staminaPips(n: number): string {
  return `<span class="stamina" title="${n} of ${STAMINA} stamina: each Max Effort spends one" aria-label="${n} of ${STAMINA} stamina">${Array.from({ length: STAMINA }, (_, i) => `<span class="pip ${i < n ? 'on' : ''}"></span>`).join('')}</span>`;
}

function fatigueHtml(deck: string[]): string {
  const n = tiredCount(deck);
  return `<span class="fatigue ${n >= 3 ? 'high' : ''}" title="Tired Arm cards in your pitching deck">Fatigue: ${n} Tired Arm${n === 1 ? '' : 's'} in ${deck.length} cards</span>`;
}

export function deckSummaryHtml(s: GameState, p: PlayerId, deck: DeckName): string {
  const pile = s.players[p][deck];
  return `<span class="muted">Draw ${pile.draw.length} · Discard ${pile.discard.length} · Deck ${deckList(pile).length}</span>`;
}

// ---------------------------------------------------------------- hand & controls

const tiredCount = (ids: string[]) => ids.filter((id) => id === 'tiredArm').length;
/** Two human players: label whose hand this is. */
const ui2 = (s: GameState) => !s.players[0].ai && !s.players[1].ai;

export function handHtml(s: GameState, viewer: PlayerId, selected: number | null, maxEffort = false, confirmWalk = false): string {
  const pitching = pitchingTeam(s) === viewer;
  const pl = s.players[viewer];
  const pile = pitching ? pl.pitching : pl.batting;
  const waiting = pitching ? !s.pending.pitch : !s.pending.bat;
  if (!waiting) return `<div class="dock-msg"><p class="waiting">Waiting for ${esc(s.players[(1 - viewer) as PlayerId].name)}…</p></div>`;

  const cards = pile.hand
    .map((id, i) => {
      const c = card(id);
      const disabled = c.kind === 'tactic' && c.tactic === 'steal' && !canSteal(s.sit.bases);
      return cardHtml(id, { selectable: true, selected: selected === i, disabled, act: 'select', index: i });
    })
    .join('');

  let controls: string;
  if (pitching) {
    const sel = selected !== null ? card(pile.hand[selected]) : null;
    controls =
      pile.hand.length === 0
        ? `<button class="primary" data-act="meatball">Out of cards: groove a Tired Arm fastball</button>`
        : `<button class="primary" data-act="throw" ${sel ? '' : 'disabled'}>${sel ? `Throw ${esc(sel.name)}${maxEffort ? ' with max effort' : ''}` : 'Pick a pitch'}</button>
      ${
        pl.stamina > 0
          ? `<button class="effort ${maxEffort ? 'on' : ''}" data-act="effort" aria-pressed="${maxEffort}" title="+${MAX_EFFORT_STUFF} stuff on this pitch. Spends 1 stamina and shuffles a Tired Arm into your draw pile. (E)">🔥 Max effort ${maxEffort ? 'ON' : 'off'} ${staminaPips(pl.stamina)}</button>`
          : `<button class="effort" disabled title="Out of stamina. Throw an Easy pitch or release a Tired Arm in the market to win some back.">🔥 Out of stamina ${staminaPips(0)}</button>`
      }`;
    controls += `<div class="tools">
      <button data-act="mound" ${s.moundVisitUsed ? 'disabled' : ''} title="Once per half-inning: throw back your hand and draw ${PITCH_HAND_SIZE} fresh cards. You still pitch after.">${s.moundVisitUsed ? 'Mound visit used' : 'Mound visit'}</button>
      <button data-act="ibb" class="${confirmWalk ? 'confirm' : ''}" ${s.sit.bases[0] ? 'disabled' : ''} title="${s.sit.bases[0] ? 'Only with first base open.' : 'Put the batter on first without throwing a pitch, to set up a force or a double play.'}">${confirmWalk ? 'Confirm: walk him' : 'Intentional walk'}</button>
    </div>`;
  } else {
    const sel = selected !== null ? card(pile.hand[selected]) : null;
    const verb = sel ? (sel.kind === 'swing' ? `Swing: ${esc(sel.name)}` : `Play ${esc(sel.name)}`) : 'Pick a card';
    controls = `<button class="primary" data-act="play" ${sel ? '' : 'disabled'}>${verb}</button>
      <button data-act="take" title="Don't swing. Strike-zone pitches are strikes; chase pitches are balls.">Take</button>
      <button data-act="hack" title="Swing without spending a card: contact -1, power 0, sit any.">Hack</button>`;
  }
  return `<div class="hand-area">
    <div class="hand-head"><h3>${pitching ? 'Your pitch' : 'Your swing'}${ui2(s) ? ` <span class="muted">(${esc(pl.name)})</span>` : ''}</h3>${deckSummaryHtml(s, viewer, pitching ? 'pitching' : 'batting')}${pitching ? fatigueHtml(deckList(pl.pitching)) : ''}<span class="keys muted">${pitching ? 'Keys: 1-5 pick · E effort · Enter throw' : 'Keys: 1-9 pick · Enter swing · T take'}</span></div>
    <div class="dock-body">
      <div class="hand">${cards || '<p class="muted">No cards in hand.</p>'}</div>
      <div class="controls">${controls}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- shop

/**
 * The market. `released` is the card released on this visit: if that was the last copy, it keeps
 * its slot (greyed out) so the deck list doesn't reflow under the player's cursor.
 */
export function shopHtml(s: GameState, viewer: PlayerId, releaseDeck: DeckName, released: { deck: DeckName; id: string } | null = null): string {
  const p = s.players[viewer];
  const shop = s.shop!;
  const market = s.market.row
    .map((id, i) => {
      const c = card(id);
      const afford = p.stars >= c.cost;
      return cardHtml(id, {
        act: afford ? 'buy' : undefined,
        index: i,
        disabled: !afford,
        selectable: afford,
        footer: `<div class="card-foot">${afford ? `Sign for ${c.cost}★` : `Need ${c.cost}★`} → ${c.kind === 'pitch' ? 'pitching' : 'batting'} deck</div>`,
      });
    })
    .join('');
  const pile = p[releaseDeck];
  const list = deckList(pile);
  const counts = new Map<string, number>();
  for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  if (released && released.deck === releaseDeck && !counts.has(released.id)) counts.set(released.id, 0);
  const canRelease = !shop.released && p.stars >= RELEASE_COST && list.length > MIN_DECK_SIZE;
  const deckCards = [...counts]
    .sort((a, b) => card(a[0]).cost - card(b[0]).cost || a[0].localeCompare(b[0]))
    .map(([id, n]) =>
      cardHtml(id, {
        small: true,
        act: canRelease && n > 0 ? 'release' : undefined,
        dataId: id,
        disabled: !canRelease || n === 0,
        footer: `<div class="card-foot">${n === 0 ? 'Released' : `×${n}`}${canRelease && n > 0 ? ` · Release ${RELEASE_COST}★` : released && released.id === id && released.deck === releaseDeck && n > 0 ? ' · 1 released' : ''}</div>`,
      }),
    )
    .join('');
  return `<div class="shop">
    <div class="shop-head">
      <h2>${shop.pregame ? 'Spring training' : 'Market'}: ${esc(p.name)}</h2>
      <div class="stars-big">${p.stars}★</div>
      <button class="primary" data-act="endShop">Done shopping</button>
    </div>
    <p class="muted">${shop.pregame ? 'Build your roster before the first pitch. ' : ''}Sign free agents with stars. Signed players report immediately: the card goes straight into your hand. ${s.market.supply.length} cards left in the supply.</p>
    <div class="market">${market || '<p>The market is empty.</p>'}</div>
    <h3>Release a card <small class="muted">(once per visit, ${RELEASE_COST}★; thins your deck${shop.released ? ', already used' : ''})</small></h3>
    <div class="tabs">
      <button data-act="relDeck" data-deck="pitching" class="${releaseDeck === 'pitching' ? 'on' : ''}">Pitching deck (${deckList(p.pitching).length})</button>
      <button data-act="relDeck" data-deck="batting" class="${releaseDeck === 'batting' ? 'on' : ''}">Batting deck (${deckList(p.batting).length})</button>
    </div>
    <div class="deck-cards">${deckCards}</div>
  </div>`;
}

// ---------------------------------------------------------------- rules

export function rulesHtml(): string {
  const tri = PITCH_TYPES.map(
    (t) => `<tr><td><span class="mini t-${t}">Sit ${TYPE_LABEL[t]}</span></td><td><span class="mini t-${t}">${TYPE_LABEL[t]}</span> +3</td><td><span class="mini t-${FOOLED_BY[t]}">${TYPE_LABEL[FOOLED_BY[t]]}</span> −2</td></tr>`,
  ).join('');
  const edgePct = Math.round(((7 - EDGE_STRIKE_ROLL) / 6) * 100);
  const checkPct = Math.round(((7 - CHECK_SWING_ROLL) / 6) * 100);
  return `<div class="rules">
  <h2>How to play Strike</h2>
  <p>Two managers alternate half-innings as <b>pitcher</b> and <b>batter</b>. Each of you has a <b>pitching deck</b> and a <b>batting deck</b>. Every pitch, both sides secretly pick a card, then reveal.</p>
  <h3>The pitch</h3>
  <ul>
    <li><b>Pitcher</b> plays a pitch card: a <b>type</b> (Heat, Breaking, Offspeed), a <b>zone</b> (Strike, Edge, Chase), <b>stuff</b> (how nasty it is) and <b>control</b>.</li>
    <li><b>Command:</b> every pitch rolls a d6. At or under its control it hits its spot; over, it misses one zone wider (Strike → Edge → Chase → in the dirt). A pitch in the dirt is a ball no matter what, any swing card goes back to your hand, and with runners on it may get away for a <b>wild pitch</b> (${Math.round((WILD_PITCH_ROLL / 6) * 100)}%), moving everyone up.</li>
    <li><b>Batter</b> plays a swing card, a tactic, <b>Takes</b> (no card), or <b>Hacks</b> (a weak swing with no card).</li>
    <li><b>Taking:</b> a Strike-zone pitch is a strike, a Chase pitch is a ball, an Edge pitch is the umpire's call (strike ${edgePct}% of the time).</li>
    <li><b>Swinging:</b> roll 2d6 + contact − stuff, ${ZONE_CONTACT.edge} on the Edge, ${ZONE_CONTACT.chase} on a Chase. Low = miss, middle = foul, high = ball in play. A second 2d6 + power decides how far it goes.</li>
    <li><b>Check swing:</b> swing at a Chase pitch and ${checkPct}% of the time you hold up. It's a ball and you keep your card. Deceptive pitches don't allow it.</li>
    <li><b>${BALLS_FOR_WALK} balls</b> is a walk, <b>${STRIKES_FOR_OUT} strikes</b> is a strikeout, and two-strike fouls don't count.</li>
  </ul>
  <h3>Fatigue and max effort</h3>
  <ul>
    <li><b>Tired Arm</b> cards are flat, wild (control 2) and hittable. You gain one after every half-inning you pitch.</li>
    <li><b>Stamina:</b> every pitcher starts with ${STAMINA} stamina, the fuel for Max Effort (like the engine in <i>Heat</i>). With none left, you can't go Max Effort.</li>
    <li><b>🔥 Max effort:</b> reach back for +${MAX_EFFORT_STUFF} stuff on any pitch. It spends 1 stamina and <b>shuffles a Tired Arm into your draw pile</b>, so the strain can come back this same inning. Save it for the big spots.</li>
    <li><b>Easy</b> pitches (Changeup, Circle Change, Eephus, Knuckleball) shake a Tired Arm out of your hand when you throw them, and it goes back to your stamina.</li>
    <li>Releasing a Tired Arm in the market also wins back 1 stamina (up to ${STAMINA}).</li>
  </ul>
  <h3>The read triangle</h3>
  <p>Swing cards "sit" on a pitch type. Guess right for +3 contact and +${READ_QUALITY_BONUS} hit quality (you square it up); get fooled for −2. "Any" swings never gain or lose.</p>
  <table class="tri"><thead><tr><th>Your swing</th><th>Crushes</th><th>Fooled by</th></tr></thead><tbody>${tri}</tbody></table>
  <h3>Running the bases</h3>
  <ul>
    <li>Singles score runners from 2nd and 3rd; doubles score everyone but the runner from 1st, who goes to 3rd.</li>
    <li>Fly balls score a runner from 3rd with less than two outs (sac fly). Grounders move runners up but can turn two.</li>
    <li><b>Steal</b> cards send the lead runner: roll a d6 plus the card's speed (+1 on the basic Steal), +1 against Breaking or Offspeed, −1 stealing 3rd; 4 or more is safe. <b>Bunts</b> sacrifice runners over, or try for a hit. <b>Hit &amp; Run</b> sends the runner on contact.</li>
    <li>Extra innings start with a runner on 2nd.</li>
    <li>Pitchers have two free tools: a <b>mound visit</b> (once per half-inning, throw back your hand and draw a fresh one before you pitch) and the <b>intentional walk</b> (with first base open, put the batter on first without a pitch, to set up a force or a double play).</li>
  </ul>
  <h3>Building your deck</h3>
  <ul>
    <li>Earn <b>stars</b>: batters for hits, walks, runs and steals; pitchers for outs and strikeouts; everyone +${ECONOMY.halfInningStars} per half-inning.</li>
    <li>You start with small 8-card decks and ${ECONOMY.startingStars}★ for a <b>spring training</b> market visit before the first pitch.</li>
    <li>After each half-inning, both managers earn ${ECONOMY.halfInningStars}★ and visit the <b>market</b> (trailing team first) to sign new cards or release one.</li>
    <li>Signed players report immediately: a new card goes straight into your hand.</li>
    <li>Hands refill at the start of each at-bat: 5 pitches, 4 batting cards.</li>
  </ul>
  <h3>Scouting</h3>
  <p>Discard piles are public. The scouting panel shows what's left in your opponent's deck, which is exactly what the AI knows about you. It never sees your hand.</p>
  <p><b>AI managers:</b> <b>Rookie</b> plays on gut feel. <b>Veteran</b> plays the percentages. <b>All-Star</b> mixes its choices like a game theorist and adapts to your habits.</p>
</div>`;
}
