import type { Position, SimPlayer } from './types';

const COORD: Record<Exclude<Position, 'GK'>, [number, number]> = {
  CB: [0, 0], LB: [-1, 0.4], RB: [1, 0.4], CDM: [0, 1], CM: [0, 1.8], LM: [-1, 1.8], RM: [1, 1.8],
  CAM: [0, 2.6], LW: [-1, 3], RW: [1, 3], ST: [0, 3.6],
};

/** Rating points lost when a player whose natural position is `from` plays at `to`. */
export function positionDistancePenalty(from: Position, to: Position): number {
  if (from === to) return 0;
  if (from === 'GK' || to === 'GK') return 40;
  const [ax, ay] = COORD[from];
  const [bx, by] = COORD[to];
  const d = Math.hypot((ax - bx) * 1.2, ay - by);
  return Math.min(25, Math.round(d * 5));
}

/** Penalty for playing `p` at slot position `slot`. Natural or secondary positions have no penalty. */
export function positionPenalty(p: Pick<SimPlayer, 'position' | 'secondary'>, slot: Position): number {
  if (p.position === slot || p.secondary.includes(slot)) return 0;
  let best = positionDistancePenalty(p.position, slot);
  for (const s of p.secondary) best = Math.min(best, positionDistancePenalty(s, slot) + 2);
  return best;
}

/** A penalty at or above this is flagged "unsuitable" in the UI. */
export const UNSUITABLE_PENALTY = 10;

/** Effective rating of a player at a slot, after position penalty and fatigue. */
export function effectiveRating(p: SimPlayer, slot: Position): number {
  const fatigue = (100 - p.condition) * 0.12;
  return Math.max(1, p.overall - positionPenalty(p, slot) - fatigue);
}
