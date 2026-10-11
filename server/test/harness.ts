import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import type { Action, Ack, Snapshot, AuctionPatch } from '@fa/shared';
import { openDb } from '../src/db';
import { seedReferenceData } from '../src/db/seed';
import { createApp } from '../src/app';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TestClient {
  name: string; code: string; token: string; pid: number; socket: Socket; snap: Snapshot;
  act: (a: Action) => Promise<Ack>; ask: <T = unknown>(ev: string, payload?: unknown) => Promise<Ack<T>>; close: () => void;
}

export async function startTestServer(opts: { restRateMax?: number; socketRate?: number } = {}) {
  const db = openDb(':memory:');
  seedReferenceData(db);
  const clock = { t: 1_800_000_000_000 };
  const app = createApp({ db, now: () => clock.t, serveClient: false, restRateMax: opts.restRateMax ?? 1000, socketRate: opts.socketRate ?? 1000 });
  await new Promise<void>((r) => app.server.listen(0, r));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as Ack<{ code: string; token: string; participantId: number }>;
  };
  const clients: TestClient[] = [];
  async function attach(name: string, code: string, token: string, pid: number): Promise<TestClient> {
    const socket = connect(base, { auth: { code, token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const c = { name, code, token, pid, socket, snap: undefined as unknown as Snapshot } as TestClient;
    socket.on('snapshot', (s: Snapshot) => { c.snap = s; });
    socket.on('auction', (p: AuctionPatch) => { if (c.snap && p.version >= c.snap.version) c.snap = { ...c.snap, version: p.version, auction: p.auction }; });
    c.act = (a) => new Promise((res) => socket.emit('action', a, res));
    c.ask = (ev, payload) => new Promise((res) => socket.emit(ev, payload, res as never));
    c.close = () => socket.close();
    await new Promise<void>((res, rej) => { socket.once('connect_error', rej); socket.once('snapshot', () => res()); });
    clients.push(c);
    return c;
  }
  return {
    ...app, db, clock, port, base, post, attach,
    async create(name: string) { const r = await post('/rooms', { name }); if (!r.ok) throw new Error(r.error); return attach(name, r.data!.code, r.data!.token, r.data!.participantId); },
    async join(code: string, name: string) { const r = await post('/rooms/join', { code, name }); if (!r.ok) throw new Error(r.error); return attach(name, code, r.data!.token, r.data!.participantId); },
    async stop() { clients.forEach((c) => c.close()); await app.close(); db.close(); },
    /** wait until pushed snapshots reach every client */
    async settle(ms = 80) { await sleep(ms); },
  };
}
