import { useMemo, useState } from 'react';
import { Crest, Empty, PosTag, Tabs, type Game } from '../ui';

type Key = 'goals' | 'assists' | 'apps' | 'yellow' | 'red' | 'saves' | 'cleanSheets';

export default function Stats({ game }: { game: Game }) {
  const { snap, catalog, clubOf } = game;
  const [sort, setSort] = useState<Key>('goals');
  const [team, setTeam] = useState<'all' | number>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => snap.stats.filter((s) => (team === 'all' || s.participantId === team) && s.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b[sort] - a[sort] || b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name)).slice(0, 100), [snap.stats, sort, team, q]);

  if (snap.stats.length === 0) return <Empty title="No statistics yet">Goals, assists, cards and saves appear after the first matchday is played.</Empty>;
  const leader = (k: Key) => [...snap.stats].sort((a, b) => b[k] - a[k])[0];
  const cards: { k: Key; label: string }[] = [{ k: 'goals', label: 'Top scorer' }, { k: 'assists', label: 'Most assists' }, { k: 'cleanSheets', label: 'Most clean sheets' }, { k: 'saves', label: 'Most saves' }];
  const th = (k: Key, label: string) => <th className="text-right"><button className={`font-medium ${sort === k ? 'text-pitch-300' : 'hover:text-mist-100'}`} onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</button></th>;

  return (
    <div className="space-y-4">
      <h1 className="h-page">Player statistics</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(({ k, label }) => { const l = leader(k); return l && l[k] > 0 ? (
          <div key={k} className="panel-pad"><div className="text-sm muted">{label}</div><div className="num text-4xl font-bold text-gold-400">{l[k]}</div><div className="font-semibold truncate">{l.name}</div><div className="text-xs muted flex items-center gap-1.5"><Crest club={clubOf(l.participantId)} size={16} />{clubOf(l.participantId)?.name}</div></div>) : null; })}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input aria-label="Search players" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} className="!w-auto flex-1 min-w-[10rem]" />
        <select aria-label="Team" value={String(team)} onChange={(e) => setTeam(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="!w-auto"><option value="all">All teams</option>{snap.participants.map((p) => <option key={p.id} value={p.id}>{clubOf(p.id)?.name ?? p.name}</option>)}</select>
      </div>
      <Tabs value={sort} onChange={setSort} items={[{ id: 'goals', label: 'Goals' }, { id: 'assists', label: 'Assists' }, { id: 'apps', label: 'Appearances' }, { id: 'cleanSheets', label: 'Clean sheets' }, { id: 'saves', label: 'Saves' }, { id: 'yellow', label: 'Yellow cards' }]} />
      <div className="panel overflow-x-auto">
        <table>
          <thead><tr><th className="w-8">#</th><th>Player</th><th>Team</th>{th('apps', 'Apps')}<th className="text-right">Mins</th>{th('goals', 'Goals')}{th('assists', 'Assists')}{th('yellow', 'Yellow')}{th('red', 'Red')}{th('saves', 'Saves')}{th('cleanSheets', 'Clean sheets')}</tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={`${s.playerId}-${s.participantId}`}>
                <td className="num text-mist-400">{i + 1}</td>
                <td className="font-semibold"><span className="inline-flex items-center gap-2">{s.name}<PosTag pos={s.position} /></span><span className="block text-xs font-normal muted">{catalog.playerById.get(s.playerId)?.nationality}</span></td>
                <td><span className="inline-flex items-center gap-2"><Crest club={clubOf(s.participantId)} size={20} />{clubOf(s.participantId)?.name}</span></td>
                <td className="num text-right">{s.apps}</td><td className="num text-right text-mist-400">{s.minutes}</td>
                <td className="num text-right font-bold">{s.goals}</td><td className="num text-right">{s.assists}</td><td className="num text-right">{s.yellow}</td><td className="num text-right">{s.red}</td>
                <td className="num text-right">{s.isGk ? s.saves : '–'}</td><td className="num text-right">{s.isGk ? s.cleanSheets : '–'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="text-center muted py-6">No players match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
