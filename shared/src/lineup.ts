import { FORMATIONS } from './formations';
import { UNSUITABLE_PENALTY, effectiveRating, positionPenalty } from './positions';
import type { FormationId, Lineup, SimPlayer } from './types';

export const MAX_BENCH = 7;

export interface LineupCheck { errors: string[]; warnings: string[]; valid: boolean }

/** `squad` must contain only the players owned by the manager; anything else is rejected. */
export function validateLineup(lineup: Lineup, squad: SimPlayer[]): LineupCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const slots = FORMATIONS[lineup.formation];
  if (!slots) return { errors: ['Unknown formation.'], warnings, valid: false };
  const byId = new Map(squad.map((p) => [p.id, p]));
  if (lineup.slots.length !== 11) errors.push('A starting XI needs exactly 11 slots.');
  const seen = new Set<number>();
  let natGk = 0;
  let filled = 0;
  lineup.slots.forEach((id, i) => {
    if (id === null || id === undefined) { return; }
    filled++;
    const p = byId.get(id);
    if (!p) { errors.push(`Player #${id} is not in your squad.`); return; }
    if (seen.has(id)) errors.push(`${p.name} is placed in more than one position.`);
    seen.add(id);
    if (p.position === 'GK') natGk++;
    const slot = slots[i];
    if (!slot) return;
    const pen = positionPenalty(p, slot.pos);
    if (pen >= UNSUITABLE_PENALTY) warnings.push(`${p.name} (${p.position}) is out of position at ${slot.pos} (−${pen} rating).`);
    if (p.condition < 60) warnings.push(`${p.name} is tired (condition ${Math.round(p.condition)}).`);
  });
  if (filled < 11) errors.push(`Starting XI incomplete: ${filled}/11 selected.`);
  if (natGk > 1) errors.push('Only one goalkeeper may start.');
  for (const id of lineup.bench) {
    const p = byId.get(id);
    if (!p) errors.push(`Bench player #${id} is not in your squad.`);
    else if (seen.has(id)) errors.push(`${p.name} is both starting and on the bench.`);
    seen.add(id);
  }
  if (new Set(lineup.bench).size !== lineup.bench.length) errors.push('Duplicate players on the bench.');
  if (lineup.bench.length > MAX_BENCH) errors.push(`Bench can hold at most ${MAX_BENCH} players.`);
  const gkSlotPlayer = lineup.slots[0] !== null ? byId.get(lineup.slots[0] as number) : undefined;
  if (filled === 11 && gkSlotPlayer && gkSlotPlayer.position !== 'GK') warnings.push('No goalkeeper in goal — an outfield player will play there.');
  return { errors, warnings, valid: errors.length === 0 };
}

/** Best XI for a formation: greedy assignment over effective ratings, keepers placed first. */
export function autoPickLineup(squad: SimPlayer[], formation: FormationId): Lineup {
  const slots = FORMATIONS[formation];
  const used = new Set<number>();
  const result: (number | null)[] = Array(11).fill(null);
  const order = slots.map((_, i) => i).sort((a, b) => (slots[a].pos === 'GK' ? -1 : 0) - (slots[b].pos === 'GK' ? -1 : 0));
  // Fill the scarcest/most specific slots first by choosing, for each slot, the best remaining player.
  const pairs: { slot: number; p: SimPlayer; r: number }[] = [];
  for (const i of order) for (const p of squad) pairs.push({ slot: i, p, r: effectiveRating(p, slots[i].pos) });
  pairs.sort((a, b) => b.r - a.r);
  const slotDone = new Set<number>();
  // Goalkeeper slot is resolved before outfield so a keeper is never stranded.
  const gkPair = pairs.find((x) => x.slot === 0 && x.p.position === 'GK');
  if (gkPair) { result[0] = gkPair.p.id; used.add(gkPair.p.id); slotDone.add(0); }
  for (const pr of pairs) {
    if (slotDone.has(pr.slot) || used.has(pr.p.id)) continue;
    if (pr.p.position === 'GK' && pr.slot !== 0) continue; // never field a second keeper outfield
    result[pr.slot] = pr.p.id; used.add(pr.p.id); slotDone.add(pr.slot);
  }
  // Fallback for tiny squads: fill any gaps with whoever is left.
  for (let i = 0; i < 11; i++) {
    if (result[i] === null) {
      const left = squad.find((p) => !used.has(p.id));
      if (left) { result[i] = left.id; used.add(left.id); }
    }
  }
  const rest = squad.filter((p) => !used.has(p.id)).sort((a, b) => b.overall - a.overall);
  const bench: number[] = [];
  const gk = rest.find((p) => p.position === 'GK');
  if (gk) bench.push(gk.id);
  for (const p of rest) { if (bench.length >= MAX_BENCH) break; if (!bench.includes(p.id)) bench.push(p.id); }
  return { formation, slots: result, bench };
}

/** Resolve a stored lineup to SimPlayers ordered by formation slot. Returns null if invalid. */
export function resolveLineup(lineup: Lineup, squad: SimPlayer[]): { starters: SimPlayer[]; bench: SimPlayer[] } | null {
  if (!validateLineup(lineup, squad).valid) return null;
  const byId = new Map(squad.map((p) => [p.id, p]));
  return {
    starters: lineup.slots.map((id) => byId.get(id as number) as SimPlayer),
    bench: lineup.bench.map((id) => byId.get(id) as SimPlayer),
  };
}
