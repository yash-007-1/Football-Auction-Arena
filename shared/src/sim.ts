import { FORMATIONS, lineOf } from './formations';
import { positionPenalty } from './positions';
import { Rng } from './rng';
import type {
  MatchEvent, MatchResult, Mentality, PlayerMatchStats, Position, SimPlayer, SimTeam, Tactics, TeamMatchStats,
} from './types';

/** How much each formation slot contributes to attack / midfield / defence. */
const SLOT_WEIGHTS: Record<Position, { att: number; mid: number; def: number }> = {
  GK: { att: 0, mid: 0, def: 0 },
  CB: { att: 0, mid: 0.05, def: 1.0 },
  LB: { att: 0.15, mid: 0.25, def: 0.65 },
  RB: { att: 0.15, mid: 0.25, def: 0.65 },
  CDM: { att: 0.08, mid: 0.6, def: 0.5 },
  CM: { att: 0.25, mid: 0.8, def: 0.25 },
  LM: { att: 0.5, mid: 0.5, def: 0.15 },
  RM: { att: 0.5, mid: 0.5, def: 0.15 },
  CAM: { att: 0.7, mid: 0.6, def: 0.05 },
  LW: { att: 0.95, mid: 0.25, def: 0 },
  RW: { att: 0.95, mid: 0.25, def: 0 },
  ST: { att: 1.0, mid: 0.1, def: 0 },
};

const MENTALITY_IDX: Record<Mentality, number> = { very_defensive: -2, defensive: -1, balanced: 0, attacking: 1, very_attacking: 2 };
const MAX_SUBS = 5;
const SUB_WINDOWS: { minute: number; count: number }[] = [{ minute: 60, count: 2 }, { minute: 72, count: 2 }, { minute: 82, count: 1 }];

interface Active {
  player: SimPlayer;
  slot: number;
  pos: Position;
  stamina: number;
  from: number;
  to: number | null;
  yellows: number;
  sentOff: boolean;
  stats: PlayerMatchStats;
}

export interface TeamRatings {
  attack: number; midfield: number; defence: number; goalkeeper: number; chemistry: number; overall: number;
}

const stamMult = (s: number) => 0.88 + 0.12 * (Math.max(0, Math.min(100, s)) / 100);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function skills(p: SimPlayer, pos: Position, stamina: number) {
  const pen = positionPenalty(p, pos);
  const k = Math.max(0.3, (p.overall - pen) / p.overall);
  const fm = stamMult(stamina);
  return {
    att: k * (0.5 * p.overall + 0.3 * p.shooting + 0.1 * p.pace + 0.1 * p.passing) * fm,
    mid: k * (0.5 * p.overall + 0.35 * p.passing + 0.15 * p.physical) * fm,
    def: k * (0.5 * p.overall + 0.4 * p.defending + 0.1 * p.physical) * fm,
    gk: k * p.overall * fm,
    shoot: k * p.shooting * fm,
    pass: k * p.passing * fm,
  };
}

function chemistryOf(players: SimPlayer[]): number {
  let nat = 0; let club = 0;
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    if (players[i].nationality === players[j].nationality) nat++;
    if (players[i].clubName === players[j].clubName) club++;
  }
  return Math.min(2, nat * 0.08 + club * 0.15);
}

function fullDenominators(formation: SimTeam['formation']) {
  let att = 0; let mid = 0; let def = 0;
  for (const s of FORMATIONS[formation]) { const w = SLOT_WEIGHTS[s.pos]; att += w.att; mid += w.mid; def += w.def; }
  return { att, mid, def };
}

function lineStrengths(act: Active[], formation: SimTeam['formation']) {
  const den = fullDenominators(formation);
  let a = 0; let m = 0; let d = 0; let gk = 0; let gkFound = false;
  for (const x of act) {
    if (x.sentOff) continue;
    const w = SLOT_WEIGHTS[x.pos];
    const s = skills(x.player, x.pos, x.stamina);
    a += w.att * s.att; m += w.mid * s.mid; d += w.def * s.def;
    if (x.pos === 'GK') { gk = s.gk; gkFound = true; }
  }
  return { attack: a / den.att, midfield: m / den.mid, defence: d / den.def, goalkeeper: gkFound ? gk : 30 };
}

/** Preview ratings for the UI (no randomness, no home advantage, tactics not applied). */
export function computeTeamRatings(team: SimTeam): TeamRatings {
  const slots = FORMATIONS[team.formation];
  const act: Active[] = team.starters.map((p, i) => ({
    player: p, slot: i, pos: slots[i].pos, stamina: p.condition, from: 0, to: null, yellows: 0, sentOff: false,
    stats: blankStats(p, 'home'),
  }));
  const s = lineStrengths(act, team.formation);
  const chem = chemistryOf(team.starters);
  const overall = (s.attack + s.midfield + s.defence) / 3 * 0.85 + s.goalkeeper * 0.15;
  return { ...s, chemistry: chem, overall };
}

interface Mods { att: number; mid: number; def: number; poss: number; tempo: number; foul: number; passAcc: number; drain: number }

function avgOf(act: Active[], pred: (p: Position) => boolean, f: (p: SimPlayer) => number, fallback: number): number {
  const xs = act.filter((a) => !a.sentOff && pred(a.pos)).map((a) => f(a.player));
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : fallback;
}

function tacticMods(t: Tactics, own: Active[], opp: Active[], oppT: Tactics, ownCentral: number, oppCentral: number, ownForm: SimTeam['formation'], home: boolean): Mods {
  const m: Mods = { att: 0, mid: 0, def: 0, poss: 0, tempo: 1, foul: 1, passAcc: 0, drain: 1 };
  const idx = MENTALITY_IDX[t.mentality];
  m.att += 2.5 * idx; m.def -= 2.0 * idx; m.tempo += 0.05 * idx; m.poss += 0.012 * idx;

  const attPhys = avgOf(own, (p) => lineOf(p) === 'ATT', (p) => p.physical, 70);
  const midPass = avgOf(own, (p) => lineOf(p) === 'MID', (p) => p.passing, 70);
  const attPace = avgOf(own, (p) => lineOf(p) === 'ATT', (p) => p.pace, 70);
  if (t.buildUp === 'short') { m.poss += 0.025 + Math.max(0, midPass - 70) * 0.0015; m.tempo *= 0.97; m.att += 0.3; m.passAcc += 0.03; }
  else if (t.buildUp === 'direct') { m.poss -= 0.03; m.tempo *= 1.07; m.att += clamp((attPhys - 70) * 0.04, -1, 1.5); m.passAcc -= 0.04; }

  if (t.pressing === 'low') { m.poss -= 0.015; m.foul *= 0.85; m.drain *= 0.8; }
  else if (t.pressing === 'high') { m.poss += 0.025; m.foul *= 1.3; m.drain *= 1.3; m.def -= 0.5; }

  if (t.defensiveLine === 'deep') { m.def += 1.4; m.poss -= 0.02; m.tempo *= 0.97; }
  else if (t.defensiveLine === 'high') { m.def -= 0.8; m.mid += 0.8; m.poss += 0.02; }

  if (t.passingRisk === 'risky') { m.tempo *= 1.05; m.att += 0.6; m.passAcc -= 0.06; }
  else if (t.passingRisk === 'safe') { m.tempo *= 0.95; m.att -= 0.4; m.passAcc += 0.04; }

  // Width matchup: wide attacks beat narrow defences, narrow attacks beat wide defences.
  if (t.width === 'wide') m.att += oppT.width === 'narrow' ? 1.0 : oppT.width === 'wide' ? -0.6 : 0.3;
  else if (t.width === 'narrow') { m.att += oppT.width === 'wide' ? 0.6 : oppT.width === 'narrow' ? -0.6 : 0; m.poss += 0.015; }

  // The opponent's high line leaves space behind for our pace; pressing opponents are beaten by direct play.
  if (oppT.defensiveLine === 'high') m.att += Math.max(0, (attPace - 68) * 0.06);
  if (oppT.pressing === 'high' && t.buildUp === 'direct') m.att += 0.8;
  if (oppT.pressing === 'high' && t.buildUp === 'short') m.att -= 0.5;

  if (t.counterAttack) { m.poss -= 0.025; m.att += 0.0; }

  // Formation shape.
  const slots = FORMATIONS[ownForm];
  const attackers = slots.reduce((s, x) => s + (x.pos === 'ST' || x.pos === 'LW' || x.pos === 'RW' ? 1 : x.pos === 'CAM' ? 0.5 : 0), 0);
  const defenders = slots.filter((x) => lineOf(x.pos) === 'DEF').length;
  m.att += 0.6 * (attackers - 2.5);
  m.def += 0.6 * (defenders - 4);
  m.poss += 0.012 * (ownCentral - oppCentral);

  if (home) { m.att += 1.5; m.def += 0.8; m.poss += 0.01; } else { m.att -= 0.3; }
  void opp;
  return m;
}

function blankStats(p: SimPlayer, side: 'home' | 'away'): PlayerMatchStats {
  return { playerId: p.id, name: p.name, side, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, saves: 0, shots: 0, cleanSheet: false, goalsConceded: 0, isGK: false, endCondition: p.condition };
}

function centralMids(formation: SimTeam['formation']): number {
  return FORMATIONS[formation].filter((s) => s.pos === 'CM' || s.pos === 'CDM' || s.pos === 'CAM').length;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function simulateMatch(home: SimTeam, away: SimTeam, seed: number): MatchResult {
  if (home.starters.length !== 11 || away.starters.length !== 11) throw new Error('Both teams need exactly 11 starters');
  const rng = new Rng(seed);
  const teams = { home, away } as const;
  type Side = 'home' | 'away';
  const mk = (t: SimTeam, side: Side): Active[] => t.starters.map((p, i) => {
    const st = blankStats(p, side);
    st.isGK = FORMATIONS[t.formation][i].pos === 'GK';
    return { player: p, slot: i, pos: FORMATIONS[t.formation][i].pos, stamina: p.condition, from: 0, to: null, yellows: 0, sentOff: false, stats: st };
  });
  const active: Record<Side, Active[]> = { home: mk(home, 'home'), away: mk(away, 'away') };
  const everyone: Record<Side, Active[]> = { home: [...active.home], away: [...active.away] };
  const bench: Record<Side, SimPlayer[]> = { home: [...home.bench], away: [...away.bench] };
  const subsUsed: Record<Side, number> = { home: 0, away: 0 };
  const formNoise: Record<Side, number> = { home: rng.normal() * 1.2, away: rng.normal() * 1.2 };
  const chem: Record<Side, number> = { home: chemistryOf(home.starters), away: chemistryOf(away.starters) };
  const central = { home: centralMids(home.formation), away: centralMids(away.formation) };

  const score = { home: 0, away: 0 };
  const events: MatchEvent[] = [];
  const stats: Record<Side, TeamMatchStats & { possMinutes: number; _passes: number; _acc: number }> = {
    home: { possession: 0, shots: 0, shotsOnTarget: 0, passes: 0, passAccuracy: 0, fouls: 0, yellows: 0, reds: 0, saves: 0, corners: 0, possMinutes: 0, _passes: 0, _acc: 0 },
    away: { possession: 0, shots: 0, shotsOnTarget: 0, passes: 0, passAccuracy: 0, fouls: 0, yellows: 0, reds: 0, saves: 0, corners: 0, possMinutes: 0, _passes: 0, _acc: 0 },
  };
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

  const push = (minute: number, type: MatchEvent['type'], side: Side | null, text: string, extra: Partial<MatchEvent> = {}) => {
    events.push({ minute, type, side, text, homeScore: score.home, awayScore: score.away, ...extra });
  };
  const gkOf = (s: Side) => active[s].find((a) => a.pos === 'GK' && !a.sentOff);

  push(0, 'kickoff', null, `Kick-off! ${home.name} vs ${away.name}.`);

  for (let minute = 1; minute <= 90; minute++) {
    // Substitutions happen at fixed windows.
    for (const w of SUB_WINDOWS) {
      if (minute !== w.minute) continue;
      for (const s of ['home', 'away'] as Side[]) {
        for (let n = 0; n < w.count && subsUsed[s] < MAX_SUBS && bench[s].length; n++) {
          const cands = active[s].filter((a) => !a.sentOff && a.pos !== 'GK');
          let bestSwap: { out: Active; inn: SimPlayer; gain: number } | null = null;
          for (const out of cands) {
            const curVal = out.player.overall * stamMult(out.stamina) - positionPenalty(out.player, out.pos) - out.yellows * 1.5;
            for (const inn of bench[s]) {
              if (inn.position === 'GK') continue;
              const val = inn.overall * stamMult(inn.condition) - positionPenalty(inn, out.pos);
              const gain = val - curVal;
              if (gain >= 0 && (!bestSwap || gain > bestSwap.gain)) bestSwap = { out, inn, gain };
            }
          }
          if (!bestSwap) break;
          const { out, inn } = bestSwap;
          out.to = minute; out.stats.minutes = minute - out.from; out.stats.endCondition = out.stamina;
          const st = blankStats(inn, s);
          const entry: Active = { player: inn, slot: out.slot, pos: out.pos, stamina: inn.condition, from: minute, to: null, yellows: 0, sentOff: false, stats: st };
          active[s] = active[s].map((a) => (a === out ? entry : a));
          everyone[s].push(entry);
          bench[s] = bench[s].filter((b) => b.id !== inn.id);
          subsUsed[s]++;
          push(minute, 'sub', s, `Substitution for ${teams[s].name}: ${inn.name} replaces ${out.player.name}.`, { playerId: out.player.id, playerName: out.player.name, inId: inn.id, inName: inn.name });
        }
      }
    }

    if (minute === 46) push(45, 'halftime', null, `Half-time: ${home.name} ${score.home}-${score.away} ${away.name}.`);

    const ls = { home: lineStrengths(active.home, home.formation), away: lineStrengths(active.away, away.formation) };
    const mods = {
      home: tacticMods(home.tactics, active.home, active.away, away.tactics, central.home, central.away, home.formation, true),
      away: tacticMods(away.tactics, active.away, active.home, home.tactics, central.away, central.home, away.formation, false),
    };
    const eff = (s: Side) => ({
      att: ls[s].attack + mods[s].att + chem[s] + formNoise[s],
      mid: ls[s].midfield + mods[s].mid + chem[s] + formNoise[s],
      def: ls[s].defence + mods[s].def + chem[s] + formNoise[s],
      gk: ls[s].goalkeeper,
    });
    const E = { home: eff('home'), away: eff('away') };

    // Counter-attacking converts when a side has less of the ball.
    const pHomeBase = clamp(0.5 + 0.0045 * (E.home.mid - E.away.mid) + mods.home.poss - mods.away.poss, 0.3, 0.7);
    const holder: Side = rng.chance(pHomeBase) ? 'home' : 'away';
    stats[holder].possMinutes++;
    const holderBuildUp = teams[holder].tactics.buildUp;
    const passesThisMin = (holderBuildUp === 'short' ? 8.6 : holderBuildUp === 'balanced' ? 7.4 : 6.0) * (0.9 + rng.next() * 0.2);
    stats[holder]._passes += passesThisMin;
    const acc = clamp(0.7 + (E[holder].mid - 70) * 0.004 + mods[holder].passAcc + (rng.next() - 0.5) * 0.02, 0.55, 0.93);
    stats[holder]._acc += passesThisMin * acc;

    const A = holder; const D = other(holder);
    let edge = (E[A].att + E[A].mid * 0.4) / 1.4 - (E[D].def + E[D].mid * 0.3) / 1.3;
    if (teams[A].tactics.counterAttack && (A === 'home' ? pHomeBase : 1 - pHomeBase) < 0.5) {
      const pace = avgOf(active[A], (p) => lineOf(p) === 'ATT', (p) => p.pace, 70);
      edge += 1.5 + Math.max(0, (pace - 70) * 0.05);
    }
    if (teams[D].tactics.pressing === 'high') edge -= 1.2;
    const tempo = mods[A].tempo * (A === 'home' ? 1 : 1);
    const pShot = clamp(0.27 * tempo * Math.exp(0.037 * edge), 0.05, 0.6);

    // stamina drain
    for (const s of ['home', 'away'] as Side[]) {
      const press = mods[s].drain;
      for (const a of active[s]) {
        if (a.sentOff) continue;
        const posF = a.pos === 'GK' ? 0.15 : a.pos === 'CB' ? 0.85 : a.pos === 'ST' ? 0.95 : 1.1;
        a.stamina = Math.max(5, a.stamina - 0.26 * press * posF * (1.12 - a.player.physical / 400));
      }
    }

    if (rng.chance(pShot)) {
      const shooters = active[A].filter((a) => !a.sentOff && a.pos !== 'GK');
      const shooter = rng.weighted(shooters, (a) => {
        const w = SLOT_WEIGHTS[a.pos].att; const sk = skills(a.player, a.pos, a.stamina);
        return Math.pow(w + 0.03, 2) * Math.pow(sk.shoot / 70, 3);
      });
      if (shooter) {
        shooter.stats.shots++; stats[A].shots++;
        const sk = skills(shooter.player, shooter.pos, shooter.stamina);
        const q = 0.5 * sk.shoot + 0.5 * E[A].att;
        const onTarget = rng.chance(clamp(0.34 + 0.004 * (q - 75), 0.22, 0.55));
        const gk = gkOf(D);
        if (!onTarget) {
          if (rng.chance(0.28)) stats[A].corners++;
          if (rng.chance(0.55)) push(minute, 'miss', A, rng.pick([
            `${shooter.player.name} fires wide for ${teams[A].name}.`,
            `${shooter.player.name} skies it over the bar.`,
            `${shooter.player.name} drags the shot just past the post.`,
            `A block! ${shooter.player.name}'s effort is charged down.`,
          ]), { playerId: shooter.player.id, playerName: shooter.player.name });
        } else {
          stats[A].shotsOnTarget++;
          const pGoal = clamp(sigmoid(-0.85 + 0.04 * (q - E[D].gk)), 0.08, 0.7);
          if (rng.chance(pGoal)) {
            score[A]++;
            shooter.stats.goals++;
            let assist: Active | null = null;
            if (rng.chance(0.7)) {
              const others = active[A].filter((a) => !a.sentOff && a !== shooter && a.pos !== 'GK');
              assist = rng.weighted(others, (a) => {
                const w = SLOT_WEIGHTS[a.pos]; const s2 = skills(a.player, a.pos, a.stamina);
                return (w.att + w.mid + 0.05) * Math.pow(s2.pass / 70, 2);
              });
              if (assist) assist.stats.assists++;
            }
            for (const a of active[D]) if (a.pos === 'GK' && !a.sentOff) a.stats.goalsConceded++;
            push(minute, 'goal', A,
              `GOAL! ${shooter.player.name} scores for ${teams[A].name}!${assist ? ` Assisted by ${assist.player.name}.` : ''} ${home.name} ${score.home}-${score.away} ${away.name}.`,
              { playerId: shooter.player.id, playerName: shooter.player.name, assistId: assist?.player.id, assistName: assist?.player.name });
          } else {
            stats[D].saves++;
            if (gk) gk.stats.saves++;
            if (rng.chance(0.35)) stats[A].corners++;
            push(minute, 'save', D, `${gk ? gk.player.name : 'The keeper'} saves ${shooter.player.name}'s shot for ${teams[D].name}.`,
              { playerId: gk?.player.id, playerName: gk?.player.name });
          }
        }
      }
    }

    // Penalties: more likely against a poorly organised defence.
    if (rng.chance(0.0011 * Math.exp(0.03 * edge))) {
      const takerPool = active[A].filter((a) => !a.sentOff && a.pos !== 'GK');
      const designated = takerPool.find((a) => a.player.id === teams[A].tactics.setPieceTakerId);
      const taker = designated ?? takerPool.slice().sort((x, y) => y.player.shooting - x.player.shooting)[0];
      const fouler = rng.weighted(active[D].filter((a) => !a.sentOff && a.pos !== 'GK'), (a) => (lineOf(a.pos) === 'DEF' ? 1 : 0.6));
      stats[D].fouls++;
      if (fouler) push(minute, 'foul', D, `Penalty to ${teams[A].name}! ${fouler.player.name} brings down an attacker in the box.`, { playerId: fouler.player.id, playerName: fouler.player.name });
      if (taker) {
        taker.stats.shots++; stats[A].shots++; stats[A].shotsOnTarget++;
        const gk = gkOf(D);
        const pConv = clamp(0.78 + (skills(taker.player, taker.pos, taker.stamina).shoot - E[D].gk) * 0.003, 0.6, 0.88);
        if (rng.chance(pConv)) {
          score[A]++; taker.stats.goals++;
          for (const a of active[D]) if (a.pos === 'GK' && !a.sentOff) a.stats.goalsConceded++;
          push(minute, 'penalty', A, `PENALTY SCORED! ${taker.player.name} converts for ${teams[A].name}. ${home.name} ${score.home}-${score.away} ${away.name}.`, { playerId: taker.player.id, playerName: taker.player.name });
        } else {
          stats[D].saves++;
          if (gk) gk.stats.saves++;
          push(minute, 'penalty_miss', A, `Penalty missed! ${taker.player.name} fails to score for ${teams[A].name}.`, { playerId: taker.player.id, playerName: taker.player.name });
        }
      }
    }

    // Fouls and cards, per side.
    for (const s of ['home', 'away'] as Side[]) {
      const pf = 0.115 * mods[s].foul;
      if (!rng.chance(pf)) continue;
      stats[s].fouls++;
      const fouler = rng.weighted(active[s].filter((a) => !a.sentOff && a.pos !== 'GK'), (a) => (a.pos === 'CDM' ? 1.5 : lineOf(a.pos) === 'DEF' ? 1.0 : lineOf(a.pos) === 'MID' ? 1.2 : 0.5));
      if (!fouler) continue;
      const pYellow = 0.15 + (teams[s].tactics.pressing === 'high' ? 0.04 : 0);
      if (rng.chance(0.003)) {
        fouler.sentOff = true; fouler.stats.red++; fouler.to = minute; fouler.stats.minutes = minute - fouler.from; fouler.stats.endCondition = fouler.stamina; stats[s].reds++;
        push(minute, 'red', s, `RED CARD! ${fouler.player.name} is sent off for ${teams[s].name} after a reckless challenge.`, { playerId: fouler.player.id, playerName: fouler.player.name });
      } else if (rng.chance(pYellow)) {
        fouler.yellows++; fouler.stats.yellow++; stats[s].yellows++;
        if (fouler.yellows >= 2) {
          fouler.sentOff = true; fouler.stats.red++; fouler.to = minute; fouler.stats.minutes = minute - fouler.from; fouler.stats.endCondition = fouler.stamina; stats[s].reds++;
          push(minute, 'red', s, `SECOND YELLOW! ${fouler.player.name} is sent off for ${teams[s].name}.`, { playerId: fouler.player.id, playerName: fouler.player.name });
        } else {
          push(minute, 'yellow', s, `Yellow card for ${fouler.player.name} (${teams[s].name}).`, { playerId: fouler.player.id, playerName: fouler.player.name });
        }
      }
    }
  }

  push(90, 'fulltime', null, `Full-time: ${home.name} ${score.home}-${score.away} ${away.name}.`);

  // Finalise player stats.
  const players: PlayerMatchStats[] = [];
  for (const s of ['home', 'away'] as Side[]) {
    for (const a of everyone[s]) {
      if (a.to === null) { a.stats.minutes = 90 - a.from; a.stats.endCondition = a.stamina; }
      const conceded = score[other(s)];
      if (a.stats.isGK) a.stats.cleanSheet = conceded === 0 && a.stats.minutes >= 60;
      players.push(a.stats);
    }
  }
  const finish = (s: Side): TeamMatchStats => {
    const x = stats[s];
    const total = stats.home.possMinutes + stats.away.possMinutes;
    return {
      possession: Math.round((x.possMinutes / total) * 100),
      shots: x.shots, shotsOnTarget: x.shotsOnTarget,
      passes: Math.round(x._passes),
      passAccuracy: x._passes ? Math.round((x._acc / x._passes) * 100) : 0,
      fouls: x.fouls, yellows: x.yellows, reds: x.reds, saves: x.saves, corners: x.corners,
    };
  };
  const hs = finish('home'); const as = finish('away');
  as.possession = 100 - hs.possession;
  return { homeGoals: score.home, awayGoals: score.away, events, homeStats: hs, awayStats: as, players, seed };
}
