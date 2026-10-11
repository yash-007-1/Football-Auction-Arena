import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CatalogClub, CatalogPlayer, SnapshotParticipant } from '@fa/shared';
import { useCatalog, useSnap, serverNow } from './store';

/* ------------------------------------------------------------------ game context helpers */

export function useGame() {
  const snap = useSnap();
  const catalog = useCatalog();
  return useMemo(() => {
    if (!snap || !catalog) return null;
    const byId = new Map(snap.participants.map((p) => [p.id, p]));
    const me = byId.get(snap.me.participantId)!;
    const clubOf = (pid: number | null | undefined): CatalogClub | undefined => {
      const p = pid ? byId.get(pid) : undefined;
      return p && p.clubId !== null ? catalog.clubById.get(p.clubId) : undefined;
    };
    const ownerOf = new Map(snap.squads.map((s) => [s.playerId, s]));
    return { snap, catalog, byId, me, isHost: snap.me.isHost, clubOf, ownerOf, clubName: (pid: number) => clubOf(pid)?.name ?? byId.get(pid)?.name ?? 'Unknown' };
  }, [snap, catalog]);
}
export type Game = NonNullable<ReturnType<typeof useGame>>;

export const money = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `€${m.toLocaleString('en-GB')}M`);

/* ------------------------------------------------------------------ small components */

export function Crest({ club, size = 32 }: { club?: Pick<CatalogClub, 'short' | 'color1' | 'color2' | 'logoUrl'> | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (club?.logoUrl && !broken) return <img src={club.logoUrl} alt="" width={size} height={size} onError={() => setBroken(true)} className="object-contain shrink-0" />;
  const c1 = club?.color1 ?? '#1d2e4d'; const c2 = club?.color2 ?? '#c3cde0';
  return (
    <span aria-hidden className="shrink-0 grid place-items-center font-display font-bold leading-none select-none"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${c1} 0 58%, ${c2} 58% 100%)`, borderRadius: size * 0.28, fontSize: size * 0.36, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.7)' }}>
      {club?.short ?? '?'}
    </span>
  );
}

const POS_TONE: Record<string, string> = { GK: 'bg-gold-500/20 text-gold-300', CB: 'bg-sky-500/15 text-sky-300', LB: 'bg-sky-500/15 text-sky-300', RB: 'bg-sky-500/15 text-sky-300',
  CDM: 'bg-pitch-500/15 text-pitch-300', CM: 'bg-pitch-500/15 text-pitch-300', LM: 'bg-pitch-500/15 text-pitch-300', RM: 'bg-pitch-500/15 text-pitch-300', CAM: 'bg-pitch-500/15 text-pitch-300',
  LW: 'bg-alert-500/15 text-alert-400', RW: 'bg-alert-500/15 text-alert-400', ST: 'bg-alert-500/15 text-alert-400' };
export const PosTag = ({ pos }: { pos: string }) => <span className={`inline-block min-w-[2.4rem] text-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${POS_TONE[pos] ?? 'bg-ink-600'}`}>{pos}</span>;

export function Rating({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const tone = value >= 88 ? 'text-gold-400' : value >= 82 ? 'text-pitch-300' : value >= 76 ? 'text-mist-100' : 'text-mist-400';
  const sz = size === 'lg' ? 'text-7xl' : size === 'md' ? 'text-2xl' : 'text-lg';
  return <span className={`num font-bold leading-none ${tone} ${sz}`}>{value}</span>;
}

export function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const parts = name.split(' ').filter(Boolean);
  const text = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
  return <span aria-hidden className="shrink-0 grid place-items-center rounded-full bg-ink-500 text-mist-300 font-display font-semibold" style={{ width: size, height: size, fontSize: size * 0.4 }}>{text}</span>;
}

export function PlayerAvatar({ p, size = 40 }: { p: Pick<CatalogPlayer, 'name' | 'photoUrl'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (p.photoUrl && !broken) return <img src={p.photoUrl} alt="" width={size} height={size} onError={() => setBroken(true)} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return <Initials name={p.name} size={size} />;
}

export function AttrBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-mist-400">{label}</span>
      <div className="flex-1 h-1.5 rounded bg-ink-500 overflow-hidden"><div className="h-full rounded bg-pitch-400" style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="num w-6 text-right text-sm">{value}</span>
    </div>
  );
}

export function Condition({ value }: { value: number }) {
  const tone = value >= 80 ? 'bg-pitch-400' : value >= 60 ? 'bg-gold-500' : 'bg-alert-500';
  return <span title={`Condition ${Math.round(value)}%`} className="inline-block w-10 h-1.5 rounded bg-ink-500 overflow-hidden align-middle"><span className={`block h-full ${tone}`} style={{ width: `${value}%` }} /></span>;
}

export function Dot({ on, label }: { on: boolean; label?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-mist-400"><span className={`inline-block w-2 h-2 rounded-full ${on ? 'bg-pitch-400' : 'bg-alert-500'}`} />{label ?? (on ? 'Online' : 'Offline')}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return <div role="status" className="flex items-center gap-3 text-mist-400"><span className="w-5 h-5 rounded-full border-2 border-ink-500 border-t-pitch-400 animate-spin" />{label && <span>{label}</span>}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="panel-pad text-center py-10"><div className="font-display text-xl text-mist-100">{title}</div>{children && <div className="muted mt-1 text-sm max-w-md mx-auto">{children}</div>}</div>;
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-ink-950/80" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="panel-pad max-w-md w-full animate-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold mb-2">{title}</h2>
        <div className="text-mist-300 text-sm space-y-2">{children}</div>
        <div className="flex justify-end gap-2 mt-5">{actions}</div>
      </div>
    </div>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap"><h2 className="text-2xl font-bold">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

/** Seconds (fractional) left until a server-time deadline; re-renders ~10x per second. */
export function useCountdown(endsAt: number | null | undefined): number | null {
  const [, tick] = useState(0);
  useEffect(() => { if (!endsAt) return; const id = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(id); }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, (endsAt - serverNow()) / 1000);
}

export const leagueOrder = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];

export function ManagerName({ p, game }: { p: SnapshotParticipant; game: Game }) {
  const club = game.clubOf(p.id);
  return <span className="inline-flex items-center gap-2 min-w-0"><Crest club={club} size={22} /><span className="truncate">{club?.name ?? p.name}</span></span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto scroll-thin">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${value === i.id ? 'bg-pitch-500 text-ink-950' : 'bg-ink-600 text-mist-300 hover:bg-ink-500'}`}>{i.label}</button>
      ))}
    </div>
  );
}
