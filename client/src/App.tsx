import { useEffect, useState, type ReactNode } from 'react';
import type { Phase } from '@fa/shared';
import { connect, getState, loadCatalog, useStore } from './store';
import { Crest, Spinner, useGame, type Game } from './ui';
import Landing from './screens/Landing';
import Lobby from './screens/Lobby';
import Auction from './screens/Auction';
import History from './screens/History';
import Reveal from './screens/Reveal';
import Matchday from './screens/Matchday';
import Lineup from './screens/Lineup';
import Tactics from './screens/Tactics';
import Squad from './screens/Squad';
import League from './screens/League';
import Fixtures from './screens/Fixtures';
import Stats from './screens/Stats';
import Match from './screens/Match';
import Season from './screens/Season';
import Settings from './screens/Settings';

export type View = 'lobby' | 'settings' | 'auction' | 'history' | 'squads' | 'reveal' | 'matchday' | 'lineup' | 'tactics' | 'squad' | 'table' | 'fixtures' | 'stats' | 'match' | 'season';

const NAV: Record<Phase, { id: View; label: string }[]> = {
  lobby: [{ id: 'lobby', label: 'Lobby' }, { id: 'settings', label: 'Room' }],
  auction: [{ id: 'auction', label: 'Live auction' }, { id: 'history', label: 'Auction history' }, { id: 'squads', label: 'Squads' }, { id: 'settings', label: 'Room' }],
  review: [{ id: 'reveal', label: 'Squad reveal' }, { id: 'history', label: 'Auction history' }, { id: 'settings', label: 'Room' }],
  prepare: [{ id: 'matchday', label: 'Schedule' }, { id: 'lineup', label: 'Starting XI' }, { id: 'tactics', label: 'Tactics' }, { id: 'squad', label: 'My squad' }, { id: 'fixtures', label: 'Fixtures' }, { id: 'table', label: 'Table' }, { id: 'history', label: 'Auction history' }, { id: 'settings', label: 'Room' }],
  league: [{ id: 'matchday', label: 'Matchday' }, { id: 'lineup', label: 'Starting XI' }, { id: 'tactics', label: 'Tactics' }, { id: 'squad', label: 'My squad' }, { id: 'table', label: 'Table' }, { id: 'fixtures', label: 'Fixtures' }, { id: 'stats', label: 'Player stats' }, { id: 'match', label: 'Match centre' }, { id: 'settings', label: 'Room' }],
  season_end: [{ id: 'season', label: 'Season' }, { id: 'table', label: 'Table' }, { id: 'fixtures', label: 'Results' }, { id: 'stats', label: 'Player stats' }, { id: 'match', label: 'Match centre' }, { id: 'squad', label: 'My squad' }, { id: 'settings', label: 'Room' }],
};
const DEFAULT_VIEW: Record<Phase, View> = { lobby: 'lobby', auction: 'auction', review: 'reveal', prepare: 'matchday', league: 'matchday', season_end: 'season' };
const PHASE_LABEL: Record<Phase, string> = { lobby: 'Lobby', auction: 'Auction', review: 'Squad reveal', prepare: 'Pre-season', league: 'League', season_end: 'Season complete' };

function parseHash(): { view: string; arg: string } {
  const [, view = '', arg = ''] = location.hash.replace(/^#/, '').split('/');
  return { view, arg };
}
export function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => { const h = () => setR(parseHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return r;
}
export const go = (view: View, arg?: string) => { location.hash = `#/${view}${arg ? `/${arg}` : ''}`; window.scrollTo({ top: 0 }); };

function Banner({ tone, children }: { tone: 'warn' | 'bad'; children: ReactNode }) {
  return <div role="status" className={`px-4 py-2 text-sm text-center ${tone === 'warn' ? 'bg-gold-500/15 text-gold-300' : 'bg-alert-500/15 text-alert-400'}`}>{children}</div>;
}

export default function App() {
  const session = useStore((s) => s.session);
  const conn = useStore((s) => s.conn);
  const snap = useStore((s) => s.snap);
  const catalog = useStore((s) => s.catalog);
  const catalogError = useStore((s) => s.catalogError);
  const lastError = useStore((s) => s.lastError);
  const toasts = useStore((s) => s.toasts);
  const route = useRoute();
  const game = useGame();

  useEffect(() => { void loadCatalog(); connect(); }, []);

  if (!session) return <><Landing error={lastError} />{toasts.length > 0 && <Toasts />}</>;

  if (catalogError && !catalog) {
    return <Centered><p className="text-alert-400 mb-3">Could not load the player database: {catalogError}</p><button className="btn-primary" onClick={() => void loadCatalog()}>Try again</button></Centered>;
  }
  if (!snap || !catalog || !game) {
    return <Centered><Spinner label={conn === 'reconnecting' ? 'Reconnecting to your room…' : 'Loading your room…'} />
      {conn === 'reconnecting' && <p className="muted text-sm mt-3">Your progress is saved on the server. This will resume automatically.</p>}</Centered>;
  }

  const nav = NAV[snap.room.phase];
  const view: View = (nav.some((n) => n.id === route.view) ? route.view : DEFAULT_VIEW[snap.room.phase]) as View;
  const myClub = game.clubOf(game.me.id);

  return (
    <div className="min-h-screen flex flex-col">
      {conn !== 'online' && <Banner tone="bad">Connection lost. Reconnecting… your seat and progress are kept.</Banner>}
      <header className="border-b border-ink-600 bg-ink-800/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="font-display text-xl font-bold tracking-wide mr-1"><span className="text-pitch-400">Auction</span> League</div>
          <span className="chip">{PHASE_LABEL[snap.room.phase]}{snap.room.season > 1 ? ` · Season ${snap.room.season}` : ''}</span>
          <span className="chip" title="Room code">Room {snap.room.code}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-sm"><Crest club={myClub} size={24} /><span className="font-semibold">{game.me.name}</span>{game.isHost && <span className="chip text-gold-300">Host</span>}</div>
        </div>
        <nav aria-label="Sections" className="max-w-7xl mx-auto px-4 pb-2"><div className="flex gap-1 overflow-x-auto scroll-thin">
          {nav.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} aria-current={view === n.id ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${view === n.id ? 'bg-ink-500 text-mist-100 shadow-[inset_0_-2px_0_theme(colors.pitch.400)]' : 'text-mist-400 hover:text-mist-100 hover:bg-ink-600'}`}>{n.label}</button>
          ))}
        </div></nav>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5"><Screen view={view} game={game} arg={route.arg} /></main>
      <footer className="max-w-7xl mx-auto w-full px-4 py-4 text-xs text-mist-500">
        Player data: {catalog.dataset.season} · updated {catalog.dataset.lastUpdated}. Ratings are estimates, not an official feed.
      </footer>
      <Toasts />
    </div>
  );
}

function Screen({ view, game, arg }: { view: View; game: Game; arg: string }) {
  switch (view) {
    case 'lobby': return <Lobby game={game} />;
    case 'settings': return <Settings game={game} />;
    case 'auction': return <Auction game={game} />;
    case 'history': return <History game={game} />;
    case 'squads': return <Reveal game={game} live />;
    case 'reveal': return <Reveal game={game} />;
    case 'matchday': return <Matchday game={game} />;
    case 'lineup': return <Lineup game={game} />;
    case 'tactics': return <Tactics game={game} />;
    case 'squad': return <Squad game={game} />;
    case 'table': return <League game={game} />;
    case 'fixtures': return <Fixtures game={game} />;
    case 'stats': return <Stats game={game} />;
    case 'match': return <Match game={game} fixtureId={arg} />;
    case 'season': return <Season game={game} />;
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen grid place-items-center p-6"><div className="text-center flex flex-col items-center">{children}</div></div>;
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  void getState;
  return (
    <div aria-live="polite" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,28rem)]">
      {toasts.map((t) => (
        <div key={t.id} className={`animate-pop rounded-lg px-4 py-3 text-sm shadow-xl border ${t.kind === 'error' ? 'bg-ink-800 border-alert-500/60 text-alert-400' : t.kind === 'good' ? 'bg-ink-800 border-pitch-500/60 text-pitch-300' : 'bg-ink-800 border-ink-500 text-mist-100'}`}>{t.text}</div>
      ))}
    </div>
  );
}
