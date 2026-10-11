import { positionChanges, validateLineup, type Lineup, type Tactics, DEFAULT_TACTICS, type Snapshot, type FormationId, type TableRow, type SeasonSummary } from '@fa/shared';
import { q } from '../db';
import { auctionView, reviewTeams, squadCounts } from './auction';
import { computeStandings, editableRound, getSeason, playerStats, type FixtureRow } from './league';
import { type Ctx, GameError, getParticipants, getRoom, loadSquad } from './types';

export function canStartAuction(ctx: Ctx, roomId: string): { ok: boolean; reasons: string[] } {
  const ps = getParticipants(ctx, roomId);
  const reasons: string[] = [];
  if (ps.length < 2) reasons.push('At least 2 managers are needed.');
  const noClub = ps.filter((p) => p.club_id === null);
  if (noClub.length) reasons.push(`Waiting for a club from: ${noClub.map((p) => p.name).join(', ')}.`);
  const notReady = ps.filter((p) => p.club_id !== null && !p.ready && !p.is_host);
  if (notReady.length) reasons.push(`Not ready: ${notReady.map((p) => p.name).join(', ')}.`);
  const away = ps.filter((p) => !p.connected);
  if (away.length) reasons.push(`Disconnected: ${away.map((p) => p.name).join(', ')}.`);
  return { ok: reasons.length === 0, reasons };
}

interface LineupRow { formation: FormationId; slots: string; bench: string; tactics: string; auto: number }

/** Full state for one participant. The server is authoritative: everything here is read from the database. */
export function buildSnapshot(ctx: Ctx, roomId: string, participantId: number): Snapshot {
  const room = getRoom(ctx, roomId);
  const season = getSeason(ctx, room);
  const ps = getParticipants(ctx, roomId);
  const me = ps.find((p) => p.id === participantId);
  if (!me) throw new GameError('not_found', 'You are not in this room.');
  const counts = squadCounts(ctx, roomId, room.season);
  const spentRows = q.all<{ participant_id: number; s: number }>(ctx.db, 'SELECT participant_id, SUM(price) AS s FROM squad_players WHERE room_id = ? AND season = ? GROUP BY participant_id', roomId, room.season);
  const spent = new Map(spentRows.map((r) => [r.participant_id, r.s]));

  const fixtures = q.all<FixtureRow>(ctx.db, 'SELECT id, key, round, home_id, away_id, status, home_goals, away_goals FROM fixtures WHERE room_id = ? AND season = ? ORDER BY round, key', roomId, room.season);

  // My upcoming match (lineup, tactics, validation messages).
  let match: Snapshot['me']['match'] = null;
  let bye = false;
  const er = editableRound(season);
  if (er !== null) {
    const f = fixtures.find((x) => x.round === er && x.status === 'scheduled' && (x.home_id === me.id || x.away_id === me.id));
    if (!f) bye = true;
    else {
      const row = q.get<LineupRow>(ctx.db, 'SELECT formation, slots, bench, tactics, auto FROM lineups WHERE fixture_id = ? AND participant_id = ?', f.id, me.id);
      if (row) {
        const lineup: Lineup = { formation: row.formation, slots: JSON.parse(row.slots), bench: JSON.parse(row.bench) };
        const check = validateLineup(lineup, loadSquad(ctx, roomId, room.season, me.id));
        match = {
          fixtureId: f.id, round: f.round, opponentId: f.home_id === me.id ? f.away_id : f.home_id, home: f.home_id === me.id, lineup,
          tactics: { ...DEFAULT_TACTICS, ...(JSON.parse(row.tactics) as Partial<Tactics>) }, auto: !!row.auto, errors: check.errors, warnings: check.warnings,
        };
      }
    }
  }

  // Table + position movement since the previous matchday.
  const table: TableRow[] = computeStandings(ctx, room);
  let changes: Record<number, number> = {};
  const lastPlayed = season.status === 'finished' ? season.total_rounds : season.round_simulated ? season.current_round : season.current_round - 1;
  if (lastPlayed >= 1) changes = positionChanges(computeStandings(ctx, room, lastPlayed - 1), computeStandings(ctx, room, lastPlayed));

  const archive = q.all<{ season: number; summary: string }>(ctx.db, 'SELECT season, summary FROM season_archive WHERE room_id = ? ORDER BY season DESC', roomId);
  const history = archive.filter((a) => a.season !== room.season || room.phase !== 'season_end').map((a) => {
    const s = JSON.parse(a.summary) as SeasonSummary;
    return { season: a.season, champion: s.champion, runnerUp: s.runnerUp, topScorer: s.topScorer?.name ?? null };
  });

  return {
    version: room.version, serverNow: ctx.now(),
    room: { code: room.code, phase: room.phase, season: room.season, config: room.cfg, canStart: room.phase === 'lobby' ? canStartAuction(ctx, roomId) : { ok: false, reasons: [] } },
    me: { participantId: me.id, isHost: !!me.is_host, editableRound: er, match, bye },
    participants: ps.map((p) => ({
      id: p.id, name: p.name, clubId: p.club_id, ready: !!p.ready, connected: !!p.connected, isHost: !!p.is_host,
      budget: p.budget, squadSize: counts.get(p.id) ?? 0, spent: spent.get(p.id) ?? 0,
    })),
    squads: q.all<{ player_id: number; participant_id: number; price: number; condition: number }>(ctx.db,
      'SELECT player_id, participant_id, price, condition FROM squad_players WHERE room_id = ? AND season = ? ORDER BY price DESC', roomId, room.season)
      .map((r) => ({ playerId: r.player_id, participantId: r.participant_id, price: r.price, condition: Math.round(r.condition) })),
    auction: auctionView(ctx, room),
    review: room.phase === 'review' ? reviewTeams(ctx, room) : null,
    season: { status: season.status, currentRound: season.current_round, roundSimulated: !!season.round_simulated, totalRounds: season.total_rounds, locked: !!season.schedule_locked, byes: JSON.parse(season.byes) },
    fixtures: fixtures.map((f) => ({ id: f.id, key: f.key, round: f.round, homeId: f.home_id, awayId: f.away_id, status: f.status, homeGoals: f.home_goals, awayGoals: f.away_goals })),
    table, positionChanges: changes,
    stats: room.phase === 'league' || room.phase === 'season_end' ? playerStats(ctx, roomId, room.season) : [],
    summary: season.summary ? (JSON.parse(season.summary) as SeasonSummary) : null,
    history,
  };
}
