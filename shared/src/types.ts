export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';
export const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2' | '3-4-3' | '4-1-4-1' | '5-3-2';
export const FORMATION_IDS: FormationId[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '3-4-3', '4-1-4-1', '5-3-2'];

export interface SimPlayer {
  id: number;
  name: string;
  nationality: string;
  clubName: string;
  position: Position;
  secondary: Position[];
  overall: number;
  pace: number;
  shooting: number;
  passing: number;
  defending: number;
  physical: number;
  /** 0-100. 100 = fully fit. */
  condition: number;
}

export type Mentality = 'very_defensive' | 'defensive' | 'balanced' | 'attacking' | 'very_attacking';
export type BuildUp = 'short' | 'balanced' | 'direct';
export type Pressing = 'low' | 'medium' | 'high';
export type DefLine = 'deep' | 'balanced' | 'high';
export type Width = 'narrow' | 'balanced' | 'wide';
export type PassRisk = 'safe' | 'balanced' | 'risky';

export interface Tactics {
  mentality: Mentality;
  buildUp: BuildUp;
  pressing: Pressing;
  defensiveLine: DefLine;
  width: Width;
  passingRisk: PassRisk;
  counterAttack: boolean;
  setPieceTakerId: number | null;
  captainId: number | null;
}

export const DEFAULT_TACTICS: Tactics = {
  mentality: 'balanced',
  buildUp: 'balanced',
  pressing: 'medium',
  defensiveLine: 'balanced',
  width: 'balanced',
  passingRisk: 'balanced',
  counterAttack: false,
  setPieceTakerId: null,
  captainId: null,
};

/** A lineup: slots[i] is the player id placed in formation slot i (null = empty). */
export interface Lineup {
  formation: FormationId;
  slots: (number | null)[];
  bench: number[];
}

export interface SimTeam {
  teamId: number;
  name: string;
  formation: FormationId;
  tactics: Tactics;
  /** Exactly 11, ordered by formation slot. */
  starters: SimPlayer[];
  bench: SimPlayer[];
}

export type EventType =
  | 'kickoff' | 'shot' | 'save' | 'goal' | 'miss' | 'foul' | 'yellow' | 'red' | 'sub' | 'penalty' | 'penalty_miss' | 'halftime' | 'fulltime';

export interface MatchEvent {
  minute: number;
  type: EventType;
  side: 'home' | 'away' | null;
  playerId?: number;
  playerName?: string;
  assistId?: number;
  assistName?: string;
  /** For subs: player coming on. */
  inId?: number;
  inName?: string;
  text: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamMatchStats {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passAccuracy: number;
  fouls: number;
  yellows: number;
  reds: number;
  saves: number;
  corners: number;
}

export interface PlayerMatchStats {
  playerId: number;
  name: string;
  side: 'home' | 'away';
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  saves: number;
  shots: number;
  cleanSheet: boolean;
  goalsConceded: number;
  isGK: boolean;
  /** Stamina at the end of the match (or when subbed/sent off); feeds next matchday's condition. */
  endCondition: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  homeStats: TeamMatchStats;
  awayStats: TeamMatchStats;
  players: PlayerMatchStats[];
  seed: number;
}
