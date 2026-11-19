/**
 * Deterministic string-seeded PRNG (FNV-1a 32-bit hash + Mulberry32).
 */
export function hashSeed(seed: string): number {
  const normalized = seed.trim().toUpperCase() || 'MAREE-01';
  let h = 2166136261 >>> 0;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface SeededRng {
  next(): number; // [0, 1)
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: string): SeededRng {
  let state = hashSeed(seed) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min: number, maxInclusive: number): number {
      return min + Math.floor(next() * (maxInclusive - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
  };
}

const SEED_WORDS = ['CORAIL', 'ABYSSE', 'MAREE', 'PERLE', 'NAUTILE', 'ATOLL', 'BRISANT', 'RECIF'];

export function makeRandomSeed(): string {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${word}-${num}`;
}
