// Ingestion pipeline: normalize -> dedupe -> diff -> history -> status -> sales.
//
// Status rules (the core of "verified information"):
//   active      – present on at least one source
//   pending     – a source says under contract / LOI
//   sold        – ONLY when a sale record exists (confirmed or broker_reported)
//   off_market  – gone from every source for N complete crawls with no sale
//                 record. We do not know what happened; we never call it sold.
import { tx, type DB, type Row } from "./db.js";
import { resolveLocation } from "./geo.js";
import { fingerprint, normalizeIndustry, parseIntLoose, parseMoney, parseYearEstablished } from "./normalize.js";
import { ADAPTERS } from "./sources/adapters.js";
import type { FetchResult, RawListing, RawSale } from "./sources/types.js";
import { processAlerts } from "./alerts.js";

export interface RunSummary {
  sourceId: string;
  asOf: string;
  seen: number;
  created: number;
  updated: number;
  disappeared: number;
  skippedOutOfRegion: number;
  salesRecorded: number;
  complete: boolean;
  notes: string[];
}

const MISSES_BEFORE_OFF_MARKET = Number(process.env.MISSES_BEFORE_OFF_MARKET ?? 2);

export async function runSource(db: DB, sourceId: string, asOf: Date = new Date()): Promise<RunSummary> {
  const src = db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId) as Row | undefined;
  if (!src) throw new Error(`Unknown source ${sourceId}`);
  const adapter = ADAPTERS[String(src.adapter)];
  if (!adapter) throw new Error(`No adapter ${src.adapter}`);
  const config = JSON.parse(String(src.config_json || "{}"));
  const startedAt = new Date().toISOString();
  const runId = Number(
    db.prepare("INSERT INTO ingest_runs (source_id, started_at, as_of, status) VALUES (?, ?, ?, 'running')").run(sourceId, startedAt, asOf.toISOString()).lastInsertRowid,
  );
  let result: FetchResult;
  try {
    result = await adapter.fetch({ asOf, config });
  } catch (e) {
    const msg = (e as Error).message;
    db.prepare("UPDATE ingest_runs SET finished_at=?, status='error', message=? WHERE id=?").run(new Date().toISOString(), msg, runId);
    db.prepare("UPDATE sources SET last_run_at=?, last_run_status='error', last_run_message=? WHERE id=?").run(asOf.toISOString(), msg, sourceId);
    throw e;
  }
  const maxEventBefore = Number((db.prepare("SELECT COALESCE(MAX(id),0) AS m FROM listing_events").get() as Row).m);
  const summary = tx(db, () => applyResult(db, sourceId, result, asOf));
  db.prepare(
    "UPDATE ingest_runs SET finished_at=?, status='ok', seen=?, created=?, updated=?, disappeared=?, skipped_out_of_region=?, message=? WHERE id=?",
  ).run(new Date().toISOString(), summary.seen, summary.created, summary.updated, summary.disappeared, summary.skippedOutOfRegion, summary.notes.join("; ") || null, runId);
  db.prepare("UPDATE sources SET last_run_at=?, last_run_status='ok', last_run_message=? WHERE id=?").run(
    asOf.toISOString(),
    `${summary.seen} listings, ${summary.created} new, ${summary.salesRecorded} sales${summary.complete ? "" : " (partial crawl)"}`,
    sourceId,
  );
  await processAlerts(db, maxEventBefore, asOf);
  return summary;
}

interface Normalized {
  title: string;
  description: string | null;
  industry: string;
  industry_raw: string | null;
  is_franchise: number;
  city: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  location_precision: string;
  asking_price: number | null;
  revenue: number | null;
  cash_flow_sde: number | null;
  ebitda: number | null;
  inventory: number | null;
  ffe: number | null;
  real_estate_included: number;
  employees: number | null;
  year_established: number | null;
  financials_basis: string;
  listed_at: string | null;
  inRegion: boolean;
}

export function normalizeRaw(r: RawListing, asOf: Date): Normalized {
  const loc = resolveLocation({ city: r.city, county: r.county, state: r.state, lat: r.lat, lng: r.lng });
  return {
    title: r.title.trim(),
    description: r.description ?? null,
    industry: normalizeIndustry(r.industry, r.title),
    industry_raw: r.industry ?? null,
    is_franchise: r.isFranchise || /franchise/i.test(r.title) ? 1 : 0,
    city: loc.city,
    county: loc.county,
    lat: loc.lat,
    lng: loc.lng,
    location_precision: loc.precision,
    asking_price: parseMoney(r.askingPrice),
    revenue: parseMoney(r.revenue),
    cash_flow_sde: parseMoney(r.cashFlow),
    ebitda: parseMoney(r.ebitda),
    inventory: parseMoney(r.inventory),
    ffe: parseMoney(r.ffe),
    real_estate_included: r.realEstateIncluded ? 1 : 0,
    employees: parseIntLoose(r.employees),
    year_established: parseYearEstablished(r.yearEstablished, asOf.getUTCFullYear()),
    financials_basis: r.financialsBasis ?? "seller_reported",
    listed_at: r.listedAt ? new Date(r.listedAt).toISOString().slice(0, 10) : null,
    inRegion: loc.inRegion,
  };
}

const TRACKED: (keyof Normalized)[] = ["asking_price", "revenue", "cash_flow_sde", "ebitda"];
const BASIS_RANK: Record<string, number> = { seller_reported: 0, broker_verified: 1, cpa_reviewed: 2 };

function applyResult(db: DB, sourceId: string, result: FetchResult, asOf: Date): RunSummary {
  const now = asOf.toISOString();
  const day = now.slice(0, 10);
  const s: RunSummary = { sourceId, asOf: now, seen: 0, created: 0, updated: 0, disappeared: 0, skippedOutOfRegion: 0, salesRecorded: 0, complete: result.complete, notes: result.notes ?? [] };
  const event = db.prepare(
    "INSERT INTO listing_events (listing_id, source_id, occurred_at, type, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const setStatus = (listingId: number, from: string, to: string) => {
    if (from === to) return;
    db.prepare("UPDATE listings SET status=?, status_changed_at=? WHERE id=?").run(to, now, listingId);
    event.run(listingId, sourceId, now, "status_change", "status", from, to);
  };
  const seenExternal = new Set<string>();

  for (const raw of result.listings) {
    const n = normalizeRaw(raw, asOf);
    if (!n.inRegion) {
      s.skippedOutOfRegion++;
      continue;
    }
    s.seen++;
    seenExternal.add(raw.externalId);
    const fp = fingerprint(n);
    const link = db.prepare("SELECT listing_id FROM listing_sources WHERE source_id=? AND external_id=?").get(sourceId, raw.externalId) as Row | undefined;
    let listingId: number | null = link ? Number(link.listing_id) : null;

    if (listingId == null) {
      // Cross-source dedupe: same business syndicated from another site.
      const dup = db
        .prepare(
          `SELECT l.id FROM listings l WHERE l.fingerprint=? AND l.status != 'sold'
             AND NOT EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id=l.id AND ls.source_id=?)
           ORDER BY l.last_seen_at DESC LIMIT 1`,
        )
        .get(fp, sourceId) as Row | undefined;
      listingId = dup ? Number(dup.id) : null;
    }

    if (listingId == null) {
      listingId = Number(
        db
          .prepare(
            `INSERT INTO listings (fingerprint, title, description, industry, industry_raw, is_franchise, city, county, lat, lng, location_precision,
               asking_price, revenue, cash_flow_sde, ebitda, inventory, ffe, real_estate_included, employees, year_established, financials_basis,
               status, status_changed_at, first_seen_at, last_seen_at, listed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            fp, n.title, n.description, n.industry, n.industry_raw, n.is_franchise, n.city, n.county, n.lat, n.lng, n.location_precision,
            n.asking_price, n.revenue, n.cash_flow_sde, n.ebitda, n.inventory, n.ffe, n.real_estate_included, n.employees, n.year_established,
            n.financials_basis, raw.sourceStatus === "pending" ? "pending" : "active", now, now, now, n.listed_at,
          ).lastInsertRowid,
      );
      event.run(listingId, sourceId, n.listed_at && n.listed_at < day ? n.listed_at : now, "listed", null, null, n.asking_price != null ? String(n.asking_price) : null);
      s.created++;
    } else {
      const cur = db.prepare("SELECT * FROM listings WHERE id=?").get(listingId) as Row;
      const updates: Record<string, unknown> = { last_seen_at: now };
      for (const f of TRACKED) {
        const nv = n[f] as number | null;
        const ov = cur[f] as number | null;
        if (nv == null) continue; // a source omitting a field is not a change
        if (ov == null) {
          updates[f] = nv;
          continue;
        }
        if (Math.abs(nv - ov) >= 1) {
          updates[f] = nv;
          event.run(listingId, sourceId, now, f === "asking_price" ? "price_change" : "financials_change", f, String(ov), String(nv));
        }
      }
      // Fill gaps without overwriting richer data from other sources.
      for (const f of ["description", "inventory", "ffe", "employees", "year_established", "listed_at"] as const) {
        if (cur[f] == null && n[f] != null) updates[f] = n[f];
      }
      if (n.location_precision === "address" && cur.location_precision !== "address") Object.assign(updates, { lat: n.lat, lng: n.lng, location_precision: "address" });
      if ((BASIS_RANK[n.financials_basis] ?? 0) > (BASIS_RANK[String(cur.financials_basis)] ?? 0)) updates.financials_basis = n.financials_basis;
      if (n.is_franchise && !cur.is_franchise) updates.is_franchise = 1;
      updates.fingerprint = fp;
      const keys = Object.keys(updates);
      db.prepare(`UPDATE listings SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...(keys.map((k) => updates[k]) as never[]), listingId);

      const status = String(cur.status);
      if (status === "off_market") {
        event.run(listingId, sourceId, now, "relisted", null, null, null);
        setStatus(listingId, status, raw.sourceStatus === "pending" ? "pending" : "active");
      } else if (status !== "sold") {
        if (raw.sourceStatus === "pending") setStatus(listingId, status, "pending");
        else if (raw.sourceStatus === "active" && status === "pending") setStatus(listingId, status, "active"); // deal fell through
      }
      s.updated++;
    }

    db.prepare(
      `INSERT INTO listing_sources (listing_id, source_id, external_id, url, broker_name, first_seen_at, last_seen_at, present, missed_runs)
       VALUES (?,?,?,?,?,?,?,1,0)
       ON CONFLICT(source_id, external_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, url=excluded.url,
         broker_name=COALESCE(excluded.broker_name, broker_name), present=1, missed_runs=0`,
    ).run(listingId, sourceId, raw.externalId, raw.url ?? null, raw.brokerName ?? null, now, now);

    const l = db.prepare("SELECT asking_price, cash_flow_sde, revenue FROM listings WHERE id=?").get(listingId) as Row;
    db.prepare("INSERT OR REPLACE INTO price_history (listing_id, observed_at, asking_price, cash_flow_sde, revenue) VALUES (?,?,?,?,?)").run(
      listingId, day, l.asking_price as number | null, l.cash_flow_sde as number | null, l.revenue as number | null,
    );
  }

  // Disappearance: only trustworthy when the crawl saw the full inventory.
  if (result.complete) {
    const present = db.prepare("SELECT listing_id, external_id, missed_runs FROM listing_sources WHERE source_id=? AND present=1").all(sourceId) as Row[];
    for (const p of present) {
      if (seenExternal.has(String(p.external_id))) continue;
      const misses = Number(p.missed_runs) + 1;
      const gone = misses >= MISSES_BEFORE_OFF_MARKET;
      db.prepare("UPDATE listing_sources SET missed_runs=?, present=? WHERE source_id=? AND external_id=?").run(misses, gone ? 0 : 1, sourceId, String(p.external_id));
      if (!gone) continue;
      const listingId = Number(p.listing_id);
      const stillListed = db.prepare("SELECT COUNT(*) AS c FROM listing_sources WHERE listing_id=? AND present=1").get(listingId) as Row;
      if (Number(stillListed.c) > 0) continue;
      const cur = db.prepare("SELECT status FROM listings WHERE id=?").get(listingId) as Row;
      if (cur.status === "sold" || cur.status === "off_market") continue;
      event.run(listingId, sourceId, now, "disappeared", null, null, null);
      setStatus(listingId, String(cur.status), "off_market");
      s.disappeared++;
    }
  }

  for (const sale of result.sales ?? []) if (recordSale(db, sourceId, sale, now, setStatus)) s.salesRecorded++;
  return s;
}

function recordSale(db: DB, sourceId: string, sale: RawSale, now: string, setStatus: (id: number, from: string, to: string) => void): boolean {
  let listingId: number | null = null;
  if (sale.externalListingId) {
    const same = db.prepare("SELECT listing_id FROM listing_sources WHERE source_id=? AND external_id=?").get(sourceId, sale.externalListingId) as Row | undefined;
    const any = same ?? (db.prepare("SELECT listing_id FROM listing_sources WHERE external_id=? LIMIT 1").get(sale.externalListingId) as Row | undefined);
    listingId = any ? Number(any.listing_id) : null;
  }
  if (listingId == null) {
    const loc = resolveLocation({ city: sale.city, county: sale.county });
    const m = db.prepare("SELECT id FROM listings WHERE lower(title)=lower(?) AND (city=? OR ? IS NULL) LIMIT 1").get(sale.businessName, loc.city, loc.city) as Row | undefined;
    listingId = m ? Number(m.id) : null;
  }
  if (listingId == null) {
    const loc = resolveLocation({ city: sale.city, county: sale.county });
    if (!loc.inRegion) return false; // sale outside the Columbus region
  }
  const price = parseMoney(sale.salePrice);
  const date = sale.saleDate ? new Date(sale.saleDate).toISOString().slice(0, 10) : null;
  const listing = listingId != null ? (db.prepare("SELECT * FROM listings WHERE id=?").get(listingId) as Row) : null;

  const existing = listingId != null
    ? (db.prepare("SELECT * FROM sales WHERE listing_id=?").get(listingId) as Row | undefined)
    : (db.prepare("SELECT * FROM sales WHERE source_id=? AND business_name=? AND sale_date IS ?").get(sourceId, sale.businessName, date) as Row | undefined);

  if (existing) {
    // Upgrade a broker claim to confirmed, or fill in a price, but never downgrade.
    const upgrade = existing.verification === "broker_reported" && sale.verification === "confirmed";
    const addPrice = existing.sale_price == null && price != null;
    if (!upgrade && !addPrice) return false;
    db.prepare(
      `UPDATE sales SET verification=?, evidence_type=?, evidence_url=?, evidence_note=?, sale_price=COALESCE(?, sale_price), sale_date=COALESCE(?, sale_date), source_id=?, recorded_at=? WHERE id=?`,
    ).run(
      upgrade ? "confirmed" : String(existing.verification),
      upgrade ? sale.evidenceType : String(existing.evidence_type),
      upgrade ? (sale.evidenceUrl ?? null) : (existing.evidence_url as string | null),
      upgrade ? (sale.evidenceNote ?? null) : (existing.evidence_note as string | null),
      price, date, upgrade ? sourceId : String(existing.source_id), now, Number(existing.id),
    );
    return true;
  }

  db.prepare(
    `INSERT INTO sales (listing_id, business_name, industry, city, county, sale_price, sale_date, verification, evidence_type, evidence_url, evidence_note, source_id, recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    listingId,
    sale.businessName,
    (listing?.industry as string) ?? normalizeIndustry(sale.industry, sale.businessName),
    (listing?.city as string) ?? sale.city ?? null,
    (listing?.county as string) ?? sale.county ?? null,
    price, date, sale.verification, sale.evidenceType, sale.evidenceUrl ?? null, sale.evidenceNote ?? null, sourceId, now,
  );
  if (listing && listing.status !== "sold") setStatus(Number(listing.id), String(listing.status), "sold");
  return true;
}
