import { z } from "zod";
import type { DB, Row } from "./db.js";
import { analyzeDeal, DEFAULT_ASSUMPTIONS, type FinanceAssumptions, type FinanceResult } from "./finance.js";

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v == null ? [] : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)));
const num = z.coerce.number().finite().optional();
const bool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((v) => (v == null ? undefined : v === true || v === "true" || v === "1"));

export const FiltersSchema = z.object({
  q: z.string().optional(),
  status: csv, // default: active,pending
  industry: csv,
  county: csv,
  city: csv,
  minPrice: num,
  maxPrice: num,
  minCashFlow: num,
  maxCashFlow: num,
  minRevenue: num,
  maxRevenue: num,
  minRoi: num,           // cash-on-cash %, after debt service
  minOwnerIncome: num,
  maxMultiple: num,
  minDscr: num,
  minYears: num,
  minEmployees: num,
  maxEmployees: num,
  franchise: z.enum(["any", "only", "exclude"]).optional(),
  realEstate: z.enum(["any", "only", "exclude"]).optional(),
  hasFinancials: bool,
  newWithinDays: num,
  priceReduced: bool,
  sort: z
    .enum(["newest", "price_asc", "price_desc", "cash_flow_desc", "revenue_desc", "roi_desc", "owner_income_desc", "multiple_asc", "dscr_desc", "updated"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const AssumptionsSchema = z.object({
  downPaymentPct: num,
  sellerNotePct: num,
  sbaRatePct: num,
  sbaTermYears: num,
  sellerNoteRatePct: num,
  sellerNoteTermYears: num,
  closingCostPct: num,
  workingCapital: num,
  capexReservePct: num,
  managerSalary: num,
  ownerMarketSalary: num,
});

export function parseAssumptions(q: Record<string, unknown>): FinanceAssumptions {
  const parsed = AssumptionsSchema.parse(q);
  const out = { ...DEFAULT_ASSUMPTIONS };
  for (const [k, v] of Object.entries(parsed)) if (v != null) (out as Record<string, number>)[k] = v;
  return out;
}

export interface ListingView extends Row {
  id: number;
  finance: FinanceResult;
  sources: Row[];
  price_reduced: boolean;
  original_price: number | null;
  days_on_market: number;
  sale?: Row | null;
}

export function enrich(db: DB, rows: Row[], a: FinanceAssumptions, asOf: Date): ListingView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const ph = ids.map(() => "?").join(",");
  const srcRows = db
    .prepare(
      `SELECT ls.listing_id, ls.source_id, ls.url, ls.broker_name, ls.present, ls.first_seen_at, ls.last_seen_at, s.name AS source_name, s.kind AS source_kind
       FROM listing_sources ls JOIN sources s ON s.id = ls.source_id WHERE ls.listing_id IN (${ph})`,
    )
    .all(...ids) as Row[];
  const first = db
    .prepare(
      `SELECT listing_id, asking_price FROM price_history ph WHERE listing_id IN (${ph})
       AND observed_at = (SELECT MIN(observed_at) FROM price_history p2 WHERE p2.listing_id = ph.listing_id)`,
    )
    .all(...ids) as Row[];
  const sales = db.prepare(`SELECT * FROM sales WHERE listing_id IN (${ph})`).all(...ids) as Row[];
  const firstMap = new Map(first.map((r) => [Number(r.listing_id), r.asking_price as number | null]));
  const saleMap = new Map(sales.map((r) => [Number(r.listing_id), r]));
  return rows.map((r) => {
    const id = Number(r.id);
    const orig = firstMap.get(id) ?? null;
    const price = r.asking_price as number | null;
    const startDate = new Date(String(r.listed_at ?? r.first_seen_at));
    const endDate = r.status === "active" || r.status === "pending" ? asOf : new Date(String(r.status_changed_at ?? r.last_seen_at));
    return {
      ...r,
      id,
      is_franchise: Boolean(r.is_franchise),
      real_estate_included: Boolean(r.real_estate_included),
      finance: analyzeDeal({ askingPrice: price, sde: r.cash_flow_sde as number | null, ebitda: r.ebitda as number | null, revenue: r.revenue as number | null }, a),
      sources: srcRows.filter((s) => Number(s.listing_id) === id).map(({ listing_id: _, ...s }) => ({ ...s, present: Boolean(s.present) })),
      original_price: orig,
      price_reduced: orig != null && price != null && price < orig - 1,
      days_on_market: Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86400e3)),
      sale: saleMap.get(id) ?? null,
    };
  });
}

/** In-memory predicate shared by search and alert matching. */
export function matches(l: ListingView, f: Filters, asOf: Date): boolean {
  const statuses = f.status.length ? f.status : ["active", "pending"];
  if (!statuses.includes(String(l.status))) return false;
  if (f.q) {
    const hay = `${l.title} ${l.description ?? ""} ${l.industry} ${l.city ?? ""} ${l.county ?? ""}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  if (f.industry.length && !f.industry.includes(String(l.industry))) return false;
  if (f.county.length && !f.county.includes(String(l.county))) return false;
  if (f.city.length && !f.city.includes(String(l.city))) return false;
  const price = l.asking_price as number | null;
  const cf = l.cash_flow_sde as number | null;
  const rev = l.revenue as number | null;
  const range = (v: number | null, min?: number, max?: number) => (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));
  if (!range(price, f.minPrice, f.maxPrice)) return false;
  if (!range(cf, f.minCashFlow, f.maxCashFlow)) return false;
  if (!range(rev, f.minRevenue, f.maxRevenue)) return false;
  if (!range(l.employees as number | null, f.minEmployees, f.maxEmployees)) return false;
  if (f.minRoi != null && !(l.finance.cashOnCashPct != null && l.finance.cashOnCashPct >= f.minRoi)) return false;
  if (f.minOwnerIncome != null && !(l.finance.ownerIncome != null && l.finance.ownerIncome >= f.minOwnerIncome)) return false;
  if (f.maxMultiple != null && !(l.finance.multiple != null && l.finance.multiple <= f.maxMultiple)) return false;
  if (f.minDscr != null && !(l.finance.dscr != null && l.finance.dscr >= f.minDscr)) return false;
  if (f.minYears != null && !(l.year_established != null && asOf.getUTCFullYear() - Number(l.year_established) >= f.minYears)) return false;
  if (f.franchise === "only" && !l.is_franchise) return false;
  if (f.franchise === "exclude" && l.is_franchise) return false;
  if (f.realEstate === "only" && !l.real_estate_included) return false;
  if (f.realEstate === "exclude" && l.real_estate_included) return false;
  if (f.hasFinancials && (price == null || (cf == null && l.ebitda == null))) return false;
  if (f.newWithinDays != null && (asOf.getTime() - new Date(String(l.first_seen_at)).getTime()) / 86400e3 > f.newWithinDays) return false;
  if (f.priceReduced && !l.price_reduced) return false;
  return true;
}

const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
};

export function sortListings(list: ListingView[], sort: Filters["sort"] = "newest"): ListingView[] {
  const by: Record<string, (a: ListingView, b: ListingView) => number> = {
    newest: (a, b) => String(b.first_seen_at).localeCompare(String(a.first_seen_at)),
    updated: (a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)),
    price_asc: (a, b) => nullsLast(a.asking_price as number, b.asking_price as number, 1),
    price_desc: (a, b) => nullsLast(a.asking_price as number, b.asking_price as number, -1),
    cash_flow_desc: (a, b) => nullsLast(a.cash_flow_sde as number, b.cash_flow_sde as number, -1),
    revenue_desc: (a, b) => nullsLast(a.revenue as number, b.revenue as number, -1),
    roi_desc: (a, b) => nullsLast(a.finance.cashOnCashPct, b.finance.cashOnCashPct, -1),
    owner_income_desc: (a, b) => nullsLast(a.finance.ownerIncome, b.finance.ownerIncome, -1),
    multiple_asc: (a, b) => nullsLast(a.finance.multiple, b.finance.multiple, 1),
    dscr_desc: (a, b) => nullsLast(a.finance.dscr, b.finance.dscr, -1),
  };
  return [...list].sort(by[sort] ?? by.newest);
}

export function searchListings(db: DB, f: Filters, a: FinanceAssumptions, asOf: Date) {
  const statuses = f.status.length ? f.status : ["active", "pending"];
  const rows = db.prepare(`SELECT * FROM listings WHERE status IN (${statuses.map(() => "?").join(",")})`).all(...statuses) as Row[];
  const all = enrich(db, rows, a, asOf).filter((l) => matches(l, f, asOf));
  const sorted = sortListings(all, f.sort);
  const offset = f.offset ?? 0;
  const limit = f.limit ?? 50;
  return { total: sorted.length, items: sorted.slice(offset, offset + limit), all: sorted };
}
