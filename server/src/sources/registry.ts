import type { DB } from "../db.js";

export interface SourceDef {
  id: string;
  name: string;
  kind: "marketplace" | "broker" | "public_record" | "press" | "manual" | "demo";
  adapter: string;
  homepage: string | null;
  access_method: string;
  compliance_note: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export const SOURCE_DEFS: SourceDef[] = [
  {
    id: "bizbuysell",
    name: "BizBuySell",
    kind: "marketplace",
    adapter: "licensed_feed",
    homepage: "https://www.bizbuysell.com",
    access_method: "Licensed data feed / partner API (not scraped)",
    compliance_note:
      "BizBuySell's terms of use restrict automated collection. The crawler refuses this host. Enable only with a data license or partner feed (set BIZBUYSELL_FEED_URL and BIZBUYSELL_API_KEY), or import a CSV you are entitled to use.",
    enabled: false,
    config: { urlEnv: "BIZBUYSELL_FEED_URL", keyEnv: "BIZBUYSELL_API_KEY", itemsPath: "listings" },
  },
  {
    id: "bizquest",
    name: "BizQuest",
    kind: "marketplace",
    adapter: "licensed_feed",
    homepage: "https://www.bizquest.com",
    access_method: "Licensed data feed / partner API (not scraped)",
    compliance_note:
      "BizQuest's terms of use restrict automated collection. The crawler refuses this host. Enable only with a data license or partner feed (set BIZQUEST_FEED_URL and BIZQUEST_API_KEY).",
    enabled: false,
    config: { urlEnv: "BIZQUEST_FEED_URL", keyEnv: "BIZQUEST_API_KEY", itemsPath: "listings" },
  },
  {
    id: "broker-example",
    name: "Independent broker website (template)",
    kind: "broker",
    adapter: "broker_html",
    homepage: null,
    access_method: "Polite HTML crawl (robots.txt honored, ≥5s between requests)",
    compliance_note:
      "Use only for broker sites whose robots.txt and terms permit crawling, ideally with the broker's written OK. Partial crawls never mark listings as gone.",
    enabled: false,
    config: {
      startUrls: ["https://broker.example/listings?state=OH"],
      maxPages: 10,
      nextSelector: "a.next",
      brokerName: "Example Brokerage",
      selectors: { item: ".listing", title: ".title", link: "a", price: ".price", cashFlow: ".cash-flow", revenue: ".revenue", location: ".location", status: ".status" },
    },
  },
  {
    id: "manual-import",
    name: "Manual CSV import",
    kind: "manual",
    adapter: "csv",
    homepage: null,
    access_method: "CSV upload (broker spreadsheets, licensed exports)",
    compliance_note: "Operator is responsible for having rights to imported data. Imports are partial by default (never infer disappearance).",
    enabled: false,
    config: { listingsPath: "data/imports/listings.csv", salesPath: "data/imports/sales.csv", complete: false },
  },
  {
    id: "public-records",
    name: "Public records & press (verified sales)",
    kind: "public_record",
    adapter: "csv",
    homepage: null,
    access_method: "Curated CSV of sales evidenced by county filings, liquor-permit transfers, press releases, or news",
    compliance_note:
      "Each sale needs an evidence URL. Rows without independent evidence are stored as broker-reported, never confirmed.",
    enabled: false,
    config: { salesPath: "data/imports/verified_sales.csv", complete: false },
  },
  {
    id: "demo-marketplace",
    name: "Demo marketplace (synthetic)",
    kind: "demo",
    adapter: "demo",
    homepage: null,
    access_method: "Synthetic generator",
    compliance_note: "Fictional data for demonstration. Not real businesses.",
    enabled: true,
    config: { channel: "marketplace" },
  },
  {
    id: "demo-broker",
    name: "Demo broker site (synthetic)",
    kind: "demo",
    adapter: "demo",
    homepage: null,
    access_method: "Synthetic generator",
    compliance_note: "Fictional data for demonstration. Not real businesses.",
    enabled: true,
    config: { channel: "broker" },
  },
  {
    id: "demo-records",
    name: "Demo verified sale records (synthetic)",
    kind: "demo",
    adapter: "demo",
    homepage: null,
    access_method: "Synthetic generator",
    compliance_note: "Fictional data for demonstration. Not real sales.",
    enabled: true,
    config: { channel: "records" },
  },
];

export function registerSources(db: DB): void {
  const stmt = db.prepare(
    `INSERT INTO sources (id, name, kind, adapter, homepage, access_method, compliance_note, enabled, config_json)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, adapter=excluded.adapter, homepage=excluded.homepage,
       access_method=excluded.access_method, compliance_note=excluded.compliance_note`,
  );
  for (const s of SOURCE_DEFS) {
    stmt.run(s.id, s.name, s.kind, s.adapter, s.homepage, s.access_method, s.compliance_note, s.enabled ? 1 : 0, JSON.stringify(s.config));
  }
}
