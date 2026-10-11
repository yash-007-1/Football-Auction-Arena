import { useState } from 'react';
import { act, getState, leave, toast, useStore } from '../store';
import { Crest, Dot, Modal, Section, type Game } from '../ui';

export default function Settings({ game }: { game: Game }) {
  const { snap, catalog, me, isHost, clubOf } = game;
  const conn = useStore((s) => s.conn);
  const [confirm, setConfirm] = useState<null | 'leave' | 'host'>(null);
  const [target, setTarget] = useState<number | null>(null);
  const lobby = snap.room.phase === 'lobby';
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'good'); } catch { toast(`Copy this ${what.toLowerCase()}: ${text}`); } };
  const session = getState().session;

  async function doLeave() {
    if (lobby) await act({ type: 'lobby.leave' }, { quiet: true });
    leave();
  }
  const seatLink = session ? `${location.origin}/?room=${session.code}&seat=${session.token}&pid=${session.participantId}&name=${encodeURIComponent(session.name)}` : '';

  return (
    <div className="space-y-8 max-w-4xl">
      <h1 className="h-page">Room settings</h1>

      <Section title="Connection">
        <div className="panel-pad flex items-center gap-4 flex-wrap">
          <Dot on={conn === 'online'} label={conn === 'online' ? 'Connected' : conn === 'reconnecting' ? 'Reconnecting…' : conn} />
          <span className="text-sm muted flex-1">Your seat and the game live on the server. If you refresh, lose signal or close the tab, you rejoin automatically on this device with nothing lost.</span>
          <button className="btn-ghost" onClick={() => location.reload()}>Reconnect now</button>
        </div>
      </Section>

      <Section title="Invite and rejoin">
        <div className="panel-pad space-y-3">
          <div className="flex items-center gap-3 flex-wrap"><span className="num text-4xl font-bold text-gold-400 tracking-[.15em]">{snap.room.code}</span>
            {lobby && <button className="btn-ghost" onClick={() => copy(`${location.origin}/?room=${snap.room.code}`, 'Invite link')}>Copy invite link</button>}
            <button className="btn-ghost" onClick={() => copy(snap.room.code, 'Room code')}>Copy code</button></div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-mist-300">Continue on another device</summary>
            <p className="muted mt-2">This link signs in as you, with your seat, squad and budget. Open it on your other device, and never share it with other managers.</p>
            <button className="btn-ghost mt-2" onClick={() => copy(seatLink, 'Personal rejoin link')}>Copy my personal rejoin link</button>
          </details>
        </div>
      </Section>

      <Section title={`Managers (${snap.participants.length})`}>
        <ul className="panel divide-y divide-ink-600">
          {snap.participants.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <Crest club={clubOf(p.id)} size={30} />
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{p.name}{p.id === me.id ? ' (you)' : ''}{p.isHost && <span className="chip ml-2 text-gold-300">Host</span>}</div><div className="text-xs muted truncate">{clubOf(p.id)?.name ?? 'No club'}</div></div>
              <Dot on={p.connected} />
              {isHost && p.id !== me.id && <button className="btn-ghost !py-1 text-xs" onClick={() => { setTarget(p.id); setConfirm('host'); }}>Make host</button>}
              {isHost && lobby && p.id !== me.id && <button className="btn-danger !py-1 text-xs" onClick={() => act({ type: 'lobby.kick', participantId: p.id })}>Remove</button>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Rules in this room">
        <dl className="panel-pad grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {([['Budget per manager', `€${snap.room.config.budget.toLocaleString()}M`], ['Squad size', `${snap.room.config.minSquad} to ${snap.room.config.maxSquad}`], ['Goalkeepers per squad', '1 to 3, plus at least 10 outfield players'], ['Lot timer', `${snap.room.config.timerSeconds}s, reset to ${snap.room.config.bidResetSeconds}s after each bid`],
            ['Season format', snap.room.config.doubleRound ? 'Home and away round-robin' : 'Single round-robin'], ['Points', 'Win 3, draw 1, loss 0'], ['Table order', 'Points, goal difference, goals scored, head-to-head, club name']] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
        </dl>
      </Section>

      <Section title="Player data">
        <div className="panel-pad text-sm space-y-1.5">
          <div><span className="muted">Dataset:</span> {catalog.dataset.name}, season {catalog.dataset.season}, last updated {catalog.dataset.lastUpdated}.</div>
          <div><span className="muted">{catalog.clubs.length} clubs, {catalog.players.length} players.</span></div>
          <p className="text-gold-300">{catalog.dataset.provenance}</p><p className="muted">{catalog.dataset.caveat}</p>
        </div>
      </Section>

      <div className="flex gap-2"><button className="btn-danger" onClick={() => setConfirm('leave')}>{lobby ? 'Leave this room' : 'Sign out on this device'}</button></div>

      {confirm === 'leave' && (
        <Modal title={lobby ? 'Leave this room?' : 'Sign out on this device?'} onClose={() => setConfirm(null)} actions={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Stay</button><button className="btn-danger" onClick={doLeave}>{lobby ? 'Leave room' : 'Sign out'}</button></>}>
          {lobby ? <p>Your seat and club selection will be released.</p> : <p>Your squad and seat stay in the room, but you can only get back in with your personal rejoin link. Copy it first if you are unsure.</p>}
        </Modal>
      )}
      {confirm === 'host' && target !== null && (
        <Modal title="Make this manager the host?" onClose={() => setConfirm(null)} actions={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn-gold" onClick={async () => { const r = await act({ type: 'lobby.transferHost', participantId: target }); if (r.ok) setConfirm(null); }}>Make host</button></>}>
          <p>{snap.participants.find((p) => p.id === target)?.name} will control the auction and the league. You become a regular manager.</p>
        </Modal>
      )}
    </div>
  );
}
