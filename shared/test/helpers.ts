import { FORMATIONS, autoPickLineup, resolveLineup, DEFAULT_TACTICS } from '../src';
import type { FormationId, Position, SimPlayer, SimTeam, Tactics } from '../src';

let nextId = 1;
export function mkPlayer(pos: Position, overall: number, extra: Partial<SimPlayer> = {}): SimPlayer {
  const attr = (base: number) => Math.max(20, Math.min(99, base));
  const att = pos === 'ST' || pos === 'LW' || pos === 'RW';
  const def = pos === 'CB' || pos === 'LB' || pos === 'RB';
  return {
    id: nextId++, name: `P${nextId}`, nationality: 'Testland', clubName: `Club${nextId}`, position: pos, secondary: [],
    overall, pace: attr(overall), shooting: attr(att ? overall + 3 : overall - 15), passing: attr(overall - 5),
    defending: attr(def ? overall + 3 : overall - 25), physical: attr(overall - 3), condition: 100, ...extra,
  };
}

/** A balanced 25-man squad where every player has rating `r` (keepers rated `r`). */
export function mkSquad(r: number): SimPlayer[] {
  const layout: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CDM', 'CM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST', 'ST', 'CB', 'CM', 'LW', 'RB'];
  return layout.map((p) => mkPlayer(p, r));
}

export function mkTeam(id: number, squad: SimPlayer[], formation: FormationId = '4-3-3', tactics: Partial<Tactics> = {}): SimTeam {
  const lineup = autoPickLineup(squad, formation);
  const res = resolveLineup(lineup, squad);
  if (!res) throw new Error('auto lineup invalid');
  return { teamId: id, name: `Team${id}`, formation, tactics: { ...DEFAULT_TACTICS, ...tactics }, starters: res.starters, bench: res.bench };
}
export { FORMATIONS };
