/** Mulberry32: tiny seedable PRNG. State is a 32-bit integer so it can live in game state. */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

/** A mutable random source backed by a seed. */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  d6(): number {
    return this.int(6) + 1;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
