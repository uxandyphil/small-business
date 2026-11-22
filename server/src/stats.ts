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
  const byCity = groupStats(active, (l) => String(l.city ?? "Unknown"));

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
    byCity,
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
  const saleRows = sales.map((s) => {
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
  });
  const offMarketViews = enrich(db, offMarket, DEFAULT_ASSUMPTIONS, asOf);
  const activeByIndustry = new Map(
    (db.prepare("SELECT industry, COUNT(*) c FROM listings WHERE status IN ('active','pending') GROUP BY industry").all() as Row[]).map((r) => [String(r.industry), Number(r.c)]),
  );

  // Which industries are actually selling: volume, speed, price and sell-through.
  const groups = new Map<string, typeof saleRows>();
  for (const s of saleRows) {
    const k = String((s as Row).industry ?? "Other");
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const offByIndustry = new Map<string, number>();
  for (const o of offMarketViews) offByIndustry.set(String(o.industry), (offByIndustry.get(String(o.industry)) ?? 0) + 1);
  const industries = [...new Set([...groups.keys(), ...offByIndustry.keys()])]
    .map((name) => {
      const g = groups.get(name) ?? [];
      const off = offByIndustry.get(name) ?? 0;
      return {
        name,
        sales: g.length,
        confirmed: g.filter((s) => (s as Row).verification === "confirmed").length,
        brokerReported: g.filter((s) => (s as Row).verification === "broker_reported").length,
        sharePct: saleRows.length ? (g.length / saleRows.length) * 100 : 0,
        medianSalePrice: median(g.map((s) => (s as Row).sale_price as number | null)),
        medianSaleMultiple: median(g.map((s) => s.sale_multiple)),
        medianSaleToAsk: median(g.map((s) => s.sale_to_ask)),
        medianDaysOnMarket: median(g.map((s) => s.listing?.days_on_market)),
        offMarket: off,
        // Of the listings in this industry that left the market this year, the share with a sale record.
        sellThroughPct: g.length + off > 0 ? (g.length / (g.length + off)) * 100 : null,
        activeNow: activeByIndustry.get(name) ?? 0,
      };
    })
    .sort((a, b) => b.sales - a.sales || (b.sellThroughPct ?? 0) - (a.sellThroughPct ?? 0));

  return {
    year,
    industries,
    sales: saleRows,
    offMarket: offMarketViews.map((l) => ({
      id: l.id, title: l.title, industry: l.industry, city: l.city, county: l.county, asking_price: l.asking_price,
      cash_flow_sde: l.cash_flow_sde, last_seen_at: l.last_seen_at, status_changed_at: l.status_changed_at, days_on_market: l.days_on_market, sources: l.sources,
    })),
  };
}

/**
 * Year-over-year market comparison. Each prior year is also measured over the
 * same calendar window as the current, partial year ("same period"), so a
 * year-to-date figure can be compared like for like.
 */
export function yearComparison(db: DB, asOf: Date) {
  const firstRun = (db.prepare("SELECT MIN(as_of) t FROM ingest_runs WHERE status='ok'").get() as Row | undefined)?.t as string | undefined;
  if (!firstRun) return { asOf: asOf.toISOString(), currentYear: asOf.getUTCFullYear(), years: [], industries: [] };
  const firstYear = new Date(firstRun).getUTCFullYear();
  const currentYear = asOf.getUTCFullYear();
  const cutoff = asOf.toISOString().slice(5, 10); // MM-DD for same-period comparisons
  const inYtd = (iso: string) => iso.slice(5, 10) <= cutoff;
  const yearOf = (iso: unknown) => (iso ? Number(String(iso).slice(0, 4)) : NaN);

  const sales = db.prepare("SELECT * FROM sales WHERE sale_date IS NOT NULL").all() as Row[];
  const soldIds = sales.map((s) => s.listing_id).filter((x) => x != null) as number[];
  const soldViews = new Map(
    (soldIds.length ? enrich(db, db.prepare(`SELECT * FROM listings WHERE id IN (${soldIds.map(() => "?").join(",")})`).all(...soldIds) as Row[], DEFAULT_ASSUMPTIONS, asOf) : []).map((v) => [v.id, v]),
  );
  const offMarket = db.prepare("SELECT id, industry, status_changed_at FROM listings WHERE status='off_market'").all() as Row[];
  const listed = db
    .prepare(
      `SELECT l.id, l.industry, l.cash_flow_sde, e.occurred_at,
         (SELECT asking_price FROM price_history p WHERE p.listing_id = l.id ORDER BY observed_at LIMIT 1) AS first_price
       FROM listing_events e JOIN listings l ON l.id = e.listing_id WHERE e.type = 'listed'`,
    )
    .all() as Row[];

  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i).map((y) => {
    const ys = sales.filter((s) => yearOf(s.sale_date) === y);
    const yo = offMarket.filter((o) => yearOf(o.status_changed_at) === y);
    const yl = listed.filter((l) => yearOf(l.occurred_at) === y);
    const saleDetail = ys.map((s) => {
      const l = s.listing_id != null ? soldViews.get(Number(s.listing_id)) : undefined;
      return {
        price: s.sale_price as number | null,
        multiple: s.sale_price && l?.cash_flow_sde ? Number(s.sale_price) / Number(l.cash_flow_sde) : null,
        toAsk: s.sale_price && l?.asking_price ? Number(s.sale_price) / Number(l.asking_price) : null,
        dom: l?.days_on_market ?? null,
      };
    });
    const ytd = ys.filter((s) => inYtd(String(s.sale_date)));
    const ytdSales = ytd.length;
    const ytdOff = yo.filter((o) => inYtd(String(o.status_changed_at))).length;
    const byInd = new Map<string, number>();
    for (const s of ys) byInd.set(String(s.industry ?? "Other"), (byInd.get(String(s.industry ?? "Other")) ?? 0) + 1);
    return {
      year: y,
      partial: y === currentYear,
      sales: ys.length,
      confirmed: ys.filter((s) => s.verification === "confirmed").length,
      brokerReported: ys.filter((s) => s.verification === "broker_reported").length,
      offMarket: yo.length,
      newListings: yl.length,
      sellThroughPct: ys.length + yo.length ? (ys.length / (ys.length + yo.length)) * 100 : null,
      medianSalePrice: median(saleDetail.map((d) => d.price)),
      medianSaleMultiple: median(saleDetail.map((d) => d.multiple)),
      medianSaleToAsk: median(saleDetail.map((d) => d.toAsk)),
      medianDaysOnMarket: median(saleDetail.map((d) => d.dom)),
      // What sellers were asking: first asking price ÷ cash flow for listings that came to market this year.
      medianAskingMultiple: median(yl.map((l) => (l.first_price && l.cash_flow_sde ? Number(l.first_price) / Number(l.cash_flow_sde) : null))),
      samePeriod: {
        sales: ytdSales,
        confirmed: ytd.filter((s) => s.verification === "confirmed").length,
        brokerReported: ytd.filter((s) => s.verification === "broker_reported").length,
        offMarket: ytdOff,
        newListings: yl.filter((l) => inYtd(String(l.occurred_at))).length,
        sellThroughPct: ytdSales + ytdOff ? (ytdSales / (ytdSales + ytdOff)) * 100 : null,
      },
      topIndustries: [...byInd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
      // Data before the first crawl only reflects listings already on market then.
      incomplete: y === firstYear && firstRun.slice(5, 10) > "01-15",
    };
  });

  const industryNames = [...new Set(sales.filter((s) => yearOf(s.sale_date) >= firstYear).map((s) => String(s.industry ?? "Other")))];
  const industries = industryNames
    .map((name) => {
      const perYear = years.map((y) => {
        const n = sales.filter((s) => String(s.industry ?? "Other") === name && yearOf(s.sale_date) === y.year).length;
        const off = offMarket.filter((o) => String(o.industry) === name && yearOf(o.status_changed_at) === y.year).length;
        return { year: y.year, sales: n, sharePct: y.sales ? (n / y.sales) * 100 : 0, sellThroughPct: n + off ? (n / (n + off)) * 100 : null };
      });
      return { name, total: perYear.reduce((a, b) => a + b.sales, 0), perYear };
    })
    .sort((a, b) => b.total - a.total);

  return { asOf: asOf.toISOString(), currentYear, samePeriodEnd: cutoff, years, industries };
}
