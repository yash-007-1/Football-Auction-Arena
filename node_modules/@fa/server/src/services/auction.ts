import { MIN_OUTFIELD, Rng, hashSeed, maxBidFor, minNextBid, settleLot, validateBid, BID_ERROR_TEXT, checkSquad, type Lot, type AuctionView, type ReviewTeam } from '@fa/shared';
import { q, tx } from '../db';
import {
  type Ctx, GameError, type Room, bump, getParticipant, getParticipants, getRoom, requireHost, requirePhase,
} from './types';

export interface AuctionRow {
  room_id: string; season: number; status: 'running' | 'between' | 'paused' | 'finished'; queue: string; lot_seq: number;
  player_id: number | null; start_price: number | null; current_bid: number | null; high_bidder_id: number | null;
  ends_at: number | null; paused_remaining_ms: number | null; paused_from: string | null; last_result: string | null;
}

const getAuction = (ctx: Ctx, room: Room) => q.get<AuctionRow>(ctx.db, 'SELECT * FROM auctions WHERE room_id = ? AND season = ?', room.id, room.season);
export function squadCounts(ctx: Ctx, roomId: string, season: number): Map<number, number> {
  const rows = q.all<{ participant_id: number; n: number }>(ctx.db, 'SELECT participant_id, COUNT(*) AS n FROM squad_players WHERE room_id = ? AND season = ? GROUP BY participant_id', roomId, season);
  return new Map(rows.map((r) => [r.participant_id, r.n]));
}

interface PoolPlayer { id: number; overall: number; position: string }
const BANDS = [88, 85, 82, 79, 0];

function orderQueue(players: PoolPlayer[], room: Room, salt: string, managers: number): number[] {
  const rng = new Rng(hashSeed(room.id, room.season, salt));
  let list = [...players];
  const size = room.cfg.poolSize;
  const tiered = (arr: PoolPlayer[]) => {
    const out: PoolPlayer[] = [];
    BANDS.forEach((min, i) => {
      const max = i === 0 ? 1000 : BANDS[i - 1];
      out.push(...rng.shuffle(arr.filter((p) => p.overall >= min && p.overall < max)));
    });
    return out;
  };
  list = room.cfg.order === 'tiered' ? tiered(list) : rng.shuffle(list);
  if (size > 0 && size < list.length) {
    let chosen = list.slice(0, size);
    const rest = list.slice(size);
    const needGk = managers * 2;
    const gks = chosen.filter((p) => p.position === 'GK').length;
    if (gks < needGk) {
      const extra = rest.filter((p) => p.position === 'GK').sort((a, b) => b.overall - a.overall).slice(0, needGk - gks);
      const drop = new Set(chosen.filter((p) => p.position !== 'GK').sort((a, b) => a.overall - b.overall).slice(0, extra.length).map((p) => p.id));
      chosen = chosen.filter((p) => !drop.has(p.id)).concat(extra);
      const keep = new Set(chosen.map((p) => p.id));
      list = list.filter((p) => keep.has(p.id));
    } else list = chosen;
  }
  return list.map((p) => p.id);
}

const unownedPlayers = (ctx: Ctx, room: Room) => q.all<PoolPlayer>(ctx.db,
  'SELECT id, overall, position FROM players WHERE id NOT IN (SELECT player_id FROM squad_players WHERE room_id = ? AND season = ?) ORDER BY id', room.id, room.season);

export function startAuction(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId);
    requirePhase(room, 'lobby');
    const ps = getParticipants(ctx, roomId);
    if (ps.length < 2) throw new GameError('not_enough_players', 'At least 2 managers are needed to start.');
    const noClub = ps.filter((p) => p.club_id === null);
    if (noClub.length) throw new GameError('not_ready', `Waiting for a club selection from: ${noClub.map((p) => p.name).join(', ')}.`);
    const notReady = ps.filter((p) => !p.ready && !p.is_host);
    if (notReady.length) throw new GameError('not_ready', `Not ready yet: ${notReady.map((p) => p.name).join(', ')}.`);
    const away = ps.filter((p) => !p.connected);
    if (away.length) throw new GameError('not_connected', `Disconnected: ${away.map((p) => p.name).join(', ')}. Wait for them or remove them.`);
    if (room.cfg.maxSquad * ps.length > 0 && room.cfg.poolSize !== 0 && room.cfg.poolSize < ps.length * room.cfg.minSquad)
      throw new GameError('bad_settings', 'Player pool is too small for the minimum squad size.');
    q.run(ctx.db, 'UPDATE participants SET budget = ? WHERE room_id = ?', room.cfg.budget, roomId);
    const queue = orderQueue(unownedPlayers(ctx, room), room, 'queue', ps.length);
    const now = ctx.now();
    q.run(ctx.db, `INSERT INTO auctions (room_id, season, status, queue, lot_seq, ends_at) VALUES (?, ?, 'between', ?, 0, ?)`,
      roomId, room.season, JSON.stringify(queue), now + 5000);
    q.run(ctx.db, "UPDATE rooms SET phase = 'auction' WHERE id = ?", roomId);
    bump(ctx, roomId);
  });
  ctx.schedule(roomId);
}

function allDone(ctx: Ctx, room: Room): boolean {
  const counts = squadCounts(ctx, room.id, room.season);
  return getParticipants(ctx, room.id).every((p) => (counts.get(p.id) ?? 0) >= room.cfg.maxSquad || p.budget < room.cfg.minPlayerPrice);
}

function finish(ctx: Ctx, room: Room) {
  q.run(ctx.db, "UPDATE auctions SET status = 'finished', player_id = NULL, current_bid = NULL, high_bidder_id = NULL, ends_at = NULL WHERE room_id = ? AND season = ?", room.id, room.season);
  q.run(ctx.db, "UPDATE rooms SET phase = 'review' WHERE id = ?", room.id);
  bump(ctx, room.id);
}

function startNextLot(ctx: Ctx, room: Room, a: AuctionRow, now: number) {
  const queue: number[] = JSON.parse(a.queue);
  if (allDone(ctx, room)) return finish(ctx, room);
  let next: number | undefined;
  while (queue.length) {
    const id = queue.shift() as number;
    const owned = q.get(ctx.db, 'SELECT 1 FROM squad_players WHERE room_id = ? AND season = ? AND player_id = ?', room.id, room.season, id);
    if (!owned) { next = id; break; }
  }
  if (next === undefined) return finish(ctx, room);
  const player = q.get<{ start_price: number }>(ctx.db, 'SELECT start_price FROM players WHERE id = ?', next)!;
  q.run(ctx.db,
    `UPDATE auctions SET status = 'running', queue = ?, lot_seq = lot_seq + 1, player_id = ?, start_price = ?, current_bid = NULL, high_bidder_id = NULL, ends_at = ?, last_result = last_result
     WHERE room_id = ? AND season = ?`,
    JSON.stringify(queue), next, player.start_price, now + room.cfg.timerSeconds * 1000, room.id, room.season);
  bump(ctx, room.id);
}

/** Settle the open lot exactly once: budget deducted, ownership recorded, history written — all or nothing. */
function settleCurrent(ctx: Ctx, room: Room, a: AuctionRow, now: number) {
  if (a.player_id === null || a.start_price === null) return;
  const lot: Lot = { playerId: a.player_id, startPrice: a.start_price, currentBid: a.current_bid, highBidderId: a.high_bidder_id };
  const out = settleLot(lot);
  if (out.sold) {
    const upd = q.run(ctx.db, 'UPDATE participants SET budget = budget - ? WHERE id = ? AND room_id = ? AND budget >= ?', out.price, out.teamId, room.id, out.price);
    if (Number(upd.changes) !== 1) throw new GameError('settle_failed', 'Winning bidder can no longer afford this player.');
    q.run(ctx.db, 'INSERT INTO squad_players (room_id, season, participant_id, player_id, price, source) VALUES (?, ?, ?, ?, ?, ?)', room.id, room.season, out.teamId, lot.playerId, out.price, 'auction');
    q.run(ctx.db, "INSERT INTO auction_lots (room_id, season, seq, player_id, start_price, status, winner_id, price, settled_at) VALUES (?, ?, ?, ?, ?, 'sold', ?, ?, ?)",
      room.id, room.season, a.lot_seq, lot.playerId, lot.startPrice, out.teamId, out.price, now);
  } else {
    q.run(ctx.db, "INSERT INTO auction_lots (room_id, season, seq, player_id, start_price, status, settled_at) VALUES (?, ?, ?, ?, ?, 'unsold', ?)",
      room.id, room.season, a.lot_seq, lot.playerId, lot.startPrice, now);
  }
  const result = { seq: a.lot_seq, playerId: lot.playerId, sold: out.sold, winnerId: out.sold ? out.teamId : null, price: out.sold ? out.price : null };
  q.run(ctx.db, "UPDATE auctions SET status = 'between', ends_at = ?, last_result = ?, player_id = player_id WHERE room_id = ? AND season = ?",
    now + room.cfg.intermissionSeconds * 1000, JSON.stringify(result), room.id, room.season);
}

/** Called by the room timer (and tests). Safe to call at any time; does nothing unless a deadline has passed. */
export function advanceAuction(ctx: Ctx, roomId: string): boolean {
  const changed = tx(ctx.db, () => {
    const room = q.get(ctx.db, 'SELECT id FROM rooms WHERE id = ?', roomId) ? getRoom(ctx, roomId) : null;
    if (!room || room.phase !== 'auction') return false;
    const a = getAuction(ctx, room);
    if (!a || a.ends_at === null) return false;
    const now = ctx.now();
    if (now < a.ends_at) return false;
    if (a.status === 'running') { settleCurrent(ctx, room, a, now); bump(ctx, room.id); return true; }
    if (a.status === 'between') { startNextLot(ctx, room, a, now); return true; }
    return false;
  });
  if (changed) { ctx.notify(roomId, 'snapshot'); ctx.schedule(roomId); }
  return changed;
}

export function nextWakeAt(ctx: Ctx, roomId: string): number | null {
  const r = q.get<{ phase: string; season: number }>(ctx.db, 'SELECT phase, season FROM rooms WHERE id = ?', roomId);
  if (!r || r.phase !== 'auction') return null;
  const a = q.get<AuctionRow>(ctx.db, 'SELECT * FROM auctions WHERE room_id = ? AND season = ?', roomId, r.season);
  if (!a || (a.status !== 'running' && a.status !== 'between')) return null;
  return a.ends_at;
}

export function placeBid(ctx: Ctx, roomId: string, participantId: number, amount: number, nonce: string): { duplicate: boolean } {
  const res = tx(ctx.db, () => {
    const room = getRoom(ctx, roomId);
    requirePhase(room, 'auction');
    const a = getAuction(ctx, room);
    if (!a || a.player_id === null) throw new GameError('no_lot', BID_ERROR_TEXT.no_lot);
    if (a.status === 'paused') throw new GameError('paused', BID_ERROR_TEXT.paused);
    if (a.status !== 'running') throw new GameError('no_lot', BID_ERROR_TEXT.no_lot);
    const now = ctx.now();
    if (a.ends_at === null || now >= a.ends_at) throw new GameError('lot_closed', 'Bidding on this player has closed.');
    const p = getParticipant(ctx, roomId, participantId);
    if (!p || p.club_id === null) throw new GameError('ineligible', BID_ERROR_TEXT.ineligible);
    const size = squadCounts(ctx, roomId, room.season).get(p.id) ?? 0;
    const lot: Lot = { playerId: a.player_id, startPrice: a.start_price as number, currentBid: a.current_bid, highBidderId: a.high_bidder_id };
    // Idempotency: the same client nonce for the same lot is only ever processed once.
    if (q.get(ctx.db, 'SELECT 1 FROM auction_bids WHERE room_id = ? AND season = ? AND lot_seq = ? AND participant_id = ? AND nonce = ?', roomId, room.season, a.lot_seq, p.id, nonce))
      return { duplicate: true };
    const lotPos = q.get<{ position: string }>(ctx.db, 'SELECT position FROM players WHERE id = ?', a.player_id)?.position;
    const gks = q.get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM squad_players s JOIN players pl ON pl.id = s.player_id WHERE s.room_id = ? AND s.season = ? AND s.participant_id = ? AND pl.position = 'GK'", roomId, room.season, p.id)?.n ?? 0;
    const v = validateBid({ lot, bidder: { teamId: p.id, budget: p.budget, squadSize: size, connected: !!p.connected, goalkeepers: gks }, amount, cfg: room.cfg, paused: false, lotIsGk: lotPos === 'GK' });
    if (!v.ok) throw new GameError(v.error, BID_ERROR_TEXT[v.error]);
    q.run(ctx.db, 'INSERT INTO auction_bids (room_id, season, lot_seq, participant_id, amount, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', roomId, room.season, a.lot_seq, p.id, amount, nonce, now);
    const newEnds = Math.max(a.ends_at, now + room.cfg.bidResetSeconds * 1000);
    q.run(ctx.db, 'UPDATE auctions SET current_bid = ?, high_bidder_id = ?, ends_at = ? WHERE room_id = ? AND season = ?', amount, p.id, newEnds, roomId, room.season);
    bump(ctx, roomId);
    return { duplicate: false };
  });
  if (!res.duplicate) { ctx.notify(roomId, 'auction'); ctx.schedule(roomId); }
  return res;
}

export function pauseAuction(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'auction');
    const a = getAuction(ctx, room);
    if (!a || (a.status !== 'running' && a.status !== 'between')) throw new GameError('bad_state', 'The auction cannot be paused right now.');
    const remaining = Math.max(0, (a.ends_at ?? ctx.now()) - ctx.now());
    q.run(ctx.db, "UPDATE auctions SET status = 'paused', paused_remaining_ms = ?, paused_from = ?, ends_at = NULL WHERE room_id = ? AND season = ?", remaining, a.status, roomId, room.season);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot'); ctx.schedule(roomId);
}

export function resumeAuction(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'auction');
    const a = getAuction(ctx, room);
    if (!a || a.status !== 'paused') throw new GameError('bad_state', 'The auction is not paused.');
    q.run(ctx.db, 'UPDATE auctions SET status = ?, ends_at = ?, paused_remaining_ms = NULL, paused_from = NULL WHERE room_id = ? AND season = ?',
      a.paused_from === 'between' ? 'between' : 'running', ctx.now() + Math.max(1500, a.paused_remaining_ms ?? 0), roomId, room.season);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot'); ctx.schedule(roomId);
}

/** Host completes the auction early. A lot that already has a bid is sold first; otherwise it is dropped. */
export function endAuction(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'auction');
    const a = getAuction(ctx, room);
    if (!a) throw new GameError('bad_state', 'No auction in progress.');
    if ((a.status === 'running' || (a.status === 'paused' && a.paused_from === 'running')) && a.current_bid !== null) settleCurrent(ctx, room, a, ctx.now());
    finish(ctx, room);
  });
  ctx.notify(roomId, 'snapshot'); ctx.schedule(roomId);
}

export function reviewTeams(ctx: Ctx, room: Room): ReviewTeam[] {
  const rows = q.all<{ participant_id: number; position: string; price: number }>(ctx.db,
    'SELECT s.participant_id, p.position, s.price FROM squad_players s JOIN players p ON p.id = s.player_id WHERE s.room_id = ? AND s.season = ?', room.id, room.season);
  return getParticipants(ctx, room.id).map((p) => {
    const mine = rows.filter((r) => r.participant_id === p.id);
    const c = checkSquad(mine.map((r) => r.position), room.cfg);
    return { participantId: p.id, size: mine.length, ok: c.ok, problems: c.problems, spent: mine.reduce((s, r) => s + r.price, 0) };
  });
}

/** Verify budgets and ownership are internally consistent (used before leaving the review phase and in tests). */
export function verifyIntegrity(ctx: Ctx, roomId: string): string[] {
  const room = getRoom(ctx, roomId);
  const problems: string[] = [];
  for (const p of getParticipants(ctx, roomId)) {
    const spent = q.get<{ s: number | null }>(ctx.db, 'SELECT SUM(price) AS s FROM squad_players WHERE room_id = ? AND season = ? AND participant_id = ?', roomId, room.season, p.id)?.s ?? 0;
    if (p.budget + spent !== room.cfg.budget) problems.push(`${p.name}: budget ${p.budget} + spent ${spent} != ${room.cfg.budget}`);
    if (p.budget < 0) problems.push(`${p.name}: negative budget`);
  }
  const dup = q.all<{ player_id: number }>(ctx.db, 'SELECT player_id FROM squad_players WHERE room_id = ? AND season = ? GROUP BY player_id HAVING COUNT(*) > 1', roomId, room.season);
  if (dup.length) problems.push('duplicate ownership detected');
  return problems;
}

/** Give every short squad the cheapest available players (keeper first if needed). */
export function autoFill(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'review');
    const cfg = room.cfg;
    let seq = (q.get<{ m: number | null }>(ctx.db, 'SELECT MAX(seq) AS m FROM auction_lots WHERE room_id = ? AND season = ?', roomId, room.season)?.m ?? 0);
    for (const t of reviewTeams(ctx, room)) {
      if (t.ok) continue;
      const p = getParticipant(ctx, roomId, t.participantId)!;
      const squad = q.all<{ position: string }>(ctx.db, 'SELECT p.position FROM squad_players s JOIN players p ON p.id = s.player_id WHERE s.room_id = ? AND s.season = ? AND s.participant_id = ?', roomId, room.season, p.id);
      let size = squad.length; let hasGk = squad.some((x) => x.position === 'GK'); let budget = p.budget;
      let outfield = squad.filter((x) => x.position !== 'GK').length;
      const needed = Math.max(cfg.minSquad - size, (hasGk ? 0 : 1) + Math.max(0, MIN_OUTFIELD - outfield));
      if (size + needed > cfg.maxSquad) throw new GameError('cannot_fill', `${p.name} has no room left in the squad to add the missing players.`);
      while (size < cfg.minSquad || !hasGk || outfield < MIN_OUTFIELD) {
        const need = !hasGk;
        const cand = q.get<{ id: number; start_price: number }>(ctx.db,
          `SELECT id, start_price FROM players WHERE position ${need ? '=' : '!='} 'GK' AND id NOT IN (SELECT player_id FROM squad_players WHERE room_id = ? AND season = ?)
           ORDER BY start_price ASC, overall DESC LIMIT 1`, roomId, room.season);
        const remainingAfter = Math.max(0, cfg.minSquad - size - 1);
        if (!cand || budget - cand.start_price < remainingAfter * cfg.minPlayerPrice || budget < cand.start_price)
          throw new GameError('cannot_fill', `${p.name} cannot afford enough players to reach the minimum squad (budget €${budget}M).`);
        q.run(ctx.db, 'UPDATE participants SET budget = budget - ? WHERE id = ? AND budget >= ?', cand.start_price, p.id, cand.start_price);
        q.run(ctx.db, "INSERT INTO squad_players (room_id, season, participant_id, player_id, price, source) VALUES (?, ?, ?, ?, ?, 'autofill')", roomId, room.season, p.id, cand.id, cand.start_price);
        seq++;
        q.run(ctx.db, "INSERT INTO auction_lots (room_id, season, seq, player_id, start_price, status, winner_id, price, settled_at) VALUES (?, ?, ?, ?, ?, 'sold', ?, ?, ?)", roomId, room.season, seq, cand.id, cand.start_price, p.id, cand.start_price, ctx.now());
        budget -= cand.start_price; size++; if (need) hasGk = true; else outfield++;
      }
    }
    q.run(ctx.db, 'UPDATE auctions SET lot_seq = ? WHERE room_id = ? AND season = ?', seq, roomId, room.season);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}

/** Re-open bidding on every player nobody owns, so short squads can be completed by auction. */
export function reopenAuction(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'review');
    const queue = orderQueue(unownedPlayers(ctx, room), { ...room, cfg: { ...room.cfg, poolSize: 0 } }, `reopen-${ctx.now()}`, getParticipants(ctx, roomId).length);
    if (!queue.length) throw new GameError('bad_state', 'There are no unsold players left to auction.');
    q.run(ctx.db, "UPDATE auctions SET status = 'between', queue = ?, ends_at = ?, player_id = NULL, current_bid = NULL, high_bidder_id = NULL, last_result = NULL WHERE room_id = ? AND season = ?",
      JSON.stringify(queue), ctx.now() + 4000, roomId, room.season);
    q.run(ctx.db, "UPDATE rooms SET phase = 'auction' WHERE id = ?", roomId);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot'); ctx.schedule(roomId);
}

export function auctionView(ctx: Ctx, room: Room): AuctionView | null {
  const a = getAuction(ctx, room);
  if (!a) return null;
  const counts = squadCounts(ctx, room.id, room.season);
  const lot = a.player_id !== null ? { playerId: a.player_id, startPrice: a.start_price as number, currentBid: a.current_bid, highBidderId: a.high_bidder_id } : null;
  const recent = q.all<{ participant_id: number; amount: number; created_at: number }>(ctx.db,
    'SELECT participant_id, amount, created_at FROM auction_bids WHERE room_id = ? AND season = ? AND lot_seq = ? ORDER BY id DESC LIMIT 8', room.id, room.season, a.lot_seq);
  const maxBids: Record<number, number> = {};
  for (const p of getParticipants(ctx, room.id)) maxBids[p.id] = (counts.get(p.id) ?? 0) >= room.cfg.maxSquad ? 0 : maxBidFor({ budget: p.budget, squadSize: counts.get(p.id) ?? 0 }, room.cfg);
  const tally = q.all<{ status: string; n: number }>(ctx.db, 'SELECT status, COUNT(*) AS n FROM auction_lots WHERE room_id = ? AND season = ? GROUP BY status', room.id, room.season);
  return {
    status: a.status, lotSeq: a.lot_seq, playerId: a.player_id, startPrice: a.start_price, currentBid: a.current_bid, highBidderId: a.high_bidder_id,
    endsAt: a.ends_at, pausedRemainingMs: a.paused_remaining_ms, queueLength: (JSON.parse(a.queue) as number[]).length,
    minNextBid: lot ? minNextBid(lot) : null,
    lastResult: a.last_result ? JSON.parse(a.last_result) : null,
    recentBids: recent.map((r) => ({ participantId: r.participant_id, amount: r.amount, at: r.created_at })),
    maxBids,
    soldCount: tally.find((t) => t.status === 'sold')?.n ?? 0, unsoldCount: tally.find((t) => t.status === 'unsold')?.n ?? 0,
  };
}

export function auctionHistory(ctx: Ctx, roomId: string): { seq: number; playerId: number; startPrice: number; status: string; winnerId: number | null; price: number | null; at: number }[] {
  const room = getRoom(ctx, roomId);
  return q.all<{ seq: number; player_id: number; start_price: number; status: string; winner_id: number | null; price: number | null; settled_at: number }>(ctx.db,
    'SELECT seq, player_id, start_price, status, winner_id, price, settled_at FROM auction_lots WHERE room_id = ? AND season = ? ORDER BY seq DESC', roomId, room.season)
    .map((r) => ({ seq: r.seq, playerId: r.player_id, startPrice: r.start_price, status: r.status, winnerId: r.winner_id, price: r.price, at: r.settled_at }));
}
