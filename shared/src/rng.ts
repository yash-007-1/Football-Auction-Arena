/** Deterministic seeded PRNG (mulberry32). Same seed => same sequence. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number): boolean { return this.next() < p; }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Approximately normal(0,1) via Box-Muller. */
  normal(): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T | null {
    let total = 0;
    const ws = items.map((i) => { const w = Math.max(0, weight(i)); total += w; return w; });
    if (total <= 0) return items.length ? items[0] : null;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
