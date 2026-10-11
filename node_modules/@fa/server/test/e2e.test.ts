import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { autoPickLineup, minIncrement, type Lineup } from '@fa/shared';
import { startTestServer, sleep, type TestClient } from './harness';
import { placeBid, auctionView, verifyIntegrity, squadCounts } from '../src/services/auction';
import { advanceAuction } from '../src/game';
import { getRoom, loadSquad, type Ctx } from '../src/services/types';
import { q } from '../src/db';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let s: Server;
beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.stop(); });

const roomIdOf = (code: string) => (q.get<{ id: string }>(s.db, 'SELECT id FROM rooms WHERE code = ?', code) as { id: string }).id;
const budgets = (roomId: string) => Object.fromEntries(q.all<{ id: number; budget: number }>(s.db, 'SELECT id, budget FROM participants WHERE room_id = ?', roomId).map((r) => [r.id, r.budget]));
const ok = async (p: Promise<{ ok: boolean; error?: string; code?: string }>) => { const r = await p; if (!r.ok) throw new Error(`${r.code}: ${r.error}`); return r; };

/** Open the next lot / settle the current one by moving the fake clock; mirrors what the server timer does in real time. */
function stepClock(ctx: Ctx, roomId: string): void {
  const a = auctionView(ctx, getRoom(ctx, roomId));
  if (!a || a.endsAt === null) return;
  s.clock.t = a.endsAt + 1;
  advanceAuction(ctx, roomId);
}

/** Fast driver: managers with the thinnest squads bid at the start price on lots they can sensibly afford. */
function driveAuction(roomId: string, stop: (sold: number) => boolean) {
  const ctx = s.ctx;
  let guard = 0;
  while (guard++ < 2000) {
    const room = getRoom(ctx, roomId);
    if (room.phase !== 'auction') return;
    const a = auctionView(ctx, room)!;
    if (a.status === 'running' && a.playerId !== null) {
      const counts = squadCounts(ctx, roomId, room.season);
      const ps = q.all<{ id: number; budget: number }>(ctx.db, 'SELECT id, budget FROM participants WHERE room_id = ? ORDER BY id', roomId)
        .map((p) => ({ ...p, size: counts.get(p.id) ?? 0 })).sort((x, y) => x.size - y.size || y.budget - x.budget);
      let n = 0;
      for (const p of ps) {
        const need = Math.max(1, room.cfg.minSquad - p.size);
        const cap = Math.floor((p.budget / need) * 1.4);
        const price = a.currentBid === null ? a.startPrice! : a.minNextBid!;
        if (price <= cap && price <= a.maxBids[p.id] && p.size < room.cfg.maxSquad && n < 2 && a.highBidderId !== p.id) {
          try { placeBid(ctx, roomId, p.id, price, `drv-${a.lotSeq}-${p.id}`); n++; } catch { continue; } // server rules (e.g. goalkeeper cap) may refuse a bid
          const again = auctionView(ctx, getRoom(ctx, roomId))!;
          a.currentBid = again.currentBid; a.minNextBid = again.minNextBid; a.highBidderId = again.highBidderId;
        }
      }
    }
    if (stop(auctionView(ctx, getRoom(ctx, roomId))!.soldCount)) return;
    stepClock(ctx, roomId);
  }
  throw new Error('auction driver did not finish');
}

async function lobby(names: string[], settings: Record<string, unknown>) {
  const host = await s.create(names[0]);
  const rest: TestClient[] = [];
  for (const n of names.slice(1)) rest.push(await s.join(host.code, n));
  const all = [host, ...rest];
  await s.settle();
  const clubs = s.db.prepare('SELECT id FROM clubs ORDER BY id').all() as { id: number }[];
  for (let i = 0; i < all.length; i++) await ok(all[i].act({ type: 'lobby.setClub', clubId: clubs[i * 3].id }));
  for (const c of rest) await ok(c.act({ type: 'lobby.ready', ready: true }));
  await ok(host.act({ type: 'lobby.settings', settings }));
  await s.settle();
  return { host, rest, all, roomId: roomIdOf(host.code) };
}

describe('room A: ten managers, full flow', () => {
  let host: TestClient; let all: TestClient[]; let rest: TestClient[]; let roomId: string; let code: string;

  it('1-2: ten participants join; an eleventh is refused', async () => {
    host = await s.create('Host');
    code = host.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    rest = [];
    for (let i = 2; i <= 10; i++) rest.push(await s.join(code, `Manager ${i}`));
    all = [host, ...rest];
    await s.settle();
    expect(host.snap.participants).toHaveLength(10);
    const eleventh = await s.post('/rooms/join', { code, name: 'Latecomer' });
    expect(eleventh.ok).toBe(false);
    expect(eleventh.ok === false && eleventh.code).toBe('room_full');
    const dupName = await s.post('/rooms/join', { code, name: 'manager 2' });
    expect(dupName.ok).toBe(false);
    roomId = roomIdOf(code);
  });

  it('3: two participants cannot select the same club; nobody can touch another manager', async () => {
    const clubs = s.db.prepare('SELECT id FROM clubs ORDER BY id').all() as { id: number }[];
    await ok(host.act({ type: 'lobby.setClub', clubId: clubs[0].id }));
    const clash = await rest[0].act({ type: 'lobby.setClub', clubId: clubs[0].id });
    expect(clash).toMatchObject({ ok: false, code: 'club_taken' });
    for (let i = 0; i < rest.length; i++) await ok(rest[i].act({ type: 'lobby.setClub', clubId: clubs[i + 1].id }));
    // The payload cannot name another participant (strict schema) and host-only actions are refused.
    const forged = await rest[0].act({ type: 'lobby.setClub', clubId: clubs[20].id, participantId: host.pid } as never);
    expect(forged).toMatchObject({ ok: false, code: 'invalid' });
    expect(await rest[0].act({ type: 'lobby.kick', participantId: host.pid })).toMatchObject({ ok: false, code: 'not_host' });
    expect(await rest[0].act({ type: 'lobby.start' })).toMatchObject({ ok: false, code: 'not_host' });
    await s.settle();
    expect(host.snap.participants.find((p) => p.id === host.pid)?.clubId).toBe(clubs[0].id);
    expect(host.snap.room.canStart.ok).toBe(false); // others not ready yet
  });

  it('4: everybody starts with exactly €1,000M, the host starts the auction', async () => {
    for (const c of rest) await ok(c.act({ type: 'lobby.ready', ready: true }));
    await ok(host.act({ type: 'lobby.settings', settings: { minSquad: 11, poolSize: 200 } }));
    await s.settle();
    expect(host.snap.room.canStart.ok).toBe(true);
    expect(host.snap.participants.every((p) => p.budget === 1000)).toBe(true);
    await ok(host.act({ type: 'lobby.start' }));
    await s.settle();
    for (const c of all) { expect(c.snap.room.phase).toBe('auction'); expect(c.snap.participants.every((p) => p.budget === 1000)).toBe(true); }
    expect(Object.values(budgets(roomId)).every((b) => b === 1000)).toBe(true);
  });

  it('5-7: live bids are consistent, invalid bids are refused, the winner is charged exactly once', async () => {
    stepClock(s.ctx, roomId); // intermission over -> first lot opens
    await s.settle();
    const lot = host.snap.auction!;
    expect(lot.status).toBe('running');
    for (const c of all) expect(c.snap.auction!.playerId).toBe(lot.playerId);
    const price = lot.minNextBid!;
    await ok(rest[0].act({ type: 'auction.bid', amount: price, nonce: 'nonce-a1' }));
    await s.settle();
    for (const c of all) { expect(c.snap.auction!.currentBid).toBe(price); expect(c.snap.auction!.highBidderId).toBe(rest[0].pid); }
    expect(await rest[1].act({ type: 'auction.bid', amount: price, nonce: 'nonce-b1' })).toMatchObject({ ok: false, code: 'below_minimum' });
    expect(await rest[0].act({ type: 'auction.bid', amount: price + 50, nonce: 'nonce-a2' })).toMatchObject({ ok: false, code: 'already_highest' });
    expect(await rest[2].act({ type: 'auction.bid', amount: 5000, nonce: 'nonce-c1' })).toMatchObject({ ok: false, code: 'over_budget' });
    expect(await rest[2].act({ type: 'auction.bid', amount: 10.5, nonce: 'nonce-c2' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await rest[2].act({ type: 'auction.bid', amount: -4, nonce: 'nonce-c3' })).toMatchObject({ ok: false, code: 'invalid' });
    const raise = price + minIncrement(price) + 1; // respects the €5 increment on lots priced €100M+
    await ok(rest[1].act({ type: 'auction.bid', amount: raise, nonce: 'nonce-dup1' }));
    await ok(rest[1].act({ type: 'auction.bid', amount: raise, nonce: 'nonce-dup1' })); // retried delivery: idempotent
    const n = q.get<{ n: number }>(s.db, 'SELECT COUNT(*) AS n FROM auction_bids WHERE room_id = ? AND participant_id = ?', roomId, rest[1].pid)!.n;
    expect(n).toBe(1);
    const a = auctionView(s.ctx, getRoom(s.ctx, roomId))!;
    expect(a.endsAt! - s.clock.t).toBeGreaterThanOrEqual(getRoom(s.ctx, roomId).cfg.bidResetSeconds * 1000 - 1); // timer reset on valid bid
    stepClock(s.ctx, roomId);
    await s.settle();
    const b = budgets(roomId);
    expect(b[rest[1].pid]).toBe(1000 - raise);
    expect(b[rest[0].pid]).toBe(1000);
    for (const c of all) {
      expect(c.snap.squads.filter((x) => x.playerId === lot.playerId)).toEqual([expect.objectContaining({ participantId: rest[1].pid, price: raise })]);
      expect(c.snap.auction!.lastResult).toMatchObject({ sold: true, winnerId: rest[1].pid, price: raise });
    }
    // settling again does nothing (exactly-once)
    advanceAuction(s.ctx, roomId);
    expect(budgets(roomId)[rest[1].pid]).toBe(1000 - raise);
  });

  it('8-9: an unsold player changes no budget; no player is sold twice', async () => {
    const before = budgets(roomId);
    stepClock(s.ctx, roomId); // next lot opens
    stepClock(s.ctx, roomId); // nobody bids -> unsold
    await s.settle();
    expect(budgets(roomId)).toEqual(before);
    expect(host.snap.auction!.lastResult).toMatchObject({ sold: false, winnerId: null, price: null });
    expect(host.snap.auction!.unsoldCount).toBe(1);
    const dupOwners = q.all(s.db, 'SELECT player_id FROM squad_players WHERE room_id = ? GROUP BY player_id HAVING COUNT(*) > 1', roomId);
    expect(dupOwners).toHaveLength(0);
    expect(() => s.db.prepare("INSERT INTO squad_players (room_id, season, participant_id, player_id, price) SELECT room_id, season, ?, player_id, 1 FROM squad_players WHERE room_id = ? LIMIT 1").run(host.pid, roomId)).toThrow();
  });

  it('pause and resume are host-only and block bidding', async () => {
    stepClock(s.ctx, roomId);
    await s.settle();
    expect(await rest[0].act({ type: 'auction.pause' })).toMatchObject({ ok: false, code: 'not_host' });
    await ok(host.act({ type: 'auction.pause' }));
    await s.settle();
    expect(rest[0].snap.auction!.status).toBe('paused');
    expect(await rest[0].act({ type: 'auction.bid', amount: rest[0].snap.auction!.minNextBid!, nonce: 'nonce-p1' })).toMatchObject({ ok: false, code: 'paused' });
    await ok(host.act({ type: 'auction.resume' }));
    await s.settle();
    expect(rest[0].snap.auction!.status).toBe('running');
  });

  it('10, 19: refresh/reconnect keeps the auction state and budgets', async () => {
    const victim = rest[3];
    const budgetBefore = budgets(roomId);
    victim.close();
    await s.settle(150);
    expect(host.snap.participants.find((p) => p.id === victim.pid)?.connected).toBe(false);
    const back = await s.attach(victim.name, victim.code, victim.token, victim.pid);
    await s.settle();
    expect(back.snap.participants.find((p) => p.id === victim.pid)?.connected).toBe(true);
    expect(back.snap.participants.map((p) => p.budget)).toEqual(host.snap.participants.map((p) => p.budget));
    expect(back.snap.auction!.lotSeq).toBe(host.snap.auction!.lotSeq);
    expect(budgets(roomId)).toEqual(budgetBefore);
    rest[3] = back; all[4] = back;
    const bad = await s.post('/rooms/join', { code, name: 'Sneaky' });
    expect(bad.ok).toBe(false); // game already started
    await expect(s.attach('x', code, 'f'.repeat(48), victim.pid)).rejects.toBeTruthy(); // wrong token cannot attach
  });

  it('auction runs on; the host ends it early and short squads must be fixed before the league', async () => {
    driveAuction(roomId, (sold) => sold >= 90);
    await s.settle();
    expect(getRoom(s.ctx, roomId).phase).toBe('auction');
    await ok(host.act({ type: 'auction.end' }));
    await s.settle();
    for (const c of all) expect(c.snap.room.phase).toBe('review');
    expect(verifyIntegrity(s.ctx, roomId)).toEqual([]);
    expect(host.snap.review!.some((t) => !t.ok)).toBe(true);
    expect(await host.act({ type: 'review.proceed' })).toMatchObject({ ok: false, code: 'squads_invalid' });
    expect(await rest[0].act({ type: 'review.autofill' })).toMatchObject({ ok: false, code: 'not_host' });
    await ok(host.act({ type: 'review.autofill' }));
    await s.settle();
    expect(host.snap.review!.every((t) => t.ok)).toBe(true);
    expect(verifyIntegrity(s.ctx, roomId)).toEqual([]);
    for (const p of host.snap.participants) expect(p.budget + p.spent).toBe(1000);
  });

  it('11-12: the full schedule exists and is saved before the league starts', async () => {
    expect(q.get(s.db, 'SELECT 1 FROM fixtures WHERE room_id = ?', roomId)).toBeUndefined();
    await ok(host.act({ type: 'review.proceed' }));
    await s.settle();
    for (const c of all) expect(c.snap.room.phase).toBe('prepare');
    const fx = host.snap.fixtures;
    expect(fx).toHaveLength(90);
    expect(new Set(fx.map((f) => f.id)).size).toBe(90);
    expect(host.snap.season.totalRounds).toBe(18);
    expect(host.snap.season.locked).toBe(false);
    const pair = new Map<string, number>();
    for (const f of fx) pair.set(`${f.homeId}>${f.awayId}`, (pair.get(`${f.homeId}>${f.awayId}`) ?? 0) + 1);
    expect(pair.size).toBe(90); // every ordered pair exactly once: home and away
    for (let r = 1; r <= 18; r++) { const inRound = fx.filter((f) => f.round === r).flatMap((f) => [f.homeId, f.awayId]); expect(new Set(inRound).size).toBe(10); }
    const snapshotBefore = JSON.stringify(fx.map((f) => [f.id, f.key, f.round, f.homeId, f.awayId]));
    expect(await rest[0].act({ type: 'league.start' })).toMatchObject({ ok: false, code: 'not_host' });
    await ok(host.act({ type: 'league.start' }));
    await s.settle();
    expect(JSON.stringify(host.snap.fixtures.map((f) => [f.id, f.key, f.round, f.homeId, f.awayId]))).toBe(snapshotBefore); // schedule never regenerated
    expect(host.snap.season).toMatchObject({ locked: true, currentRound: 1, status: 'running' });
  });

  it('13: managers can save a valid lineup and tactics, but never use another manager\'s players', async () => {
    const c = rest[1];
    const m = c.snap.me.match!;
    const mine = loadSquad(s.ctx, roomId, 1, c.pid);
    const lineup = autoPickLineup(mine, '4-4-2');
    await ok(c.act({ type: 'lineup.save', lineup }));
    await ok(c.act({ type: 'tactics.save', tactics: { ...m.tactics, mentality: 'attacking', pressing: 'high', counterAttack: true, captainId: lineup.slots[3], setPieceTakerId: lineup.slots[9] } }));
    await s.settle();
    expect(c.snap.me.match!.lineup.formation).toBe('4-4-2');
    expect(c.snap.me.match!.tactics.mentality).toBe('attacking');
    expect(c.snap.me.match!.auto).toBe(false);
    // other managers' lineups are untouched
    expect(rest[2].snap.me.match!.lineup.formation).not.toBe('4-4-2-forged');
    const foreign = host.snap.squads.find((x) => x.participantId === host.pid)!.playerId;
    const stolen: Lineup = { ...lineup, slots: [...lineup.slots] }; stolen.slots[5] = foreign;
    expect(await c.act({ type: 'lineup.save', lineup: stolen })).toMatchObject({ ok: false, code: 'invalid_lineup' });
    const dup: Lineup = { ...lineup, slots: [...lineup.slots] }; dup.slots[5] = dup.slots[6];
    expect(await c.act({ type: 'lineup.save', lineup: dup })).toMatchObject({ ok: false, code: 'invalid_lineup' });
    const short: Lineup = { ...lineup, slots: [...lineup.slots] }; short.slots[10] = null;
    expect(await c.act({ type: 'lineup.save', lineup: short })).toMatchObject({ ok: false, code: 'invalid_lineup' });
    const twoGk = loadSquad(s.ctx, roomId, 1, c.pid).filter((p) => p.position === 'GK');
    if (twoGk.length >= 2) { const l2: Lineup = { ...lineup, slots: [...lineup.slots] }; l2.slots[1] = twoGk[1].id; l2.slots[0] = twoGk[0].id; expect(await c.act({ type: 'lineup.save', lineup: l2 })).toMatchObject({ ok: false, code: 'invalid_lineup' }); }
    expect(await c.act({ type: 'tactics.save', tactics: { ...m.tactics, captainId: foreign } })).toMatchObject({ ok: false, code: 'invalid_tactics' });
    expect(await c.act({ type: 'tactics.save', tactics: { ...m.tactics, mentality: 'chaos' as never } })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('14-17: every fixture is simulated exactly once and all clients agree on results and table', async () => {
    expect(await rest[0].act({ type: 'league.simulate' })).toMatchObject({ ok: false, code: 'not_host' });
    await ok(host.act({ type: 'league.simulate' }));
    expect(await host.act({ type: 'league.simulate' })).toMatchObject({ ok: false, code: 'already_simulated' });
    expect(await host.act({ type: 'league.start' })).toMatchObject({ ok: false, code: 'wrong_phase' });
    await s.settle();
    const r1 = host.snap.fixtures.filter((f) => f.round === 1);
    expect(r1).toHaveLength(5);
    expect(r1.every((f) => f.status === 'played' && f.homeGoals !== null)).toBe(true);
    expect(host.snap.fixtures.filter((f) => f.status === 'played')).toHaveLength(5);
    const ref = JSON.stringify({ t: host.snap.table, f: host.snap.fixtures, st: host.snap.stats });
    for (const c of all) expect(JSON.stringify({ t: c.snap.table, f: c.snap.fixtures, st: c.snap.stats })).toBe(ref);
    // table equals a recomputation from fixtures
    const pts = new Map<number, number>();
    for (const f of r1) { const h = f.homeGoals!; const a = f.awayGoals!; pts.set(f.homeId, h > a ? 3 : h === a ? 1 : 0); pts.set(f.awayId, a > h ? 3 : h === a ? 1 : 0); }
    for (const row of host.snap.table) { expect(row.played).toBe(1); expect(row.points).toBe(pts.get(row.teamId)); }
    // identical match centre data for different viewers
    const m1 = await host.ask<{ events: { type: string }[]; homeGoals: number; awayGoals: number }>('match', r1[0].id);
    const m2 = await rest[4].ask<{ events: unknown[] }>('match', r1[0].id);
    if (!m1.ok || !m2.ok) throw new Error('match detail unavailable');
    expect(JSON.stringify(m1.data!.events)).toBe(JSON.stringify(m2.data!.events));
    expect(m1.data!.events.length).toBeGreaterThan(5);
    expect(m1.data!.events.filter((e) => e.type === 'goal' || e.type === 'penalty').length).toBe(m1.data!.homeGoals + m1.data!.awayGoals);
    expect(host.snap.table.reduce((n, r) => n + r.goalsFor, 0)).toBe(r1.reduce((n, f) => n + f.homeGoals! + f.awayGoals!, 0));
  });

  it('18: a complete season ends with the right champion and statistics; nothing is processed twice', async () => {
    expect(await host.act({ type: 'league.next' })).toMatchObject({ ok: true });
    for (let round = 2; round <= 18; round++) {
      await ok(host.act({ type: 'league.simulate' }));
      await ok(host.act({ type: 'league.next' }));
    }
    await s.settle();
    for (const c of all) expect(c.snap.room.phase).toBe('season_end');
    const fx = host.snap.fixtures;
    expect(fx.every((f) => f.status === 'played')).toBe(true);
    expect(q.get<{ n: number }>(s.db, 'SELECT COUNT(DISTINCT fixture_id) AS n FROM player_match_stats')!.n).toBe(90);
    expect(q.get<{ n: number }>(s.db, 'SELECT COUNT(*) AS n FROM fixtures WHERE seed IS NULL')!.n).toBe(0);
    const t = host.snap.table;
    expect(t.every((r) => r.played === 18)).toBe(true);
    expect(t.reduce((n, r) => n + r.won, 0)).toBe(t.reduce((n, r) => n + r.lost, 0));
    for (let i = 1; i < t.length; i++) expect(t[i - 1].points >= t[i].points).toBe(true);
    const sum = host.snap.summary!;
    expect(sum.champion!.participantId).toBe(t[0].teamId);
    expect(sum.runnerUp!.participantId).toBe(t[1].teamId);
    const maxGoals = Math.max(...host.snap.stats.map((p) => p.goals));
    expect(sum.topScorer!.goals).toBe(maxGoals);
    expect(host.snap.stats.reduce((n, p) => n + p.goals, 0)).toBe(t.reduce((n, r) => n + r.goalsFor, 0)); // own goals do not exist, so scorers sum to team goals
    expect(sum.bestAttack!.goals).toBe(Math.max(...t.map((r) => r.goalsFor)));
    expect(sum.bestDefence!.conceded).toBe(Math.min(...t.map((r) => r.goalsAgainst)));
    expect(sum.managers).toHaveLength(10);
    expect(await host.act({ type: 'league.simulate' })).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('new season (keep): squads and budgets carry over, the old season is archived untouched', async () => {
    const champBefore = host.snap.summary!.champion;
    const budgetBefore = budgets(roomId);
    await ok(host.act({ type: 'season.new', mode: 'keep' }));
    await s.settle();
    expect(host.snap.room).toMatchObject({ phase: 'prepare', season: 2 });
    expect(host.snap.fixtures).toHaveLength(90);
    expect(host.snap.fixtures.every((f) => f.status === 'scheduled')).toBe(true);
    expect(host.snap.table.every((r) => r.played === 0)).toBe(true);
    expect(budgets(roomId)).toEqual(budgetBefore);
    expect(host.snap.squads.length).toBe(q.get<{ n: number }>(s.db, 'SELECT COUNT(*) AS n FROM squad_players WHERE room_id = ? AND season = 1', roomId)!.n);
    expect(host.snap.history[0]).toMatchObject({ season: 1, champion: champBefore });
    const old = q.get<{ n: number }>(s.db, "SELECT COUNT(*) AS n FROM fixtures WHERE room_id = ? AND season = 1 AND status = 'played'", roomId)!.n;
    expect(old).toBe(90);
    const arch = await host.ask<{ champion: unknown }>('seasonArchive', 1);
    expect(arch.ok && arch.data!.champion).toEqual(champBefore);
  });
});

describe('room B: three managers, odd team count, natural end of auction, season reset', () => {
  it('byes, exhausted player list, full season, reset to a fresh auction', async () => {
    const { host, all, roomId } = await lobby(['Ann', 'Bob', 'Cy'], { minSquad: 11, poolSize: 40, timerSeconds: 10, bidResetSeconds: 5 });
    await ok(host.act({ type: 'lobby.start' }));
    driveAuction(roomId, () => false); // runs until the player list is exhausted
    await s.settle();
    expect(getRoom(s.ctx, roomId).phase).toBe('review');
    expect(auctionView(s.ctx, getRoom(s.ctx, roomId))!.status).toBe('finished');
    expect(verifyIntegrity(s.ctx, roomId)).toEqual([]);
    if (host.snap.review!.some((t) => !t.ok)) await ok(host.act({ type: 'review.autofill' }));
    await ok(host.act({ type: 'review.proceed' }));
    await ok(host.act({ type: 'league.start' }));
    await s.settle();
    expect(host.snap.fixtures).toHaveLength(6);
    expect(host.snap.season.totalRounds).toBe(6);
    for (let r = 1; r <= 6; r++) {
      await s.settle();
      expect(all.filter((c) => c.snap.me.bye)).toHaveLength(1); // one team rests every round
      await ok(host.act({ type: 'league.simulate' }));
      await ok(host.act({ type: 'league.next' }));
    }
    await s.settle();
    expect(host.snap.room.phase).toBe('season_end');
    expect(host.snap.table.every((t) => t.played === 4)).toBe(true);
    await ok(host.act({ type: 'season.new', mode: 'reset' }));
    await s.settle();
    expect(host.snap.room).toMatchObject({ phase: 'lobby', season: 2 });
    expect(host.snap.participants.every((p) => p.budget === 1000 && p.squadSize === 0)).toBe(true);
    expect(host.snap.history).toHaveLength(1);
    expect(host.snap.participants.every((p) => p.clubId !== null)).toBe(true);
  });
});

describe('abuse protection', () => {
  it('rate limits socket actions and REST room creation', async () => {
    const limited = await startTestServer({ restRateMax: 3, socketRate: 2 });
    const h = await limited.create('Rate');
    const results = await Promise.all(Array.from({ length: 20 }, () => h.act({ type: 'lobby.ready', ready: true })));
    expect(results.some((r) => !r.ok && r.code === 'rate_limited')).toBe(true);
    let blocked = 0;
    for (let i = 0; i < 6; i++) { const r = await limited.post('/rooms', { name: `Spam ${i}` }); if (!r.ok && r.code === 'rate_limited') blocked++; }
    expect(blocked).toBeGreaterThan(0);
    await limited.stop();
  });
  it('rejects garbage payloads without corrupting state', async () => {
    const h = await s.create('Garbage');
    for (const bad of [null, 5, 'x', {}, { type: 'nope' }, { type: 'lobby.setClub', clubId: 'a' }, { type: 'auction.bid', amount: 1 }]) {
      const r = await h.act(bad as never);
      expect(r.ok).toBe(false);
    }
    await sleep(10);
    expect(h.socket.connected).toBe(true);
  });
});
