import crypto from 'node:crypto';
import { z } from 'zod';
import { MAX_SQUAD_LIMIT } from '@fa/shared';
import { q, tx } from '../db';
import {
  type Ctx, GameError, MAX_PARTICIPANTS, DEFAULT_ROOM_CONFIG, type ParticipantRow, type RoomConfig, bump, getParticipant, getParticipants, getRoom,
  requireHost, requirePhase,
} from './types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(20, 'Name can be at most 20 characters')
  .regex(/^[\p{L}\p{N} _.'-]+$/u, 'Name contains unsupported characters');

export function createRoom(ctx: Ctx, rawName: string, maxRooms: number): { roomId: string; code: string; participantId: number; token: string } {
  const name = nameSchema.parse(rawName);
  return tx(ctx.db, () => {
    const count = (q.get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM rooms')?.n) ?? 0;
    if (count >= maxRooms) throw new GameError('server_busy', 'The server has reached its room limit. Try again later.');
    let code = newCode();
    for (let i = 0; i < 20 && q.get(ctx.db, 'SELECT 1 FROM rooms WHERE code = ?', code); i++) code = newCode();
    if (q.get(ctx.db, 'SELECT 1 FROM rooms WHERE code = ?', code)) throw new GameError('server_busy', 'Could not allocate a room code.');
    const roomId = crypto.randomUUID();
    const now = ctx.now();
    q.run(ctx.db, 'INSERT INTO rooms (id, code, phase, season, config, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, 1, ?, ?)',
      roomId, code, 'lobby', JSON.stringify(DEFAULT_ROOM_CONFIG), now, now);
    q.run(ctx.db, 'INSERT INTO seasons (room_id, season, status) VALUES (?, 1, ?)', roomId, 'setup');
    const token = newToken();
    const r = q.run(ctx.db, 'INSERT INTO participants (room_id, name, token_hash, is_host, ready, connected, budget, joined_at) VALUES (?, ?, ?, 1, 1, 0, ?, ?)',
      roomId, name, hashToken(token), DEFAULT_ROOM_CONFIG.budget, now);
    return { roomId, code, participantId: Number(r.lastInsertRowid), token };
  });
}

export function findRoomByCode(ctx: Ctx, code: string): { id: string } | undefined {
  return q.get<{ id: string }>(ctx.db, 'SELECT id FROM rooms WHERE code = ?', code.trim().toUpperCase());
}

export function joinRoom(ctx: Ctx, code: string, rawName: string): { roomId: string; participantId: number; token: string } {
  const name = nameSchema.parse(rawName);
  return tx(ctx.db, () => {
    const found = findRoomByCode(ctx, code);
    if (!found) throw new GameError('room_not_found', 'No room with that code.');
    const room = getRoom(ctx, found.id);
    if (room.phase !== 'lobby') throw new GameError('game_started', 'This game has already started. Use your original device to rejoin.');
    const ps = getParticipants(ctx, room.id);
    if (ps.length >= MAX_PARTICIPANTS) throw new GameError('room_full', `This room is full (${MAX_PARTICIPANTS} managers).`);
    if (ps.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError('name_taken', 'That name is already used in this room.');
    const token = newToken();
    const r = q.run(ctx.db, 'INSERT INTO participants (room_id, name, token_hash, is_host, ready, connected, budget, joined_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?)',
      room.id, name, hashToken(token), room.cfg.budget, ctx.now());
    bump(ctx, room.id);
    return { roomId: room.id, participantId: Number(r.lastInsertRowid), token };
  });
}

/** Resolve a (room code, token) pair to a participant. Tokens are stored hashed and compared in constant time. */
export function authenticate(ctx: Ctx, code: string, token: string): { roomId: string; participant: ParticipantRow } | null {
  if (typeof code !== 'string' || typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const hash = hashToken(token);
  const row = q.get<ParticipantRow & { code: string }>(ctx.db,
    'SELECT p.*, r.code AS code FROM participants p JOIN rooms r ON r.id = p.room_id WHERE p.token_hash = ?', hash);
  if (!row || row.code !== code.trim().toUpperCase()) return null;
  const a = Buffer.from(hash); const b = Buffer.from(row.token_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { roomId: row.room_id, participant: row };
}

export function setConnected(ctx: Ctx, roomId: string, participantId: number, connected: boolean) {
  q.run(ctx.db, 'UPDATE participants SET connected = ? WHERE id = ? AND room_id = ?', connected ? 1 : 0, participantId, roomId);
  bump(ctx, roomId);
}

export function setClub(ctx: Ctx, roomId: string, participantId: number, clubId: number | null) {
  tx(ctx.db, () => {
    const room = getRoom(ctx, roomId);
    requirePhase(room, 'lobby');
    if (clubId !== null) {
      if (!q.get(ctx.db, 'SELECT 1 FROM clubs WHERE id = ?', clubId)) throw new GameError('club_not_found', 'Unknown club.');
      const taken = q.get<{ name: string }>(ctx.db, 'SELECT name FROM participants WHERE room_id = ? AND club_id = ? AND id != ?', roomId, clubId, participantId);
      if (taken) throw new GameError('club_taken', `That club is already managed by ${taken.name}.`);
    }
    try {
      q.run(ctx.db, 'UPDATE participants SET club_id = ?, ready = CASE WHEN is_host = 1 THEN 1 ELSE 0 END WHERE id = ? AND room_id = ?', clubId, participantId, roomId);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new GameError('club_taken', 'That club was just taken by someone else.');
      throw e;
    }
    bump(ctx, roomId);
  });
}

export function setReady(ctx: Ctx, roomId: string, participantId: number, ready: boolean) {
  const room = getRoom(ctx, roomId);
  requirePhase(room, 'lobby');
  const p = getParticipant(ctx, roomId, participantId);
  if (!p) throw new GameError('not_found', 'Participant not found.');
  if (ready && p.club_id === null) throw new GameError('no_club', 'Choose a club before readying up.');
  q.run(ctx.db, 'UPDATE participants SET ready = ? WHERE id = ?', ready || p.is_host ? 1 : 0, participantId);
  bump(ctx, roomId);
}

export const settingsSchema = z.object({
  minSquad: z.number().int().min(11).max(MAX_SQUAD_LIMIT),
  maxSquad: z.number().int().min(11).max(MAX_SQUAD_LIMIT),
  timerSeconds: z.number().int().min(8).max(120),
  bidResetSeconds: z.number().int().min(3).max(60),
  intermissionSeconds: z.number().int().min(2).max(15),
  doubleRound: z.boolean(),
  poolSize: z.number().int().min(0).max(1000),
  order: z.enum(['tiered', 'random']),
}).partial().strict();

export function updateSettings(ctx: Ctx, roomId: string, hostId: number, raw: unknown) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId);
    requirePhase(room, 'lobby');
    const patch = settingsSchema.parse(raw);
    const next: RoomConfig = { ...room.cfg, ...patch };
    if (next.minSquad > next.maxSquad) throw new GameError('bad_settings', 'Minimum squad size cannot exceed the maximum.');
    if (next.bidResetSeconds > next.timerSeconds) throw new GameError('bad_settings', 'Bid timer reset cannot be longer than the lot timer.');
    if (next.poolSize !== 0 && next.poolSize < getParticipants(ctx, roomId).length * next.minSquad)
      throw new GameError('bad_settings', 'Player pool is too small for the minimum squad size.');
    q.run(ctx.db, 'UPDATE rooms SET config = ? WHERE id = ?', JSON.stringify(next), roomId);
    bump(ctx, roomId);
  });
}

export function leaveRoom(ctx: Ctx, roomId: string, participantId: number): { roomClosed: boolean } {
  return tx(ctx.db, () => {
    const room = getRoom(ctx, roomId);
    requirePhase(room, 'lobby');
    const p = getParticipant(ctx, roomId, participantId);
    if (!p) return { roomClosed: false };
    q.run(ctx.db, 'DELETE FROM participants WHERE id = ?', participantId);
    const rest = getParticipants(ctx, roomId);
    if (rest.length === 0) { q.run(ctx.db, 'DELETE FROM rooms WHERE id = ?', roomId); return { roomClosed: true }; }
    if (p.is_host) q.run(ctx.db, 'UPDATE participants SET is_host = 1, ready = 1 WHERE id = ?', rest[0].id);
    bump(ctx, roomId);
    return { roomClosed: false };
  });
}

export function kick(ctx: Ctx, roomId: string, hostId: number, targetId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    requirePhase(getRoom(ctx, roomId), 'lobby');
    if (targetId === hostId) throw new GameError('bad_target', 'You cannot remove yourself; leave the room instead.');
    const t = getParticipant(ctx, roomId, targetId);
    if (!t) throw new GameError('not_found', 'That manager is not in this room.');
    q.run(ctx.db, 'DELETE FROM participants WHERE id = ?', targetId);
    bump(ctx, roomId);
  });
}

export function transferHost(ctx: Ctx, roomId: string, hostId: number, targetId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const t = getParticipant(ctx, roomId, targetId);
    if (!t) throw new GameError('not_found', 'That manager is not in this room.');
    q.run(ctx.db, 'UPDATE participants SET is_host = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE room_id = ?', targetId, roomId);
    if (t.club_id !== null) q.run(ctx.db, 'UPDATE participants SET ready = 1 WHERE id = ?', targetId);
    bump(ctx, roomId);
  });
}
