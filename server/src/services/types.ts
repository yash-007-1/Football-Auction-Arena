import type { Db } from '../db';
import { q } from '../db';
import { DEFAULT_AUCTION_CONFIG, type RoomConfig, type Phase, type SimPlayer, type Position } from '@fa/shared';
export type { RoomConfig, Phase };

export type NotifyKind = 'snapshot' | 'auction';
export interface Ctx {
  db: Db;
  now: () => number;
  notify: (roomId: string, kind: NotifyKind) => void;
  /** (Re)arm the room's auction timer. */
  schedule: (roomId: string) => void;
}

export class GameError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  ...DEFAULT_AUCTION_CONFIG, intermissionSeconds: 4, doubleRound: true, poolSize: 0, order: 'tiered',
};
export const MAX_PARTICIPANTS = 10;
export const RECOVERY_PER_MATCHDAY = 20;
export const MIN_CONDITION = 35;


export interface RoomRow { id: string; code: string; phase: Phase; season: number; config: string; version: number; created_at: number; updated_at: number }
export interface Room extends Omit<RoomRow, 'config'> { cfg: RoomConfig }
export interface ParticipantRow {
  id: number; room_id: string; name: string; token_hash: string; club_id: number | null; is_host: number; ready: number;
  connected: number; budget: number; joined_at: number;
}

export function getRoom(ctx: Ctx, roomId: string): Room {
  const r = q.get<RoomRow>(ctx.db, 'SELECT * FROM rooms WHERE id = ?', roomId);
  if (!r) throw new GameError('room_not_found', 'Room not found.');
  return { ...r, cfg: { ...DEFAULT_ROOM_CONFIG, ...(JSON.parse(r.config) as Partial<RoomConfig>) } };
}
export function getParticipants(ctx: Ctx, roomId: string): ParticipantRow[] {
  return q.all<ParticipantRow>(ctx.db, 'SELECT * FROM participants WHERE room_id = ? ORDER BY joined_at, id', roomId);
}
export function getParticipant(ctx: Ctx, roomId: string, id: number): ParticipantRow | undefined {
  return q.get<ParticipantRow>(ctx.db, 'SELECT * FROM participants WHERE room_id = ? AND id = ?', roomId, id);
}
export function bump(ctx: Ctx, roomId: string) {
  q.run(ctx.db, 'UPDATE rooms SET version = version + 1, updated_at = ? WHERE id = ?', ctx.now(), roomId);
}
export function requireHost(ctx: Ctx, roomId: string, participantId: number) {
  const p = getParticipant(ctx, roomId, participantId);
  if (!p || !p.is_host) throw new GameError('not_host', 'Only the host can do that.');
}
export function requirePhase(room: Room, ...phases: Phase[]) {
  if (!phases.includes(room.phase)) throw new GameError('wrong_phase', `That action is not available during the "${room.phase}" phase.`);
}

interface PlayerDbRow {
  id: number; name: string; nationality: string; position: string; secondary: string; overall: number; pace: number; shooting: number;
  passing: number; defending: number; physical: number; club_name: string; condition: number;
}
export function toSim(r: PlayerDbRow): SimPlayer {
  return {
    id: r.id, name: r.name, nationality: r.nationality, clubName: r.club_name, position: r.position as Position,
    secondary: JSON.parse(r.secondary) as Position[], overall: r.overall, pace: r.pace, shooting: r.shooting, passing: r.passing,
    defending: r.defending, physical: r.physical, condition: r.condition,
  };
}
/** The manager's squad for the room's current season, with live condition. */
export function loadSquad(ctx: Ctx, roomId: string, season: number, participantId: number): SimPlayer[] {
  const rows = q.all<PlayerDbRow>(ctx.db,
    `SELECT p.id, p.name, p.nationality, p.position, p.secondary, p.overall, p.pace, p.shooting, p.passing, p.defending, p.physical, p.club_name, s.condition AS condition
     FROM squad_players s JOIN players p ON p.id = s.player_id
     WHERE s.room_id = ? AND s.season = ? AND s.participant_id = ? ORDER BY p.overall DESC, p.id`, roomId, season, participantId);
  return rows.map(toSim);
}
