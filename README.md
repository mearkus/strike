# Strike ⚾

A two-player baseball deck-building card game that runs in the browser. You take turns
as **pitcher** and **batter**: both sides pick a card in secret every pitch, then reveal.
Between half-innings you spend the stars you've earned to sign better cards. Play a
friend on the same device, or the computer at three difficulty levels.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

## Testing

```bash
npm test           # engine, rules and AI unit tests (vitest)
npm run lint       # type-check
npm run build      # type-check + production build into dist/
npm run sim        # AI-vs-AI round robin with league stats (balance tuning)
```

`npm run sim -- --games 200 --innings 9 --only veteran` narrows the run;
`npm run sim -- --calibrate` prints a fresh run-expectancy table for the AI.

## How it plays

| | |
|---|---|
| **Pitch cards** | Type (Heat / Breaking / Offspeed), zone (Strike / Edge / Chase), stuff and control. |
| **Command** | Every pitch rolls a d6 against its control. A miss drifts one zone wider: Strike → Edge → Chase → in the dirt (always a ball, can be a wild pitch). |
| **Swing cards** | Sit on a pitch type, plus contact and power. Tactics: Steal, Bunt, Good Eye. |
| **Read triangle** | Sit on the right type: +3 contact and +1 hit quality. Get fooled: −2. Sit Heat is fooled by Offspeed, Sit Breaking by Heat, Sit Offspeed by Breaking. |
| **Take or swing** | Taken strikes are strikes, taken chases are balls, and the edge is called a strike one time in three. Chasing hurts contact but you may check your swing. |
| **Count** | 4 balls walk, 3 strikes out, two-strike fouls don't count. |
| **Bases** | Singles score runners from 2nd; doubles score all but the runner from 1st; sac flies, double plays, steals, bunts and hit-and-runs are all in. Extra innings start with a runner on 2nd. |
| **Deck-building** | You start with small 8-card decks and 3★ for a spring-training signing before the first pitch. Earn stars for hits, runs, walks, steals, outs and strikeouts, plus 3★ per half-inning. After every half-inning, both sides sign cards from a shared market or release one. Signed players report immediately: the card goes straight into your hand. |
| **Fatigue** | *Tired Arm* cards are flat, wild and hittable. You gain one per half-inning pitched. **Max effort** gives any pitch +2 stuff, but it spends 1 of your 4 **stamina** and shuffles a Tired Arm into your draw pile. Like the engine in the board game *Heat*, stamina is finite, so save it for big spots. **Easy** pitches (Changeup, Circle Change, Eephus, Knuckleball) shake a Tired Arm out of your hand and back into stamina; releasing a Tired Arm in the market does too. |

The in-game **How to play** button has the full rules.

### Specific counters

- **Pitchout** throws out any stealer; steals are easier on Breaking and Offspeed, and the basic Steal card runs with +1 speed.
- Pitchers have two free tools: a **mound visit** (once per half-inning, throw back the hand and draw a fresh one) and the **intentional walk** (put the batter on to set up a force or a double play).
- **Sinkers** cause double plays; **Hit & Run** prevents them.
- **Deceptive** chase pitches (Sweeper, Splitter) allow no check swing; **Good Eye** pays off against chase-heavy pitchers.
- **Tunnel Change** gets nastier after Heat; **Timed Up** punishes a pitcher who repeats a type.
- **Knuckleball** can't be sat on but has wild control; **Eephus** doubles read bonuses and penalties.
- High-stuff pitches (Triple-Digit Gas, 12-6 Hammer) have shaky control; command pitches (Painted Heater, Cutter, Heavy Sinker) rarely miss.
- **Protect the Plate** and **Spoil It** survive two-strike counts.

## The AI

All three levels see only public information: the cards left in your deck (discard piles
are public) and your past choices. None of them see your hand.

- **Rookie** picks cards at random and shops on impulse.
- **Veteran** scores every option by expected runs against your likely cards, using a
  run-expectancy and count-value table calibrated by simulation, and picks with a bit of noise.
- **All-Star** treats each pitch as a zero-sum matrix game, plays the mixed-strategy
  equilibrium (fictitious play), and shifts toward exploiting your observed habits once it
  has scouted ~12 of your pitches. It shops by measuring each card's value against your deck.

Pitchers also weigh **max effort** against two costs: fatigue (the chance the Tired Arm comes
back this inning, plus how often it will turn up in the innings they still have to pitch) and
stamina (a point spent now can't be spent in a bigger spot later). The All-Star spends about
90% of its stamina with runners in scoring position or two strikes.

## Project layout

```
src/engine/   rules: cards, pitch resolution, base running, game state machine (pure, seeded RNG)
src/ai/       run-value model, matrix-game solver, decisions and shopping per difficulty
src/ui/       DOM rendering, controller, styles
scripts/sim.ts  headless AI-vs-AI simulator for balance and calibration
test/         vitest suites
```
