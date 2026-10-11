import { useState } from 'react';
import type { FixtureView } from '@fa/shared';
import { go } from '../App';
import { Crest, type Game } from '../ui';

export function FixtureRow({ f, game, onOpen }: { f: FixtureView; game: Game; onOpen?: () => void }) {
  const { me, clubOf, byId } = game;
  const played = f.status === 'played';
  const mine = f.homeId === me.id || f.awayId === me.id;
  const side = (id: number, right = false) => (
    <span className={`flex items-center gap-2 min-w-0 flex-1 ${right ? 'justify-end text-right flex-row-reverse' : ''}`}>
      <Crest club={clubOf(id)} size={28} /><span className="min-w-0"><span className={`block truncate font-semibold ${id === me.id ? 'text-pitch-300' : ''}`}>{clubOf(id)?.name ?? byId.get(id)?.name}</span><span className="block text-xs muted truncate">{byId.get(id)?.name}</span></span>
    </span>
  );
  const inner = (
    <>
      {side(f.homeId)}
      <span className="num text-2xl font-bold w-24 text-center shrink-0">{played ? <span><span className={f.homeGoals! > f.awayGoals! ? 'text-gold-300' : ''}>{f.homeGoals}</span> – <span className={f.awayGoals! > f.homeGoals! ? 'text-gold-300' : ''}>{f.awayGoals}</span></span> : <span className="text-base text-mist-500 font-medium">vs</span>}</span>
      {side(f.awayId, true)}
    </>
  );
  const cls = `w-full flex items-center gap-2 px-3 py-2.5 ${mine ? 'bg-pitch-500/5' : ''}`;
  return played ? <button className={`${cls} text-left hover:bg-ink-600`} onClick={onOpen ?? (() => go('match', f.id))} aria-label="Open match centre">{inner}</button> : <div className={cls}>{inner}</div>;
}

export default function Fixtures({ game }: { game: Game }) {
  const { snap, byId, clubOf } = game;
  const total = snap.season.totalRounds;
  const [round, setRound] = useState(Math.max(1, Math.min(total || 1, snap.season.currentRound || 1)));
  const [mineOnly, setMineOnly] = useState(false);
  if (total === 0) return <div className="panel-pad">The fixture list is created when the host continues from the squad reveal.</div>;
  const inRound = snap.fixtures.filter((f) => f.round === round && (!mineOnly || f.homeId === game.me.id || f.awayId === game.me.id));
  const bye = snap.season.byes[round];
  const status = (r: number) => { const fx = snap.fixtures.filter((f) => f.round === r); return fx.every((f) => f.status === 'played') ? 'done' : fx.some((f) => f.status === 'played') ? 'part' : 'todo'; };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="h-page">Fixtures</h1><p className="muted mt-1">{snap.fixtures.length} matches over {total} matchdays{snap.season.locked ? '. The schedule is locked.' : '. The host starts the league when everyone is ready.'}</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-4 !h-4" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />Only my matches</label>
      </div>
      <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1" role="tablist" aria-label="Matchday">
        {Array.from({ length: total }, (_, i) => i + 1).map((r) => (
          <button key={r} role="tab" aria-selected={round === r} onClick={() => setRound(r)} title={status(r) === 'done' ? 'Played' : status(r) === 'part' ? 'In progress' : 'Scheduled'}
            className={`num min-w-[2.6rem] px-2 py-1.5 rounded-lg text-lg font-bold ${round === r ? 'bg-pitch-500 text-ink-950' : status(r) === 'done' ? 'bg-ink-600 text-mist-300' : 'bg-ink-700 border border-ink-500 text-mist-400'} ${snap.season.currentRound === r && snap.season.status === 'running' ? 'ring-2 ring-gold-400' : ''}`}>{r}</button>
        ))}
      </div>
      <h2 className="text-2xl font-bold">Matchday {round}{snap.season.currentRound === round && snap.season.status === 'running' && <span className="chip ml-2 align-middle text-gold-300">Current</span>}</h2>
      <div className="panel divide-y divide-ink-600 overflow-hidden">
        {inRound.map((f) => <FixtureRow key={f.id} f={f} game={game} />)}
        {inRound.length === 0 && <div className="p-4 muted text-sm">{mineOnly ? 'You have a bye this matchday.' : 'No fixtures.'}</div>}
      </div>
      {bye && <p className="text-sm muted">Bye this matchday: <span className="text-mist-100 font-semibold">{clubOf(bye)?.name ?? byId.get(bye)?.name}</span></p>}
    </div>
  );
}
