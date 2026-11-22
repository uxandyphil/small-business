// Read-only "API" for the GitHub Pages build. Loads a SQLite snapshot of the
// database into the browser (sql.js / WebAssembly) and answers the same
// endpoints with the same server code (server/src/handlers.ts), so numbers
// match the full version exactly. Favorites live in localStorage; alerts and
// data collection need the server version.
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { ReadDB } from "../../server/src/dbtypes";
import { getListingDetail, getMeta, getSales, getSources, getStats, getYearComparison, lastUpdated, listByIds, listListings } from "../../server/src/handlers";

const FAV_KEY = "cbt.favorites";

function wrap(db: Database): ReadDB {
  return {
    prepare(sql: string) {
      const run = (params: unknown[]) => {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p)) as (string | number | null)[]);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      };
      return { all: (...p: unknown[]) => run(p), get: (...p: unknown[]) => run(p)[0] };
    },
  };
}

let ready: Promise<{ db: ReadDB; asOf: Date }> | null = null;
function load() {
  ready ??= (async () => {
    const [SQL, buf] = await Promise.all([
      initSqlJs({ locateFile: () => wasmUrl } as unknown as Parameters<typeof initSqlJs>[0]),
      fetch(`${import.meta.env.BASE_URL}tracker.db`).then((r) => {
        if (!r.ok) throw new Error(`Could not load data snapshot (HTTP ${r.status})`);
        return r.arrayBuffer();
      }),
    ]);
    const db = wrap(new SQL.Database(new Uint8Array(buf)));
    // Freeze "today" at the snapshot date so "new in 30 days" etc. stay meaningful.
    const t = lastUpdated(db);
    return { db, asOf: t ? new Date(t) : new Date() };
  })();
  return ready;
}

function favorites(): number[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function setFavorites(ids: number[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: favorites last for this page view only */
  }
}

class HttpError extends Error {}

export async function staticApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { db, asOf } = await load();
  const url = new URL(path, "http://static.local");
  const q = Object.fromEntries(url.searchParams);
  const method = (init.method ?? "GET").toUpperCase();
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  const out = (() => {
    if (p === "/api/meta") return { ...getMeta(db), staticMode: true };
    if (p === "/api/listings") return listListings(db, q, asOf);
    if ((m = p.match(/^\/api\/listings\/(\d+)$/))) {
      const d = getListingDetail(db, m[1], q, asOf, favorites().includes(Number(m[1])));
      if (!d) throw new HttpError("Not found");
      return d;
    }
    if (p === "/api/stats") return getStats(db, q, asOf);
    if (p === "/api/sales/compare") return getYearComparison(db, asOf);
    if (p === "/api/sales") return getSales(db, q, asOf);
    if (p === "/api/sources") return getSources(db);
    if (p === "/api/favorites") return listByIds(db, favorites(), q, asOf);
    if ((m = p.match(/^\/api\/favorites\/(\d+)$/))) {
      const id = Number(m[1]);
      const rest = favorites().filter((x) => x !== id);
      setFavorites(method === "DELETE" ? rest : [id, ...rest]);
      return { ok: true };
    }
    if (p === "/api/notifications") return { items: [], unread: 0 };
    if (p === "/api/alerts" && method === "GET") return { items: [] };
    throw new HttpError("Alerts need the full server version of this site.");
  })();
  return out as T;
}
