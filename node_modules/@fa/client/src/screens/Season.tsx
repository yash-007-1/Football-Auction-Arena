import { useState } from 'react';
import { act } from '../store';
import { go } from '../App';
import { Crest, Modal, Section, Spinner, money, type Game } from '../ui';
import { LeagueTable } from './League';

export default function Season({ game }: { game: Game }) {
  const { snap, isHost, clubOf, byId } = game;
  const sum = snap.summary;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState<null | 'keep' | 'reset'>(null);
  if (!sum) return <Spinner label="Preparing the season summary…" />;
  const champ = sum.champion; const club = champ ? clubOf(champ.participantId) : undefined;
  const awards: { label: string; main: string; sub: string; value: string }[] = [];
  if (sum.topScorer) awards.push({ label: 'Top scorer', main: sum.topScorer.name, sub: clubOf(sum.topScorer.participantId)?.name ?? '', value: `${sum.topScorer.goals} goals` });
  if (sum.mostAssists) awards.push({ label: 'Most assists', main: sum.mostAssists.name, sub: clubOf(sum.mostAssists.participantId)?.name ?? '', value: `${sum.mostAssists.assists} assists` });
  if (sum.bestGoalkeeper) awards.push({ label: 'Best goalkeeper', main: sum.bestGoalkeeper.name, sub: clubOf(sum.bestGoalkeeper.participantId)?.name ?? '', value: `${sum.bestGoalkeeper.cleanSheets} clean sheets` });
  if (sum.bestAttack) awards.push({ label: 'Best attack', main: sum.bestAttack.club, sub: byId.get(sum.bestAttack.participantId)?.name ?? '', value: `${sum.bestAttack.goals} scored` });
  if (sum.bestDefence) awards.push({ label: 'Best defence', main: sum.bestDefence.club, sub: byId.get(sum.bestDefence.participantId)?.name ?? '', value: `${sum.bestDefence.conceded} conceded` });

  async function start(mode: 'keep' | 'reset') {
    setBusy(mode);
    const r = await act({ type: 'season.new', mode });
    setBusy(null);
    if (r.ok) { setAsk(false); go(mode === 'keep' ? 'matchday' : 'lobby'); }
  }

  return (
    <div className="space-y-8">
      <section className="panel overflow-hidden" style={{ background: 'linear-gradient(120deg, rgba(217,174,68,.18), rgba(18,153,79,.12) 55%, transparent)' }}>
        <div className="p-6 sm:p-10 flex items-center gap-6 flex-wrap">
          <Crest club={club} size={110} />
          <div className="min-w-0 flex-1">
            <p className="text-gold-300 font-semibold">Season {sum.season} champions</p>
            <h1 className="font-display font-extrabold text-5xl sm:text-7xl leading-none mt-1 break-words">{champ?.club}</h1>
            <p className="text-mist-300 mt-2 text-lg">Managed by <span className="text-mist-100 font-semibold">{champ?.manager}</span> with {champ?.points} points.</p>
            {sum.runnerUp && <p className="text-mist-400 mt-1 flex items-center gap-2"><Crest club={clubOf(sum.runnerUp.participantId)} size={20} />Runners-up: {sum.runnerUp.club} ({sum.runnerUp.points} pts, {sum.runnerUp.manager})</p>}
          </div>
          {isHost ? <button className="btn-gold btn-lg" onClick={() => setAsk(true)}>Start a new season</button> : <p className="muted text-sm max-w-[14rem]">The host starts the next season.</p>}
        </div>
      </section>

      <Section title="Awards">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {awards.map((a) => <div key={a.label} className="panel-pad"><div className="text-sm muted">{a.label}</div><div className="font-display text-2xl font-bold leading-tight mt-0.5">{a.main}</div><div className="text-xs muted truncate">{a.sub}</div><div className="num text-xl text-gold-300 mt-1">{a.value}</div></div>)}
        </div>
      </Section>

      <Section title="Final table"><LeagueTable game={game} rows={sum.table} /></Section>

      <Section title="Manager season summaries">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sum.managers.map((m) => (
            <article key={m.participantId} className="panel-pad space-y-2">
              <header className="flex items-center gap-3"><Crest club={clubOf(m.participantId)} size={40} /><div className="min-w-0 flex-1"><h3 className="text-xl font-bold truncate">{m.club}</h3><div className="text-sm muted">{m.manager}</div></div><div className="text-right"><div className="num text-3xl font-bold text-gold-300">{m.position}</div><div className="text-xs muted">finished</div></div></header>
              <dl className="grid grid-cols-4 gap-1 text-center text-sm">{[['W', m.won], ['D', m.drawn], ['L', m.lost], ['Pts', m.points]].map(([k, v]) => <div key={k as string} className="rounded bg-ink-600 py-1"><dt className="text-xs muted">{k}</dt><dd className="num text-lg">{v}</dd></div>)}</dl>
              <p className="text-sm text-mist-300">Goals {m.goalsFor}–{m.goalsAgainst}. Top scorer: {m.topScorer ?? 'none'}. Squad of {m.squadSize}, {money(m.spent)} invested.</p>
            </article>
          ))}
        </div>
      </Section>

      <div className="flex gap-2 flex-wrap"><button className="btn-ghost" onClick={() => go('fixtures')}>Every result</button><button className="btn-ghost" onClick={() => go('stats')}>Individual player statistics</button></div>

      {snap.history.length > 0 && (
        <Section title="Previous seasons">
          <ul className="panel divide-y divide-ink-600">{snap.history.map((h) => <li key={h.season} className="flex items-center gap-3 px-3 py-2.5 text-sm"><span className="num text-lg w-16">Season {h.season}</span><span className="flex-1 font-semibold">{h.champion?.club} <span className="muted font-normal">({h.champion?.manager})</span></span><span className="muted">Top scorer: {h.topScorer ?? '—'}</span></li>)}</ul>
        </Section>
      )}

      {ask && (
        <Modal title="Start a new season" onClose={() => setAsk(false)} actions={<button className="btn-ghost" onClick={() => setAsk(false)}>Cancel</button>}>
          <p>This season's results, table and statistics stay saved. Choose how the next one begins.</p>
          <button disabled={!!busy} onClick={() => start('keep')} className="w-full text-left rounded-lg border border-ink-500 hover:border-pitch-500 p-3"><span className="block font-semibold text-mist-100">Keep squads and budgets</span><span className="text-xs">Everyone keeps their players and unspent budget. Fitness resets and a new fixture list is generated. {busy === 'keep' && 'Starting…'}</span></button>
          <button disabled={!!busy} onClick={() => start('reset')} className="w-full text-left rounded-lg border border-ink-500 hover:border-gold-500 p-3"><span className="block font-semibold text-mist-100">Fresh auction</span><span className="text-xs">Squads are cleared, every budget returns to {money(snap.room.config.budget)}, and clubs stay. You go back to the lobby to auction again. {busy === 'reset' && 'Starting…'}</span></button>
        </Modal>
      )}
    </div>
  );
}
