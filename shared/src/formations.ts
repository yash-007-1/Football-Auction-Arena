import type { FormationId, Position } from './types';

export interface Slot { pos: Position; x: number; y: number }

/** x: 0 (left) to 100 (right); y: 0 (opponent goal, top) to 100 (own goal, bottom). */
export const FORMATIONS: Record<FormationId, Slot[]> = {
  '4-3-3': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'LB', x: 14, y: 72 }, { pos: 'CB', x: 38, y: 77 }, { pos: 'CB', x: 62, y: 77 }, { pos: 'RB', x: 86, y: 72 },
    { pos: 'CM', x: 28, y: 50 }, { pos: 'CDM', x: 50, y: 58 }, { pos: 'CM', x: 72, y: 50 },
    { pos: 'LW', x: 16, y: 22 }, { pos: 'ST', x: 50, y: 15 }, { pos: 'RW', x: 84, y: 22 },
  ],
  '4-4-2': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'LB', x: 14, y: 72 }, { pos: 'CB', x: 38, y: 77 }, { pos: 'CB', x: 62, y: 77 }, { pos: 'RB', x: 86, y: 72 },
    { pos: 'LM', x: 14, y: 48 }, { pos: 'CM', x: 38, y: 54 }, { pos: 'CM', x: 62, y: 54 }, { pos: 'RM', x: 86, y: 48 },
    { pos: 'ST', x: 38, y: 18 }, { pos: 'ST', x: 62, y: 18 },
  ],
  '4-2-3-1': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'LB', x: 14, y: 72 }, { pos: 'CB', x: 38, y: 77 }, { pos: 'CB', x: 62, y: 77 }, { pos: 'RB', x: 86, y: 72 },
    { pos: 'CDM', x: 36, y: 58 }, { pos: 'CDM', x: 64, y: 58 },
    { pos: 'LW', x: 16, y: 34 }, { pos: 'CAM', x: 50, y: 36 }, { pos: 'RW', x: 84, y: 34 },
    { pos: 'ST', x: 50, y: 14 },
  ],
  '3-5-2': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'CB', x: 24, y: 77 }, { pos: 'CB', x: 50, y: 79 }, { pos: 'CB', x: 76, y: 77 },
    { pos: 'LM', x: 8, y: 50 }, { pos: 'CM', x: 32, y: 50 }, { pos: 'CDM', x: 50, y: 60 }, { pos: 'CM', x: 68, y: 50 }, { pos: 'RM', x: 92, y: 50 },
    { pos: 'ST', x: 38, y: 18 }, { pos: 'ST', x: 62, y: 18 },
  ],
  '3-4-3': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'CB', x: 24, y: 77 }, { pos: 'CB', x: 50, y: 79 }, { pos: 'CB', x: 76, y: 77 },
    { pos: 'LM', x: 12, y: 52 }, { pos: 'CM', x: 38, y: 55 }, { pos: 'CM', x: 62, y: 55 }, { pos: 'RM', x: 88, y: 52 },
    { pos: 'LW', x: 18, y: 22 }, { pos: 'ST', x: 50, y: 15 }, { pos: 'RW', x: 82, y: 22 },
  ],
  '4-1-4-1': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'LB', x: 14, y: 72 }, { pos: 'CB', x: 38, y: 77 }, { pos: 'CB', x: 62, y: 77 }, { pos: 'RB', x: 86, y: 72 },
    { pos: 'CDM', x: 50, y: 62 },
    { pos: 'LM', x: 14, y: 42 }, { pos: 'CM', x: 38, y: 46 }, { pos: 'CM', x: 62, y: 46 }, { pos: 'RM', x: 86, y: 42 },
    { pos: 'ST', x: 50, y: 15 },
  ],
  '5-3-2': [
    { pos: 'GK', x: 50, y: 92 },
    { pos: 'LB', x: 8, y: 64 }, { pos: 'CB', x: 28, y: 77 }, { pos: 'CB', x: 50, y: 79 }, { pos: 'CB', x: 72, y: 77 }, { pos: 'RB', x: 92, y: 64 },
    { pos: 'CM', x: 28, y: 50 }, { pos: 'CM', x: 50, y: 54 }, { pos: 'CM', x: 72, y: 50 },
    { pos: 'ST', x: 38, y: 18 }, { pos: 'ST', x: 62, y: 18 },
  ],
};

export type Line = 'GK' | 'DEF' | 'MID' | 'ATT';
export function lineOf(pos: Position): Line {
  switch (pos) {
    case 'GK': return 'GK';
    case 'CB': case 'LB': case 'RB': return 'DEF';
    case 'CDM': case 'CM': case 'LM': case 'RM': case 'CAM': return 'MID';
    default: return 'ATT';
  }
}
