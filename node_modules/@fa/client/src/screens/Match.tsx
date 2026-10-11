import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchDetail, MatchEvent, TeamMatchStats } from '@fa/shared';
import { ask } from '../store';
import { go } from '../App';
import { Crest, Empty, PosTag, Spinner, Tabs, type Game } from '../ui';

const ICON: Record<string, string> = { goal: '⚽', penalty: '⚽', penalty_miss: '✖', yellow: '🟨', red: '🟥', sub: '⇄', save: '🧤', shot: '', miss: '', foul: '', kickoff: '', halftime: '', fulltime: '' };
const KEY_TYPES = new Set(['goal', 'penalty', 'penalty_miss', 'yellow', 'red', 'sub', 'kickoff', 'halftime', 'fulltime']);

function StatRow({ label, h, a, pct = false }: { label: string; h: number; a: number; pct?: boolean }) {
  const total = h + a || 1;
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="num text-lg">{h}{pct ? '%' : ''}</span><span className="muted">{label}</span><span className="num text-lg">{a}{pct ? '%' : ''}</span></div>
      <div className="flex gap-1 h-1.5"><div className="flex-1 flex justify-end bg-ink-500 rounded-l overflow-hidden"><div className="bg-pitch-400" style={{ width: `${(h / total) * 100}%` }} /></div><div className="flex-1 bg-ink-500 rounded-r overflow-hidden"><div className="bg-gold-500 h-full" style={{ width: `${(a / total) * 100}%` }} /></div></div>
    </div>
  );
}

export default function Match({ game, fixtureId }: { game: Game; fixtureId: string }) {
  const { snap, clubOf, byId, me } = game;
  const played = useMemo(() => snap.fixtures.filter((f) => f.status === 'played'), [snap.fixtures]);
  const defaultId = useMemo(() => {
    const mine = [...played].reverse().find((f) => f.homeId === me.id || f.awayId === me.id);
    return (mine ?? played[played.length - 1])?.id ?? '';
  }, [played, me.id]);
  const id = fixtureId && snap.fixtures.some((f) => f.id === fixtureId) ? fixtureId : defaultId;

  const [m, setM] = useState<MatchDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'commentary' | 'stats' | 'lineups' | 'tactics'>('commentary');
  const [keyOnly, setKeyOnly] = useState(true);
  const [clock, setClock] = useState<number | null>(null); // null = full time shown
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [banner, setBanner] = useState<MatchEvent | null>(null);
  const lastShown = useRef(-1);

  useEffect(() => {
    if (!id) return;
    let live = true; setM(null); setErr(null); setClock(null); setPlaying(false); setBanner(null); lastShown.current = -1;
    void ask<MatchDetail>('match', id).then((r) => { if (!live) return; if (r.ok) setM(r.data as MatchDetail); else setErr(r.error); });
    return () => { live = false; };
  }, [id]);

  const events = m?.events ?? [];
  const maxMin = Math.max(90, ...events.map((e) => e.minute));
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setClock((c) => { const n = (c ?? 0) + speed * 0.5; if (n >= maxMin) { setPlaying(false); return null; } return n; }), 250);
    return () => clearInterval(t);
  }, [playing, speed, maxMin]);

  const visible = useMemo(() => (clock === null ? events : events.filter((e) => e.minute <= clock)), [events, clock]);
  useEffect(() => {
    if (clock === null) return;
    const e = [...visible].reverse().find((x) => ['goal', 'penalty', 'red'].includes(x.type));
    if (e && e.minute > lastShown.current) { lastShown.current = e.minute; setBanner(e); const t = setTimeout(() => setBanner(null), 3200); return () => clearTimeout(t); }
  }, [visible, clock]);

  if (played.length === 0) return <Empty title="No matches played yet">The match centre fills up once the host plays the first matchday.</Empty>;
  if (err) return <Empty title="Could not load this match">{err}</Empty>;
  if (!m || !m.played) return <Spinner label="Loading match…" />;

  const last = visible[visible.length - 1];
  const hs = last ? last.homeScore : 0; const as_ = last ? last.awayScore : 0;
  const done = clock === null;
  const minute = done ? maxMin : Math.floor(clock!);
  const home = clubOf(m.homeId); const away = clubOf(m.awayId);
  const shown = (done || !keyOnly ? visible : visible).filter((e) => !keyOnly || KEY_TYPES.has(e.type)).slice().reverse();
  const scorers = (side: 'home' | 'away') => visible.filter((e) => (e.type === 'goal' || e.type === 'penalty') && e.side === side).map((e) => `${e.playerName} ${e.minute}'${e.type === 'penalty' ? ' (pen)' : ''}`);
  const stat = (k: keyof TeamMatchStats) => [m.homeStats![k], m.awayStats![k]] as const;

  const lineupCol = (side: 'home' | 'away') => {
    const s = m[side]!; const club = side === 'home' ? home : away;
    return (
      <div className="panel-pad">
        <div className="flex items-center gap-2 mb-2"><Crest club={club} size={28} /><h3 className="text-xl font-bold flex-1 truncate">{club?.name}</h3><span className="chip">{s.formation}</span></div>
        <ol className="space-y-0.5">{s.starters.map((p, i) => p && <li key={i} className="flex items-center gap-2 text-sm"><PosTag pos={p.position} /><span className="flex-1 truncate">{p.name}{s.tactics.captainId === p.id && <span className="chip ml-1.5 !py-0">C</span>}</span><span className="num">{p.overall}</span></li>)}</ol>
        <div className="text-xs muted mt-2 mb-0.5">Bench</div>
        <ul className="text-sm text-mist-300">{s.bench.map((p, i) => p && <li key={i} className="flex gap-2"><PosTag pos={p.position} /><span className="truncate">{p.name}</span></li>)}</ul>
        {s.auto && <p className="text-xs text-gold-300 mt-2">XI was picked automatically.</p>}
      </div>
    );
  };
  const tacticsCol = (side: 'home' | 'away') => {
    const t = m[side]!.tactics; const club = side === 'home' ? home : away;
    const items: [string, string][] = [['Mentality', t.mentality.replace('_', ' ')], ['Build-up', t.buildUp], ['Pressing', t.pressing], ['Defensive line', t.defensiveLine], ['Width', t.width], ['Passing', t.passingRisk], ['Counter-attack', t.counterAttack ? 'on' : 'off']];
    return <div className="panel-pad"><div className="flex items-center gap-2 mb-2"><Crest club={club} size={28} /><h3 className="text-xl font-bold truncate">{club?.name}</h3></div><dl className="space-y-1 text-sm">{items.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="muted">{k}</dt><dd className="font-semibold capitalize">{v}</dd></div>)}</dl></div>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="h-page">Match centre</h1>
        <label className="flex items-center gap-2 text-sm"><span className="muted">Match</span>
          <select className="!w-auto" value={id} onChange={(e) => go('match', e.target.value)} aria-label="Choose a match">
            {played.map((f) => <option key={f.id} value={f.id}>MD{f.round}: {clubOf(f.homeId)?.short} {f.homeGoals}–{f.awayGoals} {clubOf(f.awayId)?.short}</option>)}
          </select></label>
      </div>

      {/* Scoreboard */}
      <div className="panel overflow-hidden relative">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-center gap-3 min-w-0 sm:justify-end text-center sm:text-right">
            <div className="min-w-0 order-2 sm:order-1"><div className="font-display text-2xl sm:text-4xl font-bold truncate">{home?.name}</div><div className="text-xs muted">{byId.get(m.homeId!)?.name} · {m.home?.formation}</div></div>
            <div className="order-1 sm:order-2"><Crest club={home} size={56} /></div>
          </div>
          <div className="text-center">
            <div className="num text-6xl sm:text-8xl font-extrabold leading-none tabular-nums">{hs}<span className="text-mist-500 mx-1.5">–</span>{as_}</div>
            <div className={`num text-lg mt-1 ${done ? 'text-gold-300' : 'text-pitch-300'}`}>{done ? 'Full time' : `${minute}'`}</div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 min-w-0 text-center sm:text-left">
            <Crest club={away} size={56} />
            <div className="min-w-0"><div className="font-display text-2xl sm:text-4xl font-bold truncate">{away?.name}</div><div className="text-xs muted">{byId.get(m.awayId!)?.name} · {m.away?.formation}</div></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 px-4 pb-3 text-xs text-mist-300"><ul className="text-right">{scorers('home').map((s, i) => <li key={i}>{s}</li>)}</ul><ul>{scorers('away').map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        {banner && <div className={`absolute inset-x-0 top-0 animate-pop px-4 py-2 text-center font-display text-2xl font-bold ${banner.type === 'red' ? 'bg-alert-500 text-white' : 'bg-gold-500 text-ink-950'}`} role="alert">{banner.type === 'red' ? 'RED CARD' : banner.type === 'penalty' ? 'PENALTY' : 'GOAL'}: {banner.playerName} ({banner.minute}')</div>}
        <div className="border-t border-ink-600 px-4 py-2.5 flex items-center gap-2 flex-wrap bg-ink-800/50">
          {done && !playing && <button className="btn-primary" onClick={() => { lastShown.current = -1; setClock(0); setPlaying(true); }}>Watch the match unfold</button>}
          {!done && <button className="btn-ghost" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Resume'}</button>}
          {!done && <button className="btn-ghost" onClick={() => { setClock(null); setPlaying(false); }}>Skip to full time</button>}
          <label className="flex items-center gap-2 text-sm ml-auto"><span className="muted">Speed</span><select className="!w-auto !py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={1}>Slow</option><option value={2}>Normal</option><option value={5}>Fast</option><option value={12}>Very fast</option></select></label>
          {!done && <div className="w-full h-1 bg-ink-500 rounded overflow-hidden"><div className="h-full bg-pitch-400" style={{ width: `${(minute / maxMin) * 100}%` }} /></div>}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[{ id: 'commentary', label: 'Commentary' }, { id: 'stats', label: 'Match stats' }, { id: 'lineups', label: 'Line-ups' }, { id: 'tactics', label: 'Tactics' }]} />

      {tab === 'commentary' && (
        <div className="panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ink-600"><span className="text-sm muted">{shown.length} entries</span>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-4 !h-4" checked={keyOnly} onChange={(e) => setKeyOnly(e.target.checked)} />Key moments only</label></div>
          <ol className="divide-y divide-ink-600 max-h-[34rem] overflow-auto scroll-thin" aria-live="off">
            {shown.map((e, i) => (
              <li key={`${e.minute}-${i}`} className={`flex gap-3 px-3 py-2 text-sm ${e.type === 'goal' || e.type === 'penalty' ? 'bg-gold-500/10' : ''}`}>
                <span className="num w-9 text-mist-400 shrink-0">{e.minute}'</span><span className="w-5 shrink-0 text-center">{ICON[e.type]}</span>
                <span className={`flex-1 ${e.type === 'goal' || e.type === 'penalty' ? 'font-semibold' : ''}`}>{e.text}{e.assistName && e.type === 'goal' ? <span className="muted"> Assist: {e.assistName}.</span> : null}</span>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-6 text-center muted">Waiting for kick-off…</li>}
          </ol>
        </div>
      )}
      {tab === 'stats' && (
        <div className="panel-pad space-y-3 max-w-2xl">
          <div className="flex justify-between font-display text-xl font-bold"><span>{home?.short}</span><span>{away?.short}</span></div>
          <StatRow label="Possession" h={stat('possession')[0]} a={stat('possession')[1]} pct />
          <StatRow label="Shots" h={stat('shots')[0]} a={stat('shots')[1]} />
          <StatRow label="Shots on target" h={stat('shotsOnTarget')[0]} a={stat('shotsOnTarget')[1]} />
          <StatRow label="Passes" h={stat('passes')[0]} a={stat('passes')[1]} />
          <StatRow label="Pass accuracy" h={stat('passAccuracy')[0]} a={stat('passAccuracy')[1]} pct />
          <StatRow label="Corners" h={stat('corners')[0]} a={stat('corners')[1]} />
          <StatRow label="Fouls" h={stat('fouls')[0]} a={stat('fouls')[1]} />
          <StatRow label="Yellow cards" h={stat('yellows')[0]} a={stat('yellows')[1]} />
          <StatRow label="Red cards" h={stat('reds')[0]} a={stat('reds')[1]} />
          <StatRow label="Saves" h={stat('saves')[0]} a={stat('saves')[1]} />
          {!done && <p className="text-xs text-mist-500">Final match statistics. They are not split by minute.</p>}
        </div>
      )}
      {tab === 'lineups' && <div className="grid md:grid-cols-2 gap-4">{lineupCol('home')}{lineupCol('away')}</div>}
      {tab === 'tactics' && <div className="grid md:grid-cols-2 gap-4">{tacticsCol('home')}{tacticsCol('away')}</div>}
    </div>
  );
}
