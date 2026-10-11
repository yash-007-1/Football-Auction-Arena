import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSITIONS, type Position } from '@fa/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = path.resolve(here, '../../data/dataset.txt');

/** Metadata displayed in the UI. */
export const DATASET_INFO = {
  name: 'Football Auction bundled dataset',
  season: '2025/26 (approximate)',
  lastUpdated: '2026-10-09',
  provenance: 'Compiled by hand from the assistant\'s general football knowledge; NOT an official or live data feed.',
  caveat: 'Club assignments, ages and 0-99 ratings/attributes are best-knowledge estimates and may be out of date or inexact. Start prices are derived from rating and age (see DATASET.md).',
};

export interface ParsedClub { name: string; short: string; league: string; color1: string; color2: string }
export interface ParsedPlayer {
  name: string; nationality: string; birthYear: number; position: Position; secondary: Position[];
  overall: number; pace: number; shooting: number; passing: number; defending: number; physical: number; clubName: string;
}

export const DATASET_SEASON_YEAR = 2026;

/** Starting price (€M) from rating and age. Documented in DATASET.md. */
export function startPriceFor(overall: number, age: number): number {
  const base = overall >= 91 ? 100 : overall >= 89 ? 80 : overall >= 87 ? 58 : overall >= 85 ? 40 : overall >= 83 ? 26 : overall >= 81 ? 17 : overall >= 79 ? 10 : overall >= 77 ? 6 : overall >= 75 ? 3 : 1;
  let f = 1;
  if (age <= 21) f = 1.3; else if (age <= 24) f = 1.12; else if (age >= 35) f = 0.4; else if (age >= 33) f = 0.6; else if (age >= 31) f = 0.8;
  return Math.max(1, Math.round(base * f));
}

export function parseDataset(text: string): { clubs: ParsedClub[]; players: ParsedPlayer[] } {
  const clubs: ParsedClub[] = []; const players: ParsedPlayer[] = [];
  let current: ParsedClub | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('|');
    if (line.startsWith('@CLUB')) {
      if (parts.length !== 6) throw new Error(`dataset line ${i + 1}: bad club line`);
      current = { name: parts[1], short: parts[2], league: parts[3], color1: parts[4], color2: parts[5] };
      clubs.push(current);
      return;
    }
    if (!current) throw new Error(`dataset line ${i + 1}: player before any club`);
    if (parts.length !== 11) throw new Error(`dataset line ${i + 1}: expected 11 fields, got ${parts.length}`);
    const [name, nationality, born, pos, sec, ovr, pac, sho, pas, def, phy] = parts;
    if (!POSITIONS.includes(pos as Position)) throw new Error(`dataset line ${i + 1}: bad position ${pos}`);
    const secondary = sec === '-' ? [] : sec.split(',').map((s) => s.trim() as Position);
    for (const s of secondary) if (!POSITIONS.includes(s)) throw new Error(`dataset line ${i + 1}: bad secondary ${s}`);
    const nums = [born, ovr, pac, sho, pas, def, phy].map(Number);
    if (nums.some((n) => !Number.isFinite(n))) throw new Error(`dataset line ${i + 1}: non-numeric value`);
    players.push({
      name, nationality, birthYear: nums[0], position: pos as Position, secondary, overall: nums[1], pace: nums[2], shooting: nums[3],
      passing: nums[4], defending: nums[5], physical: nums[6], clubName: current.name,
    });
  });
  return { clubs, players };
}

export function loadDataset() { return parseDataset(fs.readFileSync(DATASET_PATH, 'utf8')); }
