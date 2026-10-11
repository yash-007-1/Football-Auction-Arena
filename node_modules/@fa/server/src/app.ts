import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Server, type Socket } from 'socket.io';
import { ZodError, z } from 'zod';
import type { Ack, AuctionPatch, CatalogClub, CatalogPlayer, Action } from '@fa/shared';
import { config, isProd } from './config';
import { log } from './logger';
import { q, type Db } from './db';
import { DATASET_INFO } from './db/dataset';
import { parseAction } from './actions';
import { advanceAuction, dispatch } from './game';
import { type Ctx, GameError, getRoom } from './services/types';
import { authenticate, createRoom, joinRoom, setConnected } from './services/rooms';
import { auctionHistory, auctionView, nextWakeAt } from './services/auction';
import { getMatch } from './services/league';
import { buildSnapshot } from './services/snapshot';

export interface AppOptions { db: Db; now?: () => number; serveClient?: boolean; corsOrigin?: string; socketRate?: number; restRateMax?: number }

function toAck(e: unknown): { ok: false; error: string; code: string } {
  if (e instanceof GameError) return { ok: false, error: e.message, code: e.code };
  if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? 'Invalid input.', code: 'invalid' };
  log.error({ err: e }, 'unhandled error');
  return { ok: false, error: 'Something went wrong on the server. Your game state was not changed.', code: 'server_error' };
}

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const timers = new Map<string, NodeJS.Timeout>();
  const flushTimers = new Map<string, NodeJS.Timeout>();
  const online = new Map<number, Set<string>>(); // participantId -> socket ids

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  const origin = opts.corsOrigin ?? config.clientOrigin;
  app.use(cors({ origin: isProd ? false : origin }));
  app.use(express.json({ limit: '8kb' }));
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: isProd ? false : origin }, maxHttpBufferSize: 64 * 1024, pingInterval: 10_000, pingTimeout: 8_000 });

  const ctx: Ctx = {
    db: opts.db, now,
    notify: (roomId, kind) => {
      if (kind === 'auction') {
        try {
          const room = getRoom(ctx, roomId);
          const a = auctionView(ctx, room);
          if (a) io.to(roomId).emit('auction', { version: room.version, serverNow: now(), auction: a } satisfies AuctionPatch);
        } catch (e) { log.error({ err: e, roomId }, 'auction notify failed'); }
        return;
      }
      if (flushTimers.has(roomId)) return; // coalesce bursts into one snapshot per participant
      flushTimers.set(roomId, setTimeout(() => { flushTimers.delete(roomId); pushSnapshots(roomId); }, 25));
    },
    schedule: (roomId) => schedule(roomId),
  };

  function pushSnapshots(roomId: string) {
    const ids = io.sockets.adapter.rooms.get(roomId);
    if (!ids) return;
    for (const sid of ids) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      try { s.emit('snapshot', buildSnapshot(ctx, roomId, s.data.participantId)); }
      catch (e) { if (e instanceof GameError && e.code === 'not_found') { s.emit('kicked', {}); s.disconnect(true); } else log.error({ err: e, roomId }, 'snapshot failed'); }
    }
  }

  function schedule(roomId: string) {
    const prev = timers.get(roomId); if (prev) clearTimeout(prev);
    timers.delete(roomId);
    let wake: number | null = null;
    try { wake = nextWakeAt(ctx, roomId); } catch (e) { log.error({ err: e, roomId }, 'nextWakeAt failed'); }
    if (wake === null) return;
    const delay = Math.min(2_000_000_000, Math.max(0, wake - now()) + 15);
    timers.set(roomId, setTimeout(() => {
      timers.delete(roomId);
      try { if (!advanceAuction(ctx, roomId)) schedule(roomId); }
      catch (e) {
        log.error({ err: e, roomId }, 'auction advance failed; retrying');
        timers.set(roomId, setTimeout(() => { timers.delete(roomId); schedule(roomId); }, 2000));
      }
    }, delay));
  }

  /* ------------------------------------------------------------ REST */
  const limiter = rateLimit({ windowMs: opts.restRateMax === undefined ? config.restRateWindowMs : config.restRateWindowMs, limit: opts.restRateMax ?? config.restRateMax, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please wait a moment.', code: 'rate_limited' } });
  const api = express.Router();
  api.get('/health', (_req, res) => { res.json({ ok: true, time: now() }); });

  let catalogCache: { clubs: CatalogClub[]; players: CatalogPlayer[]; dataset: typeof DATASET_INFO } | null = null;
  api.get('/catalog', (_req, res) => {
    if (!catalogCache) {
      const clubs = q.all<{ id: number; name: string; short: string; league: string; color1: string; color2: string; logo_url: string | null; n: number }>(ctx.db,
        'SELECT c.*, (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS n FROM clubs c ORDER BY c.id');
      const players = q.all<{ id: number; name: string; nationality: string; age: number; position: string; secondary: string; overall: number; pace: number; shooting: number; passing: number; defending: number; physical: number; club_id: number; club_name: string; league: string; start_price: number; photo_url: string | null }>(ctx.db, 'SELECT * FROM players ORDER BY id');
      const meta = Object.fromEntries(q.all<{ key: string; value: string }>(ctx.db, 'SELECT key, value FROM dataset_meta').map((r) => [r.key, r.value]));
      catalogCache = {
        clubs: clubs.map((c) => ({ id: c.id, name: c.name, short: c.short, league: c.league, color1: c.color1, color2: c.color2, logoUrl: c.logo_url, players: c.n })),
        players: players.map((p) => ({ id: p.id, name: p.name, nationality: p.nationality, age: p.age, position: p.position, secondary: JSON.parse(p.secondary), overall: p.overall, pace: p.pace, shooting: p.shooting, passing: p.passing, defending: p.defending, physical: p.physical, clubId: p.club_id, clubName: p.club_name, league: p.league, startPrice: p.start_price, photoUrl: p.photo_url })),
        dataset: { ...DATASET_INFO, ...meta } as typeof DATASET_INFO,
      };
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(catalogCache);
  });

  const nameBody = z.object({ name: z.string().max(60) });
  api.post('/rooms', limiter, (req, res) => {
    try {
      const { name } = nameBody.parse(req.body);
      const r = createRoom(ctx, name, config.maxRooms);
      log.info({ roomId: r.roomId, code: r.code }, 'room created');
      res.json({ ok: true, data: { code: r.code, token: r.token, participantId: r.participantId } });
    } catch (e) { res.status(400).json(toAck(e)); }
  });
  api.post('/rooms/join', limiter, (req, res) => {
    try {
      const { name, code } = nameBody.extend({ code: z.string().min(4).max(10) }).parse(req.body);
      const r = joinRoom(ctx, code, name);
      ctx.notify(r.roomId, 'snapshot');
      res.json({ ok: true, data: { code: code.trim().toUpperCase(), token: r.token, participantId: r.participantId } });
    } catch (e) { res.status(400).json(toAck(e)); }
  });
  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ ok: false, error: 'Not found', code: 'not_found' }); });

  if (opts.serveClient !== false) {
    const dist = path.resolve(process.cwd(), config.clientDist);
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      app.use(express.static(dist, { maxAge: '1h', index: false }));
      app.get('*', (_req, res) => { res.sendFile(path.join(dist, 'index.html')); });
      log.info({ dist }, 'serving built client');
    }
  }
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof SyntaxError) { res.status(400).json({ ok: false, error: 'Malformed request.', code: 'invalid' }); return; }
    log.error({ err }, 'express error'); res.status(500).json({ ok: false, error: 'Server error.', code: 'server_error' });
  });

  /* ------------------------------------------------------------ Sockets */
  const rate = opts.socketRate ?? config.socketRate;
  io.use((socket, next) => {
    const a = socket.handshake.auth as { code?: string; token?: string };
    const found = authenticate(ctx, String(a?.code ?? ''), String(a?.token ?? ''));
    if (!found) return next(new Error('unauthorized'));
    socket.data.roomId = found.roomId; socket.data.participantId = found.participant.id;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const roomId: string = socket.data.roomId; const pid: number = socket.data.participantId;
    socket.join(roomId);
    const set = online.get(pid) ?? new Set<string>(); set.add(socket.id); online.set(pid, set);
    let tokens = rate * 2; let last = Date.now();
    const allow = () => { const t = Date.now(); tokens = Math.min(rate * 2, tokens + ((t - last) / 1000) * rate); last = t; if (tokens < 1) return false; tokens -= 1; return true; };

    try { setConnected(ctx, roomId, pid, true); } catch (e) { log.error({ err: e }, 'setConnected failed'); }
    try { socket.emit('snapshot', buildSnapshot(ctx, roomId, pid)); } catch (e) { log.error({ err: e }, 'initial snapshot failed'); }
    ctx.notify(roomId, 'snapshot');
    ctx.schedule(roomId);
    log.info({ roomId, pid }, 'socket connected');

    const guard = <T>(ack: unknown, fn: () => T) => {
      const cb = typeof ack === 'function' ? (ack as (a: Ack<T>) => void) : () => undefined;
      if (!allow()) return cb({ ok: false, error: 'You are sending actions too quickly.', code: 'rate_limited' });
      try { cb({ ok: true, data: fn() }); } catch (e) { cb(toAck(e)); }
    };

    socket.on('action', (raw: unknown, ack?: unknown) => guard(ack, () => {
      const action: Action = parseAction(raw);
      const r = dispatch(ctx, roomId, pid, action);
      for (const id of r.removed ?? []) {
        for (const sid of online.get(id) ?? []) { const s = io.sockets.sockets.get(sid); s?.emit('kicked', {}); s?.disconnect(true); }
      }
      return undefined;
    }));
    socket.on('sync', (_p: unknown, ack?: unknown) => guard(ack, () => buildSnapshot(ctx, roomId, pid)));
    socket.on('history', (_p: unknown, ack?: unknown) => guard(ack, () => auctionHistory(ctx, roomId)));
    socket.on('match', (raw: unknown, ack?: unknown) => guard(ack, () => getMatch(ctx, roomId, z.string().uuid().parse(raw))));
    socket.on('seasonArchive', (raw: unknown, ack?: unknown) => guard(ack, () => {
      const season = z.number().int().positive().parse(raw);
      const r = q.get<{ summary: string }>(ctx.db, 'SELECT summary FROM season_archive WHERE room_id = ? AND season = ?', roomId, season);
      if (!r) throw new GameError('not_found', 'No archived season.');
      return JSON.parse(r.summary);
    }));
    socket.on('disconnect', () => {
      const s = online.get(pid); s?.delete(socket.id);
      if (s && s.size === 0) {
        online.delete(pid);
        try { if (q.get(ctx.db, 'SELECT 1 FROM participants WHERE id = ?', pid)) { setConnected(ctx, roomId, pid, false); ctx.notify(roomId, 'snapshot'); } } catch (e) { log.error({ err: e }, 'disconnect update failed'); }
      }
      log.info({ roomId, pid }, 'socket disconnected');
    });
  });

  /** Called on boot: nobody is connected yet, and every running auction needs its timer re-armed. */
  function restore() {
    ctx.db.exec('UPDATE participants SET connected = 0');
    const idle = now() - config.roomIdleDays * 86_400_000;
    ctx.db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(idle);
    for (const r of q.all<{ id: string }>(ctx.db, "SELECT id FROM rooms WHERE phase = 'auction'")) schedule(r.id);
  }

  async function close() {
    for (const t of timers.values()) clearTimeout(t);
    for (const t of flushTimers.values()) clearTimeout(t);
    timers.clear(); flushTimers.clear();
    await new Promise<void>((resolve) => { io.close(() => resolve()); });
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { app, server, io, ctx, restore, close, schedule };
}
