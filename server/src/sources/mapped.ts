// Shared field-mapping for tabular / JSON sources (CSV exports, broker feeds,
// licensed marketplace feeds). Each source config may override the mapping.
import type { RawListing, RawSale } from "./types.js";

export const DEFAULT_FIELD_MAP: Record<keyof RawListing, string[]> = {
  externalId: ["id", "listing_id", "listingId", "external_id", "ref", "listing number"],
  url: ["url", "link", "listing_url"],
  title: ["title", "name", "headline", "business_name"],
  description: ["description", "summary", "details"],
  industry: ["industry", "category", "business_type", "type"],
  isFranchise: ["franchise", "is_franchise"],
  city: ["city", "location", "town"],
  county: ["county"],
  state: ["state"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "longitude"],
  askingPrice: ["asking_price", "price", "askingPrice", "asking"],
  revenue: ["revenue", "gross_revenue", "gross revenue", "sales"],
  cashFlow: ["cash_flow", "cashflow", "sde", "cash flow", "seller_discretionary_earnings"],
  ebitda: ["ebitda"],
  inventory: ["inventory"],
  ffe: ["ffe", "ff&e", "furniture_fixtures_equipment"],
  realEstateIncluded: ["real_estate_included", "real_estate"],
  employees: ["employees", "employee_count", "staff"],
  yearEstablished: ["year_established", "established", "years_in_business"],
  listedAt: ["listed_at", "listed", "date_listed", "posted"],
  brokerName: ["broker", "broker_name", "brokerage"],
  financialsBasis: ["financials_basis"],
  sourceStatus: ["status"],
};

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const truthy = (v: unknown) => v === true || /^(y|yes|true|1)$/i.test(String(v ?? ""));

function mapStatus(v: unknown): RawListing["sourceStatus"] {
  const s = String(v ?? "").toLowerCase();
  if (/sold|closed/.test(s)) return "sold";
  if (/pending|under contract|under loi|contingent/.test(s)) return "pending";
  return "active";
}

export function mapRow(row: Record<string, unknown>, overrides: Partial<Record<keyof RawListing, string[]>> = {}): RawListing | null {
  const fm = { ...DEFAULT_FIELD_MAP, ...overrides };
  const get = (k: keyof RawListing) => pick(row, fm[k]);
  const title = get("title");
  const externalId = get("externalId") ?? get("url");
  if (!title || !externalId) return null;
  const num = (k: keyof RawListing) => {
    const v = get(k);
    return v === undefined ? null : (v as number | string);
  };
  const lat = get("lat");
  const lng = get("lng");
  return {
    externalId: String(externalId),
    url: (get("url") as string) ?? null,
    title: String(title).trim(),
    description: (get("description") as string) ?? null,
    industry: (get("industry") as string) ?? null,
    isFranchise: truthy(get("isFranchise")),
    city: (get("city") as string) ?? null,
    county: (get("county") as string) ?? null,
    state: (get("state") as string) ?? "OH",
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
    askingPrice: num("askingPrice"),
    revenue: num("revenue"),
    cashFlow: num("cashFlow"),
    ebitda: num("ebitda"),
    inventory: num("inventory"),
    ffe: num("ffe"),
    realEstateIncluded: truthy(get("realEstateIncluded")),
    employees: num("employees"),
    yearEstablished: num("yearEstablished"),
    listedAt: (get("listedAt") as string) ?? null,
    brokerName: (get("brokerName") as string) ?? null,
    financialsBasis: (get("financialsBasis") as RawListing["financialsBasis"]) ?? "seller_reported",
    sourceStatus: mapStatus(get("sourceStatus")),
  };
}

export function mapSaleRow(row: Record<string, unknown>): RawSale | null {
  const name = pick(row, ["business_name", "name", "title"]);
  const verification = String(pick(row, ["verification"]) ?? "").toLowerCase();
  const evidenceType = String(pick(row, ["evidence_type"]) ?? "").toLowerCase();
  if (!name) return null;
  const v = verification === "confirmed" ? "confirmed" : "broker_reported";
  const allowed = ["public_record", "press_release", "news", "broker_closed_deal", "party_confirmation"] as const;
  const et = (allowed as readonly string[]).includes(evidenceType) ? (evidenceType as RawSale["evidenceType"]) : "broker_closed_deal";
  // A "confirmed" sale needs independent evidence. Broker claims alone stay broker_reported.
  const verificationFinal = v === "confirmed" && et !== "broker_closed_deal" && pick(row, ["evidence_url"]) ? "confirmed" : "broker_reported";
  return {
    businessName: String(name),
    externalListingId: (pick(row, ["listing_id", "external_listing_id"]) as string) ?? null,
    industry: (pick(row, ["industry"]) as string) ?? null,
    city: (pick(row, ["city"]) as string) ?? null,
    county: (pick(row, ["county"]) as string) ?? null,
    salePrice: (pick(row, ["sale_price", "price"]) as string) ?? null,
    saleDate: (pick(row, ["sale_date", "closed", "date"]) as string) ?? null,
    verification: verificationFinal,
    evidenceType: et,
    evidenceUrl: (pick(row, ["evidence_url", "source_url"]) as string) ?? null,
    evidenceNote: (pick(row, ["evidence_note", "notes"]) as string) ?? null,
  };
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((f) => f.trim() !== ""));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
