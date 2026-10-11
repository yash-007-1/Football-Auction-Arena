import { config } from './config';
import { log } from './logger';
import { openDb } from './db';
import { seedReferenceData } from './db/seed';
import { createApp } from './app';

const db = openDb(config.databasePath);
const seeded = seedReferenceData(db); // idempotent; never touches rooms
log.info(seeded, 'reference data ready');

const { server, restore, close } = createApp({ db });
restore();
server.listen(config.port, () => log.info({ port: config.port, env: config.nodeEnv }, 'football-auction server listening'));

const shutdown = (sig: string) => {
  log.info({ sig }, 'shutting down');
  close().finally(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error({ err: e }, 'unhandled rejection'));
