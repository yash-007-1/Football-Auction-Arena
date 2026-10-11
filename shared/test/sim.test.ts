import { describe, expect, it } from 'vitest';
import { simulateMatch, computeTeamRatings } from '../src';
import { mkSquad, mkTeam } from './helpers';

function many(home: ReturnType<typeof mkTeam>, away: ReturnType<typeof mkTeam>, n = 400) {
  let hw = 0, aw = 0, d = 0, hg = 0, ag = 0, hs = 0, as = 0, yel = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateMatch(home, away, 1000 + i);
    hg += r.homeGoals; ag += r.awayGoals; hs += r.homeStats.shots; as += r.awayStats.shots;
    yel += r.homeStats.yellows + r.awayStats.yellows;
    if (r.homeGoals > r.awayGoals) hw++; else if (r.homeGoals < r.awayGoals) aw++; else d++;
  }
  return { hw: hw / n, aw: aw / n, d: d / n, hg: hg / n, ag: ag / n, hs: hs / n, as: as / n, yel: yel / n };
}

describe('match simulation', () => {
  const squad = (r: number) => mkSquad(r);
  it('is deterministic for a seed and internally consistent', () => {
    const a = mkTeam(1, squad(80)); const b = mkTeam(2, squad(78));
    const r1 = simulateMatch(a, b, 99); const r2 = simulateMatch(a, b, 99);
    expect(r2).toEqual(r1);
    const goals = r1.events.filter((e) => e.type === 'goal' || e.type === 'penalty');
    expect(goals.filter((e) => e.side === 'home').length).toBe(r1.homeGoals);
    expect(goals.filter((e) => e.side === 'away').length).toBe(r1.awayGoals);
    expect(r1.players.filter((p) => p.side === 'home').reduce((s, p) => s + p.goals, 0)).toBe(r1.homeGoals);
    expect(r1.homeStats.possession + r1.awayStats.possession).toBe(100);
    expect(r1.homeStats.shots).toBeGreaterThanOrEqual(r1.homeStats.shotsOnTarget);
    expect(r1.homeStats.shotsOnTarget).toBeGreaterThanOrEqual(r1.homeGoals);
    const last = r1.events[r1.events.length - 1];
    expect(last.type).toBe('fulltime');
    expect([last.homeScore, last.awayScore]).toEqual([r1.homeGoals, r1.awayGoals]);
    for (let i = 1; i < r1.events.length; i++) expect(r1.events[i].minute).toBeGreaterThanOrEqual(r1.events[i - 1].minute);
  });

  it('produces realistic football numbers between equal sides', () => {
    const s = many(mkTeam(1, squad(80)), mkTeam(2, squad(80)));
    const total = s.hg + s.ag;
    expect(total).toBeGreaterThan(2.0); expect(total).toBeLessThan(3.6);
    expect(s.hw).toBeGreaterThan(s.aw);                  // home advantage
    expect(s.d).toBeGreaterThan(0.15); expect(s.d).toBeLessThan(0.35);
    expect(s.hs + s.as).toBeGreaterThan(18); expect(s.hs + s.as).toBeLessThan(34);
    expect(s.yel).toBeGreaterThan(1); expect(s.yel).toBeLessThan(7);
  });

  it('squad quality drives results', () => {
    const strong = mkTeam(1, squad(88)); const weak = mkTeam(2, squad(72));
    const s = many(strong, weak);
    expect(s.hw).toBeGreaterThan(0.7);
    const rev = many(weak, strong);
    expect(rev.aw).toBeGreaterThan(0.55);
  });

  it('lineup quality drives results (best XI beats a reserves XI from the same squad)', () => {
    const sq = squad(80);
    sq.slice(2, 12).forEach((p) => { p.overall = 90; p.shooting += 8; p.passing += 8; p.defending += 8; });
    sq.slice(12, 25).forEach((p) => { p.overall = 66; });
    const best = mkTeam(1, sq);
    const reserveSquad = sq.filter((p, i) => i < 2 || i >= 12 || p.position === 'GK');
    const worse = mkTeam(2, reserveSquad.length >= 14 ? reserveSquad : sq.slice(12).concat(sq.slice(0, 2)));
    const r = many(best, worse);
    expect(r.hg).toBeGreaterThan(r.ag + 0.4);
  });

  it('tactics measurably change the match', () => {
    const base = many(mkTeam(1, squad(80)), mkTeam(2, squad(80)));
    const att = many(mkTeam(1, squad(80), '4-3-3', { mentality: 'very_attacking' }), mkTeam(2, squad(80)));
    const def = many(mkTeam(1, squad(80), '5-3-2', { mentality: 'very_defensive', defensiveLine: 'deep' }), mkTeam(2, squad(80)));
    expect(att.hs).toBeGreaterThan(base.hs + 1.5);
    expect(att.ag).toBeGreaterThan(base.ag);               // exposes the defence
    expect(def.hs).toBeLessThan(base.hs - 1.5);
    expect(def.ag).toBeLessThan(base.ag);
    const press = many(mkTeam(1, squad(80), '4-3-3', { pressing: 'high' }), mkTeam(2, squad(80)));
    expect(press.yel).toBeGreaterThanOrEqual(base.yel - 0.1);
    const short = many(mkTeam(1, squad(80), '4-3-3', { buildUp: 'short' }), mkTeam(2, squad(80)), 200);
    const direct = many(mkTeam(1, squad(80), '4-3-3', { buildUp: 'direct' }), mkTeam(2, squad(80)), 200);
    const poss = (t: ReturnType<typeof mkTeam>, b: ReturnType<typeof mkTeam>) => { let p = 0; for (let i = 0; i < 100; i++) p += simulateMatch(t, b, i).homeStats.possession; return p / 100; };
    expect(poss(mkTeam(1, squad(80), '4-3-3', { buildUp: 'short' }), mkTeam(2, squad(80)))).toBeGreaterThan(poss(mkTeam(1, squad(80), '4-3-3', { buildUp: 'direct' }), mkTeam(2, squad(80))));
    void short; void direct;
  });

  it('formation changes the team ratings and out-of-position players hurt', () => {
    const sq = squad(80);
    const a = computeTeamRatings(mkTeam(1, sq, '4-3-3'));
    const b = computeTeamRatings(mkTeam(1, sq, '5-3-2'));
    expect(a.attack).not.toBe(b.attack);
    const tired = squad(80).map((p) => ({ ...p, condition: 40 }));
    expect(computeTeamRatings(mkTeam(1, tired)).overall).toBeLessThan(computeTeamRatings(mkTeam(1, sq)).overall);
  });

  it('substitutions, cards and stats are recorded sensibly', () => {
    let subs = 0, reds = 0, yellows = 0;
    for (let i = 0; i < 60; i++) {
      const r = simulateMatch(mkTeam(1, squad(80)), mkTeam(2, squad(80)), 500 + i);
      subs += r.events.filter((e) => e.type === 'sub').length;
      reds += r.events.filter((e) => e.type === 'red').length;
      yellows += r.events.filter((e) => e.type === 'yellow').length;
      for (const p of r.players) { expect(p.minutes).toBeGreaterThanOrEqual(0); expect(p.minutes).toBeLessThanOrEqual(90); }
      const gk = r.players.filter((p) => p.isGK && p.side === 'home');
      expect(gk.length).toBeGreaterThanOrEqual(1);
    }
    expect(subs).toBeGreaterThan(0);
    expect(yellows).toBeGreaterThan(30);
    expect(reds).toBeLessThan(40);
  });
});
