import { Rng } from './rng';

export interface ScheduledFixture {
  /** Deterministic key unique within a schedule, e.g. "R03-M2". */
  key: string;
  round: number;
  homeId: number;
  awayId: number;
}
export interface Schedule {
  rounds: number;
  fixtures: ScheduledFixture[];
  /** round -> team id with a bye (odd team counts only). */
  byes: Record<number, number>;
}

/**
 * Round-robin schedule using the circle method.
 * 2 teams: single match unless doubleRound is forced. 3+ teams: double round-robin by default.
 * Odd team counts get a bye each round. The schedule is generated ONCE and persisted by the caller.
 */
export function generateSchedule(teamIds: number[], opts: { seed: number; doubleRound?: boolean }): Schedule {
  const unique = Array.from(new Set(teamIds));
  if (unique.length < 2) throw new Error('A league needs at least 2 teams');
  if (unique.length > 10) throw new Error('A league supports at most 10 teams');
  const double = opts.doubleRound ?? unique.length >= 3;
  const rng = new Rng(opts.seed);
  const order: (number | null)[] = rng.shuffle(unique);
  if (order.length % 2 === 1) order.push(null);
  const n = order.length;
  const firstLeg: { home: number; away: number; bye?: number }[][] = [];
  const byeByRound: (number | undefined)[] = [];

  const arr = [...order];
  for (let r = 0; r < n - 1; r++) {
    const pairs: { home: number; away: number }[] = [];
    let bye: number | undefined;
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) { bye = (a ?? b) as number; continue; }
      // Alternate home/away to balance: first pairing flips each round; others by index parity.
      const flip = i === 0 ? r % 2 === 1 : (i + r) % 2 === 1;
      pairs.push(flip ? { home: b, away: a } : { home: a, away: b });
    }
    firstLeg.push(pairs);
    byeByRound.push(bye);
    // rotate all but the first element
    const last = arr.pop() as number | null;
    arr.splice(1, 0, last);
  }

  const fixtures: ScheduledFixture[] = [];
  const byes: Record<number, number> = {};
  const legs = double ? 2 : 1;
  for (let leg = 0; leg < legs; leg++) {
    firstLeg.forEach((pairs, idx) => {
      const round = leg * firstLeg.length + idx + 1;
      pairs.forEach((p, m) => {
        const home = leg === 0 ? p.home : p.away;
        const away = leg === 0 ? p.away : p.home;
        fixtures.push({ key: `R${String(round).padStart(2, '0')}-M${m + 1}`, round, homeId: home, awayId: away });
      });
      const b = byeByRound[idx];
      if (b !== undefined) byes[round] = b;
    });
  }
  return { rounds: legs * firstLeg.length, fixtures, byes };
}

export function expectedFixtureCount(teams: number, double = teams >= 3): number {
  const perLeg = (teams * (teams - 1)) / 2;
  return double ? perLeg * 2 : perLeg;
}
