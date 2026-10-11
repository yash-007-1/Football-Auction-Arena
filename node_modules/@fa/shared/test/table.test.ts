import { describe, expect, it } from 'vitest';
import { computeTable, positionChanges } from '../src';

const teams = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }, { id: 3, name: 'Charlie' }];

describe('league table', () => {
  it('awards 3/1/0 points and computes goal stats', () => {
    const t = computeTable(teams, [
      { homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0 },
      { homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 1 },
    ]);
    const a = t.find((r) => r.teamId === 1)!; const b = t.find((r) => r.teamId === 2)!; const c = t.find((r) => r.teamId === 3)!;
    expect([a.points, a.won, a.goalDiff]).toEqual([3, 1, 2]);
    expect([b.points, b.drawn, b.lost, b.goalDiff]).toEqual([1, 1, 1, -2]);
    expect([c.points, c.played]).toEqual([1, 1]);
    expect(t.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(t[0].teamId).toBe(1);
  });

  it('sorts by points, then goal difference, then goals scored, then head-to-head, then name', () => {
    const t4 = [...teams, { id: 4, name: 'Delta' }];
    // 1: 3pts GD +1 GF 3; 2: 3pts GD +1 GF 2; 3: 3pts GD 0; 4: 0
    const t = computeTable(t4, [
      { homeId: 1, awayId: 4, homeGoals: 3, awayGoals: 2 },
      { homeId: 2, awayId: 4, homeGoals: 2, awayGoals: 1 },
      { homeId: 3, awayId: 4, homeGoals: 1, awayGoals: 1 },
      { homeId: 3, awayId: 1, homeGoals: 0, awayGoals: 0 },
    ]);
    // totals: Alpha 4pts, Bravo 3pts, Charlie 2pts, Delta 0
    expect(t.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const tie = computeTable(teams, []);
    expect(tie.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']); // name is the final tie-breaker
  });

  it('uses goal difference before goals scored', () => {
    const t = computeTable(teams, [
      { homeId: 1, awayId: 3, homeGoals: 5, awayGoals: 0 }, // Alpha +5
      { homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 0 }, // Bravo +1
      { homeId: 3, awayId: 1, homeGoals: 1, awayGoals: 0 }, // Charlie win; Alpha total 3pts GD +4 ; Charlie 3pts GD -4
    ]);
    const order = t.map((r) => r.name);
    expect(order.indexOf('Alpha')).toBeLessThan(order.indexOf('Charlie'));
  });

  it('reports position changes', () => {
    const before = computeTable(teams, []);
    const after = computeTable(teams, [{ homeId: 3, awayId: 1, homeGoals: 2, awayGoals: 0 }]);
    const ch = positionChanges(before, after);
    expect(ch[3]).toBeGreaterThan(0);
    expect(ch[1]).toBeLessThan(0);
  });
});
