import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { registerSources } from "./sources/registry.js";
import { runSource } from "./ingest.js";
import type { Row } from "./db.js";

const db = openDb();
registerSources(db);
const port = Number(process.env.PORT ?? 8787);
createApp(db).listen(port, () => console.log(`API listening on http://localhost:${port}`));

// Optional scheduled ingestion of enabled, non-demo sources.
const everyHours = Number(process.env.INGEST_EVERY_HOURS ?? 0);
if (everyHours > 0) {
  const tick = async () => {
    const sources = db.prepare("SELECT id FROM sources WHERE enabled=1 AND kind != 'demo'").all() as Row[];
    for (const s of sources) {
      try {
        const r = await runSource(db, String(s.id));
        console.log(`[ingest] ${s.id}: ${r.seen} seen, ${r.created} new, ${r.disappeared} gone`);
      } catch (e) {
        console.error(`[ingest] ${s.id}: ${(e as Error).message}`);
      }
    }
  };
  setInterval(tick, everyHours * 3600e3);
}
