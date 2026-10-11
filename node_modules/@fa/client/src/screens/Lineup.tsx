import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { FORMATIONS, FORMATION_IDS, MAX_BENCH, UNSUITABLE_PENALTY, autoPickLineup, positionPenalty, validateLineup, type FormationId, type Lineup as LineupT, type SimPlayer } from '@fa/shared';
import { act, toSimPlayer, toast } from '../store';
import { Condition, Empty, PosTag, Rating, type Game } from '../ui';

type Target = { k: 'slot'; i: number } | { k: 'bench' } | { k: 'reserve' };
type Pick = { t: 'slot'; i: number } | { t: 'player'; id: number } | null;

export function placePlayer(l: LineupT, id: number, target: Target): LineupT {
  const slots = [...l.slots]; let bench = [...l.bench];
  const fromSlot = slots.indexOf(id); const inBench = bench.includes(id);
  if (target.k === 'slot') {
    if (fromSlot === target.i) return l;
    const occupant = slots[target.i];
    if (fromSlot >= 0) slots[fromSlot] = occupant;
    else if (inBench) { bench = bench.filter((x) => x !== id); if (occupant !== null) bench.push(occupant); }
    else if (occupant !== null && bench.length < MAX_BENCH) bench.push(occupant);
    slots[target.i] = id;
  } else if (target.k === 'bench') {
    if (inBench || bench.length >= MAX_BENCH) return l;
    if (fromSlot >= 0) slots[fromSlot] = null;
    bench.push(id);
  } else {
    if (fromSlot >= 0) slots[fromSlot] = null;
    bench = bench.filter((x) => x !== id);
  }
  return { ...l, slots, bench };
}

function MiniFormation({ id, active }: { id: FormationId; active: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width="34" height="42" aria-hidden className={active ? 'text-ink-950' : 'text-mist-400'}>
      {FORMATIONS[id].map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={7} fill="currentColor" />)}
    </svg>
  );
}

export default function Lineup({ game }: { game: Game }) {
  const { snap, catalog, me } = game;
  const match = snap.me.match;
  const squad: SimPlayer[] = useMemo(() => snap.squads.filter((s) => s.participantId === me.id).map((s) => { const p = catalog.playerById.get(s.playerId); return p ? toSimPlayer(p, s.condition) : null; }).filter((x): x is SimPlayer => !!x), [snap.squads, catalog, me.id]);
  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const serverKey = match ? `${match.fixtureId}|${JSON.stringify(match.lineup)}` : '';
  const [draft, setDraft] = useState<LineupT | null>(match?.lineup ?? null);
  const [pick, setPick] = useState<Pick>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (match) { setDraft(match.lineup); setPick(null); } }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (snap.me.bye) return <Empty title="You have a bye">There is no match to prepare for this matchday.</Empty>;
  if (!match || !draft) return <Empty title="No upcoming match">Your lineup can be edited once a fixture is available.</Empty>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(match.lineup);
  const check = validateLineup(draft, squad);
  const slots = FORMATIONS[draft.formation];
  const inXI = new Set(draft.slots.filter((x): x is number => x !== null));
  const reserves = squad.filter((p) => !inXI.has(p.id) && !draft.bench.includes(p.id)).sort((a, b) => b.overall - a.overall);
  const opp = game.clubOf(match.opponentId);

  const apply = (next: LineupT) => { if (next === draft) { if (pick?.t === 'player') toast(`The bench is full (${MAX_BENCH}).`, 'info'); return; } setDraft(next); };
  const setFormation = (f: FormationId) => {
    const starters = squad.filter((p) => inXI.has(p.id));
    const re = autoPickLineup(starters, f);
    const used = new Set(re.slots.filter((x): x is number => x !== null));
    setDraft({ formation: f, slots: re.slots, bench: draft.bench.filter((id) => !used.has(id)) });
    setPick(null);
  };
  const onSlot = (i: number) => {
    if (pick?.t === 'player') { apply(placePlayer(draft, pick.id, { k: 'slot', i })); setPick(null); }
    else if (pick?.t === 'slot') { const a = draft.slots[pick.i]; if (pick.i !== i) { const s = [...draft.slots]; s[pick.i] = draft.slots[i]; s[i] = a; setDraft({ ...draft, slots: s }); } setPick(null); }
    else setPick({ t: 'slot', i });
  };
  const onPlayer = (id: number) => {
    if (pick?.t === 'slot') { apply(placePlayer(draft, id, { k: 'slot', i: pick.i })); setPick(null); }
    else setPick(pick?.t === 'player' && pick.id === id ? null : { t: 'player', id });
  };
  const drop = (e: DragEvent, target: Target) => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')); if (byId.has(id)) { apply(placePlayer(draft, id, target)); setPick(null); } };
  const dragProps = (id: number) => ({ draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/plain', String(id)); e.dataTransfer.effectAllowed = 'move'; } });
  const over = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  async function save() {
    setSaving(true);
    const r = await act({ type: 'lineup.save', lineup: draft! });
    setSaving(false);
    if (r.ok) toast('Starting XI saved for this match', 'good');
  }

  const row = (p: SimPlayer, extra?: string) => {
    const selected = pick?.t === 'player' && pick.id === p.id;
    const pen = extra ? 0 : 0;
    void pen;
    return (
      <li key={p.id}>
        <button {...dragProps(p.id)} onClick={() => onPlayer(p.id)} aria-pressed={selected}
          className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left border ${selected ? 'border-gold-400 bg-gold-500/10' : 'border-transparent hover:bg-ink-600'}`}>
          <PosTag pos={p.position} /><span className="flex-1 truncate text-sm font-medium">{p.name}</span>
          <Condition value={p.condition} /><Rating value={p.overall} size="sm" />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="h-page">Starting XI</h1>
          <p className="muted mt-1">Matchday {match.round}: {match.home ? 'home' : 'away'} {match.home ? 'against' : 'at'} <span className="text-mist-100 font-semibold">{opp?.name}</span>. Your lineup is saved separately for each match.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="btn-ghost" onClick={() => { setDraft(autoPickLineup(squad, draft.formation)); setPick(null); }}>Pick best XI</button>
          <button className="btn-ghost" disabled={!dirty} onClick={() => { setDraft(match.lineup); setPick(null); }}>Undo changes</button>
          <button className="btn-primary" disabled={!dirty || !check.valid || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save lineup' : match.auto ? 'Save this XI' : 'Saved'}</button>
        </div>
      </div>
      {match.auto && !dirty && <div className="rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 text-sm px-3 py-2">This XI was picked automatically. Save it, or change it, to lock in your choice. If you do nothing it is used as it is.</div>}

      <div role="group" aria-label="Formation" className="flex gap-2 overflow-x-auto scroll-thin pb-1">
        {FORMATION_IDS.map((f) => (
          <button key={f} onClick={() => setFormation(f)} aria-pressed={draft.formation === f} className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 border ${draft.formation === f ? 'bg-pitch-500 border-pitch-400 text-ink-950' : 'bg-ink-700 border-ink-500 hover:border-pitch-500'}`}>
            <MiniFormation id={f} active={draft.formation === f} /><span className="num text-sm font-bold">{f}</span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,26rem)_1fr] gap-5">
        {/* Pitch */}
        <div>
          <div className="relative rounded-xl overflow-hidden border border-pitch-700 select-none" style={{ aspectRatio: '2 / 3', background: 'repeating-linear-gradient(0deg, #0d6b38 0 12.5%, #0f7640 12.5% 25%)' }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".6">
              <rect x="4" y="4" width="92" height="142" /><line x1="4" y1="75" x2="96" y2="75" /><circle cx="50" cy="75" r="13" />
              <rect x="22" y="4" width="56" height="22" /><rect x="36" y="4" width="28" height="9" /><rect x="22" y="124" width="56" height="22" /><rect x="36" y="137" width="28" height="9" />
            </svg>
            {slots.map((slot, i) => {
              const id = draft.slots[i]; const p = id !== null ? byId.get(id) : undefined;
              const pen = p ? positionPenalty(p, slot.pos) : 0;
              const selected = pick?.t === 'slot' && pick.i === i;
              return (
                <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${slot.x}%`, top: `${slot.y * 0.93 + 3}%`, width: '22%' }} onDragOver={over} onDrop={(e) => drop(e, { k: 'slot', i })}>
                  <button {...(p ? dragProps(p.id) : {})} onClick={() => onSlot(i)} aria-label={p ? `${slot.pos}: ${p.name}, rating ${p.overall}` : `Empty ${slot.pos} position`} aria-pressed={selected} className="w-full flex flex-col items-center gap-0.5 group">
                    <span className={`grid place-items-center rounded-full w-11 h-11 sm:w-12 sm:h-12 border-2 transition-transform group-hover:scale-105 ${selected ? 'border-gold-400 scale-110' : pen >= UNSUITABLE_PENALTY ? 'border-alert-400 border-dashed' : pen > 0 ? 'border-gold-500' : 'border-white/80'} ${p ? 'bg-ink-900/85' : 'bg-ink-900/40 border-dashed'}`}>
                      {p ? <Rating value={p.overall} size="md" /> : <span className="text-xs text-white/70 font-semibold">{slot.pos}</span>}
                    </span>
                    <span className="text-[11px] leading-tight font-semibold text-white drop-shadow max-w-full truncate bg-ink-950/55 rounded px-1">{p ? p.name.split(' ').slice(-1)[0] : 'Empty'}</span>
                    <span className="text-[10px] text-white/80 leading-none">{slot.pos}{p && pen > 0 ? ` · −${pen}` : ''}</span>
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-mist-500 mt-2">Click a player then a position, or drag and drop. A dashed red ring means the player is well out of position; their rating drops by the number shown.</p>
        </div>

        {/* Lists */}
        <div className="space-y-4">
          <div className={`rounded-xl border px-3 py-2 text-sm ${check.errors.length ? 'border-alert-500/50 bg-alert-500/10 text-alert-400' : check.warnings.length ? 'border-gold-500/40 bg-gold-500/10 text-gold-300' : 'border-pitch-500/40 bg-pitch-500/10 text-pitch-300'}`} role="status">
            {check.errors.length === 0 && check.warnings.length === 0 && 'Lineup is valid. No warnings.'}
            {check.errors.length > 0 && <><div className="font-semibold">Fix before saving</div><ul className="list-disc pl-5">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
            {check.warnings.length > 0 && <><div className="font-semibold mt-1">{check.errors.length ? 'Also note' : 'Heads up'}</div><ul className="list-disc pl-5">{check.warnings.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul></>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="panel-pad">
              <h2 className="text-xl font-bold mb-2">Starting XI <span className="muted text-base">{inXI.size}/11</span></h2>
              <ul className="space-y-0.5">{slots.map((s, i) => { const id = draft.slots[i]; const p = id !== null ? byId.get(id) : undefined; return p ? row(p) : <li key={i}><button onClick={() => onSlot(i)} className="w-full text-left text-sm text-mist-500 border border-dashed border-ink-500 rounded-lg px-2 py-1.5">Empty {s.pos}</button></li>; })}</ul>
            </div>
            <div className="space-y-4">
              <div className="panel-pad" onDragOver={over} onDrop={(e) => drop(e, { k: 'bench' })}>
                <div className="flex items-center justify-between mb-2"><h2 className="text-xl font-bold">Bench <span className="muted text-base">{draft.bench.length}/{MAX_BENCH}</span></h2>
                  {pick?.t === 'player' && !draft.bench.includes(pick.id) && <button className="btn-ghost !py-1 text-xs" onClick={() => { apply(placePlayer(draft, pick.id, { k: 'bench' })); setPick(null); }}>Move to bench</button>}</div>
                <ul className="space-y-0.5 min-h-[2.5rem]">{draft.bench.map((id) => byId.get(id)).filter((p): p is SimPlayer => !!p).map((p) => row(p))}{draft.bench.length === 0 && <li className="text-sm text-mist-500">Drop players here. Up to 5 come on automatically around minutes 60, 72 and 82.</li>}</ul>
              </div>
              <div className="panel-pad" onDragOver={over} onDrop={(e) => drop(e, { k: 'reserve' })}>
                <div className="flex items-center justify-between mb-2"><h2 className="text-xl font-bold">Not in the matchday squad <span className="muted text-base">{reserves.length}</span></h2>
                  {pick?.t === 'player' && (inXI.has(pick.id) || draft.bench.includes(pick.id)) && <button className="btn-ghost !py-1 text-xs" onClick={() => { apply(placePlayer(draft, pick.id, { k: 'reserve' })); setPick(null); }}>Remove</button>}</div>
                <ul className="space-y-0.5 max-h-72 overflow-auto scroll-thin">{reserves.map((p) => row(p))}{reserves.length === 0 && <li className="text-sm text-mist-500">Everyone is in the XI or on the bench.</li>}</ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
