/**
 * Headless AI-vs-AI simulation for balance tuning.
 *
 *   npm run sim                      # difficulty round-robin + league stats
 *   npm run sim -- --games 400       # more games per pairing
 *   npm run sim -- --calibrate       # print an empirical run-expectancy table
 */
import { chooseAction } from '../src/ai/ai';
import { basesMask } from '../src/ai/value';
import { advance } from '../src/engine/situation';
import { applyAction, newGame, score, waitingOn } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import type { Difficulty, GameState } from '../src/engine/types';

const args = process.argv.slice(2);
const flag = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
export const GAMES = flag('games', 120);
const INNINGS = flag('innings', 9);

export function playGame(a: Difficulty, b: Difficulty, seed: number, innings = INNINGS): GameState {
  let s = newGame({ names: [a, b], ai: [a, b], innings, seed });
  const rng = new Rng(seed ^ 0x5eed);
  let guard = 0;
  while (s.phase !== 'gameOver') {
    for (const p of waitingOn(s)) {
      if (s.phase === 'gameOver') break;
      s = applyAction(s, chooseAction(s, p, s.players[p].ai!, rng));
    }
    if (++guard > 20000) throw new Error('Game did not finish');
  }
  return s;
}

function leagueStats(games: GameState[]) {
  const kinds: Record<string, number> = {};
  const bip: Record<string, number> = {};
  const res: Record<string, number> = {};
  let pitches = 0, runs = 0, halfInnings = 0, steals = 0, cs = 0;
  for (const g of games) {
    runs += score(g, 0) + score(g, 1);
    halfInnings += g.players[0].runsByInning.length + g.players[1].runsByInning.length;
    for (const h of g.history) {
      pitches++;
      const o = h.outcome;
      kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
      if (o.kind === 'inPlay') bip[o.hit] = (bip[o.hit] ?? 0) + 1;
      if ('steal' in o && o.steal) o.steal === 'safe' ? steals++ : cs++;
      const r = advance(h.situationBefore, o).result;
      if (r) res[r] = (res[r] ?? 0) + 1;
    }
  }
  const c = (...k: string[]) => k.reduce((a, x) => a + (res[x] ?? 0), 0);
  const pa = Object.values(res).reduce((a, b) => a + b, 0);
  const hits = c('single', 'double', 'triple', 'homeRun', 'buntHit');
  const ab = pa - c('walk', 'sacrifice', 'sacFly');
  const pct = (n: number) => `${((n / pa) * 100).toFixed(1)}%`;
  const n = games.length;
  console.log(`  runs/team/9:   ${((runs / n / 2) * (9 / INNINGS)).toFixed(2)}`);
  console.log(`  AVG:           ${(hits / ab).toFixed(3)}   K%: ${pct(c('strikeout'))}   BB%: ${pct(c('walk'))}   HR/PA: ${pct(c('homeRun'))}   XBH/PA: ${pct(c('double', 'triple', 'homeRun'))}`);
  console.log(`  pitches/PA:    ${(pitches / pa).toFixed(2)}   pitches/game: ${(pitches / n).toFixed(0)}   half-innings/game: ${(halfInnings / n).toFixed(1)}`);
  console.log(`  pitch mix:     ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / pitches) * 100).toFixed(0)}%`).join('  ')}`);
  const nb = Object.values(bip).reduce((a, b) => a + b, 0);
  console.log(`  in play:       ${['groundout', 'doublePlay', 'popout', 'flyout', 'single', 'double', 'triple', 'homeRun'].map((k) => `${k} ${(((bip[k] ?? 0) / nb) * 100).toFixed(0)}%`).join('  ')}`);
  console.log(`  steals:        ${steals} safe, ${cs} caught`);
}

function calibrate(games: GameState[]) {
  // Runs scored from each pitch to the end of its half-inning, grouped by base-out state and by count.
  const re = Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => ({ sum: 0, n: 0 })));
  const cv = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ sum: 0, n: 0 })));
  const residuals: Array<{ h: GameState['history'][number]; future: number }> = [];
  for (const g of games) {
    const plays = g.history;
    for (let i = 0; i < plays.length; i++) {
      const h = plays[i];
      let r = 0;
      for (let j = i; j < plays.length && plays[j].batter === h.batter && (j === i || plays[j].situationBefore.outs >= plays[j - 1].situationBefore.outs); j++) r += plays[j].runs;
      residuals.push({ h, future: r });
      const sb = h.situationBefore;
      if (sb.balls === 0 && sb.strikes === 0) {
        re[sb.outs][basesMask(sb)].sum += r;
        re[sb.outs][basesMask(sb)].n++;
      }
    }
  }
  const reVal = re.map((row) => row.map((c) => (c.n ? c.sum / c.n : 0)));
  for (const { h, future } of residuals) {
    const sb = h.situationBefore;
    const c = cv[Math.min(sb.balls, 2)][Math.min(sb.strikes, 2)];
    c.sum += future - reVal[sb.outs][basesMask(sb)];
    c.n++;
  }
  console.log('RUN_EXPECTANCY = [');
  for (const row of re) console.log(`  [${row.map((c) => (c.n ? c.sum / c.n : 0).toFixed(2)).join(', ')}],  // n=${row.map((c) => c.n).join('/')}`);
  console.log(']');
  console.log('COUNT_VALUE = [');
  for (const row of cv) console.log(`  [${row.map((c) => (c.n ? c.sum / c.n : 0).toFixed(3)).join(', ')}],`);
  console.log(']');
}

const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] as Difficulty) : null;
const levels: Difficulty[] = only ? [only] : ['rookie', 'veteran', 'allstar'];
let seed = flag('seed', 1);
const all: GameState[] = [];
if (args.includes('--calibrate')) {
  for (let i = 0; i < GAMES; i++) all.push(playGame('veteran', 'veteran', seed++));
  leagueStats(all);
  calibrate(all);
} else {
  console.log(`${GAMES} games per pairing, ${INNINGS} innings, sides alternate.`);
  for (let i = 0; i < levels.length; i++) {
    for (let j = i; j < levels.length; j++) {
      let wins = 0, losses = 0, ties = 0;
      const games: GameState[] = [];
      for (let g = 0; g < GAMES; g++) {
        const flip = g % 2 === 1;
        const s = playGame(flip ? levels[j] : levels[i], flip ? levels[i] : levels[j], seed++);
        games.push(s);
        const winnerIsI = s.winner === 'tie' ? null : (s.winner === 0) !== flip;
        if (winnerIsI === null) ties++;
        else if (winnerIsI) wins++;
        else losses++;
      }
      all.push(...games);
      console.log(`${levels[i].padEnd(8)} vs ${levels[j].padEnd(8)}: ${wins}-${losses}-${ties}  (${((wins / (wins + losses)) * 100).toFixed(0)}% for ${levels[i]})`);
      if (i === j) leagueStats(games);
    }
  }
}
