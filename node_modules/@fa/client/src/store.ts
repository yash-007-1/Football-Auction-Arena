import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, Action, AuctionPatch, CatalogClub, CatalogPlayer, DatasetInfo, SimPlayer, Snapshot } from '@fa/shared';

export interface Session { code: string; token: string; participantId: number; name: string }
export type Conn = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'denied';
export interface Catalog { clubs: CatalogClub[]; players: CatalogPlayer[]; dataset: DatasetInfo; clubById: Map<number, CatalogClub>; playerById: Map<number, CatalogPlayer> }
export interface Toast { id: number; kind: 'error' | 'info' | 'good'; text: string }

interface State {
  session: Session | null; conn: Conn; snap: Snapshot | null; catalog: Catalog | null; catalogError: string | null;
  /** serverNow - Date.now(), so countdowns agree with the server clock on every device. */
  offset: number; toasts: Toast[]; lastError: string | null;
}

const KEY = 'fa.session.v1';
function loadSession(): Session | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function saveSession(s: Session | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage unavailable: session lasts until reload */ }
}

let state: State = { session: loadSession(), conn: 'idle', snap: null, catalog: null, catalogError: null, offset: 0, toasts: [], lastError: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useStore = <T,>(sel: (s: State) => T): T => useSyncExternalStore(subscribe, () => sel(state));
export const getState = () => state;

let socket: Socket | null = null;
let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = toastId++;
  set({ toasts: [...state.toasts, { id, kind, text }] });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3500);
}

export async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const d = (await res.json()) as { clubs: CatalogClub[]; players: CatalogPlayer[]; dataset: DatasetInfo };
    set({ catalog: { ...d, clubById: new Map(d.clubs.map((c) => [c.id, c])), playerById: new Map(d.players.map((p) => [p.id, p])) }, catalogError: null });
  } catch (e) { set({ catalogError: e instanceof Error ? e.message : 'Could not load players and clubs.' }); }
}

export function connect() {
  const s = state.session;
  if (!s || socket) return;
  set({ conn: 'connecting' });
  socket = io({ auth: { code: s.code, token: s.token }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, transports: ['websocket', 'polling'] });
  socket.on('connect', () => set({ conn: 'online' }));
  socket.on('disconnect', (reason) => { if (reason !== 'io client disconnect') set({ conn: 'reconnecting' }); });
  socket.io.on('reconnect_attempt', () => set({ conn: 'reconnecting' }));
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') { leave(false); set({ conn: 'denied', lastError: 'This room or your seat is no longer available. Create or join a room to continue.' }); }
    else set({ conn: 'reconnecting' });
  });
  socket.on('snapshot', (snap: Snapshot) => set({ snap, offset: snap.serverNow - Date.now(), conn: 'online' }));
  socket.on('auction', (p: AuctionPatch) => {
    const cur = state.snap;
    if (!cur || p.version < cur.version) return;
    set({ snap: { ...cur, version: p.version, auction: p.auction }, offset: p.serverNow - Date.now() });
  });
  socket.on('kicked', () => { leave(false); set({ lastError: 'You were removed from the room by the host.' }); });
}

export function leave(clearError = true) {
  socket?.removeAllListeners(); socket?.close(); socket = null;
  saveSession(null);
  set({ session: null, snap: null, conn: 'idle', ...(clearError ? { lastError: null } : {}) });
  location.hash = '';
}

export function enterRoom(s: Session) { saveSession(s); set({ session: s, lastError: null }); connect(); }

export async function api<T>(path: string, body: unknown): Promise<Ack<T>> {
  try {
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as Ack<T>;
  } catch { return { ok: false, error: 'Cannot reach the server. Check your connection and try again.', code: 'network' }; }
}

function emit<T>(event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) return resolve({ ok: false, error: 'You are offline. Reconnecting…', code: 'offline' });
    const t = setTimeout(() => resolve({ ok: false, error: 'The server did not answer in time. Try again.', code: 'timeout' }), 10_000);
    socket.emit(event, payload, (ack: Ack<T>) => { clearTimeout(t); resolve(ack); });
  });
}

/** Send a game action. Failures are shown as a toast unless `quiet` is set; the ack is always returned. */
export async function act(action: Action, opts: { quiet?: boolean } = {}): Promise<Ack> {
  const ack = await emit('action', action);
  if (!ack.ok && !opts.quiet) toast(ack.error, 'error');
  return ack;
}
export const ask = <T,>(event: 'match' | 'history' | 'seasonArchive' | 'sync', payload?: unknown) => emit<T>(event, payload);

/** Server-aligned current time in ms. */
export const serverNow = () => Date.now() + state.offset;

export function newNonce(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}

export function toSimPlayer(p: CatalogPlayer, condition = 100): SimPlayer {
  return {
    id: p.id, name: p.name, nationality: p.nationality, clubName: p.clubName, position: p.position as SimPlayer['position'], secondary: p.secondary as SimPlayer['secondary'],
    overall: p.overall, pace: p.pace, shooting: p.shooting, passing: p.passing, defending: p.defending, physical: p.physical, condition,
  };
}

/** Convenience selectors */
export const useSnap = () => useStore((s) => s.snap);
export const useCatalog = () => useStore((s) => s.catalog);
