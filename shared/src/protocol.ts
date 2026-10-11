import type { AuctionConfig } from './auction';
import type { FormationId, Lineup, MatchEvent, Tactics, TeamMatchStats, PlayerMatchStats } from './types';
import type { TableRow } from './table';

export interface RoomConfig extends AuctionConfig {
  intermissionSeconds: number;
  doubleRound: boolean;
  /** 0 = every player in the dataset. */
  poolSize: number;
  order: 'tiered' | 'random';
}

export type Phase = 'lobby' | 'auction' | 'review' | 'prepare' | 'league' | 'season_end';

export interface AuctionView {
  status: 'running' | 'between' | 'paused' | 'finished';
  lotSeq: number; playerId: number | null; startPrice: number | null; currentBid: number | null; highBidderId: number | null;
  endsAt: number | null; pausedRemainingMs: number | null; queueLength: number; minNextBid: number | null;
  lastResult: { seq: number; playerId: number; sold: boolean; winnerId: number | null; price: number | null } | null;
  recentBids: { participantId: number; amount: number; at: number }[];
  maxBids: Record<number, number>;
  soldCount: number; unsoldCount: number;
}
export interface ReviewTeam { participantId: number; size: number; ok: boolean; problems: string[]; spent: number }

export interface PlayerStatRow {
  playerId: number; participantId: number; name: string; position: string; apps: number; minutes: number; goals: number; assists: number;
  yellow: number; red: number; saves: number; cleanSheets: number; conceded: number; isGk: number;
}
export interface SeasonSummary {
  season: number;
  table: TableRow[];
  champion: { participantId: number; club: string; manager: string; points: number } | null;
  runnerUp: { participantId: number; club: string; manager: string; points: number } | null;
  topScorer: PlayerStatRow | null; mostAssists: PlayerStatRow | null; bestGoalkeeper: PlayerStatRow | null;
  bestAttack: { participantId: number; club: string; goals: number } | null;
  bestDefence: { participantId: number; club: string; conceded: number } | null;
  managers: { participantId: number; manager: string; club: string; position: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number; topScorer: string | null; squadSize: number; spent: number }[];
}

export interface SnapshotParticipant { id: number; name: string; clubId: number | null; ready: boolean; connected: boolean; isHost: boolean; budget: number; squadSize: number; spent: number }
export interface SquadEntry { playerId: number; participantId: number; price: number; condition: number }
export interface FixtureView { id: string; key: string; round: number; homeId: number; awayId: number; status: 'scheduled' | 'played'; homeGoals: number | null; awayGoals: number | null }
export interface MyMatch {
  fixtureId: string; round: number; opponentId: number; home: boolean; lineup: Lineup; tactics: Tactics; auto: boolean;
  errors: string[]; warnings: string[];
}
export interface SeasonView { status: 'setup' | 'prepare' | 'running' | 'finished'; currentRound: number; roundSimulated: boolean; totalRounds: number; locked: boolean; byes: Record<number, number> }

export interface Snapshot {
  version: number; serverNow: number;
  room: { code: string; phase: Phase; season: number; config: RoomConfig; canStart: { ok: boolean; reasons: string[] } };
  me: { participantId: number; isHost: boolean; editableRound: number | null; match: MyMatch | null; bye: boolean };
  participants: SnapshotParticipant[];
  squads: SquadEntry[];
  auction: AuctionView | null;
  review: ReviewTeam[] | null;
  season: SeasonView;
  fixtures: FixtureView[];
  table: TableRow[];
  positionChanges: Record<number, number>;
  stats: PlayerStatRow[];
  summary: SeasonSummary | null;
  history: { season: number; champion: SeasonSummary['champion']; runnerUp: SeasonSummary['runnerUp']; topScorer: string | null }[];
}
export interface AuctionPatch { version: number; serverNow: number; auction: AuctionView }

export interface MatchDetail {
  fixtureId: string; played: boolean; round?: number; key?: string; homeId?: number; awayId?: number; homeGoals?: number | null; awayGoals?: number | null;
  events?: MatchEvent[]; homeStats?: TeamMatchStats; awayStats?: TeamMatchStats; players?: PlayerMatchStats[];
  home?: { formation: FormationId; tactics: Tactics; auto: boolean; starters: ({ id: number; name: string; position: string; overall: number } | undefined)[]; bench: ({ id: number; name: string; position: string; overall: number } | undefined)[] };
  away?: MatchDetail['home'];
}

export interface CatalogPlayer {
  id: number; name: string; nationality: string; age: number; position: string; secondary: string[]; overall: number;
  pace: number; shooting: number; passing: number; defending: number; physical: number; clubId: number; clubName: string; league: string; startPrice: number; photoUrl: string | null;
}
export interface CatalogClub { id: number; name: string; short: string; league: string; color1: string; color2: string; logoUrl: string | null; players: number }
export interface DatasetInfo { name: string; season: string; lastUpdated: string; provenance: string; caveat: string }

export type Action =
  | { type: 'lobby.setClub'; clubId: number | null }
  | { type: 'lobby.ready'; ready: boolean }
  | { type: 'lobby.settings'; settings: Partial<Omit<RoomConfig, 'budget' | 'minPlayerPrice'>> }
  | { type: 'lobby.kick'; participantId: number }
  | { type: 'lobby.transferHost'; participantId: number }
  | { type: 'lobby.leave' }
  | { type: 'lobby.start' }
  | { type: 'auction.bid'; amount: number; nonce: string }
  | { type: 'auction.pause' } | { type: 'auction.resume' } | { type: 'auction.end' }
  | { type: 'review.autofill' } | { type: 'review.reopen' } | { type: 'review.proceed' }
  | { type: 'league.start' } | { type: 'league.simulate' } | { type: 'league.next' }
  | { type: 'lineup.save'; lineup: Lineup }
  | { type: 'tactics.save'; tactics: Tactics }
  | { type: 'season.new'; mode: 'keep' | 'reset' };

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; code: string };
