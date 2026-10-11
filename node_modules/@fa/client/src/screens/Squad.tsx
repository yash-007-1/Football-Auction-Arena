import { useMemo, useState } from 'react';
import { lineOf, type Position } from '@fa/shared';
import { Condition, Empty, PosTag, Rating, Tabs, money, type Game } from '../ui';
import { go } from '../App';

type Sort = 'overall' | 'position' | 'price' | 'age' | 'condition';
const ORDER = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];

export default function Squad({ game }: { game: Game }) {
  const { snap, catalog, me } = game;
  const [line, setLine] = useState<'all' | 'GK' | 'DEF' | 'MID' | 'ATT'>('all');
  const [sort, setSort] = useState<Sort>('overall');
  const lineup = snap.me.match?.lineup;
  const starting = new Set(lineup?.slots ?? []); const bench = new Set(lineup?.bench ?? []);

  const rows = useMemo(() => snap.squads.filter((s) => s.participantId === me.id).map((s) => ({ s, p: catalog.playerById.get(s.playerId)! })).filter((x) => x.p)
    .filter((x) => line === 'all' || lineOf(x.p.position as Position) === line)
    .sort((a, b) => sort === 'overall' ? b.p.overall - a.p.overall : sort === 'price' ? b.s.price - a.s.price : sort === 'age' ? a.p.age - b.p.age : sort === 'condition' ? a.s.condition - b.s.condition : ORDER.indexOf(a.p.position) - ORDER.indexOf(b.p.position) || b.p.overall - a.p.overall), [snap.squads, catalog, me.id, line, sort]);

  const total = snap.squads.filter((s) => s.participantId === me.id);
  if (total.length === 0) return <Empty title="You have no players yet">Players you win in the auction appear here.</Empty>;
  const th = (id: Sort, label: string, cls = '') => <th className={cls}><button className={`font-medium hover:text-mist-100 ${sort === id ? 'text-pitch-300' : ''}`} onClick={() => setSort(id)} aria-label={`Sort by ${label}`}>{label}{sort === id ? ' ↓' : ''}</button></th>;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="h-page">My squad</h1><p className="muted mt-1">{total.length} players · {money(me.spent)} spent · {money(me.budget)} left</p></div>
        {snap.me.match && <button className="btn-primary" onClick={() => go('lineup')}>Pick starting XI</button>}
      </div>
      <Tabs value={line} onChange={setLine} items={[{ id: 'all', label: 'Everyone' }, { id: 'GK', label: 'Goalkeepers' }, { id: 'DEF', label: 'Defenders' }, { id: 'MID', label: 'Midfielders' }, { id: 'ATT', label: 'Forwards' }]} />
      <div className="panel overflow-x-auto">
        <table>
          <thead><tr><th>Player</th>{th('position', 'Pos')}{th('overall', 'OVR')}<th className="text-right">PAC</th><th className="text-right">SHO</th><th className="text-right">PAS</th><th className="text-right">DEF</th><th className="text-right">PHY</th>{th('age', 'Age')}{th('condition', 'Condition')}{th('price', 'Paid', 'text-right')}<th>Next match</th></tr></thead>
          <tbody>
            {rows.map(({ s, p }) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.name}<span className="block text-xs font-normal muted">{p.nationality} · {p.clubName}</span></td>
                <td><PosTag pos={p.position} />{p.secondary.length > 0 && <span className="text-xs muted ml-1">{p.secondary.join('/')}</span>}</td>
                <td><Rating value={p.overall} /></td>
                <td className="num text-right">{p.pace}</td><td className="num text-right">{p.shooting}</td><td className="num text-right">{p.passing}</td><td className="num text-right">{p.defending}</td><td className="num text-right">{p.physical}</td>
                <td className="num">{p.age}</td>
                <td><Condition value={s.condition} /> <span className="text-xs muted">{s.condition}%</span></td>
                <td className="num text-right text-gold-300">{money(s.price)}</td>
                <td className="text-sm">{!lineup ? '—' : starting.has(p.id) ? <span className="text-pitch-300">Starting</span> : bench.has(p.id) ? 'Bench' : <span className="text-mist-500">Not in squad</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
