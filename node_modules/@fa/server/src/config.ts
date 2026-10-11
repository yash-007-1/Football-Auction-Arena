const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== '' ? n : d; };

export const config = {
  port: num(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databasePath: process.env.DATABASE_PATH ?? './data/football-auction.db',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  /** Serve the built client from this server (production single-process deploy). */
  clientDist: process.env.CLIENT_DIST ?? '../client/dist',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxRooms: num(process.env.MAX_ROOMS, 500),
  roomIdleDays: num(process.env.ROOM_IDLE_DAYS, 14),
  /** Socket actions per second allowed per connection before throttling. */
  socketRate: num(process.env.SOCKET_RATE_PER_SEC, 15),
  restRateWindowMs: num(process.env.REST_RATE_WINDOW_MS, 60_000),
  restRateMax: num(process.env.REST_RATE_MAX, 40),
};
export const isProd = config.nodeEnv === 'production';
