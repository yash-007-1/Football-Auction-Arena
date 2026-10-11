import { useMemo, useState } from 'react';
import { lineOf, type CatalogPlayer, type Position } from '@fa/shared';
import { act } from '../store';
import { Crest, Modal, PosTag, Rating, money, type Game } from '../ui';

const LINES: { id: 'GK' | 'DEF' | 'MID' | 'ATT'; label: string; take: number }[] = [
  { id: 'GK', label: 'Goalkeeper', take: 1 }, { id: 'DEF', label: 'Defence', take: 4 }, { id: 'MID', label: 'Midfield', take: 3 }, { id: 'ATT', label: 'Attack', take: 3 },
];

export function lineStrength(players: CatalogPlayer[]) {
  return LINES.map((l) => {
    const top = players.filter((p) => lineOf(p.position as Position) === l.id).map((p) => p.overall).sort((a, b) => b - a).slice(0, l.take);
    return { ...l, value: top.length ? Math.round(top.reduce((s, x) => s + x, 0) / l.take) : 0 };
  });
}

export default function Reveal({ game, live = false }: { game: Game; live?: boolean }) {
  const { snap, catalog, isHost, clubOf } = game;
  const cfg = snap.room.config;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'reopen' | 'proceed'>(null);
  const inReview = snap.room.phase === 'review' && !live;

  const teams = useMemo(() => snap.participants.map((p) => {
    const entries = snap.squads.filter((s) => s.participantId === p.id);
    const players = entries.map((s) => ({ s, p: catalog.playerById.get(s.playerId)! })).filter((x) => x.p);
    const strength = lineStrength(players.map((x) => x.p));
    const best = [...players].sort((a, b) => b.p.overall - a.p.overall);
    const xi = Math.round(best.slice(0, 11).reduce((n, x) => n + x.p.overall, 0) / Math.max(1, Math.min(11, best.length)));
    return { part: p, players, strength, best, xi, spent: p.spent, review: snap.review?.find((r) => r.participantId === p.id) };
  }).sort((a, b) => b.xi - a.xi), [snap, catalog]);

  const allOk = !!snap.review && snap.review.every((r) => r.ok);
  const topPlayers = useMemo(() => teams.flatMap((t) => t.players.map((x) => ({ ...x, team: t.part.id }))).sort((a, b) => b.p.overall - a.p.overall).slice(0, 5), [teams]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); await fn(); setBusy(false); };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="h-page">{live ? 'Squads so far' : 'Squad reveal'}</h1>
          <p className="muted mt-1">{live ? 'Everything bought in the auction so far.' : 'The auction is over. Check every squad before the season is generated.'}</p>
        </div>
        {inReview && (
          <div className="flex gap-2 flex-wrap">
            {isHost && !allOk && <button className="btn-ghost" disabled={busy} onClick={() => run(() => act({ type: 'review.autofill' }))}>Complete short squads automatically</button>}
            {isHost && <button className="btn-ghost" disabled={busy} onClick={() => setConfirm('reopen')}>Re-open the auction</button>}
            {isHost && <button className="btn-gold btn-lg" disabled={busy || !allOk} onClick={() => setConfirm('proceed')}>Continue to league setup</button>}
          </div>
        )}
      </div>

      {inReview && !allOk && (
        <div role="alert" className="rounded-xl border border-gold-500/50 bg-gold-500/10 p-4 text-sm text-gold-300 space-y-1">
          <div className="font-semibold text-base">Some squads cannot play yet</div>
          <p>The season cannot start until every squad has at least {cfg.minSquad} players, a goalkeeper and ten outfield players. {isHost ? 'Complete them automatically with the cheapest available players, or re-open the auction to bid for more.' : 'The host can fix this by completing squads or re-opening the auction.'}</p>
        </div>
      )}
      {inReview && allOk && <div className="rounded-xl border border-pitch-500/50 bg-pitch-500/10 p-3 text-sm text-pitch-300">All squads are valid. {isHost ? 'Continue when you are ready.' : 'Waiting for the host to continue.'}</div>}

      {topPlayers.length > 0 && (
        <div className="panel-pad">
          <h2 className="text-xl font-bold mb-2">Best players signed</h2>
          <ol className="grid sm:grid-cols-5 gap-3">
            {topPlayers.map((x, i) => (
              <li key={x.p.id} className={`rounded-lg p-3 ${i === 0 ? 'bg-gold-500/15 border border-gold-500/50' : 'bg-ink-600'}`}>
                <div className="flex items-center justify-between"><Rating value={x.p.overall} /><PosTag pos={x.p.position} /></div>
                <div className="font-semibold truncate mt-1">{x.p.name}</div>
                <div className="text-xs muted truncate flex items-center gap-1.5"><Crest club={clubOf(x.team)} size={16} />{clubOf(x.team)?.name}</div>
                <div className="num text-gold-300">{money(x.s.price)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-4">
        {teams.map((t, rank) => {
          const club = clubOf(t.part.id);
          const bestLine = [...t.strength].sort((a, b) => b.value - a.value)[0];
          return (
            <article key={t.part.id} className="panel p-4 space-y-3" aria-label={`${club?.name} squad`}>
              <header className="flex items-center gap-3">
                <Crest club={club} size={48} />
                <div className="min-w-0 flex-1"><h3 className="text-2xl font-bold truncate">{club?.name ?? t.part.name}</h3><div className="text-sm muted">Managed by {t.part.name} · {club?.league}</div></div>
                <div className="text-right"><div className="num text-3xl font-bold text-gold-300">{t.xi || '—'}</div><div className="text-xs muted">Best XI avg · #{rank + 1}</div></div>
              </header>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-ink-600 py-2"><dt className="text-xs muted">Spent</dt><dd className="num text-xl">{money(t.spent)}</dd></div>
                <div className="rounded-lg bg-ink-600 py-2"><dt className="text-xs muted">Remaining</dt><dd className="num text-xl text-gold-300">{money(t.part.budget)}</dd></div>
                <div className="rounded-lg bg-ink-600 py-2"><dt className="text-xs muted">Squad</dt><dd className="num text-xl">{t.players.length}/{cfg.maxSquad}</dd></div>
              </dl>
              <div className="grid grid-cols-4 gap-2">
                {t.strength.map((l) => (
                  <div key={l.id} className={`rounded-lg px-2 py-1.5 text-center ${l.id === bestLine.id && l.value > 0 ? 'bg-pitch-500/15 ring-1 ring-pitch-500/50' : 'bg-ink-600'}`}>
                    <div className="num text-xl">{l.value || '—'}</div><div className="text-[11px] muted">{l.label}</div>
                  </div>
                ))}
              </div>
              {t.players.length > 0 && <p className="text-xs text-mist-300">Strongest area: <span className="text-pitch-300 font-semibold">{bestLine.label.toLowerCase()}</span> ({bestLine.value}).</p>}
              {t.review && !t.review.ok && <ul className="text-sm text-gold-300 list-disc pl-5">{t.review.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-mist-300">All {t.players.length} players</summary>
                <table className="mt-1"><thead><tr><th>Player</th><th>Pos</th><th>OVR</th><th className="text-right">Paid</th></tr></thead>
                  <tbody>{t.best.map((x, i) => (
                    <tr key={x.p.id}><td className={`font-medium ${i < 3 ? 'text-gold-300' : ''}`}>{x.p.name}{x.s.price === x.p.startPrice && <span className="text-xs muted"> </span>}</td><td><PosTag pos={x.p.position} /></td><td className="num text-lg">{x.p.overall}</td><td className="num text-right text-gold-300">{money(x.s.price)}</td></tr>))}</tbody></table>
              </details>
            </article>
          );
        })}
      </div>

      {confirm === 'proceed' && (
        <Modal title="Generate the season?" onClose={() => setConfirm(null)} actions={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Back</button><button className="btn-gold" disabled={busy} onClick={() => run(async () => { const r = await act({ type: 'review.proceed' }); if (r.ok) setConfirm(null); })}>Generate fixtures</button></>}>
          <p>The full fixture list is created once and saved. Squads and budgets are locked after this.</p>
        </Modal>
      )}
      {confirm === 'reopen' && (
        <Modal title="Re-open the auction?" onClose={() => setConfirm(null)} actions={<><button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn-gold" disabled={busy} onClick={() => run(async () => { const r = await act({ type: 'review.reopen' }); if (r.ok) setConfirm(null); })}>Re-open</button></>}>
          <p>Every player nobody owns is auctioned again. Existing squads and budgets stay as they are.</p>
        </Modal>
      )}
    </div>
  );
}
