import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_GOALKEEPERS, minIncrement } from '@fa/shared';
import { act, newNonce } from '../store';
import { AttrBar, Crest, Dot, Modal, PlayerAvatar, PosTag, Rating, money, useCountdown, type Game } from '../ui';

export default function Auction({ game }: { game: Game }) {
  const { snap, catalog, me, isHost, byId, clubOf } = game;
  const a = snap.auction!;
  const cfg = snap.room.config;
  const lot = a.playerId !== null ? catalog.playerById.get(a.playerId) : undefined;
  const remaining = useCountdown(a.status === 'running' || a.status === 'between' ? a.endsAt : null);
  const [custom, setCustom] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const myPlayers = useMemo(() => snap.squads.filter((s) => s.participantId === me.id).map((s) => catalog.playerById.get(s.playerId)!).filter(Boolean), [snap.squads, me.id, catalog]);
  const myGks = myPlayers.filter((p) => p.position === 'GK').length;
  const maxBid = a.maxBids[me.id] ?? 0;
  const min = a.minNextBid ?? 0;
  const iAmHigh = a.highBidderId === me.id;
  const lotIsGk = lot?.position === 'GK';

  let blocked: string | null = null;
  if (a.status !== 'running' || !lot) blocked = a.status === 'paused' ? 'The host has paused the auction.' : 'Bidding opens with the next player.';
  else if (!me.connected) blocked = 'You are offline.';
  else if (me.squadSize >= cfg.maxSquad) blocked = `Your squad is full (${cfg.maxSquad}).`;
  else if (lotIsGk && myGks >= MAX_GOALKEEPERS) blocked = `You already have ${MAX_GOALKEEPERS} goalkeepers.`;
  else if (iAmHigh) blocked = 'You have the highest bid.';
  else if (maxBid < min) blocked = `You cannot afford ${money(min)} (you can bid up to ${money(maxBid)}).`;

  async function bid(amount: number) {
    if (blocked || pending) return;
    setPending(true);
    await act({ type: 'auction.bid', amount: Math.round(amount), nonce: newNonce() });
    setPending(false); setCustom('');
  }

  // Briefly highlight the bid amount when it changes.
  const bidKey = `${a.lotSeq}-${a.currentBid}`;
  const [flash, setFlash] = useState(bidKey);
  const prev = useRef(bidKey);
  useEffect(() => { if (prev.current !== bidKey) { prev.current = bidKey; setFlash(bidKey + Math.random()); } }, [bidKey]);

  const total = a.status === 'running' ? Math.max(cfg.timerSeconds, 1) : 1;
  const frac = a.status === 'running' && remaining !== null ? Math.min(1, remaining / total) : a.status === 'paused' ? Math.min(1, (a.pausedRemainingMs ?? 0) / 1000 / total) : 0;
  const secs = a.status === 'paused' ? Math.ceil((a.pausedRemainingMs ?? 0) / 1000) : remaining === null ? 0 : Math.ceil(remaining);
  const urgent = a.status === 'running' && remaining !== null && remaining <= 5;
  const highClub = a.highBidderId ? clubOf(a.highBidderId) : undefined;
  const result = a.lastResult && a.playerId === a.lastResult.playerId && a.status === 'between' ? a.lastResult : null;
  const winnerClub = result?.winnerId ? clubOf(result.winnerId) : undefined;

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-5">
        {/* Player card */}
        <div className="panel overflow-hidden relative">
          {lot ? (
            <div className={`p-5 sm:p-6 ${result ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-4">
                <PlayerAvatar p={lot} size={88} />
                <div className="min-w-0 flex-1">
                  <div className="flex gap-1.5 flex-wrap items-center"><PosTag pos={lot.position} />{lot.secondary.map((s) => <PosTag key={s} pos={s} />)}</div>
                  <h1 className="font-display font-extrabold text-4xl sm:text-5xl leading-none mt-2 break-words">{lot.name}</h1>
                  <p className="text-mist-300 mt-1.5 text-sm">{lot.nationality} · {lot.age} years · {lot.clubName} <span className="text-mist-500">({lot.league})</span></p>
                </div>
                <div className="text-right shrink-0"><Rating value={lot.overall} size="lg" /><div className="text-xs muted mt-1">Overall</div></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-5">
                <AttrBar label="Pace" value={lot.pace} /><AttrBar label="Shooting" value={lot.shooting} /><AttrBar label="Passing" value={lot.passing} />
                <AttrBar label="Defending" value={lot.defending} /><AttrBar label="Physical" value={lot.physical} />
                <div className="flex items-center gap-2 text-xs"><span className="w-20 text-mist-400">Start price</span><span className="num text-lg text-gold-300">{money(a.startPrice)}</span></div>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center">
              <div className="font-display text-3xl font-bold">{a.lotSeq === 0 ? 'The auction is about to begin' : 'Next player coming up'}</div>
              <div className="num text-6xl text-gold-400 mt-3">{secs}</div>
              <p className="muted text-sm mt-2">Check your squad panel below. {a.queueLength} players are in the pool.</p>
            </div>
          )}
          {result && (
            <div className="absolute inset-x-0 bottom-0 animate-pop">
              <div className={`px-5 py-3 flex items-center gap-3 ${result.sold ? 'bg-gold-500 text-ink-950' : 'bg-ink-500 text-mist-100'}`}>
                {result.sold ? <><Crest club={winnerClub} size={34} /><span className="font-display text-2xl font-bold">Sold to {winnerClub?.name ?? byId.get(result.winnerId!)?.name} for {money(result.price)}</span></> : <span className="font-display text-2xl font-bold">Unsold — no bids</span>}
                <span className="ml-auto text-sm font-semibold">Next player in {secs}s</span>
              </div>
            </div>
          )}
          {a.status === 'paused' && <div className="absolute inset-0 bg-ink-950/75 grid place-items-center text-center p-6"><div><div className="font-display text-4xl font-bold">Auction paused</div><p className="muted mt-1">{isHost ? 'Resume when everyone is ready.' : 'Waiting for the host to resume.'}</p></div></div>}
        </div>

        {/* Bid ticker */}
        <div className="panel overflow-hidden flex flex-col">
          <div className="p-5 pb-3">
            <div className="flex items-center justify-between text-sm muted"><span>Current bid</span><span>Lot {a.lotSeq} · {a.queueLength} to come</span></div>
            <div key={flash} className="num font-extrabold text-gold-400 leading-none text-7xl sm:text-8xl mt-1 animate-flash rounded">{a.currentBid !== null ? money(a.currentBid) : a.startPrice !== null ? <span className="text-mist-500">{money(a.startPrice)}</span> : '—'}</div>
            <div className="flex items-center gap-2 mt-3 min-h-[34px]">
              {a.highBidderId ? <><Crest club={highClub} size={30} /><span className="font-semibold text-lg truncate">{highClub?.name ?? byId.get(a.highBidderId)?.name}</span><span className="muted text-sm">{iAmHigh ? 'You lead' : `managed by ${byId.get(a.highBidderId)?.name}`}</span></>
                : <span className="muted">{a.status === 'running' ? 'No bids yet. The first bid must be at least the start price.' : ''}</span>}
            </div>
          </div>
          <div className="px-5">
            <div className="flex items-baseline justify-between"><span className="muted text-sm">{a.status === 'between' ? 'Next player' : 'Time left'}</span><span className={`num text-4xl font-bold ${urgent ? 'text-alert-400' : ''}`} aria-live="off">{secs}s</span></div>
            <div className="h-2.5 rounded bg-ink-500 mt-1 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={secs} aria-label="Time left on this player">
              <div className={`h-full ${urgent ? 'bg-alert-500' : 'bg-pitch-400'}`} style={{ width: `${frac * 100}%`, transition: 'width .12s linear' }} />
            </div>
          </div>
          <div className="p-5 space-y-3 mt-auto">
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary btn-lg flex-1 min-w-[10rem]" disabled={!!blocked || pending || min > maxBid} onClick={() => bid(min)}>Bid {money(min)}</button>
              {[5, 10, 25].map((n) => { const v = (a.currentBid ?? a.startPrice ?? 0) + Math.max(n, minIncrement(a.currentBid ?? 0)); return <button key={n} className="btn-ghost" disabled={!!blocked || pending || v > maxBid} onClick={() => bid(v)}>+{n}</button>; })}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(custom); if (Number.isFinite(v) && v > 0) void bid(v); }}>
              <input aria-label="Custom bid in € millions" inputMode="numeric" placeholder={`Custom bid (€M), up to ${maxBid}`} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))} disabled={!!blocked} />
              <button className="btn-gold" disabled={!!blocked || pending || !custom}>Place bid</button>
            </form>
            <p className="text-sm min-h-[1.25rem]" aria-live="polite">{blocked ? <span className="text-gold-300">{blocked}</span> : <span className="muted">Your budget {money(me.budget)} · highest bid you can place {money(maxBid)}</span>}</p>
            {isHost && (
              <div className="flex gap-2 pt-2 border-t border-ink-600">
                {a.status === 'paused' ? <button className="btn-primary" onClick={() => act({ type: 'auction.resume' })}>Resume auction</button> : <button className="btn-ghost" onClick={() => act({ type: 'auction.pause' })}>Pause auction</button>}
                <button className="btn-danger ml-auto" onClick={() => setConfirmEnd(true)}>End auction</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-5">
        <div>
          <h2 className="text-2xl font-bold mb-3">Managers</h2>
          <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {snap.participants.map((p) => {
              const club = clubOf(p.id);
              const mine = snap.squads.filter((s) => s.participantId === p.id);
              const pct = Math.min(100, (p.squadSize / cfg.minSquad) * 100);
              const lead = a.highBidderId === p.id && a.status === 'running';
              return (
                <li key={p.id} className={`panel p-3 ${lead ? 'ring-2 ring-gold-400' : ''} ${p.id === me.id ? 'border-pitch-500/70' : ''}`}>
                  <button className="w-full text-left" onClick={() => setExpanded(expanded === p.id ? null : p.id)} aria-expanded={expanded === p.id}>
                    <div className="flex items-center gap-2.5">
                      <Crest club={club} size={36} />
                      <div className="min-w-0 flex-1"><div className="font-semibold truncate">{club?.name ?? p.name}</div><div className="text-xs muted truncate">{p.name}{p.id === me.id ? ' (you)' : ''}</div></div>
                      <Dot on={p.connected} label="" />
                    </div>
                    <div className="flex items-baseline justify-between mt-2"><span className="num text-2xl font-bold text-gold-300">{money(p.budget)}</span><span className="text-xs muted">{p.squadSize}/{cfg.maxSquad} players</span></div>
                    <div className="h-1.5 rounded bg-ink-500 mt-1.5 overflow-hidden" title={`Minimum squad ${cfg.minSquad}`}><div className={`h-full ${p.squadSize >= cfg.minSquad ? 'bg-pitch-400' : 'bg-mist-500'}`} style={{ width: `${pct}%` }} /></div>
                    <div className="text-xs muted mt-1">{p.squadSize >= cfg.minSquad ? 'Minimum squad reached' : `${cfg.minSquad - p.squadSize} more needed`} · max bid {money(a.maxBids[p.id] ?? 0)}</div>
                  </button>
                  {expanded === p.id && (
                    <ul className="mt-2 pt-2 border-t border-ink-600 space-y-1 max-h-56 overflow-auto scroll-thin">
                      {mine.length === 0 && <li className="text-sm muted">No players yet.</li>}
                      {mine.map((s) => { const pl = catalog.playerById.get(s.playerId); return pl ? <li key={s.playerId} className="flex items-center gap-2 text-sm"><PosTag pos={pl.position} /><span className="truncate flex-1">{pl.name}</span><Rating value={pl.overall} size="sm" /><span className="num text-gold-300 w-14 text-right">{money(s.price)}</span></li> : null; })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="space-y-4">
          <div className="panel-pad">
            <h3 className="text-xl font-bold mb-2">Bids on this player</h3>
            <ul className="space-y-1.5 text-sm" aria-live="polite">
              {a.recentBids.length === 0 && <li className="muted">No bids yet.</li>}
              {a.recentBids.map((b, i) => <li key={`${b.at}-${i}`} className="flex items-center gap-2"><Crest club={clubOf(b.participantId)} size={20} /><span className="truncate flex-1">{clubOf(b.participantId)?.name ?? byId.get(b.participantId)?.name}</span><span className="num text-gold-300 text-lg">{money(b.amount)}</span></li>)}
            </ul>
          </div>
          <div className="panel-pad text-sm space-y-1">
            <div className="flex justify-between"><span className="muted">Sold</span><span className="num text-lg">{a.soldCount}</span></div>
            <div className="flex justify-between"><span className="muted">Unsold</span><span className="num text-lg">{a.unsoldCount}</span></div>
            <div className="flex justify-between"><span className="muted">Still to come</span><span className="num text-lg">{a.queueLength}</span></div>
          </div>
        </div>
      </div>

      {confirmEnd && (
        <Modal title="End the auction now?" onClose={() => setConfirmEnd(false)} actions={<><button className="btn-ghost" onClick={() => setConfirmEnd(false)}>Keep bidding</button><button className="btn-danger" onClick={async () => { await act({ type: 'auction.end' }); setConfirmEnd(false); }}>End auction</button></>}>
          <p>A player who already has a bid is sold to the highest bidder. Everyone moves to the squad reveal, where short squads can be completed before the league.</p>
        </Modal>
      )}
    </div>
  );
}
