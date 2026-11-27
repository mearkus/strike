import { FOOLED_BY, PITCH_TYPES, TYPE_LABEL, ZONE_LABEL, card } from '../engine/cards';
import { MIN_DECK_SIZE, RELEASE_COST, battingTeam, deckList, ordinal, pitchingTeam, score } from '../engine/game';
import { CHECK_SWING_ROLL, EDGE_STRIKE_ROLL, MAX_EFFORT_STUFF, WILD_PITCH_ROLL, ZONE_CONTACT, canSteal } from '../engine/resolve';
import { BALLS_FOR_WALK, STRIKES_FOR_OUT } from '../engine/situation';
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
}

export function cardHtml(id: string, o: CardOpts = {}): string {
  const c = card(id);
  const cls = ['card', c.kind, colorClass(c), o.selected ? 'selected' : '', o.disabled ? 'disabled' : '', o.selectable ? 'selectable' : '', o.small ? 'small' : '']
    .filter(Boolean)
    .join(' ');
  const attrs = o.act && !o.disabled ? `data-act="${o.act}" data-i="${o.index ?? ''}"${o.dataId ? ` data-id="${o.dataId}"` : ''} tabindex="0" role="button"` : '';
  return `<div class="${cls}" ${attrs} title="${esc(c.name)}: ${esc(c.text)}">
    <div class="card-head"><span class="badge">${headLabel(c)}</span>${c.cost > 0 ? `<span class="cost">${c.cost}★</span>` : ''}</div>
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

// ---------------------------------------------------------------- field

export function fieldHtml(s: GameState): string {
  const b = s.sit.bases;
  const base = (x: number, y: number, on: boolean, label: string) =>
    `<rect x="${x - 11}" y="${y - 11}" width="22" height="22" transform="rotate(45 ${x} ${y})" class="base ${on ? 'on' : ''}"><title>${label}${on ? ': runner' : ''}</title></rect>`;
  const dots = (n: number, max: number, cls: string) => Array.from({ length: max }, (_, i) => `<span class="dot ${cls} ${i < n ? 'on' : ''}"></span>`).join('');
  const half = s.half === 'top' ? '▲' : '▼';
  const seen = s.abPitches.length ? s.abPitches.map((t) => `<span class="mini t-${t}">${TYPE_LABEL[t]}</span>`).join('') : '<span class="muted">none yet</span>';
  return `<div class="field">
    <svg viewBox="0 0 200 170" class="diamond" aria-label="Bases">
      <path d="M100 160 L180 80 L100 10 L20 80 Z" class="infield"/>
      ${base(180, 80, b[0], 'First')}
      ${base(100, 14, b[1], 'Second')}
      ${base(20, 80, b[2], 'Third')}
      <path d="M90 150 L110 150 L110 160 L100 168 L90 160 Z" class="plate"/>
    </svg>
    <div class="situation">
      <div class="inning">${half} ${ordinal(s.inning)}</div>
      <div class="count-row"><span class="lbl">B</span>${dots(s.sit.balls, BALLS_FOR_WALK - 1, 'ball')}</div>
      <div class="count-row"><span class="lbl">S</span>${dots(s.sit.strikes, STRIKES_FOR_OUT - 1, 'strike')}</div>
      <div class="count-row"><span class="lbl">O</span>${dots(s.sit.outs, 2, 'out')}</div>
      <div class="seen">This at-bat: ${seen}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- last play

export function lastPlayHtml(s: GameState, animate: boolean): string {
  const lp: PlayRecord | null = s.lastPlay;
  if (!lp) return `<div class="reveal empty"><p>Choose your card. Both sides pick in secret, then the pitch is revealed.</p></div>`;
  const batCard = lp.batCard
    ? cardHtml(lp.batCard, { small: true })
    : `<div class="card small blank"><div class="card-name">${lp.batChoice.action === 'take' ? 'Takes' : 'Hack'}</div><div class="card-text">${lp.batChoice.action === 'take' ? 'No swing.' : 'A swing with no card.'}</div></div>`;
  const big = lp.runs > 0 ? 'runs' : /Home run|triple|double|Base hit|Bunt single|Ball four|Stolen|wild pitch/.test(lp.result) ? 'good' : /Strike three|double play|Caught/.test(lp.result) ? 'bad' : '';
  const result = lp.result;
  return `<div class="reveal${animate ? ' animate' : ''}">
    <div class="duel">
      <div class="side"><div class="who">${esc(s.players[lp.pitcher].name)} pitched${lp.maxEffort ? ' <span class="effort-tag">MAX EFFORT</span>' : ''}</div>${cardHtml(lp.pitchCard, { small: true })}</div>
      <div class="vs">vs</div>
      <div class="side"><div class="who">${esc(s.players[lp.batter].name)} batted</div>${batCard}</div>
    </div>
    <div class="result ${big}">${esc(result)}</div>
  </div>`;
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
    rows += `<p class="muted">Fatigue: ${tired} Tired Arm${tired === 1 ? '' : 's'} in their deck.</p>`;
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

export function handHtml(s: GameState, viewer: PlayerId, selected: number | null, maxEffort = false): string {
  const pitching = pitchingTeam(s) === viewer;
  const pl = s.players[viewer];
  const pile = pitching ? pl.pitching : pl.batting;
  const waiting = pitching ? !s.pending.pitch : !s.pending.bat;
  if (!waiting) return `<div class="hand-area"><p class="waiting">Waiting for ${esc(s.players[(1 - viewer) as PlayerId].name)}…</p></div>`;

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
      <button class="effort ${maxEffort ? 'on' : ''}" data-act="effort" aria-pressed="${maxEffort}" title="+${MAX_EFFORT_STUFF} stuff on this pitch, but a Tired Arm is shuffled into your draw pile. (E)">🔥 Max effort: ${maxEffort ? 'ON' : 'off'}</button>`;
  } else {
    const sel = selected !== null ? card(pile.hand[selected]) : null;
    const verb = sel ? (sel.kind === 'swing' ? `Swing: ${esc(sel.name)}` : `Play ${esc(sel.name)}`) : 'Pick a card to swing';
    controls = `<button class="primary" data-act="play" ${sel ? '' : 'disabled'}>${verb}</button>
      <button data-act="take" title="Don't swing. Strike-zone pitches are strikes; chase pitches are balls.">Take</button>
      <button data-act="hack" title="Swing without spending a card: contact -1, power 0, sit any.">Hack (no card)</button>`;
  }
  return `<div class="hand-area">
    <div class="hand-head"><h3>${esc(pl.name)}: your ${pitching ? 'pitching' : 'batting'} hand</h3>${deckSummaryHtml(s, viewer, pitching ? 'pitching' : 'batting')}${pitching ? fatigueHtml(deckList(pl.pitching)) : ''}</div>
    <div class="hand">${cards || '<p class="muted">No cards in hand.</p>'}</div>
    <div class="controls">${controls}</div>
  </div>`;
}

// ---------------------------------------------------------------- shop

export function shopHtml(s: GameState, viewer: PlayerId, releaseDeck: DeckName): string {
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
  const canRelease = !shop.released && p.stars >= RELEASE_COST && list.length > MIN_DECK_SIZE;
  const deckCards = [...counts]
    .sort((a, b) => card(a[0]).cost - card(b[0]).cost || a[0].localeCompare(b[0]))
    .map(([id, n]) =>
      cardHtml(id, {
        small: true,
        act: canRelease ? 'release' : undefined,
        dataId: id,
        disabled: !canRelease,
        footer: `<div class="card-foot">×${n}${canRelease ? ` · Release ${RELEASE_COST}★` : ''}</div>`,
      }),
    )
    .join('');
  return `<div class="shop">
    <div class="shop-head">
      <h2>Market: ${esc(p.name)}</h2>
      <div class="stars-big">${p.stars}★</div>
      <button class="primary" data-act="endShop">Done shopping</button>
    </div>
    <p class="muted">Sign free agents with stars. New cards go to your discard pile and show up after your next shuffle. ${s.market.supply.length} cards left in the supply.</p>
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
    <li><b>🔥 Max effort:</b> reach back for +${MAX_EFFORT_STUFF} stuff on any pitch, but a Tired Arm is <b>shuffled into your draw pile</b>, so the strain can come back this same inning.</li>
    <li><b>Easy</b> pitches (Changeup, Circle Change, Eephus, Knuckleball) shake a Tired Arm out of your hand for good when you throw them.</li>
    <li>You can also release a Tired Arm in the market.</li>
  </ul>
  <h3>The read triangle</h3>
  <p>Swing cards "sit" on a pitch type. Guess right for +3 contact; get fooled for −2. "Any" swings never gain or lose.</p>
  <table class="tri"><thead><tr><th>Your swing</th><th>Crushes</th><th>Fooled by</th></tr></thead><tbody>${tri}</tbody></table>
  <h3>Running the bases</h3>
  <ul>
    <li>Singles score runners from 2nd and 3rd; doubles score everyone but the runner from 1st, who goes to 3rd.</li>
    <li>Fly balls score a runner from 3rd with less than two outs (sac fly). Grounders move runners up but can turn two.</li>
    <li><b>Steal</b> cards send the lead runner (easier against Breaking/Offspeed, harder stealing 3rd). <b>Bunts</b> sacrifice runners over, or try for a hit. <b>Hit &amp; Run</b> sends the runner on contact.</li>
    <li>Extra innings start with a runner on 2nd.</li>
  </ul>
  <h3>Building your deck</h3>
  <ul>
    <li>Earn <b>stars</b>: batters for hits, walks, runs and steals; pitchers for outs and strikeouts; everyone +1 per half-inning.</li>
    <li>After each half-inning, both managers visit the <b>market</b> (trailing team first) to sign new cards or release one.</li>
    <li>Hands refill at the start of each at-bat: 5 pitches, 4 batting cards.</li>
  </ul>
  <h3>Scouting</h3>
  <p>Discard piles are public. The scouting panel shows what's left in your opponent's deck, which is exactly what the AI knows about you. It never sees your hand.</p>
  <p><b>AI managers:</b> <b>Rookie</b> plays on gut feel. <b>Veteran</b> plays the percentages. <b>All-Star</b> mixes its choices like a game theorist and adapts to your habits.</p>
</div>`;
}
