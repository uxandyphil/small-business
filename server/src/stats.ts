import type { ReadDB as DB, Row } from "./dbtypes.js";
import { DEFAULT_ASSUMPTIONS } from "./finance.js";
import { enrich, type ListingView } from "./query.js";

export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function weekStart(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function dashboardStats(db: DB, asOf: Date, year = asOf.getUTCFullYear()) {
  const rows = db.prepare("SELECT * FROM listings").all() as Row[];
  const all = enrich(db, rows, DEFAULT_ASSUMPTIONS, asOf);
  const active = all.filter((l) => l.status === "active" || l.status === "pending");
  const days = (iso: unknown) => (asOf.getTime() - new Date(String(iso)).getTime()) / 86400e3;
  const yearStart = `${year}-01-01`;

  const events = db.prepare("SELECT type, occurred_at, old_value, new_value, listing_id FROM listing_events WHERE occurred_at >= ?").all(yearStart) as Row[];
  const sales = db.prepare("SELECT * FROM sales WHERE sale_date >= ? AND sale_date < ?").all(yearStart, `${year + 1}-01-01`) as Row[];

  // Weekly flow: new listings vs exits (sold / off-market), by the week the event was observed.
  const weeks = new Map<string, { week: string; new: number; sold: number; off_market: number; price_cuts: number }>();
  const bucket = (iso: string) => {
    const w = weekStart(iso);
    if (!weeks.has(w)) weeks.set(w, { week: w, new: 0, sold: 0, off_market: 0, price_cuts: 0 });
    return weeks.get(w)!;
  };
  for (const e of events) {
    const t = String(e.occurred_at);
    if (e.type === "listed") bucket(t).new++;
    else if (e.type === "status_change" && e.new_value === "sold") bucket(t).sold++;
    else if (e.type === "status_change" && e.new_value === "off_market") bucket(t).off_market++;
    else if (e.type === "price_change" && Number(e.new_value) < Number(e.old_value)) bucket(t).price_cuts++;
  }
  const weekly = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));

  const byIndustry = groupStats(active, (l) => String(l.industry));
  const byCounty = groupStats(active, (l) => String(l.county ?? "Unknown"));

  const offMarketYear = all.filter((l) => l.status === "off_market" && String(l.status_changed_at) >= yearStart).length;
  const saleRatios = sales
    .map((s) => {
      const l = all.find((x) => x.id === Number(s.listing_id));
      return l && s.sale_price && l.asking_price ? Number(s.sale_price) / Number(l.asking_price) : null;
    })
    .filter((x): x is number => x != null);

  return {
    asOf: asOf.toISOString(),
    year,
    kpis: {
      activeListings: active.length,
      pending: active.filter((l) => l.status === "pending").length,
      newLast30: active.filter((l) => days(l.first_seen_at) <= 30).length,
      priceCutsLast30: Number((db
        .prepare("SELECT COUNT(DISTINCT listing_id) c FROM listing_events WHERE type='price_change' AND CAST(new_value AS REAL) < CAST(old_value AS REAL) AND occurred_at >= ?")
        .get(new Date(asOf.getTime() - 30 * 86400e3).toISOString()) as Row).c),
      medianAsking: median(active.map((l) => l.asking_price as number)),
      medianCashFlow: median(active.map((l) => l.cash_flow_sde as number)),
      medianMultiple: median(active.map((l) => l.finance.multiple)),
      medianCashOnCash: median(active.map((l) => l.finance.cashOnCashPct)),
      totalAsking: active.reduce((s, l) => s + Number(l.asking_price ?? 0), 0),
      salesConfirmed: sales.filter((s) => s.verification === "confirmed").length,
      salesBrokerReported: sales.filter((s) => s.verification === "broker_reported").length,
      salesWithPrice: sales.filter((s) => s.sale_price != null).length,
      offMarketUnverified: offMarketYear,
      medianSaleToAsk: median(saleRatios),
      medianDaysOnMarketSold: median(all.filter((l) => l.status === "sold").map((l) => l.days_on_market)),
    },
    weekly,
    byIndustry,
    byCounty,
    scatter: active
      .filter((l) => l.asking_price && l.cash_flow_sde)
      .map((l) => ({ id: l.id, title: l.title, industry: l.industry, price: l.asking_price, cashFlow: l.cash_flow_sde, multiple: l.finance.multiple, roi: l.finance.cashOnCashPct })),
    topRoi: [...active]
      .filter((l) => l.finance.cashOnCashPct != null && (l.finance.dscr ?? 0) >= 1.25)
      .sort((a, b) => (b.finance.cashOnCashPct ?? 0) - (a.finance.cashOnCashPct ?? 0))
      .slice(0, 6),
    recentlyListed: [...active].sort((a, b) => String(b.first_seen_at).localeCompare(String(a.first_seen_at))).slice(0, 6),
    mapPoints: active.map(mapPoint),
  };
}

export function mapPoint(l: ListingView) {
  return {
    id: l.id,
    title: l.title,
    industry: l.industry,
    city: l.city,
    lat: l.lat,
    lng: l.lng,
    precision: l.location_precision,
    price: l.asking_price,
    cashFlow: l.cash_flow_sde,
    roi: l.finance.cashOnCashPct,
    status: l.status,
  };
}

function groupStats(list: ListingView[], key: (l: ListingView) => string) {
  const groups = new Map<string, ListingView[]>();
  for (const l of list) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
  return [...groups.entries()]
    .map(([name, ls]) => ({
      name,
      count: ls.length,
      medianAsking: median(ls.map((l) => l.asking_price as number)),
      medianCashFlow: median(ls.map((l) => l.cash_flow_sde as number)),
      medianMultiple: median(ls.map((l) => l.finance.multiple)),
      medianCashOnCash: median(ls.map((l) => l.finance.cashOnCashPct)),
      medianMarginPct: median(ls.map((l) => l.finance.marginPct)),
    }))
    .sort((a, b) => b.count - a.count);
}

export function salesReport(db: DB, asOf: Date, year: number) {
  const sales = db
    .prepare(
      `SELECT s.*, src.name AS source_name, src.kind AS source_kind FROM sales s LEFT JOIN sources src ON src.id = s.source_id
       WHERE s.sale_date >= ? AND s.sale_date < ? ORDER BY s.sale_date DESC`,
    )
    .all(`${year}-01-01`, `${year + 1}-01-01`) as Row[];
  const ids = sales.map((s) => s.listing_id).filter((x) => x != null) as number[];
  const listings = ids.length ? (db.prepare(`SELECT * FROM listings WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[]) : [];
  const views = new Map(enrich(db, listings, DEFAULT_ASSUMPTIONS, asOf).map((v) => [v.id, v]));
  const offMarket = db
    .prepare("SELECT * FROM listings WHERE status='off_market' AND status_changed_at >= ? AND status_changed_at < ? ORDER BY status_changed_at DESC")
    .all(`${year}-01-01`, `${year + 1}-01-01`) as Row[];
  return {
    year,
    sales: sales.map((s) => {
      const l = s.listing_id != null ? views.get(Number(s.listing_id)) : undefined;
      const lastAsk = l?.asking_price as number | null | undefined;
      return {
        ...s,
        listing: l
          ? { id: l.id, title: l.title, asking_price: lastAsk, original_price: l.original_price, cash_flow_sde: l.cash_flow_sde, revenue: l.revenue, days_on_market: l.days_on_market, sources: l.sources }
          : null,
        sale_to_ask: s.sale_price && lastAsk ? Number(s.sale_price) / lastAsk : null,
        sale_multiple: s.sale_price && l?.cash_flow_sde ? Number(s.sale_price) / Number(l.cash_flow_sde) : null,
      };
    }),
    offMarket: enrich(db, offMarket, DEFAULT_ASSUMPTIONS, asOf).map((l) => ({
      id: l.id, title: l.title, industry: l.industry, city: l.city, county: l.county, asking_price: l.asking_price,
      cash_flow_sde: l.cash_flow_sde, last_seen_at: l.last_seen_at, status_changed_at: l.status_changed_at, days_on_market: l.days_on_market, sources: l.sources,
    })),
  };
}
