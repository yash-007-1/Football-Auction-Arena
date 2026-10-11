import { useEffect, useState } from 'react';
import { ask } from '../store';
import { Crest, Empty, PosTag, Spinner, Tabs, money, type Game } from '../ui';

interface Row { seq: number; playerId: number; startPrice: number; status: string; winnerId: number | null; price: number | null; at: number }

export default function History({ game }: { game: Game }) {
  const { snap, catalog, clubOf, byId } = game;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sold' | 'unsold' | 'mine'>('all');
  const tally = snap.auction ? `${snap.auction.soldCount}-${snap.auction.unsoldCount}-${snap.auction.lotSeq}` : '0';

  useEffect(() => {
    let live = true;
    void ask<Row[]>('history').then((r) => { if (!live) return; if (r.ok) { setRows(r.data ?? []); setErr(null); } else setErr(r.error); });
    return () => { live = false; };
  }, [tally, snap.room.phase]);

  if (err) return <Empty title="Could not load the history">{err}</Empty>;
  if (!rows) return <Spinner label="Loading auction history…" />;
  const shown = rows.filter((r) => filter === 'all' || (filter === 'sold' && r.status === 'sold') || (filter === 'unsold' && r.status === 'unsold') || (filter === 'mine' && r.winnerId === snap.me.participantId));
  const spent = rows.filter((r) => r.status === 'sold').reduce((n, r) => n + (r.price ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="h-page">Auction history</h1>
        <div className="text-sm muted">{rows.filter((r) => r.status === 'sold').length} sold · {rows.filter((r) => r.status === 'unsold').length} unsold · {money(spent)} spent in total</div>
      </div>
      <Tabs value={filter} onChange={setFilter} items={[{ id: 'all', label: 'All lots' }, { id: 'sold', label: 'Sold' }, { id: 'unsold', label: 'Unsold' }, { id: 'mine', label: 'My signings' }]} />
      {shown.length === 0 ? <Empty title="Nothing here yet">Results appear as each player is settled.</Empty> : (
        <div className="panel overflow-x-auto">
          <table>
            <thead><tr><th>Lot</th><th>Player</th><th>Pos</th><th>OVR</th><th className="text-right">Start</th><th>Result</th><th className="text-right">Price</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const p = catalog.playerById.get(r.playerId);
                const club = r.winnerId ? clubOf(r.winnerId) : undefined;
                return (
                  <tr key={r.seq}>
                    <td className="num text-mist-400">{r.seq}</td>
                    <td className="font-semibold">{p?.name ?? `#${r.playerId}`}<span className="block text-xs font-normal muted">{p?.clubName}</span></td>
                    <td>{p && <PosTag pos={p.position} />}</td>
                    <td className="num text-lg">{p?.overall}</td>
                    <td className="num text-right text-mist-400">{money(r.startPrice)}</td>
                    <td>{r.status === 'sold' ? <span className="inline-flex items-center gap-2"><Crest club={club} size={20} />{club?.name ?? byId.get(r.winnerId!)?.name}</span> : <span className="text-mist-500">Unsold</span>}</td>
                    <td className="num text-right text-gold-300 text-lg">{r.price !== null ? money(r.price) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
