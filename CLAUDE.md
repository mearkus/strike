# strike

Two-player baseball deck-building card game in the browser (pitcher vs batter, secret
simultaneous card picks, a market between half-innings) with a three-level AI opponent.

## Stack
TypeScript, Vite (vanilla DOM, no framework), Vitest. Node 22.

## Commands
- Install: `npm install`
- Test: `npm test`
- Lint/format: `npm run lint` (type-check)
- Run: `npm run dev`
- Build: `npm run build`
- Balance sim: `npm run sim` (`--games N --innings N --only <difficulty> --calibrate`)

## Conventions
- All work goes through pull requests: branch off `main`, push the branch, open a PR.
  Never push directly to `main`.
- Keep changes small and focused; one concern per PR.
- Write or update tests alongside behavior changes.
- Don't commit secrets. Use environment variables, documented in README.md.
- Update this file when commands or architecture change.
- The engine (`src/engine`) stays pure: no DOM, no `Math.random`. All randomness goes
  through the seeded `Rng` stored in `GameState.rng`, so games replay from a seed.
- `applyAction` never mutates its input; it clones and returns a new state.
- The AI must only use public information (deck minus discard, history). Never read the
  opponent's `hand` contents in `src/ai`.
- After changing any rule constant or card stats, run `npm run sim` and check the league
  stats (target roughly: 5-6 runs/team/9, AVG .260-.290, K 22-28%, BB 6-9%) and that each
  difficulty still beats the one below it. If run scoring shifts, re-run
  `npm run sim -- --calibrate` and update the tables in `src/ai/value.ts`.

## Architecture notes
- `engine/cards.ts`: card catalog, starter decks, market supply, read triangle.
- `engine/resolve.ts`: one pitch → command roll (`landing`) → `PitchOutcome` (dice drawn in a
  fixed order), plus `outcomeDistribution` (exact enumeration, used by the AI). Tuning
  constants live here.
- `engine/situation.ts`: applies an outcome to bases/outs/count (`advance`).
- `engine/game.ts`: the `GameState` reducer: pitches, at-bats, half-innings, market, game end.
- `ai/value.ts`: run expectancy + count values → run value of any outcome.
- `ai/ai.ts`: payoff matrix per pitch (each pitch with and without max effort, priced by
  `fatigueCost` + `staminaCost`; no max effort at 0 stamina), Veteran = softmax best
  response, All-Star = Nash (fictitious play) blended with exploitation of observed
  tendencies; shop logic.
- Tuning note: the AI's count values feed back into how often it takes pitches, so after a
  rules change, calibrate, re-run the sim, and repeat until the tables stop moving.
- `ui/main.ts`: controller (AI turns, hot-seat privacy, localStorage autosave) and the
  single-screen table layout: score bug (top), stage with field, last pitch and at-bat
  tracker (middle), hand dock (bottom), box score/scouting/log side panel, market overlay.
  `ui/view.ts`: pure HTML-string renderers; `ui/style.css`. On desktop and tablets the page
  must not scroll; keep new UI inside those regions.
