import crypto from 'node:crypto';
import { z } from 'zod';
import {
  DEFAULT_TACTICS, FORMATION_IDS, autoPickLineup, computeTable, generateSchedule, hashSeed, simulateMatch, validateLineup, resolveLineup,
  type FormationId, type Lineup, type SimPlayer, type SimTeam, type Tactics, type TableRow, type MatchResult, type PlayedResult, type PlayerStatRow, type SeasonSummary,
} from '@fa/shared';
import { q, tx } from '../db';
import { verifyIntegrity, reviewTeams } from './auction';
import {
  type Ctx, GameError, MIN_CONDITION, RECOVERY_PER_MATCHDAY, type Room, type ParticipantRow, bump, getParticipant, getParticipants, getRoom,
  loadSquad, requireHost, requirePhase,
} from './types';

export interface SeasonRow {
  room_id: string; season: number; status: 'setup' | 'prepare' | 'running' | 'finished'; current_round: number; round_simulated: number;
  schedule_locked: number; total_rounds: number; byes: string; summary: string | null; started_at: number | null;
}
export interface FixtureRow {
  id: string; room_id: string; season: number; key: string; round: number; home_id: number; away_id: number; status: 'scheduled' | 'played';
  home_goals: number | null; away_goals: number | null; seed: number | null; result: string | null; played_at: number | null;
}
interface LineupRow { fixture_id: string; participant_id: number; formation: FormationId; slots: string; bench: string; tactics: string; auto: number; updated_at: number }

export const getSeason = (ctx: Ctx, room: Room) => q.get<SeasonRow>(ctx.db, 'SELECT * FROM seasons WHERE room_id = ? AND season = ?', room.id, room.season) as SeasonRow;
export const clubNameOf = (ctx: Ctx, p: ParticipantRow): string =>
  p.club_id === null ? p.name : (q.get<{ name: string }>(ctx.db, 'SELECT name FROM clubs WHERE id = ?', p.club_id)?.name ?? p.name);

/* ---------------------------------------------------------------- schedule */

export function createSchedule(ctx: Ctx, room: Room) {
  if (q.get(ctx.db, 'SELECT 1 FROM fixtures WHERE room_id = ? AND season = ?', room.id, room.season))
    throw new GameError('schedule_exists', 'The schedule for this season has already been generated.');
  const ps = getParticipants(ctx, room.id);
  const sched = generateSchedule(ps.map((p) => p.id), { seed: hashSeed(room.id, room.season, 'schedule'), doubleRound: room.cfg.doubleRound });
  const ins = ctx.db.prepare('INSERT INTO fixtures (id, room_id, season, key, round, home_id, away_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const f of sched.fixtures) ins.run(crypto.randomUUID(), room.id, room.season, f.key, f.round, f.homeId, f.awayId);
  q.run(ctx.db, "UPDATE seasons SET status = 'prepare', total_rounds = ?, byes = ?, current_round = 0, round_simulated = 0, schedule_locked = 0 WHERE room_id = ? AND season = ?",
    sched.rounds, JSON.stringify(sched.byes), room.id, room.season);
  q.run(ctx.db, "UPDATE rooms SET phase = 'prepare' WHERE id = ?", room.id);
  ensureLineups(ctx, room, 1);
}

/** Host leaves the squad reveal and the league is generated and saved — once. */
export function proceedToLeague(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'review');
    const bad = reviewTeams(ctx, room).filter((t) => !t.ok);
    if (bad.length) {
      const names = new Map(getParticipants(ctx, roomId).map((p) => [p.id, p.name]));
      throw new GameError('squads_invalid', `Squads are incomplete: ${bad.map((b) => `${names.get(b.participantId)} (${b.problems.join(' ')})`).join(' | ')}`);
    }
    const problems = verifyIntegrity(ctx, roomId);
    if (problems.length) throw new GameError('integrity', `Integrity check failed: ${problems.join('; ')}`);
    createSchedule(ctx, room);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}

export function startLeague(ctx: Ctx, roomId: string, hostId: number) {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'prepare');
    const s = getSeason(ctx, room);
    if (s.schedule_locked) throw new GameError('already_started', 'The league has already started.');
    q.run(ctx.db, "UPDATE seasons SET status = 'running', current_round = 1, round_simulated = 0, schedule_locked = 1, started_at = ? WHERE room_id = ? AND season = ?", ctx.now(), roomId, room.season);
    q.run(ctx.db, "UPDATE rooms SET phase = 'league' WHERE id = ?", roomId);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}

/* ---------------------------------------------------------------- lineups & tactics */

export const tacticsSchema = z.object({
  mentality: z.enum(['very_defensive', 'defensive', 'balanced', 'attacking', 'very_attacking']),
  buildUp: z.enum(['short', 'balanced', 'direct']),
  pressing: z.enum(['low', 'medium', 'high']),
  defensiveLine: z.enum(['deep', 'balanced', 'high']),
  width: z.enum(['narrow', 'balanced', 'wide']),
  passingRisk: z.enum(['safe', 'balanced', 'risky']),
  counterAttack: z.boolean(),
  setPieceTakerId: z.number().int().nullable(),
  captainId: z.number().int().nullable(),
}).strict();

export const lineupSchema = z.object({
  formation: z.enum(FORMATION_IDS as [FormationId, ...FormationId[]]),
  slots: z.array(z.number().int().nullable()).length(11),
  bench: z.array(z.number().int()).max(7),
}).strict();

const lineupOf = (r: LineupRow): Lineup => ({ formation: r.formation, slots: JSON.parse(r.slots), bench: JSON.parse(r.bench) });

function defaultLineupFor(ctx: Ctx, room: Room, participantId: number): { lineup: Lineup; tactics: Tactics; auto: boolean } {
  const squad = loadSquad(ctx, room.id, room.season, participantId);
  const prev = q.get<LineupRow>(ctx.db,
    `SELECT l.* FROM lineups l JOIN fixtures f ON f.id = l.fixture_id WHERE f.room_id = ? AND l.participant_id = ? ORDER BY f.season DESC, f.round DESC, l.updated_at DESC LIMIT 1`, room.id, participantId);
  if (prev) {
    const tactics = { ...DEFAULT_TACTICS, ...(JSON.parse(prev.tactics) as Partial<Tactics>) };
    const lu = lineupOf(prev);
    if (prev.auto) return { lineup: autoPickLineup(squad, lu.formation), tactics, auto: true };
    if (validateLineup(lu, squad).valid) return { lineup: lu, tactics, auto: false };
    return { lineup: autoPickLineup(squad, lu.formation), tactics, auto: true };
  }
  return { lineup: autoPickLineup(squad, '4-3-3'), tactics: { ...DEFAULT_TACTICS }, auto: true };
}

/** Make sure both sides of every fixture in `round` have a saved lineup row (carried over or auto-picked). */
export function ensureLineups(ctx: Ctx, room: Room, round: number) {
  const fixtures = q.all<FixtureRow>(ctx.db, 'SELECT * FROM fixtures WHERE room_id = ? AND season = ? AND round = ?', room.id, room.season, round);
  for (const f of fixtures) {
    for (const pid of [f.home_id, f.away_id]) {
      if (q.get(ctx.db, 'SELECT 1 FROM lineups WHERE fixture_id = ? AND participant_id = ?', f.id, pid)) continue;
      const d = defaultLineupFor(ctx, room, pid);
      q.run(ctx.db, 'INSERT INTO lineups (fixture_id, participant_id, formation, slots, bench, tactics, auto, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        f.id, pid, d.lineup.formation, JSON.stringify(d.lineup.slots), JSON.stringify(d.lineup.bench), JSON.stringify(d.tactics), d.auto ? 1 : 0, ctx.now());
    }
  }
}

/** The round whose lineups managers may currently edit. */
export function editableRound(s: SeasonRow): number | null {
  if (s.status === 'prepare') return 1;
  if (s.status !== 'running') return null;
  const r = s.round_simulated ? s.current_round + 1 : s.current_round;
  return r <= s.total_rounds ? r : null;
}

function myEditableFixture(ctx: Ctx, room: Room, participantId: number): FixtureRow {
  const s = getSeason(ctx, room);
  const round = editableRound(s);
  if (round === null) throw new GameError('no_fixture', 'There is no upcoming match to prepare for.');
  const f = q.get<FixtureRow>(ctx.db, "SELECT * FROM fixtures WHERE room_id = ? AND season = ? AND round = ? AND status = 'scheduled' AND (home_id = ? OR away_id = ?)", room.id, room.season, round, participantId, participantId);
  if (!f) throw new GameError('bye', 'You have a bye in the next matchday — no lineup to set.');
  ensureLineups(ctx, room, round);
  return f;
}

export function saveLineup(ctx: Ctx, roomId: string, participantId: number, raw: unknown) {
  tx(ctx.db, () => {
    const room = getRoom(ctx, roomId); requirePhase(room, 'prepare', 'league');
    const input = lineupSchema.parse(raw);
    const f = myEditableFixture(ctx, room, participantId);
    const squad = loadSquad(ctx, roomId, room.season, participantId); // ownership is enforced here: only this manager's players
    const check = validateLineup(input, squad);
    if (!check.valid) throw new GameError('invalid_lineup', check.errors.join(' '));
    q.run(ctx.db, 'UPDATE lineups SET formation = ?, slots = ?, bench = ?, auto = 0, updated_at = ? WHERE fixture_id = ? AND participant_id = ?',
      input.formation, JSON.stringify(input.slots), JSON.stringify(input.bench), ctx.now(), f.id, participantId);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}

export function saveTactics(ctx: Ctx, roomId: string, participantId: number, raw: unknown) {
  tx(ctx.db, () => {
    const room = getRoom(ctx, roomId); requirePhase(room, 'prepare', 'league');
    const t = tacticsSchema.parse(raw);
    const f = myEditableFixture(ctx, room, participantId);
    const owned = new Set(loadSquad(ctx, roomId, room.season, participantId).map((p) => p.id));
    for (const id of [t.setPieceTakerId, t.captainId]) if (id !== null && !owned.has(id)) throw new GameError('invalid_tactics', 'Captain and set-piece taker must be players in your squad.');
    q.run(ctx.db, 'UPDATE lineups SET tactics = ?, auto = auto, updated_at = ? WHERE fixture_id = ? AND participant_id = ?', JSON.stringify(t), ctx.now(), f.id, participantId);
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}

/* ---------------------------------------------------------------- simulation */

interface UsedSide { formation: FormationId; tactics: Tactics; starters: number[]; bench: number[]; auto: boolean }
export interface StoredResult { events: MatchResult['events']; homeStats: MatchResult['homeStats']; awayStats: MatchResult['awayStats']; players: MatchResult['players']; home: UsedSide; away: UsedSide; seed: number }

function buildTeam(ctx: Ctx, room: Room, f: FixtureRow, pid: number): { team: SimTeam; used: UsedSide } {
  const p = getParticipant(ctx, room.id, pid) as ParticipantRow;
  const squad: SimPlayer[] = loadSquad(ctx, room.id, room.season, pid);
  const row = q.get<LineupRow>(ctx.db, 'SELECT * FROM lineups WHERE fixture_id = ? AND participant_id = ?', f.id, pid);
  let lineup: Lineup | null = row ? lineupOf(row) : null;
  let tactics: Tactics = row ? { ...DEFAULT_TACTICS, ...(JSON.parse(row.tactics) as Partial<Tactics>) } : { ...DEFAULT_TACTICS };
  let auto = row ? !!row.auto : true;
  let res = lineup ? resolveLineup(lineup, squad) : null;
  if (!res || !lineup) { // saved lineup missing or no longer valid: fall back to the best XI so the matchday can never stall
    lineup = autoPickLineup(squad, lineup?.formation ?? '4-3-3'); res = resolveLineup(lineup, squad); auto = true;
    if (!res) throw new GameError('squad_too_small', `${p.name} does not have enough players to field a team.`);
  }
  const team: SimTeam = { teamId: pid, name: clubNameOf(ctx, p), formation: lineup.formation, tactics, starters: res.starters, bench: res.bench };
  return { team, used: { formation: lineup.formation, tactics, starters: res.starters.map((x) => x.id), bench: res.bench.map((x) => x.id), auto } };
}

export function simulateRound(ctx: Ctx, roomId: string, hostId: number): { played: number } {
  const out = tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'league');
    const s = getSeason(ctx, room);
    if (s.round_simulated) throw new GameError('already_simulated', 'This matchday has already been played.');
    ensureLineups(ctx, room, s.current_round);
    const fixtures = q.all<FixtureRow>(ctx.db, "SELECT * FROM fixtures WHERE room_id = ? AND season = ? AND round = ? ORDER BY key", roomId, room.season, s.current_round);
    if (!fixtures.length) throw new GameError('no_fixtures', 'No fixtures found for this matchday.');
    const insStat = ctx.db.prepare('INSERT INTO player_match_stats (fixture_id, participant_id, player_id, minutes, goals, assists, yellow, red, saves, shots, clean_sheet, conceded, is_gk, end_condition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let played = 0;
    for (const f of fixtures) {
      if (f.status === 'played') continue;
      // Exactly-once guard: only one UPDATE can flip scheduled -> played.
      const claim = q.run(ctx.db, "UPDATE fixtures SET status = 'played' WHERE id = ? AND status = 'scheduled'", f.id);
      if (Number(claim.changes) !== 1) throw new GameError('already_simulated', `Fixture ${f.key} was already simulated.`);
      const home = buildTeam(ctx, room, f, f.home_id); const away = buildTeam(ctx, room, f, f.away_id);
      const seed = hashSeed(room.id, room.season, f.key);
      const r = simulateMatch(home.team, away.team, seed);
      const stored: StoredResult = { events: r.events, homeStats: r.homeStats, awayStats: r.awayStats, players: r.players, home: home.used, away: away.used, seed };
      q.run(ctx.db, 'UPDATE fixtures SET home_goals = ?, away_goals = ?, seed = ?, result = ?, played_at = ? WHERE id = ?', r.homeGoals, r.awayGoals, seed, JSON.stringify(stored), ctx.now(), f.id);
      for (const ps of r.players) {
        const pid = ps.side === 'home' ? f.home_id : f.away_id;
        insStat.run(f.id, pid, ps.playerId, ps.minutes, ps.goals, ps.assists, ps.yellow, ps.red, ps.saves, ps.shots, ps.cleanSheet ? 1 : 0, ps.goalsConceded, ps.isGK ? 1 : 0, ps.endCondition);
        q.run(ctx.db, 'UPDATE squad_players SET condition = ? WHERE room_id = ? AND season = ? AND player_id = ?', Math.max(MIN_CONDITION, ps.endCondition), roomId, room.season, ps.playerId);
      }
      played++;
    }
    // Everyone (including teams on a bye) recovers between matchdays.
    q.run(ctx.db, 'UPDATE squad_players SET condition = MIN(100, condition + ?) WHERE room_id = ? AND season = ?', RECOVERY_PER_MATCHDAY, roomId, room.season);
    q.run(ctx.db, 'UPDATE seasons SET round_simulated = 1 WHERE room_id = ? AND season = ?', roomId, room.season);
    bump(ctx, roomId);
    return { played };
  });
  ctx.notify(roomId, 'snapshot');
  return out;
}

export function nextRound(ctx: Ctx, roomId: string, hostId: number): { finished: boolean } {
  const out = tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'league');
    const s = getSeason(ctx, room);
    if (!s.round_simulated) throw new GameError('round_not_played', 'Play the current matchday first.');
    const unplayed = q.get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM fixtures WHERE room_id = ? AND season = ? AND round = ? AND status != 'played'", roomId, room.season, s.current_round)?.n ?? 0;
    if (unplayed) throw new GameError('round_not_played', 'Some fixtures of this matchday are unplayed.');
    if (s.current_round >= s.total_rounds) {
      const summary = buildSummary(ctx, room);
      q.run(ctx.db, "UPDATE seasons SET status = 'finished', summary = ? WHERE room_id = ? AND season = ?", JSON.stringify(summary), roomId, room.season);
      q.run(ctx.db, 'INSERT OR REPLACE INTO season_archive (room_id, season, summary, archived_at) VALUES (?, ?, ?, ?)', roomId, room.season, JSON.stringify(summary), ctx.now());
      q.run(ctx.db, "UPDATE rooms SET phase = 'season_end' WHERE id = ?", roomId);
      bump(ctx, roomId);
      return { finished: true };
    }
    q.run(ctx.db, 'UPDATE seasons SET current_round = current_round + 1, round_simulated = 0 WHERE room_id = ? AND season = ?', roomId, room.season);
    ensureLineups(ctx, room, s.current_round + 1);
    bump(ctx, roomId);
    return { finished: false };
  });
  ctx.notify(roomId, 'snapshot');
  return out;
}

/* ---------------------------------------------------------------- standings & stats */

export function playedResults(ctx: Ctx, roomId: string, season: number, upToRound?: number): PlayedResult[] {
  const rows = q.all<FixtureRow>(ctx.db, "SELECT * FROM fixtures WHERE room_id = ? AND season = ? AND status = 'played' ORDER BY round, key", roomId, season);
  return rows.filter((r) => upToRound === undefined || r.round <= upToRound)
    .map((r) => ({ homeId: r.home_id, awayId: r.away_id, homeGoals: r.home_goals as number, awayGoals: r.away_goals as number }));
}

export function computeStandings(ctx: Ctx, room: Room, upToRound?: number): TableRow[] {
  const teams = getParticipants(ctx, room.id).map((p) => ({ id: p.id, name: clubNameOf(ctx, p) }));
  return computeTable(teams, playedResults(ctx, room.id, room.season, upToRound));
}

export function playerStats(ctx: Ctx, roomId: string, season: number): PlayerStatRow[] {
  return q.all<{ player_id: number; participant_id: number; name: string; position: string; apps: number; minutes: number; goals: number; assists: number; yellow: number; red: number; saves: number; cs: number; conceded: number; gk: number }>(ctx.db,
    `SELECT s.player_id, s.participant_id, p.name, p.position, SUM(CASE WHEN s.minutes > 0 THEN 1 ELSE 0 END) AS apps, SUM(s.minutes) AS minutes,
            SUM(s.goals) AS goals, SUM(s.assists) AS assists, SUM(s.yellow) AS yellow, SUM(s.red) AS red, SUM(s.saves) AS saves,
            SUM(s.clean_sheet) AS cs, SUM(CASE WHEN s.is_gk = 1 THEN s.conceded ELSE 0 END) AS conceded, MAX(s.is_gk) AS gk
     FROM player_match_stats s JOIN fixtures f ON f.id = s.fixture_id JOIN players p ON p.id = s.player_id
     WHERE f.room_id = ? AND f.season = ? GROUP BY s.player_id, s.participant_id ORDER BY goals DESC, assists DESC, minutes DESC`, roomId, season)
    .map((r) => ({ playerId: r.player_id, participantId: r.participant_id, name: r.name, position: r.position, apps: r.apps, minutes: r.minutes, goals: r.goals, assists: r.assists, yellow: r.yellow, red: r.red, saves: r.saves, cleanSheets: r.cs, conceded: r.conceded, isGk: r.gk }));
}

function buildSummary(ctx: Ctx, room: Room): SeasonSummary {
  const table = computeStandings(ctx, room);
  const ps = getParticipants(ctx, room.id);
  const byId = new Map(ps.map((p) => [p.id, p]));
  const stats = playerStats(ctx, room.id, room.season);
  const pick = (r: TableRow | undefined) => (r ? { participantId: r.teamId, club: r.name, manager: byId.get(r.teamId)?.name ?? '', points: r.points } : null);
  const gks = stats.filter((s) => s.isGk && s.apps > 0).sort((a, b) => b.cleanSheets - a.cleanSheets || (a.conceded / Math.max(1, a.apps)) - (b.conceded / Math.max(1, b.apps)) || b.saves - a.saves);
  const attack = [...table].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  const defence = [...table].sort((a, b) => a.goalsAgainst - b.goalsAgainst)[0];
  const spent = q.all<{ participant_id: number; n: number; s: number }>(ctx.db, 'SELECT participant_id, COUNT(*) AS n, SUM(price) AS s FROM squad_players WHERE room_id = ? AND season = ? GROUP BY participant_id', room.id, room.season);
  return {
    season: room.season, table,
    champion: pick(table[0]), runnerUp: pick(table[1]),
    topScorer: [...stats].sort((a, b) => b.goals - a.goals || b.assists - a.assists)[0] ?? null,
    mostAssists: [...stats].sort((a, b) => b.assists - a.assists || b.goals - a.goals)[0] ?? null,
    bestGoalkeeper: gks[0] ?? null,
    bestAttack: attack ? { participantId: attack.teamId, club: attack.name, goals: attack.goalsFor } : null,
    bestDefence: defence ? { participantId: defence.teamId, club: defence.name, conceded: defence.goalsAgainst } : null,
    managers: table.map((r) => ({
      participantId: r.teamId, manager: byId.get(r.teamId)?.name ?? '', club: r.name, position: r.position, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
      goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, points: r.points,
      topScorer: stats.filter((s) => s.participantId === r.teamId).sort((a, b) => b.goals - a.goals)[0]?.name ?? null,
      squadSize: spent.find((s) => s.participant_id === r.teamId)?.n ?? 0, spent: spent.find((s) => s.participant_id === r.teamId)?.s ?? 0,
    })),
  };
}

/* ---------------------------------------------------------------- match view & new season */

export function getMatch(ctx: Ctx, roomId: string, fixtureId: string) {
  const f = q.get<FixtureRow>(ctx.db, 'SELECT * FROM fixtures WHERE id = ? AND room_id = ?', fixtureId, roomId);
  if (!f) throw new GameError('not_found', 'Fixture not found.');
  if (f.status !== 'played' || !f.result) return { fixtureId, played: false as const };
  const stored = JSON.parse(f.result) as StoredResult;
  const names = new Map(q.all<{ id: number; name: string; position: string; overall: number }>(ctx.db, 'SELECT id, name, position, overall FROM players').map((p) => [p.id, p]));
  const side = (u: UsedSide) => ({
    formation: u.formation, tactics: u.tactics, auto: u.auto,
    starters: u.starters.map((id) => names.get(id)), bench: u.bench.map((id) => names.get(id)),
  });
  return {
    fixtureId, played: true as const, round: f.round, key: f.key, homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals,
    events: stored.events, homeStats: stored.homeStats, awayStats: stored.awayStats, players: stored.players, home: side(stored.home), away: side(stored.away),
  };
}

export function newSeason(ctx: Ctx, roomId: string, hostId: number, mode: 'keep' | 'reset') {
  tx(ctx.db, () => {
    requireHost(ctx, roomId, hostId);
    const room = getRoom(ctx, roomId); requirePhase(room, 'season_end');
    const prev = room.season; const next = prev + 1;
    q.run(ctx.db, 'UPDATE rooms SET season = ? WHERE id = ?', next, roomId);
    q.run(ctx.db, "INSERT INTO seasons (room_id, season, status) VALUES (?, ?, 'setup')", roomId, next);
    const nextRoom = getRoom(ctx, roomId);
    if (mode === 'keep') {
      // Squads and remaining budgets carry forward; fitness resets; schedule is regenerated for the new season.
      q.run(ctx.db, "INSERT INTO squad_players (room_id, season, participant_id, player_id, price, condition, source) SELECT room_id, ?, participant_id, player_id, price, 100, 'carried' FROM squad_players WHERE room_id = ? AND season = ?", next, roomId, prev);
      createSchedule(ctx, nextRoom);
    } else {
      // Fresh start: clubs are kept, budgets reset to the full amount, a new auction is held from the lobby.
      q.run(ctx.db, 'UPDATE participants SET budget = ?, ready = CASE WHEN is_host = 1 THEN 1 ELSE 0 END WHERE room_id = ?', room.cfg.budget, roomId);
      q.run(ctx.db, "UPDATE rooms SET phase = 'lobby' WHERE id = ?", roomId);
    }
    bump(ctx, roomId);
  });
  ctx.notify(roomId, 'snapshot');
}
