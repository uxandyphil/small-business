// CLI:
//   tsx src/cli.ts seed                     – reset DB and replay a year of weekly demo crawls
//   tsx src/cli.ts ingest [sourceId ...]    – run enabled sources (or the named ones) now
//   tsx src/cli.ts sources                  – list sources and status
//   tsx src/cli.ts enable|disable <id>
//   tsx src/cli.ts export-static <file>     – write a read-only DB snapshot for the GitHub Pages build
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_DB_PATH, openDb, type Row } from "./db.js";
import { runSource } from "./ingest.js";
import { registerSources } from "./sources/registry.js";

const [cmd, ...args] = process.argv.slice(2);

async function seed() {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DEFAULT_DB_PATH + suffix, { force: true });
  const db = openDb();
  registerSources(db);
  // Weekly crawls (Mondays) from Jan 5 2026 through Nov 16 2026; records monthly.
  const start = new Date("2026-01-05T14:00:00Z");
  const end = new Date("2026-11-16T14:00:00Z");
  let weeks = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 7 * 86400e3)) {
    await runSource(db, "demo-marketplace", d);
    await runSource(db, "demo-broker", d);
    if (weeks % 4 === 0 || d.getTime() + 7 * 86400e3 > end.getTime()) await runSource(db, "demo-records", d);
    weeks++;
  }
  const counts = db.prepare("SELECT status, COUNT(*) c FROM listings GROUP BY status").all() as Row[];
  const sales = db.prepare("SELECT verification, COUNT(*) c FROM sales GROUP BY verification").all() as Row[];
  console.log(`Seeded ${weeks} weekly crawls into ${DEFAULT_DB_PATH}`);
  console.log("Listings by status:", Object.fromEntries(counts.map((r) => [r.status, r.c])));
  console.log("Sales by verification:", Object.fromEntries(sales.map((r) => [r.verification, r.c])));
}

async function ingest(ids: string[]) {
  const db = openDb();
  registerSources(db);
  const targets = ids.length
    ? ids
    : (db.prepare("SELECT id FROM sources WHERE enabled=1").all() as Row[]).map((r) => String(r.id));
  for (const id of targets) {
    try {
      const s = await runSource(db, id, new Date());
      console.log(`${id}: seen ${s.seen}, new ${s.created}, updated ${s.updated}, gone ${s.disappeared}, sales ${s.salesRecorded}${s.complete ? "" : " (partial)"}`);
      for (const n of s.notes) console.log(`  note: ${n}`);
    } catch (e) {
      console.error(`${id}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}

function sources() {
  const db = openDb();
  registerSources(db);
  for (const s of db.prepare("SELECT * FROM sources ORDER BY kind, id").all() as Row[]) {
    console.log(`${s.enabled ? "●" : "○"} ${String(s.id).padEnd(18)} ${String(s.adapter).padEnd(14)} ${s.last_run_status ?? "never run"}  ${s.last_run_message ?? ""}`);
  }
}

function toggle(id: string | undefined, on: boolean) {
  if (!id) throw new Error("source id required");
  const db = openDb();
  registerSources(db);
  const r = db.prepare("UPDATE sources SET enabled=? WHERE id=?").run(on ? 1 : 0, id);
  console.log(r.changes ? `${id} ${on ? "enabled" : "disabled"}` : `No source ${id}`);
}

function exportStatic(out: string | undefined) {
  if (!out) throw new Error("usage: export-static <file>");
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  const db = openDb();
  // VACUUM INTO folds in the WAL and produces one self-contained file.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  db.close();
  const snap = new DatabaseSync(target);
  // Never publish personal data: device ids, favorites, alerts, emails, notifications.
  snap.exec(`DELETE FROM notifications; DELETE FROM alerts; DELETE FROM favorites; DELETE FROM users;
             UPDATE sources SET config_json='{}';
             PRAGMA journal_mode=DELETE; VACUUM;`);
  const n = snap.prepare("SELECT COUNT(*) c FROM listings").get() as Row;
  snap.close();
  console.log(`Exported ${n.c} listings to ${target}`);
}

const run = { seed, ingest: () => ingest(args), sources, enable: () => toggle(args[0], true), disable: () => toggle(args[0], false), "export-static": () => exportStatic(args[0]) }[cmd ?? ""];
if (!run) {
  console.log("usage: cli.ts seed | ingest [sourceId...] | sources | enable <id> | disable <id> | export-static <file>");
  process.exit(1);
}
await run();
