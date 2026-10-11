import { useMemo, useState } from 'react';
import type { RoomConfig } from '@fa/shared';
import { act, toast } from '../store';
import { Crest, Dot, Modal, Section, leagueOrder, type Game } from '../ui';

export default function Lobby({ game }: { game: Game }) {
  const { snap, catalog, me, isHost, byId } = game;
  const [q, setQ] = useState('');
  const [league, setLeague] = useState('All');
  const [picking, setPicking] = useState<number | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);

  const takenBy = useMemo(() => new Map(snap.participants.filter((p) => p.clubId !== null).map((p) => [p.clubId as number, p])), [snap.participants]);
  const leagues = useMemo(() => ['All', ...[...new Set(catalog.clubs.map((c) => c.league))].sort((a, b) => (leagueOrder.indexOf(a) + 100 * +(leagueOrder.indexOf(a) < 0)) - (leagueOrder.indexOf(b) + 100 * +(leagueOrder.indexOf(b) < 0)))], [catalog.clubs]);
  const clubs = catalog.clubs.filter((c) => (league === 'All' || c.league === league) && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const invite = `${location.origin}/?room=${snap.room.code}`;

  async function choose(id: number | null) {
    setPicking(id);
    await act({ type: 'lobby.setClub', clubId: id });
    setPicking(null);
  }
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'good'); } catch { toast(`Copy this ${what.toLowerCase()}: ${text}`); } };
  const cfg = snap.room.config;

  return (
    <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
      <div className="space-y-5">
        <div className="panel-pad">
          <div className="muted text-sm">Room code</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="num text-6xl font-bold tracking-[.18em] text-gold-400">{snap.room.code}</div>
            <div className="flex gap-2"><button className="btn-ghost" onClick={() => copy(snap.room.code, 'Room code')}>Copy code</button><button className="btn-ghost" onClick={() => copy(invite, 'Invite link')}>Copy invite link</button></div>
          </div>
          <p className="text-sm muted mt-2">Friends enter the code on the home page, or open the invite link. Up to 10 managers per room.</p>
        </div>

        <Section title={`Managers (${snap.participants.length}/10)`}>
          <ul className="panel divide-y divide-ink-600">
            {snap.participants.map((p) => {
              const club = p.clubId ? catalog.clubById.get(p.clubId) : undefined;
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Crest club={club} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{p.name}{p.id === me.id && <span className="muted font-normal"> (you)</span>}{p.isHost && <span className="chip ml-2 text-gold-300">Host</span>}</div>
                    <div className="text-xs muted truncate">{club ? `${club.name} · ${club.league}` : 'No club yet'}</div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <Dot on={p.connected} />
                    <div className={`text-xs ${p.ready || p.isHost ? 'text-pitch-300' : 'text-mist-500'}`}>{p.isHost ? 'Host' : p.ready ? 'Ready' : 'Not ready'}</div>
                  </div>
                  {isHost && p.id !== me.id && (
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act({ type: 'lobby.kick', participantId: p.id })} aria-label={`Remove ${p.name}`}>Remove</button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        <div className="panel-pad space-y-3">
          {!isHost && (
            <>
              <button className={me.ready ? 'btn-ghost w-full btn-lg' : 'btn-primary w-full btn-lg'} disabled={me.clubId === null} onClick={() => act({ type: 'lobby.ready', ready: !me.ready })}>
                {me.ready ? 'Ready — tap to cancel' : me.clubId === null ? 'Choose a club first' : 'I am ready'}
              </button>
              <p className="text-sm muted">Waiting for the host to start the auction.</p>
            </>
          )}
          {isHost && (
            <>
              <button className="btn-gold w-full btn-lg" disabled={!snap.room.canStart.ok} onClick={() => setConfirmStart(true)}>Start the auction</button>
              {!snap.room.canStart.ok && <ul className="text-sm text-mist-400 list-disc pl-5 space-y-0.5">{snap.room.canStart.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </>
          )}
          <p className="text-xs text-mist-500">Each manager begins with {`€${cfg.budget.toLocaleString()}M`}. Squads need {cfg.minSquad}–{cfg.maxSquad} players, including at least one goalkeeper and ten outfield players.</p>
        </div>

        {isHost && <AuctionSettings cfg={cfg} count={snap.participants.length} />}
      </div>

      <Section title="Choose your club" right={<span className="text-sm muted">{me.clubId ? 'You can change your club until the auction starts.' : 'Pick the club you will manage all season.'}</span>}>
        <div className="flex gap-2 flex-wrap">
          <input aria-label="Search clubs" placeholder="Search clubs" value={q} onChange={(e) => setQ(e.target.value)} className="!w-auto flex-1 min-w-[10rem]" />
          <select aria-label="League" value={league} onChange={(e) => setLeague(e.target.value)} className="!w-auto">{leagues.map((l) => <option key={l}>{l}</option>)}</select>
        </div>
        <ul className="grid sm:grid-cols-2 gap-2">
          {clubs.map((c) => {
            const owner = takenBy.get(c.id);
            const mine = owner?.id === me.id;
            const taken = !!owner && !mine;
            return (
              <li key={c.id}>
                <button disabled={taken || picking !== null} onClick={() => choose(mine ? null : c.id)} aria-pressed={mine}
                  className={`w-full text-left flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${mine ? 'border-pitch-400 bg-pitch-500/10' : taken ? 'border-ink-600 bg-ink-800 opacity-55 cursor-not-allowed' : 'border-ink-500 bg-ink-700 hover:border-pitch-500'}`}>
                  <Crest club={c} size={38} />
                  <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{c.name}</span><span className="block text-xs muted">{c.league} · {c.players} players</span></span>
                  <span className={`text-xs font-medium ${mine ? 'text-pitch-300' : 'text-mist-400'}`}>{mine ? 'Your club' : taken ? `Taken by ${byId.get(owner!.id)?.name}` : 'Select'}</span>
                </button>
              </li>
            );
          })}
          {clubs.length === 0 && <li className="muted text-sm col-span-full py-6 text-center">No clubs match your search.</li>}
        </ul>
      </Section>

      {confirmStart && (
        <Modal title="Start the auction?" onClose={() => setConfirmStart(false)} actions={<><button className="btn-ghost" onClick={() => setConfirmStart(false)}>Not yet</button>
          <button className="btn-gold" onClick={async () => { const r = await act({ type: 'lobby.start' }); if (r.ok) setConfirmStart(false); }}>Start auction</button></>}>
          <p>{snap.participants.length} managers will bid for players one at a time. After this, new managers can no longer join.</p>
        </Modal>
      )}
    </div>
  );
}

function AuctionSettings({ cfg, count }: { cfg: RoomConfig; count: number }) {
  const [busy, setBusy] = useState(false);
  const upd = async (settings: Partial<RoomConfig>) => { setBusy(true); await act({ type: 'lobby.settings', settings: settings as never }); setBusy(false); };
  const num = (label: string, key: keyof RoomConfig, min: number, max: number, help: string) => (
    <label className="block"><span className="text-sm">{label}</span>
      <input type="number" defaultValue={cfg[key] as number} key={`${key}-${cfg[key]}`} min={min} max={max} disabled={busy} onBlur={(e) => { const v = Number(e.target.value); if (v !== cfg[key] && Number.isFinite(v)) void upd({ [key]: v } as Partial<RoomConfig>); }} />
      <span className="text-xs text-mist-500">{help}</span></label>
  );
  return (
    <details className="panel-pad" open>
      <summary className="font-display text-xl font-bold cursor-pointer">Auction rules (host)</summary>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        {num('Minimum squad', 'minSquad', 11, 25, 'Needed before the league can start')}
        {num('Maximum squad', 'maxSquad', 11, 25, 'Hard cap is 25')}
        {num('Lot timer (seconds)', 'timerSeconds', 8, 120, 'Time to bid on each player')}
        {num('Timer after a bid (seconds)', 'bidResetSeconds', 3, 60, 'The clock is raised to this on each bid')}
        {num('Pause between players (seconds)', 'intermissionSeconds', 2, 15, 'Result banner time')}
        {num('Player pool size', 'poolSize', 0, 1000, `0 = all players. Minimum ${count * cfg.minSquad} for ${count} managers`)}
        <label className="block"><span className="text-sm">Order</span>
          <select value={cfg.order} onChange={(e) => upd({ order: e.target.value as RoomConfig['order'] })}><option value="tiered">Stars first, then the rest</option><option value="random">Fully random</option></select></label>
        <label className="block"><span className="text-sm">Season format</span>
          <select value={cfg.doubleRound ? 'double' : 'single'} onChange={(e) => upd({ doubleRound: e.target.value === 'double' })}><option value="double">Home and away</option><option value="single">Single round-robin</option></select></label>
      </div>
    </details>
  );
}
