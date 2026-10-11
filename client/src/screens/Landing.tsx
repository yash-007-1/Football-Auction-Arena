import { useState, type FormEvent } from 'react';
import { api, enterRoom } from '../store';
import { Tabs } from '../ui';

const STEPS = [
  ['Create a room', 'Share the six-letter code with up to nine friends.'],
  ['Pick your clubs', 'Each manager takes one real club. No two the same.'],
  ['Auction real players', 'Everyone starts with €1,000M. Highest bid wins when the clock runs out.'],
  ['Play the season', 'Set your XI and tactics, then simulate every matchday together.'],
];

function lastName(): string { try { return localStorage.getItem('fa.name') ?? ''; } catch { return ''; } }

export default function Landing({ error }: { error: string | null }) {
  const [mode, setMode] = useState<'create' | 'join'>(() => (new URLSearchParams(location.search).get('room') ? 'join' : 'create'));
  const [name, setName] = useState(lastName());
  const [code, setCode] = useState((new URLSearchParams(location.search).get('room') ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const r = mode === 'create' ? await api<{ code: string; token: string; participantId: number }>('/rooms', { name }) : await api<{ code: string; token: string; participantId: number }>('/rooms/join', { name, code });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    try { localStorage.setItem('fa.name', name.trim()); } catch { /* optional */ }
    history.replaceState(null, '', location.pathname);
    enterRoom({ code: r.data!.code, token: r.data!.token, participantId: r.data!.participantId, name: name.trim() });
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 py-8 sm:py-14 grid lg:grid-cols-[1.25fr_1fr] gap-10 items-center">
        <div>
          <div className="font-display text-xl font-bold text-pitch-400 mb-3">Auction League</div>
          <h1 className="font-display font-extrabold leading-[.92] text-6xl sm:text-8xl">Outbid your friends.<br />Win the league.</h1>
          <p className="text-mist-300 text-lg mt-5 max-w-xl">A football club auction for up to ten managers, followed by a full simulated season. Bid on real footballers, build a squad inside your budget, then play every fixture.</p>
          <ol className="mt-8 grid sm:grid-cols-2 gap-3">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="num text-3xl font-bold text-gold-400 w-7 shrink-0 leading-none pt-0.5">{i + 1}</span>
                <span><span className="block font-semibold">{t}</span><span className="text-sm muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>

        <form onSubmit={submit} className="panel-pad space-y-4 shadow-2xl shadow-black/40">
          <Tabs value={mode} onChange={(m) => { setMode(m); setErr(null); }} items={[{ id: 'create', label: 'Create a room' }, { id: 'join', label: 'Join a room' }]} />
          {(error || err) && <div role="alert" className="rounded-lg bg-alert-500/10 border border-alert-500/40 text-alert-400 text-sm px-3 py-2">{err ?? error}</div>}
          <label className="block"><span className="text-sm text-mist-300">Your manager name</span>
            <input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} minLength={2} required autoComplete="nickname" placeholder="e.g. Yash" /></label>
          {mode === 'join' && (
            <label className="block"><span className="text-sm text-mist-300">Room code</span>
              <input className="mt-1 num text-2xl tracking-[.3em] uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} required minLength={6} maxLength={6} inputMode="text" autoCapitalize="characters" placeholder="ABC234" /></label>
          )}
          <button className="btn-primary btn-lg w-full" disabled={busy || name.trim().length < 2 || (mode === 'join' && code.length < 6)}>
            {busy ? 'One moment…' : mode === 'create' ? 'Create room' : 'Join room'}
          </button>
          <p className="text-xs text-mist-500">{mode === 'create' ? 'You will be the host. You choose when the auction and the league start.' : 'Joined mid-way? Rooms only accept new managers before the auction starts. To return to a game, open it on the same device.'}</p>
        </form>
      </div>
    </div>
  );
}
