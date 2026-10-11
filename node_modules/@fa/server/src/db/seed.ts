import { fileURLToPath } from 'node:url';
import type { Db } from './index';
import { openDb } from './index';
import { DATASET_INFO, DATASET_SEASON_YEAR, loadDataset, startPriceFor } from './dataset';
import { config } from '../config';
import { log } from '../logger';

/** Idempotent: re-running updates reference data in place and never touches rooms or game state. */
export function seedReferenceData(db: Db): { clubs: number; players: number } {
  const { clubs, players } = loadDataset();
  db.exec('BEGIN');
  try {
    const upClub = db.prepare(`INSERT INTO clubs (name, short, league, color1, color2, id)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET short=excluded.short, league=excluded.league, color1=excluded.color1, color2=excluded.color2`);
    clubs.forEach((c, i) => upClub.run(c.name, c.short, c.league, c.color1, c.color2, i + 1));
    const idOf = new Map((db.prepare('SELECT id, name, league FROM clubs').all() as { id: number; name: string; league: string }[]).map((c) => [c.name, c]));
    const up = db.prepare(`INSERT INTO players (id, name, nationality, birth_year, age, position, secondary, overall, pace, shooting, passing, defending, physical, club_id, club_name, league, start_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, nationality=excluded.nationality, birth_year=excluded.birth_year, age=excluded.age, position=excluded.position,
        secondary=excluded.secondary, overall=excluded.overall, pace=excluded.pace, shooting=excluded.shooting, passing=excluded.passing, defending=excluded.defending,
        physical=excluded.physical, club_id=excluded.club_id, club_name=excluded.club_name, league=excluded.league, start_price=excluded.start_price`);
    players.forEach((p, i) => {
      const club = idOf.get(p.clubName)!;
      const age = DATASET_SEASON_YEAR - p.birthYear;
      up.run(i + 1, p.name, p.nationality, p.birthYear, age, p.position, JSON.stringify(p.secondary), p.overall, p.pace, p.shooting, p.passing, p.defending, p.physical,
        club.id, p.clubName, club.league, startPriceFor(p.overall, age));
    });
    const meta = db.prepare('INSERT INTO dataset_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(DATASET_INFO)) meta.run(k, String(v));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { clubs: clubs.length, players: players.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(config.databasePath);
  const r = seedReferenceData(db);
  log.info(r, 'seeded reference data');
  console.log(`Seeded ${r.clubs} clubs and ${r.players} players into ${config.databasePath}`);
}
