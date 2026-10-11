import { useState } from 'react';
import { act } from '../store';
import { go } from '../App';
import { Crest, Section, type Game } from '../ui';
import { FixtureRow } from './Fixtures';
import { LeagueTable } from './League';

export default function Matchday({ game }: { game: Game }) {
  const { snap, isHost, clubOf, byId, me } = game;
  const s = snap.season;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); await fn(); setBusy(false); };
  const prepare = snap.room.phase === 'prepare';
  const round = prepare ? 1 : s.currentRound;
  const fixtures = snap.fixtures.filter((f) => f.round === round);
  const simulated = !prepare && s.roundSimulated;
  const nextRound = round + 1 <= s.totalRounds ? round + 1 : null;
  const nextFixtures = nextRound ? snap.fixtures.filter((f) => f.round === nextRound) : [];
  const m = snap.me.match;
  const lastRound = round >= s.totalRounds;
  const movers = Object.entries(snap.positionChanges).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
  const scorers = [...snap.stats].filter((x) => x.goals > 0).sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, 5);
  const bye = snap.season.byes[snap.me.editableRound ?? round];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="h-page">{prepare ? 'Pre-season schedule' : `Matchday ${round} of ${s.totalRounds}`}</h1>
          <p className="muted mt-1">{prepare ? `${snap.fixtures.length} fixtures over ${s.totalRounds} matchdays are saved. Look through the season, set your XI and tactics, then the host starts the league.` : simulated ? 'Results are in. Adjust your XI and tactics for the next match.' : 'Set your starting XI and tactics. The host plays the matchday when everyone is ready.'}</p>
        </div>
        {isHost && (
          <div className="flex gap-2 flex-wrap">
            {prepare && <button className="btn-gold btn-lg" disabled={busy} onClick={() => run(() => act({ type: 'league.start' }))}>Start league</button>}
            {!prepare && !simulated && <button className="btn-gold btn-lg" disabled={busy} onClick={() => run(() => act({ type: 'league.simulate' }))}>Play matchday {round}</button>}
            {simulated && <button className="btn-primary btn-lg" disabled={busy} onClick={() => run(() => act({ type: 'league.next' }))}>{lastRound ? 'Finish the season' : `Continue to matchday ${nextRound}`}</button>}
          </div>
        )}
      </div>
      {!isHost && <div className="panel-pad text-sm text-mist-300">{prepare ? 'Waiting for the host to start the league.' : simulated ? 'Waiting for the host to continue.' : 'Waiting for the host to play the matchday.'}</div>}

      {/* My match */}
      {snap.me.editableRound !== null && (
        <section className="panel-pad">
          {m ? (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-1 min-w-[16rem]">
                <Crest club={clubOf(me.id)} size={44} /><span className="font-display text-2xl text-mist-400">{m.home ? 'vs' : 'at'}</span><Crest club={clubOf(m.opponentId)} size={44} />
                <div className="min-w-0"><div className="font-display text-2xl font-bold truncate">{clubOf(m.opponentId)?.name}</div><div className="text-sm muted">Your next match · matchday {m.round} · {m.home ? 'home' : 'away'} · {byId.get(m.opponentId)?.name}</div></div>
              </div>
              <div className="text-sm space-y-0.5 min-w-[12rem]">
                <div>{m.lineup.formation} · {m.auto ? <span className="text-gold-300">auto-picked XI</span> : <span className="text-pitch-300">your XI saved</span>}</div>
                <div className="muted">{m.tactics.mentality.replace('_', ' ')}, {m.tactics.pressing} press</div>
                {m.errors.length > 0 && <div className="text-alert-400">{m.errors[0]}</div>}
                {m.errors.length === 0 && m.warnings.length > 0 && <div className="text-gold-300">{m.warnings.length} lineup warning{m.warnings.length > 1 ? 's' : ''}</div>}
              </div>
              <div className="flex gap-2"><button className="btn-primary" onClick={() => go('lineup')}>Starting XI</button><button className="btn-ghost" onClick={() => go('tactics')}>Tactics</button></div>
            </div>
          ) : snap.me.bye ? <div><div className="font-display text-2xl font-bold">You have a bye</div><p className="muted text-sm">No match for you in matchday {snap.me.editableRound}{bye ? '' : ''}. Your players recover fitness.</p></div> : <div className="muted">Preparing your lineup…</div>}
        </section>
      )}

      <Section title={simulated ? `Matchday ${round} results` : `Matchday ${round} fixtures`}>
        <div className="panel divide-y divide-ink-600 overflow-hidden">{fixtures.map((f) => <FixtureRow key={f.id} f={f} game={game} />)}</div>
        {s.byes[round] && <p className="text-sm muted">Bye: {clubOf(s.byes[round])?.name ?? byId.get(s.byes[round])?.name}</p>}
      </Section>

      {!prepare && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <Section title="League table" right={movers.length > 0 ? <span className="text-sm muted">Biggest moves: {movers.map(([id, v]) => `${clubOf(Number(id))?.short ?? ''} ${v > 0 ? '▲' : '▼'}${Math.abs(v)}`).join(' · ')}</span> : undefined}>
            <LeagueTable game={game} compact />
            <button className="btn-ghost" onClick={() => go('table')}>Full table</button>
          </Section>
          <div className="space-y-6">
            <Section title="Top scorers">
              {scorers.length === 0 ? <p className="muted text-sm">No goals yet.</p> : (
                <ol className="panel divide-y divide-ink-600">{scorers.map((x, i) => <li key={x.playerId} className="flex items-center gap-3 px-3 py-2"><span className="num w-5 text-mist-400">{i + 1}</span><Crest club={clubOf(x.participantId)} size={22} /><span className="flex-1 truncate font-semibold">{x.name}</span><span className="num text-2xl font-bold text-gold-300">{x.goals}</span></li>)}</ol>
              )}
              <button className="btn-ghost" onClick={() => go('stats')}>All player statistics</button>
            </Section>
            {simulated && nextFixtures.length > 0 && (
              <Section title={`Next up: matchday ${nextRound}`}><div className="panel divide-y divide-ink-600 overflow-hidden">{nextFixtures.map((f) => <FixtureRow key={f.id} f={f} game={game} />)}</div></Section>
            )}
          </div>
        </div>
      )}

      {prepare && (
        <Section title="Season at a glance" right={<button className="btn-ghost" onClick={() => go('fixtures')}>Browse every matchday</button>}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Array.from({ length: Math.min(s.totalRounds, 6) }, (_, i) => i + 1).map((r) => (
              <div key={r} className="panel p-3"><div className="font-display text-lg font-bold mb-1">Matchday {r}</div>
                <ul className="text-sm space-y-0.5">{snap.fixtures.filter((f) => f.round === r).map((f) => <li key={f.id} className="truncate"><span className={f.homeId === me.id ? 'text-pitch-300 font-semibold' : ''}>{clubOf(f.homeId)?.short}</span> <span className="muted">v</span> <span className={f.awayId === me.id ? 'text-pitch-300 font-semibold' : ''}>{clubOf(f.awayId)?.short}</span></li>)}</ul></div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
