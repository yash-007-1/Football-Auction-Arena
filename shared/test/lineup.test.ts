import { describe, expect, it } from 'vitest';
import { autoPickLineup, positionPenalty, resolveLineup, validateLineup, FORMATIONS, FORMATION_IDS } from '../src';
import { mkPlayer, mkSquad } from './helpers';

describe('lineup validation', () => {
  const squad = mkSquad(78);
  it('auto-picks a valid XI for every formation', () => {
    for (const f of FORMATION_IDS) {
      const l = autoPickLineup(squad, f);
      const c = validateLineup(l, squad);
      expect(c.errors, f).toEqual([]);
      expect(l.slots.filter((x) => x !== null).length).toBe(11);
      expect(new Set(l.slots).size).toBe(11);
      expect(FORMATIONS[f].length).toBe(11);
      expect(squad.find((p) => p.id === l.slots[0])!.position).toBe('GK');
    }
  });
  it('rejects wrong size, duplicates, foreign players, two keepers', () => {
    const l = autoPickLineup(squad, '4-4-2');
    expect(validateLineup({ ...l, slots: l.slots.slice(0, 10) }, squad).valid).toBe(false);
    const dup = [...l.slots]; dup[5] = dup[4];
    expect(validateLineup({ ...l, slots: dup }, squad).errors.join()).toMatch(/more than one position/);
    const foreign = mkPlayer('ST', 90);
    const withForeign = [...l.slots]; withForeign[10] = foreign.id;
    expect(validateLineup({ ...l, slots: withForeign }, squad).errors.join()).toMatch(/not in your squad/);
    const gk2 = squad.filter((p) => p.position === 'GK')[1];
    const twoGk = [...l.slots]; twoGk[9] = gk2.id;
    expect(validateLineup({ ...l, slots: twoGk }, squad).errors.join()).toMatch(/one goalkeeper/);
    expect(resolveLineup({ ...l, slots: twoGk }, squad)).toBeNull();
    const benchDup = { ...l, bench: [l.slots[3] as number] };
    expect(validateLineup(benchDup, squad).errors.join()).toMatch(/both starting and on the bench/);
  });
  it('warns about out-of-position players and applies a penalty', () => {
    const l = autoPickLineup(squad, '4-4-2');
    const st = squad.find((p) => p.position === 'ST')!;
    const arr = [...l.slots]; const old = arr[1]; arr[1] = st.id; // striker at left back
    if (old !== null && arr.includes(old)) { /* keep unique */ }
    const swapIdx = arr.indexOf(st.id, 2); if (swapIdx > 1) arr[swapIdx] = old;
    const c = validateLineup({ ...l, slots: arr }, squad);
    expect(c.warnings.join()).toMatch(/out of position/);
    expect(positionPenalty(st, 'LB')).toBeGreaterThan(10);
    expect(positionPenalty(st, 'ST')).toBe(0);
    expect(positionPenalty({ position: 'CM', secondary: ['CDM'] }, 'CDM')).toBe(0);
  });
});
