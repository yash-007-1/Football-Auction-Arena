import { describe, expect, it } from 'vitest';
import { expectedFixtureCount, generateSchedule } from '../src';

describe('fixture generation', () => {
  for (let n = 2; n <= 10; n++) {
    it(`${n} teams: correct counts, unique ids, every pair meets, no double bookings`, () => {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const s = generateSchedule(ids, { seed: 42 });
      const double = n >= 3;
      expect(s.fixtures.length).toBe(expectedFixtureCount(n, double));
      expect(new Set(s.fixtures.map((f) => f.key)).size).toBe(s.fixtures.length);
      const legRounds = n % 2 === 0 ? n - 1 : n;
      expect(s.rounds).toBe(double ? legRounds * 2 : legRounds);
      // every ordered pair appears once for double RR; every unordered pair once for single RR
      const pairs = new Map<string, number>();
      for (const f of s.fixtures) {
        expect(f.homeId).not.toBe(f.awayId);
        const k = `${f.homeId}>${f.awayId}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
      for (const a of ids) for (const b of ids) {
        if (a === b) continue;
        const ab = pairs.get(`${a}>${b}`) ?? 0; const ba = pairs.get(`${b}>${a}`) ?? 0;
        if (double) { expect(ab).toBe(1); expect(ba).toBe(1); } else { expect(ab + ba).toBe(1); }
      }
      // a team plays at most once per round; odd leagues give exactly one bye per round
      for (let r = 1; r <= s.rounds; r++) {
        const inRound = s.fixtures.filter((f) => f.round === r);
        const teams = inRound.flatMap((f) => [f.homeId, f.awayId]);
        expect(new Set(teams).size).toBe(teams.length);
        if (n % 2 === 1) {
          expect(s.byes[r]).toBeDefined();
          expect(teams).not.toContain(s.byes[r]);
          expect(teams.length).toBe(n - 1);
        } else {
          expect(teams.length).toBe(n);
        }
      }
    });
  }

  it('is deterministic for a seed and balanced between home and away', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(generateSchedule(ids, { seed: 7 })).toEqual(generateSchedule(ids, { seed: 7 }));
    const s = generateSchedule(ids, { seed: 7 });
    for (const id of ids) {
      const home = s.fixtures.filter((f) => f.homeId === id).length;
      expect(home).toBe(7);
    }
  });

  it('rejects invalid league sizes', () => {
    expect(() => generateSchedule([1], { seed: 1 })).toThrow();
    expect(() => generateSchedule(Array.from({ length: 11 }, (_, i) => i), { seed: 1 })).toThrow();
  });
});
