import { pino } from 'pino';
import { config } from './config';
export const log = pino({ level: process.env.VITEST ? 'silent' : config.logLevel, base: { app: 'football-auction' } });
