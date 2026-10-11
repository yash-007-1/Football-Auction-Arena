import { useEffect, useMemo, useState } from 'react';
import { COUNTER_HELP, DEFAULT_TACTICS, SETPIECE_HELP, TACTIC_OPTIONS, type Tactics as TacticsT } from '@fa/shared';
import { act, toast } from '../store';
import { Empty, type Game } from '../ui';

export default function Tactics({ game }: { game: Game }) {
  const { snap, catalog } = game;
  const match = snap.me.match;
  const key = match ? `${match.fixtureId}|${JSON.stringify(match.tactics)}` : '';
  const [t, setT] = useState<TacticsT>(match?.tactics ?? DEFAULT_TACTICS);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (match) setT(match.tactics); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const squad = useMemo(() => snap.squads.filter((s) => s.participantId === game.me.id).map((s) => catalog.playerById.get(s.playerId)).filter((p): p is NonNullable<typeof p> => !!p).sort((a, b) => b.overall - a.overall), [snap.squads, catalog, game.me.id]);

  if (snap.me.bye) return <Empty title="You have a bye">There is no match to prepare for this matchday.</Empty>;
  if (!match) return <Empty title="No upcoming match" />;
  const dirty = JSON.stringify(t) !== JSON.stringify(match.tactics);
  const starters = new Set(match.lineup.slots);
  const startingPlayers = squad.filter((p) => starters.has(p.id));

  async function save() {
    setSaving(true);
    const r = await act({ type: 'tactics.save', tactics: t });
    setSaving(false);
    if (r.ok) toast('Tactics saved for this match', 'good');
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="h-page">Tactics</h1><p className="muted mt-1">Every setting changes the match simulation. Saved for matchday {match.round} against {game.clubOf(match.opponentId)?.name}; they carry over to later matches until you change them.</p></div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setT({ ...DEFAULT_TACTICS, setPieceTakerId: t.setPieceTakerId, captainId: t.captainId })}>Reset to balanced</button>
          <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save tactics' : 'Saved'}</button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {TACTIC_OPTIONS.map((opt) => {
          const cur = t[opt.key] as string;
          const help = opt.options.find((o) => o.value === cur)?.help;
          return (
            <fieldset key={opt.key} className="panel-pad">
              <legend className="sr-only">{opt.label}</legend>
              <h2 className="text-xl font-bold mb-2">{opt.label}</h2>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={opt.label}>
                {opt.options.map((o) => (
                  <button key={o.value} role="radio" aria-checked={cur === o.value} onClick={() => setT({ ...t, [opt.key]: o.value } as TacticsT)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${cur === o.value ? 'bg-pitch-500 text-ink-950' : 'bg-ink-600 text-mist-300 hover:bg-ink-500'}`}>{o.label}</button>
                ))}
              </div>
              <p className="text-sm text-mist-300 mt-2 min-h-[3rem]">{help}</p>
            </fieldset>
          );
        })}
        <fieldset className="panel-pad">
          <h2 className="text-xl font-bold mb-2">Counter-attacking</h2>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Counter-attacking">
            {[true, false].map((v) => <button key={String(v)} role="radio" aria-checked={t.counterAttack === v} onClick={() => setT({ ...t, counterAttack: v })} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${t.counterAttack === v ? 'bg-pitch-500 text-ink-950' : 'bg-ink-600 text-mist-300 hover:bg-ink-500'}`}>{v ? 'On' : 'Off'}</button>)}
          </div>
          <p className="text-sm text-mist-300 mt-2">{COUNTER_HELP}</p>
        </fieldset>
        <fieldset className="panel-pad space-y-3">
          <h2 className="text-xl font-bold">Captain and set pieces</h2>
          <label className="block text-sm">Captain
            <select value={t.captainId ?? ''} onChange={(e) => setT({ ...t, captainId: e.target.value ? Number(e.target.value) : null })}><option value="">Not chosen</option>{squad.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position}, {p.overall}){starters.has(p.id) ? '' : ' – not starting'}</option>)}</select></label>
          <label className="block text-sm">Penalty and set-piece taker
            <select value={t.setPieceTakerId ?? ''} onChange={(e) => setT({ ...t, setPieceTakerId: e.target.value ? Number(e.target.value) : null })}><option value="">Best shooter on the pitch</option>{startingPlayers.map((p) => <option key={p.id} value={p.id}>{p.name} (shooting {p.shooting})</option>)}</select></label>
          <p className="text-xs text-mist-500">{SETPIECE_HELP}</p>
        </fieldset>
      </div>
    </div>
  );
}
