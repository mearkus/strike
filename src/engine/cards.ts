import type { BatCardDef, CardDef, PitchCardDef, PitchType, Sit, SwingCardDef, TacticCardDef } from './types';

const pitch = (d: Omit<PitchCardDef, 'kind' | 'effects'> & { effects?: PitchCardDef['effects'] }): PitchCardDef => ({
  kind: 'pitch',
  effects: [],
  ...d,
});
const swing = (d: Omit<SwingCardDef, 'kind' | 'effects'> & { effects?: SwingCardDef['effects'] }): SwingCardDef => ({
  kind: 'swing',
  effects: [],
  ...d,
});
const tactic = (d: Omit<TacticCardDef, 'kind'>): TacticCardDef => ({ kind: 'tactic', ...d });

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  [
    // ---------- Pitching: starter ----------
    pitch({ id: 'fourSeam', name: 'Four-Seamer', type: 'heat', zone: 'strike', stuff: 1, control: 5, cost: 1, text: 'A straight fastball over the plate.' }),
    pitch({ id: 'highHeat', name: 'High Heat', type: 'heat', zone: 'chase', stuff: 1, control: 6, cost: 1, text: 'Up out of the zone. Tempting to chase.' }),
    pitch({ id: 'curveball', name: 'Curveball', type: 'curve', zone: 'strike', stuff: 1, control: 5, cost: 1, text: 'A loopy breaking ball for a strike.' }),
    pitch({ id: 'slider', name: 'Slider', type: 'curve', zone: 'edge', stuff: 1, control: 4, cost: 1, text: 'Nips the corner.' }),
    pitch({ id: 'dirtCurve', name: 'Curve in the Dirt', type: 'curve', zone: 'chase', stuff: 1, control: 5, cost: 1, text: 'Bounces in front of the plate.' }),
    pitch({ id: 'cornerChange', name: 'Changeup Away', type: 'change', zone: 'edge', stuff: 1, control: 4, cost: 1, text: 'Fades to the outside corner.' }),
    pitch({ id: 'lowChange', name: 'Low Changeup', type: 'change', zone: 'chase', stuff: 1, control: 6, cost: 1, text: 'Fades below the knees.' }),
    pitch({ id: 'changeup', name: 'Changeup', type: 'change', zone: 'strike', stuff: 1, control: 5, cost: 1, effects: ['easy'], text: 'Easy: shakes a Tired Arm out of your hand. Looks like a fastball, arrives late.' }),
    pitch({ id: 'twoSeam', name: 'Two-Seamer', type: 'heat', zone: 'strike', stuff: 0, control: 5, cost: 1, effects: ['sinker'], text: 'Sinks: weaker contact and more double plays.' }),

    // ---------- Pitching: market ----------
    pitch({ id: 'gas', name: 'Triple-Digit Gas', type: 'heat', zone: 'strike', stuff: 3, control: 3, cost: 5, text: '100 mph, give or take a few feet.' }),
    pitch({ id: 'paintedHeater', name: 'Painted Heater', type: 'heat', zone: 'edge', stuff: 2, control: 5, cost: 3, text: 'A fastball on the black, every time.' }),
    pitch({ id: 'heavySinker', name: 'Heavy Sinker', type: 'heat', zone: 'strike', stuff: 2, control: 5, cost: 4, effects: ['sinker'], text: 'Worm-killer. Weaker contact and more double plays.' }),
    pitch({ id: 'cutter', name: 'Cutter', type: 'heat', zone: 'strike', stuff: 2, control: 5, cost: 3, effects: ['cutter'], text: 'Saws off bats: batter gets -1 power.' }),
    pitch({ id: 'pitchout', name: 'Pitchout', type: 'heat', zone: 'chase', stuff: 0, control: 6, cost: 2, effects: ['pitchout'], text: 'Way outside. Any steal attempt is thrown out.' }),
    pitch({ id: 'hammer', name: '12-6 Hammer', type: 'curve', zone: 'strike', stuff: 3, control: 3, cost: 5, text: 'Falls off the table for a strike.' }),
    pitch({ id: 'backdoor', name: 'Backdoor Slider', type: 'curve', zone: 'edge', stuff: 2, control: 4, cost: 3, text: 'Starts off the plate, breaks onto the corner.' }),
    pitch({ id: 'sweeper', name: 'Sweeper', type: 'curve', zone: 'chase', stuff: 2, control: 4, cost: 4, effects: ['deceptive'], text: 'Deceptive: no check swings. Sweeps out of the zone.' }),
    pitch({ id: 'circleChange', name: 'Circle Change', type: 'change', zone: 'edge', stuff: 2, control: 4, cost: 3, effects: ['easy'], text: 'Easy: shakes a Tired Arm out of your hand. Fades to the corner.' }),
    pitch({ id: 'splitter', name: 'Splitter', type: 'change', zone: 'chase', stuff: 1, control: 4, cost: 4, effects: ['deceptive', 'weakContact'], text: 'Deceptive: no check swings. Dives late; contact is weak.' }),
    pitch({ id: 'tunnelChange', name: 'Tunnel Change', type: 'change', zone: 'strike', stuff: 1, control: 4, cost: 3, effects: ['tunnel'], text: '+2 stuff if the previous pitch this at-bat was Heat.' }),
    pitch({ id: 'eephus', name: 'Eephus', type: 'change', zone: 'strike', stuff: 0, control: 6, cost: 2, effects: ['eephus', 'easy'], text: 'Easy. A 50 mph rainbow: read bonuses and penalties are doubled.' }),
    pitch({ id: 'knuckleball', name: 'Knuckleball', type: 'knuckle', zone: 'strike', stuff: 2, control: 2, cost: 4, effects: ['easy'], text: 'Easy. No type, so no batter can sit on it, but it goes where it wants.' }),

    // ---------- Pitching: junk ----------
    pitch({ id: 'tiredArm', name: 'Tired Arm', type: 'heat', zone: 'strike', stuff: -1, control: 2, cost: 0, effects: ['meatball'], text: 'Fatigue: flat, wild and hittable. You gain one after every half-inning you pitch and every Max Effort pitch.' }),

    // ---------- Batting: starter ----------
    swing({ id: 'swingAway', name: 'Swing Away', sit: 'any', contact: 0, power: 0, cost: 1, text: 'A plain cut. No guess, no penalty.' }),
    swing({ id: 'sitHeat', name: 'Sit Fastball', sit: 'heat', contact: 0, power: 1, cost: 1, text: 'Gear up for Heat.' }),
    swing({ id: 'sitCurve', name: 'Sit Breaking', sit: 'curve', contact: 0, power: 1, cost: 1, text: 'Wait on the breaking ball.' }),
    swing({ id: 'sitChange', name: 'Sit Offspeed', sit: 'change', contact: 0, power: 1, cost: 1, text: 'Stay back on the changeup.' }),
    tactic({ id: 'bunt', name: 'Bunt', tactic: 'bunt', bonus: 0, cost: 1, text: 'With runners on and <2 outs: sacrifice them over. Otherwise bunt for a hit.' }),
    tactic({ id: 'steal', name: 'Steal', tactic: 'steal', bonus: 0, cost: 1, text: 'Take the pitch; the lead runner tries to steal. Easier on non-Heat.' }),

    // ---------- Batting: market ----------
    swing({ id: 'moonshot', name: 'Moonshot', sit: 'heat', contact: 0, power: 3, cost: 5, text: 'Sell out for the fastball.' }),
    swing({ id: 'launchAngle', name: 'Launch Angle', sit: 'any', contact: -1, power: 3, cost: 5, text: 'Big uppercut. All-or-nothing.' }),
    swing({ id: 'barrel', name: 'Barrel It Up', sit: 'any', contact: 2, power: 1, cost: 4, text: 'Solid, all-purpose contact.' }),
    swing({ id: 'waitHook', name: 'Wait on the Hook', sit: 'curve', contact: 2, power: 2, cost: 4, text: 'You know the curve is coming.' }),
    swing({ id: 'stayBack', name: 'Stay Back', sit: 'change', contact: 2, power: 2, cost: 4, text: 'Let the changeup come to you.' }),
    swing({ id: 'slap', name: 'Slap Hitter', sit: 'any', contact: 3, power: -1, cost: 2, text: 'Put it in play, somewhere.' }),
    swing({ id: 'protect', name: 'Protect the Plate', sit: 'any', contact: 1, power: 0, cost: 3, effects: ['protect'], text: '+3 contact with two strikes.' }),
    swing({ id: 'spoil', name: 'Spoil It', sit: 'any', contact: 1, power: -1, cost: 2, effects: ['spoil'], text: 'With two strikes, near-misses become fouls.' }),
    swing({ id: 'ambush', name: 'First-Pitch Ambush', sit: 'heat', contact: 1, power: 1, cost: 3, effects: ['ambush'], text: '+2 power on an 0-0 count.' }),
    swing({ id: 'clutch', name: 'Clutch Knock', sit: 'any', contact: 1, power: 1, cost: 4, effects: ['clutch'], text: '+2 contact and +1 power with a runner in scoring position.' }),
    swing({ id: 'timedUp', name: 'Timed Up', sit: 'any', contact: 0, power: 1, cost: 3, effects: ['timing'], text: '+3 contact if you already saw this pitch type this at-bat.' }),
    swing({ id: 'hitAndRun', name: 'Hit & Run', sit: 'any', contact: 2, power: 0, cost: 3, effects: ['hitAndRun'], text: 'Runners go: extra base on a single, no double plays. On a miss the lead runner steals.' }),
    tactic({ id: 'jetSteal', name: 'Jet Steal', tactic: 'steal', bonus: 2, cost: 3, text: 'Take the pitch; the lead runner steals with +2 speed.' }),
    tactic({ id: 'dragBunt', name: 'Drag Bunt', tactic: 'bunt', bonus: 2, cost: 3, text: 'A bunt with +2. Great for bunt hits.' }),
    tactic({ id: 'goodEye', name: 'Good Eye', tactic: 'goodEye', bonus: 0, cost: 2, text: 'Take the pitch. Ball: draw 2 cards. Strike: draw 1.' }),
  ].map((c) => [c.id, c]),
);

export const STARTER_PITCHING = [
  'fourSeam', 'fourSeam', 'twoSeam', 'highHeat',
  'curveball', 'slider', 'dirtCurve',
  'changeup', 'cornerChange', 'lowChange',
];

export const STARTER_BATTING = [
  'swingAway', 'swingAway', 'swingAway', 'swingAway',
  'sitHeat', 'sitHeat', 'sitCurve', 'sitChange', 'bunt', 'steal',
];

/** Copies of each card in the shared market supply. */
export const MARKET_SUPPLY: Record<string, number> = {
  gas: 2, paintedHeater: 3, heavySinker: 2, cutter: 3, pitchout: 2, hammer: 2, backdoor: 3,
  sweeper: 2, circleChange: 3, splitter: 2, tunnelChange: 2, eephus: 2, knuckleball: 2,
  moonshot: 2, launchAngle: 2, barrel: 3, waitHook: 2, stayBack: 2, slap: 3, protect: 3,
  spoil: 3, ambush: 2, clutch: 2, timedUp: 2, hitAndRun: 2, jetSteal: 2, dragBunt: 2, goodEye: 3,
};

export const MARKET_ROW_SIZE = 6;
export const PITCH_HAND_SIZE = 5;
export const BAT_HAND_SIZE = 4;

/** Used when the pitcher has no cards left in hand. */
export const MEATBALL = 'tiredArm';
/** The free swing a batter can always take without a card. */
export const HACK: SwingCardDef = swing({ id: 'hack', name: 'Hack', sit: 'any', contact: -1, power: 0, cost: 0, text: 'No card: a weak swing.' });

export function card(id: string): CardDef {
  const c = CARDS[id] ?? (id === HACK.id ? HACK : undefined);
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

export function pitchCard(id: string): PitchCardDef {
  const c = card(id);
  if (c.kind !== 'pitch') throw new Error(`${id} is not a pitch`);
  return c;
}

export function batCard(id: string): BatCardDef {
  const c = card(id);
  if (c.kind === 'pitch') throw new Error(`${id} is not a batting card`);
  return c;
}

export const PITCH_TYPES: PitchType[] = ['heat', 'curve', 'change'];

/**
 * The read triangle. Guess the pitch: +3 contact. Get fooled: -2.
 * Sit Heat is fooled by Change, Sit Curve by Heat, Sit Change by Curve.
 */
export const FOOLED_BY: Record<PitchType, PitchType> = { heat: 'change', curve: 'heat', change: 'curve' };

export function readMod(sit: Sit, type: string): number {
  if (sit === 'any' || type === 'knuckle') return 0;
  if (sit === type) return 3;
  if (FOOLED_BY[sit] === type) return -2;
  return 0;
}

export const TYPE_LABEL: Record<string, string> = { heat: 'Heat', curve: 'Breaking', change: 'Offspeed', knuckle: 'Knuckle', any: 'Any' };
export const ZONE_LABEL: Record<string, string> = { strike: 'Strike', edge: 'Edge', chase: 'Chase' };
