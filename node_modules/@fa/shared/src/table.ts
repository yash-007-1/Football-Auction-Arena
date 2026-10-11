export interface TableTeam { id: number; name: string }
export interface PlayedResult { homeId: number; awayId: number; homeGoals: number; awayGoals: number }
export interface TableRow {
  position: number;
  teamId: number;
  name: string;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalDiff: number; points: number;
  form: ('W' | 'D' | 'L')[];
}

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const POINTS_LOSS = 0;

/**
 * League table. Order: points, goal difference, goals scored, head-to-head points among tied teams,
 * then club name A-Z as the final deterministic tie-breaker.
 * `results` must be in the order the matches were played (used for the form guide).
 */
export function computeTable(teams: TableTeam[], results: PlayedResult[]): TableRow[] {
  const rows = new Map<number, TableRow>();
  for (const t of teams) {
    rows.set(t.id, { position: 0, teamId: t.id, name: t.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [] });
  }
  for (const r of results) {
    const h = rows.get(r.homeId); const a = rows.get(r.awayId);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.goalsFor += r.homeGoals; h.goalsAgainst += r.awayGoals;
    a.goalsFor += r.awayGoals; a.goalsAgainst += r.homeGoals;
    if (r.homeGoals > r.awayGoals) { h.won++; a.lost++; h.points += POINTS_WIN; a.points += POINTS_LOSS; h.form.push('W'); a.form.push('L'); }
    else if (r.homeGoals < r.awayGoals) { a.won++; h.lost++; a.points += POINTS_WIN; h.points += POINTS_LOSS; a.form.push('W'); h.form.push('L'); }
    else { h.drawn++; a.drawn++; h.points += POINTS_DRAW; a.points += POINTS_DRAW; h.form.push('D'); a.form.push('D'); }
  }
  const list = [...rows.values()];
  for (const r of list) r.goalDiff = r.goalsFor - r.goalsAgainst;

  const h2h = (a: number, b: number): number => {
    let pa = 0; let pb = 0;
    for (const r of results) {
      const pair = (r.homeId === a && r.awayId === b) || (r.homeId === b && r.awayId === a);
      if (!pair) continue;
      const ag = r.homeId === a ? r.homeGoals : r.awayGoals;
      const bg = r.homeId === a ? r.awayGoals : r.homeGoals;
      if (ag > bg) pa += 3; else if (ag < bg) pb += 3; else { pa++; pb++; }
    }
    return pa - pb;
  };
  list.sort((x, y) =>
    y.points - x.points || y.goalDiff - x.goalDiff || y.goalsFor - x.goalsFor ||
    -h2h(x.teamId, y.teamId) || x.name.localeCompare(y.name));
  list.forEach((r, i) => { r.position = i + 1; r.form = r.form.slice(-5); });
  return list;
}

/** Position change per team between two tables (positive = moved up). */
export function positionChanges(prev: TableRow[], next: TableRow[]): Record<number, number> {
  const before = new Map(prev.map((r) => [r.teamId, r.position]));
  const out: Record<number, number> = {};
  for (const r of next) out[r.teamId] = (before.get(r.teamId) ?? r.position) - r.position;
  return out;
}
