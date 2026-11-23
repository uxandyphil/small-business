import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? resolve(here, "../../data/tracker.db");

export type DB = DatabaseSync;

const SCHEMA = /* sql */ `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Where data comes from, and whether we are permitted to collect it automatically.
CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,            -- marketplace | broker | public_record | press | manual | demo
  adapter         TEXT NOT NULL,            -- csv | json_feed | broker_html | licensed_feed | demo
  homepage        TEXT,
  access_method   TEXT NOT NULL,            -- e.g. "Licensed data feed", "Broker-provided JSON feed", "Manual CSV import"
  compliance_note TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 0,
  config_json     TEXT NOT NULL DEFAULT '{}',
  last_run_at     TEXT,
  last_run_status TEXT,
  last_run_message TEXT
);

-- One row per real-world business opportunity (deduplicated across sources).
CREATE TABLE IF NOT EXISTS listings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint      TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  industry         TEXT NOT NULL,
  industry_raw     TEXT,
  is_franchise     INTEGER NOT NULL DEFAULT 0,
  city             TEXT,
  county           TEXT,
  state            TEXT NOT NULL DEFAULT 'OH',
  lat              REAL,
  lng              REAL,
  location_precision TEXT NOT NULL DEFAULT 'city', -- address | city | county | unknown
  asking_price     REAL,
  revenue          REAL,
  cash_flow_sde    REAL,
  ebitda           REAL,
  inventory        REAL,
  ffe              REAL,
  real_estate_included INTEGER NOT NULL DEFAULT 0,
  employees        INTEGER,
  year_established INTEGER,
  financials_basis TEXT NOT NULL DEFAULT 'seller_reported', -- seller_reported | broker_verified | cpa_reviewed
  status           TEXT NOT NULL DEFAULT 'active',          -- active | pending | sold | off_market
  status_changed_at TEXT,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  listed_at        TEXT                     -- date the source says it was listed, if given
);
CREATE INDEX IF NOT EXISTS idx_listings_fp ON listings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

-- Each source's copy of a listing (a business can appear on several sites).
CREATE TABLE IF NOT EXISTS listing_sources (
  listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id),
  external_id  TEXT NOT NULL,
  url          TEXT,
  broker_name  TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  present      INTEGER NOT NULL DEFAULT 1,
  missed_runs  INTEGER NOT NULL DEFAULT 0,  -- consecutive complete crawls without this listing
  PRIMARY KEY (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ls_listing ON listing_sources(listing_id);

-- Append-only change log: price changes, status changes, financial restatements.
CREATE TABLE IF NOT EXISTS listing_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id   TEXT,
  occurred_at TEXT NOT NULL,
  type        TEXT NOT NULL,     -- listed | price_change | financials_change | status_change | relisted | disappeared
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_listing ON listing_events(listing_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_time ON listing_events(occurred_at);

-- Point-in-time price observations for history charts.
CREATE TABLE IF NOT EXISTS price_history (
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  asking_price REAL,
  cash_flow_sde REAL,
  revenue REAL,
  PRIMARY KEY (listing_id, observed_at)
);

-- Sale records. A listing is only ever shown as "sold" when one of these exists.
CREATE TABLE IF NOT EXISTS sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id       INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  business_name    TEXT NOT NULL,
  industry         TEXT,
  city             TEXT,
  county           TEXT,
  sale_price       REAL,
  sale_date        TEXT,
  verification     TEXT NOT NULL,   -- confirmed | broker_reported
  evidence_type    TEXT NOT NULL,   -- public_record | press_release | news | broker_closed_deal | party_confirmation
  evidence_url     TEXT,
  evidence_note    TEXT,
  source_id        TEXT REFERENCES sources(id),
  recorded_at      TEXT NOT NULL,
  -- Two different businesses can share a name and closing date; listing_id tells them apart.
  UNIQUE (source_id, business_name, sale_date, listing_id)
);

-- Lightweight anonymous users (device id) for favorites and alerts.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  filters_json TEXT NOT NULL,          -- same shape as the /api/listings query
  notify_new  INTEGER NOT NULL DEFAULT 1,
  notify_price_drop INTEGER NOT NULL DEFAULT 1,
  notify_status INTEGER NOT NULL DEFAULT 1,
  email       TEXT,
  created_at  TEXT NOT NULL,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id   INTEGER REFERENCES alerts(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  event_id   INTEGER REFERENCES listing_events(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- new_listing | price_drop | status_change | favorite_update
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT,
  emailed_at TEXT,
  UNIQUE (user_id, event_id, kind)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  as_of       TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT,
  seen        INTEGER DEFAULT 0,
  created     INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  disappeared INTEGER DEFAULT 0,
  skipped_out_of_region INTEGER DEFAULT 0,
  message     TEXT
);
`;

export function openDb(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type Row = Record<string, unknown>;
