// Read-only endpoint logic shared by the Express API and the static
// (GitHub Pages) build, which runs this same code in the browser.
import { z } from "zod";
import type { ReadDB, Row } from "./dbtypes.js";
import { DEFAULT_ASSUMPTIONS } from "./finance.js";
import { COLUMBUS, REGION_COUNTIES } from "./geo.js";
import { INDUSTRIES } from "./normalize.js";
import { enrich, FiltersSchema, parseAssumptions, searchListings } from "./query.js";
import { dashboardStats, mapPoint, median, salesReport } from "./stats.js";

type Query = Record<string, unknown>;

export function getMeta(db: ReadDB) {
  const counties = db.prepare("SELECT county AS name, COUNT(*) c FROM listings WHERE status IN ('active','pending') AND county IS NOT NULL GROUP BY county ORDER BY c DESC").all();
  const cities = db.prepare("SELECT city AS name, county, COUNT(*) c FROM listings WHERE status IN ('active','pending') AND city IS NOT NULL GROUP BY city ORDER BY c DESC").all();
  const demo = db.prepare("SELECT COUNT(*) c FROM listing_sources ls JOIN sources s ON s.id=ls.source_id WHERE s.kind='demo'").get() as Row;
  const real = db.prepare("SELECT COUNT(*) c FROM listing_sources ls JOIN sources s ON s.id=ls.source_id WHERE s.kind!='demo'").get() as Row;
  return {
    industries: INDUSTRIES,
    counties,
    cities,
    region: { center: COLUMBUS, counties: REGION_COUNTIES },
    demoMode: Number(demo.c) > 0,
    realListingCount: Number(real.c),
    lastUpdated: lastUpdated(db),
    defaultAssumptions: DEFAULT_ASSUMPTIONS,
  };
}

export function lastUpdated(db: ReadDB): string | null {
  return ((db.prepare("SELECT MAX(as_of) t FROM ingest_runs WHERE status='ok'").get() as Row | undefined)?.t as string) ?? null;
}

export function listListings(db: ReadDB, query: Query, now: Date) {
  const f = FiltersSchema.parse(query);
  const a = parseAssumptions(query);
  const { total, items, all } = searchListings(db, f, a, now);
  return {
    total,
    items,
    summary: {
      medianAsking: median(all.map((l) => l.asking_price as number)),
      medianCashFlow: median(all.map((l) => l.cash_flow_sde as number)),
      medianMultiple: median(all.map((l) => l.finance.multiple)),
      medianCashOnCash: median(all.map((l) => l.finance.cashOnCashPct)),
    },
    mapPoints: query.map === "1" ? all.map(mapPoint) : undefined,
  };
}

/** Returns null when the listing does not exist. */
export function getListingDetail(db: ReadDB, idRaw: unknown, query: Query, now: Date, favorite: boolean) {
  const id = z.coerce.number().int().parse(idRaw);
  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(id) as Row | undefined;
  if (!row) return null;
  const a = parseAssumptions(query);
  const [l] = enrich(db, [row], a, now);
  const events = db
    .prepare("SELECT e.*, s.name AS source_name FROM listing_events e LEFT JOIN sources s ON s.id=e.source_id WHERE listing_id=? ORDER BY occurred_at, e.id")
    .all(id);
  const history = db.prepare("SELECT observed_at, asking_price, cash_flow_sde, revenue FROM price_history WHERE listing_id=? ORDER BY observed_at").all(id);
  const peersRows = db.prepare("SELECT * FROM listings WHERE industry=? AND id != ? AND status IN ('active','pending','sold')").all(String(row.industry), id) as Row[];
  const activePeers = enrich(db, peersRows, a, now).filter((p) => p.status !== "sold");
  const soldComps = db
    .prepare(
      "SELECT s.*, l.cash_flow_sde FROM sales s LEFT JOIN listings l ON l.id = s.listing_id WHERE s.industry=? AND s.sale_price IS NOT NULL AND (s.listing_id IS NULL OR s.listing_id != ?) ORDER BY s.sale_date DESC LIMIT 8",
    )
    .all(String(row.industry), id) as Row[];
  return {
    listing: l,
    events,
    history,
    favorite,
    comparables: {
      industry: row.industry,
      activeCount: activePeers.length,
      medianMultiple: median(activePeers.map((p) => p.finance.multiple)),
      medianCashOnCash: median(activePeers.map((p) => p.finance.cashOnCashPct)),
      medianMarginPct: median(activePeers.map((p) => p.finance.marginPct)),
      medianAsking: median(activePeers.map((p) => p.asking_price as number)),
      similar: activePeers
        .filter((p) => p.asking_price && l.asking_price)
        .sort((x, y) => Math.abs(Math.log(Number(x.asking_price) / Number(l.asking_price))) - Math.abs(Math.log(Number(y.asking_price) / Number(l.asking_price))))
        .slice(0, 5),
      soldComps: soldComps.map((s) => ({ ...s, multiple: s.cash_flow_sde ? Number(s.sale_price) / Number(s.cash_flow_sde) : null })),
    },
  };
}

export function getStats(db: ReadDB, query: Query, now: Date) {
  const year = z.coerce.number().int().optional().parse(query.year);
  return dashboardStats(db, now, year);
}

export function getSales(db: ReadDB, query: Query, now: Date) {
  const year = z.coerce.number().int().default(now.getUTCFullYear()).parse(query.year);
  return salesReport(db, now, year);
}

export function getSources(db: ReadDB) {
  const sources = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.adapter, s.homepage, s.access_method, s.compliance_note, s.enabled, s.last_run_at, s.last_run_status, s.last_run_message,
         (SELECT COUNT(*) FROM listing_sources ls WHERE ls.source_id=s.id AND ls.present=1) AS live_listings,
         (SELECT COUNT(*) FROM listing_sources ls WHERE ls.source_id=s.id) AS total_listings,
         (SELECT COUNT(*) FROM sales x WHERE x.source_id=s.id) AS sales
       FROM sources s ORDER BY s.enabled DESC, s.kind, s.name`,
    )
    .all();
  const runs = db.prepare("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 20").all();
  return { sources, runs };
}

/** Listings for a set of ids, newest-saved first (order of `ids`). */
export function listByIds(db: ReadDB, ids: number[], query: Query, now: Date) {
  if (ids.length === 0) return { items: [] };
  const rows = db.prepare(`SELECT * FROM listings WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
  const byId = new Map(enrich(db, rows, parseAssumptions(query), now).map((l) => [l.id, l]));
  return { items: ids.map((id) => byId.get(id)).filter(Boolean) };
}
