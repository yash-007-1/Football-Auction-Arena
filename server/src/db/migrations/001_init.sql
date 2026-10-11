-- Football Auction schema (SQLite). Money is stored as integer € millions, times as epoch milliseconds.
-- PostgreSQL migration path: the schema uses only portable SQL (INTEGER/TEXT/REAL, PK/UNIQUE/FK, partial
-- unique indexes). Replace AUTOINCREMENT with GENERATED ... AS IDENTITY and INTEGER booleans with BOOLEAN.

CREATE TABLE dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  short TEXT NOT NULL,
  league TEXT NOT NULL,
  color1 TEXT NOT NULL,
  color2 TEXT NOT NULL,
  logo_url TEXT
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  nationality TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  age INTEGER NOT NULL,
  position TEXT NOT NULL,
  secondary TEXT NOT NULL DEFAULT '[]',
  overall INTEGER NOT NULL,
  pace INTEGER NOT NULL,
  shooting INTEGER NOT NULL,
  passing INTEGER NOT NULL,
  defending INTEGER NOT NULL,
  physical INTEGER NOT NULL,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  club_name TEXT NOT NULL,
  league TEXT NOT NULL,
  start_price INTEGER NOT NULL,
  photo_url TEXT
);
CREATE INDEX idx_players_overall ON players(overall DESC);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL,                 -- lobby | auction | review | prepare | league | season_end
  season INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,                -- JSON room settings
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  club_id INTEGER REFERENCES clubs(id),
  is_host INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  connected INTEGER NOT NULL DEFAULT 0,
  budget INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  CHECK (budget >= 0)
);
-- A club can be chosen by only one participant per room (NULLs are allowed many times).
CREATE UNIQUE INDEX uq_participant_club ON participants(room_id, club_id) WHERE club_id IS NOT NULL;
CREATE UNIQUE INDEX uq_participant_name ON participants(room_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX uq_participant_token ON participants(token_hash);

CREATE TABLE seasons (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  status TEXT NOT NULL,                -- setup | prepare | running | finished
  current_round INTEGER NOT NULL DEFAULT 0,
  round_simulated INTEGER NOT NULL DEFAULT 0,   -- 1 once every fixture of current_round has been played
  schedule_locked INTEGER NOT NULL DEFAULT 0,
  total_rounds INTEGER NOT NULL DEFAULT 0,
  byes TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  started_at INTEGER,
  PRIMARY KEY (room_id, season)
);

CREATE TABLE auctions (
  room_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  status TEXT NOT NULL,                -- running | between | paused | finished
  queue TEXT NOT NULL,                 -- JSON array of player ids still to come
  lot_seq INTEGER NOT NULL DEFAULT 0,
  player_id INTEGER,
  start_price INTEGER,
  current_bid INTEGER,
  high_bidder_id INTEGER,
  ends_at INTEGER,                     -- epoch ms: lot closes (running) or next lot begins (between)
  paused_remaining_ms INTEGER,
  paused_from TEXT,
  last_result TEXT,                    -- JSON of the last settled lot (for the result banner)
  PRIMARY KEY (room_id, season),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE auction_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id),
  start_price INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sold','unsold')),
  winner_id INTEGER REFERENCES participants(id),
  price INTEGER,
  settled_at INTEGER NOT NULL,
  UNIQUE (room_id, season, seq)
);
-- A player can be sold at most once per room and season.
CREATE UNIQUE INDEX uq_lot_sold_once ON auction_lots(room_id, season, player_id) WHERE status = 'sold';

CREATE TABLE auction_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  lot_seq INTEGER NOT NULL,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  amount INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, season, lot_seq, participant_id, nonce)
);

CREATE TABLE squad_players (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  price INTEGER NOT NULL,
  condition REAL NOT NULL DEFAULT 100,
  source TEXT NOT NULL DEFAULT 'auction',      -- auction | autofill | carried
  PRIMARY KEY (room_id, season, player_id)     -- duplicate ownership is impossible
);
CREATE INDEX idx_squad_owner ON squad_players(room_id, season, participant_id);

CREATE TABLE fixtures (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  key TEXT NOT NULL,
  round INTEGER NOT NULL,
  home_id INTEGER NOT NULL REFERENCES participants(id),
  away_id INTEGER NOT NULL REFERENCES participants(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','played')),
  home_goals INTEGER,
  away_goals INTEGER,
  seed INTEGER,
  result TEXT,                          -- JSON: events, team stats, lineups used
  played_at INTEGER,
  UNIQUE (room_id, season, key)
);
CREATE INDEX idx_fixtures_round ON fixtures(room_id, season, round);

CREATE TABLE lineups (
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  formation TEXT NOT NULL,
  slots TEXT NOT NULL,
  bench TEXT NOT NULL,
  tactics TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (fixture_id, participant_id)
);

CREATE TABLE player_match_stats (
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  minutes INTEGER NOT NULL,
  goals INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  yellow INTEGER NOT NULL,
  red INTEGER NOT NULL,
  saves INTEGER NOT NULL,
  shots INTEGER NOT NULL,
  clean_sheet INTEGER NOT NULL,
  conceded INTEGER NOT NULL,
  is_gk INTEGER NOT NULL,
  end_condition REAL NOT NULL,
  PRIMARY KEY (fixture_id, participant_id, player_id)
);

CREATE TABLE season_archive (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  summary TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, season)
);
