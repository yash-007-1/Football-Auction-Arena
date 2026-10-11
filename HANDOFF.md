# Football Auction League: Handoff

Written 2026-10-10. Read this first when resuming. Everything below states what was actually run; anything not listed as verified should be treated as **unverified**.

## 1. What this is

An online multiplayer football auction and league simulator: up to 10 managers join a room by code, pick unique real clubs, bid live (€1,000M each) on real footballers, reveal squads, then play a simulated double round-robin season (XI, formation, tactics, server-side match engine, table, stats, new season).

## 2. Stack and structure

npm workspaces monorepo, Node >= 22.13 (uses the built-in `node:sqlite`, which is *experimental*).

| Workspace | Tech | Role |
|---|---|---|
| `shared/` | TypeScript, vitest | Pure game rules, imported as source by both sides: auction rules, fixtures, lineup validation, match simulator, table, protocol types |
| `server/` | Express, Socket.IO, Zod, pino, `node:sqlite` | Server-authoritative game, rooms, persistence, timers |
| `client/` | React 18, Vite, Tailwind 3, TypeScript | 15 views (see below) |

```
shared/src   auction.ts fixtures.ts formations.ts lineup.ts positions.ts protocol.ts rng.ts sim.ts table.ts tactics-info.ts types.ts index.ts
shared/test  auction fixtures lineup sim table (+helpers)
server/src   index.ts app.ts game.ts actions.ts config.ts logger.ts
             db/{index,seed,dataset}.ts  db/migrations/001_init.sql
             services/{rooms,auction,league,snapshot,types}.ts
server/data  dataset.txt   (39 clubs, 356 players)
server/test  e2e.test.ts harness.ts
client/src   App.tsx main.tsx store.ts ui.tsx index.css
             screens/{Landing,Lobby,Auction,History,Reveal,Matchday,Lineup,Tactics,Squad,League,Fixtures,Stats,Match,Season,Settings}.tsx
```
~4,500 lines of TS/TSX. There is no git repository yet (`git init` is advisable).

## 3. Current stage

| Area | State |
|---|---|
| Shared rules and engine | Done. 31 tests pass. |
| Server (rooms, auction, league, sockets, REST, rate limits) | Done. 16 end-to-end tests pass (12/12 consecutive full runs). |
| Client | **Written and typechecks, but has never been built with `vite build`, never run in a browser, and never connected to the real server.** |
| Docs | README.md and DATASET.md are **missing** (HANDOFF.md is the only doc). |

## 4. Verified vs not verified

**Verified (actually run):**
- `tsc --noEmit` passes in `shared`, `server`, `client`.
- `shared`: 31/31 tests. `server/test/e2e.test.ts`: 16/16, repeated 12 times in a row without failure after the fixes below.
- The e2e suite uses real Socket.IO clients against a real in-process server, with an in-memory DB and a fake clock. It covers: 10 joins, 11th refused (`room_full`), duplicate name refused, duplicate club refused (`club_taken`), forged/strict-schema payloads, non-host actions refused, all budgets = 1000, bid sync across clients, below-minimum / already-highest / over-budget / non-integer / negative bids rejected, idempotent duplicate nonce, timer reset on bid, winner charged exactly once, unsold leaves budgets unchanged, DB-level duplicate ownership impossible, pause/resume, disconnect + token reconnect keeping state, join refused after start, wrong token refused, early end, `squads_invalid` blocking progress, auto-fill, integrity check (budget + spent = 1000), schedule of 90 fixtures / 18 rounds saved before start and never regenerated, lineup validation (foreign player, duplicate, short XI, 2 keepers), tactics validation, repeat `league.simulate` refused, identical results/tables across clients, table recomputed from fixtures, 18 rounds to `season_end` with correct champion/top scorer/best attack/defence, new season "keep" (squads and budgets carried, old season archived), 3-manager odd league with byes (6 fixtures, 1 bye per round), exhausted-pool auction end, new season "reset" (budgets 1000, squads empty), socket and REST rate limiting, garbage payloads.
- Dataset: 39 clubs, 356 players, parsed and seeded without error.

**NOT verified:**
- `vite build`, `npm start` serving the client, any browser rendering, any UI interaction (drag-and-drop, countdown, match playback), mobile layout.
- A clean `npm ci` (dependencies were already installed).
- Real-time (non-fake-clock) auction timers via `setTimeout`, and server restart recovery (`restore()`), which is coded but untested.
- Bidding from a disconnected socket (rule is unit-tested in `shared`, not through sockets).
- Most of the auction in the e2e suite after the first lots is driven by calling the service layer, not through sockets (live socket bidding is tested for the first lots only).
- Dataset accuracy (see section 8).

## 5. Bugs found and fixed during this session

1. **Real rules bug (fixed):** squads of e.g. 2 keepers + 9 outfielders passed review but could not field a legal XI (`squad_too_small` at simulation). Fixed in `shared/src/auction.ts`: squads need >= 10 outfield players, max 3 goalkeepers (`MAX_GOALKEEPERS`, bid error `gk_limit`), and `autoFill` now respects both.
2. `node:sqlite` could not load under vitest; fixed by loading via `createRequire` in `server/src/db/index.ts`.
3. Three **test** flakes (the app was right, the tests were wrong), all fixed: nonces shorter than the 4-char minimum; a +€3 raise on lots priced ≥€100M (increment is €5); scored penalties are `penalty` events, not `goal`; test driver did not tolerate the keeper cap.

## 6. Known bugs and gaps (unfixed)

- **Rejoin link is broken:** `client/src/screens/Settings.tsx` generates `/?room=CODE&seat=TOKEN&pid=..&name=..`, but `Landing.tsx` never reads `seat`/`pid`. Either implement it (call `enterRoom` from those params, then strip the URL) or remove the "Continue on another device" block.
- `README.md` and `DATASET.md` do not exist, though `dataset.txt` and `db/dataset.ts` reference DATASET.md.
- The spec asked for PostgreSQL + Prisma preferred, or SQLite with a migration path. SQLite via experimental `node:sqlite` is used; the migration path is only described in the header comment of `001_init.sql`. No deployment docs, Dockerfile or hosting config.
- No player photos or club logos (initials/colour crests are the fallback). `logo_url`/`photo_url` columns exist but are always null.
- No client-side tests (e.g. `placePlayer` in `Lineup.tsx`).
- Minor: `restRateWindowMs` expression in `app.ts` rate limiter is redundant (harmless).
- The audit tasks (clean install, real browser multi-client run, dataset review, restart persistence) were started but **not completed**.

## 7. Install, configure, run

```bash
cd /home/claude/football-auction
npm install                      # (use `npm ci` once to verify a clean install)
cp server/.env.example server/.env   # optional; defaults work
# Terminal 1: API + sockets on :3001 (auto-migrates and auto-seeds the DB on start)
npm run dev:server
# Terminal 2: UI on http://localhost:5173 (Vite proxies /api and /socket.io to :3001)
npm run dev:client
```

Tests / checks:
```bash
npm test               # shared + server
npm run typecheck      # all three workspaces
npm run build          # client build + server typecheck  (client build NOT yet verified)
```
Production-style single process (unverified): `npm run build && npm start`, then open http://localhost:3001 (the server serves `client/dist`, resolved relative to `server/` as `../client/dist`).

Environment variables (`server/.env`, see `server/.env.example`; none are secrets):
`PORT=3001`, `NODE_ENV`, `DATABASE_PATH=./data/football-auction.db` (created automatically, relative to `server/`), `CLIENT_ORIGIN=http://localhost:5173` (CORS in dev), `CLIENT_DIST=../client/dist`, `LOG_LEVEL=info`, `MAX_ROOMS=500`, `ROOM_IDLE_DAYS=14`, `SOCKET_RATE_PER_SEC=15`, `REST_RATE_WINDOW_MS=60000`, `REST_RATE_MAX=40`.

Database: SQLite file, one migration (`001_init.sql`) applied automatically; reference data seeded idempotently by `npm run seed` (also done at every server start). Deleting the `.db` file resets all rooms.

## 8. Player dataset: provenance (important)

`server/data/dataset.txt`: **39 clubs, 356 players** across Premier League, La Liga, Serie A, Bundesliga, Ligue 1, plus Primeira Liga, Eredivisie, Süper Lig, Saudi Pro League, MLS and Danish Superliga. The names are real footballers, but the file was **compiled from the assistant's general football knowledge, not from an official or licensed feed**. Club assignments, ages (birth year) and the 0-99 ratings/attributes are estimates and may be out of date or wrong. Start prices are computed from rating and age by `startPriceFor()` in `server/src/db/dataset.ts`. The UI shows this caveat (footer, Room screen). Do not describe this as verified or official data. Replacing it with a licensed/open dataset is a priority if accuracy matters.

## 9. Next five priorities

1. **Build and run for real:** `npm run build && npm start`, then drive the UI in headless Chromium (Playwright is preinstalled at `/opt/pw-browsers`) with 3+ browser contexts through lobby → auction (real timers) → squads → league → season end. Fix whatever breaks; check mobile widths.
2. **Fix rejoin:** make `Landing.tsx` consume `seat/pid/name` params (or delete that Settings block).
3. **Write `README.md` and `DATASET.md`** (setup, env, DB, deploy steps, dataset provenance and price formula, limitations).
4. **Test restart and real-timer paths:** kill the server mid-auction, restart, confirm `restore()` re-arms the timer and state is intact; add a socket-level disconnected-bidder test.
5. **Dataset quality pass** against a reliable source, and decide on photos/logos (licensing); then add `git init` and a first commit.

## 10. Resume checklist

```bash
cd /home/claude/football-auction && npm test && npm run typecheck   # expect: 31 + 16 pass, no TS errors
```
