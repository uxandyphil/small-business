import { describe, expect, it, beforeEach } from "vitest";
import { analyzeDeal, annualPayment, DEFAULT_ASSUMPTIONS } from "../src/finance.js";
import { fingerprint, normalizeIndustry, parseMoney, parseYearEstablished } from "../src/normalize.js";
import { isRestrictedHost, parseRobots, robotsAllows } from "../src/sources/compliance.js";
import { mapSaleRow, parseCsv } from "../src/sources/mapped.js";
import { resolveLocation } from "../src/geo.js";
import { openDb, type DB, type Row } from "../src/db.js";
import { runSource } from "../src/ingest.js";
import { salesReport, yearComparison } from "../src/stats.js";
import { ADAPTERS } from "../src/sources/adapters.js";
import type { FetchResult, RawListing } from "../src/sources/types.js";

describe("finance", () => {
  it("amortizes like a standard loan", () => {
    // $100k, 10%, 10 years -> $1,321.51/mo
    expect(annualPayment(100_000, 10, 10)).toBeCloseTo(1321.51 * 12, 0);
    expect(annualPayment(120_000, 0, 10)).toBe(12_000);
  });

  it("computes owner income, DSCR and ROI", () => {
    const r = analyzeDeal({ askingPrice: 1_000_000, sde: 350_000, revenue: 1_400_000 });
    expect(r.equity).toBe(100_000);
    expect(r.sellerNote).toBe(100_000);
    expect(r.sbaLoan).toBe(800_000);
    expect(r.cashInvested).toBe(130_000);
    const debt = annualPayment(800_000, 10.5, 10) + annualPayment(100_000, 7, 5);
    expect(r.annualDebtService).toBeCloseTo(debt, 6);
    const available = 350_000 * 0.95;
    expect(r.ownerIncome).toBeCloseTo(available - debt, 6);
    expect(r.dscr).toBeCloseTo(available / debt, 6);
    expect(r.cashOnCashPct).toBeCloseTo(((available - debt - 75_000) / 130_000) * 100, 6);
    expect(r.multiple).toBeCloseTo(2.857, 2);
    expect(r.marginPct).toBeCloseTo(25, 6);
  });

  it("flags thin coverage and overpricing", () => {
    const r = analyzeDeal({ askingPrice: 2_000_000, sde: 300_000 });
    expect(r.dscr!).toBeLessThan(1.25);
    expect(r.flags.join(" ")).toMatch(/DSCR/);
    expect(r.flags.join(" ")).toMatch(/6\.7x/);
  });

  it("falls back to EBITDA and handles missing price", () => {
    expect(analyzeDeal({ askingPrice: 500_000, sde: null, ebitda: 150_000 }).basis).toBe("ebitda");
    const none = analyzeDeal({ askingPrice: null, sde: 100_000 });
    expect(none.ownerIncome).toBeNull();
    expect(none.flags[0]).toMatch(/not disclosed/);
  });

  it("respects user assumptions", () => {
    const allCash = analyzeDeal({ askingPrice: 500_000, sde: 200_000 }, { ...DEFAULT_ASSUMPTIONS, downPaymentPct: 100, sellerNotePct: 0 });
    expect(allCash.annualDebtService).toBe(0);
    expect(allCash.dscr).toBeNull();
  });
});

describe("normalize", () => {
  it("parses money loosely but refuses to guess", () => {
    expect(parseMoney("$1,250,000")).toBe(1_250_000);
    expect(parseMoney("1.25M")).toBe(1_250_000);
    expect(parseMoney("$450K")).toBe(450_000);
    expect(parseMoney("Not Disclosed")).toBeNull();
    expect(parseMoney("Call for price")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
  it("parses establishment year", () => {
    expect(parseYearEstablished("Established 2009", 2026)).toBe(2009);
    expect(parseYearEstablished("15 years", 2026)).toBe(2011);
    expect(parseYearEstablished(1998, 2026)).toBe(1998);
  });
  it("maps industries", () => {
    expect(normalizeIndustry("Pizza Restaurant")).toBe("Restaurants & Food");
    expect(normalizeIndustry(null, "Established HVAC Contractor")).toBe("Home & Trade Services");
    expect(normalizeIndustry("Car Wash")).toBe("Automotive");
    expect(normalizeIndustry("Retail")).toBe("Retail");
    expect(normalizeIndustry("zzz")).toBe("Other");
  });
  it("fingerprints syndicated copies identically", () => {
    const a = fingerprint({ title: "Profitable HVAC Contractor in Dublin", industry: "Home & Trade Services", city: "Dublin", asking_price: 900_000 });
    const b = fingerprint({ title: "Turnkey Profitable HVAC Contractor in Dublin", industry: "Home & Trade Services", city: "Dublin", asking_price: 900_000 });
    const c = fingerprint({ title: "Profitable HVAC Contractor in Dublin", industry: "Home & Trade Services", city: "Dublin", asking_price: 1_400_000 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("geo", () => {
  it("resolves Columbus-area places and rejects others", () => {
    expect(resolveLocation({ city: "Dublin, OH" })).toMatchObject({ city: "Dublin", county: "Franklin", inRegion: true, precision: "city" });
    expect(resolveLocation({ city: "Short North" }).city).toBe("Columbus");
    expect(resolveLocation({ county: "Franklin County" })).toMatchObject({ precision: "county", inRegion: true });
    // Coverage is Franklin County only by default
    expect(resolveLocation({ county: "Delaware County" })).toMatchObject({ precision: "county", inRegion: false });
    expect(resolveLocation({ city: "Newark" })).toMatchObject({ county: "Licking", inRegion: false });
    expect(resolveLocation({ city: "Cleveland", county: "Cuyahoga" }).inRegion).toBe(false);
    expect(resolveLocation({ city: "Dublin", state: "CA" }).inRegion).toBe(false);
  });
});

describe("compliance", () => {
  it("honors robots.txt longest-match semantics", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/listings\nCrawl-delay: 10\n\nUser-agent: OtherBot\nDisallow: /");
    expect(robotsAllows(r, "/listings")).toBe(true);
    expect(robotsAllows(r, "/private/admin")).toBe(false);
    expect(robotsAllows(r, "/private/listings/1")).toBe(true);
    expect(r.crawlDelaySec).toBe(10);
  });
  it("blocks marketplaces that prohibit scraping unless licensed", () => {
    expect(isRestrictedHost("https://www.bizbuysell.com/ohio/columbus-businesses-for-sale/")).toBe(true);
    expect(isRestrictedHost("https://www.bizquest.com/x")).toBe(true);
    expect(isRestrictedHost("https://feeds.bizbuysell.com/x", ["feeds.bizbuysell.com"])).toBe(false);
    expect(isRestrictedHost("https://somebroker.com/listings")).toBe(false);
  });
  it("never confirms a sale without independent evidence", () => {
    expect(mapSaleRow({ business_name: "X", verification: "confirmed", evidence_type: "broker_closed_deal", evidence_url: "https://a" })!.verification).toBe("broker_reported");
    expect(mapSaleRow({ business_name: "X", verification: "confirmed", evidence_type: "public_record" })!.verification).toBe("broker_reported");
    expect(mapSaleRow({ business_name: "X", verification: "confirmed", evidence_type: "public_record", evidence_url: "https://a" })!.verification).toBe("confirmed");
  });
  it("parses quoted CSV", () => {
    expect(parseCsv('title,price\n"Pizza, Inc ""Best""","$1,000"\r\n')).toEqual([{ title: 'Pizza, Inc "Best"', price: "$1,000" }]);
  });
});

// ---- Pipeline lifecycle against a scripted test source
describe("ingestion pipeline", () => {
  let db: DB;
  let next: FetchResult;
  const listing = (over: Partial<RawListing> = {}): RawListing => ({
    externalId: "A1", title: "Established Pizzeria in Hilliard", industry: "Restaurant", city: "Hilliard", askingPrice: "$500,000", cashFlow: "$180K", revenue: "1.1M", ...over,
  });

  beforeEach(() => {
    db = openDb(":memory:");
    ADAPTERS.test = { id: "test", fetch: async () => next };
    for (const id of ["t1", "t2"]) {
      db.prepare("INSERT INTO sources (id, name, kind, adapter, access_method, compliance_note, enabled) VALUES (?, ?, 'broker', 'test', 'test', 'test', 1)").run(id, id);
    }
  });
  const status = () => (db.prepare("SELECT status FROM listings").get() as Row).status;
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

  it("creates, tracks price drops, and dedupes across sources", async () => {
    next = { listings: [listing()], complete: true };
    await runSource(db, "t1", day(0));
    next = { listings: [listing({ externalId: "B9", title: "Turnkey Established Pizzeria in Hilliard" })], complete: true };
    await runSource(db, "t2", day(0));
    expect((db.prepare("SELECT COUNT(*) c FROM listings").get() as Row).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) c FROM listing_sources").get() as Row).c).toBe(2);

    next = { listings: [listing({ askingPrice: 450_000 })], complete: true };
    await runSource(db, "t1", day(7));
    const ev = db.prepare("SELECT * FROM listing_events WHERE type='price_change'").get() as Row;
    expect([ev.old_value, ev.new_value]).toEqual(["500000", "450000"]);
    expect((db.prepare("SELECT COUNT(*) c FROM price_history").get() as Row).c).toBe(2);
  });

  it("marks off-market (not sold) only after repeated complete misses on every source", async () => {
    next = { listings: [listing()], complete: true };
    await runSource(db, "t1", day(0));
    next = { listings: [], complete: false }; // partial crawl: no inference
    await runSource(db, "t1", day(7));
    await runSource(db, "t1", day(14));
    expect(status()).toBe("active");
    next = { listings: [], complete: true };
    await runSource(db, "t1", day(21));
    expect(status()).toBe("active"); // one miss is not enough
    await runSource(db, "t1", day(28));
    expect(status()).toBe("off_market");
    expect((db.prepare("SELECT COUNT(*) c FROM sales").get() as Row).c).toBe(0);

    next = { listings: [listing()], complete: true };
    await runSource(db, "t1", day(35));
    expect(status()).toBe("active");
    expect(db.prepare("SELECT 1 FROM listing_events WHERE type='relisted'").get()).toBeTruthy();
  });

  it("marks sold only with a sale record and upgrades verification", async () => {
    next = { listings: [listing({ sourceStatus: "pending" })], complete: true };
    await runSource(db, "t1", day(0));
    expect(status()).toBe("pending");
    next = {
      listings: [listing({ sourceStatus: "sold" })],
      sales: [{ businessName: "Established Pizzeria in Hilliard", externalListingId: "A1", verification: "broker_reported", evidenceType: "broker_closed_deal", saleDate: "2026-01-20" }],
      complete: true,
    };
    await runSource(db, "t1", day(21));
    expect(status()).toBe("sold");
    next = {
      listings: [],
      sales: [{ businessName: "Established Pizzeria in Hilliard", externalListingId: "A1", verification: "confirmed", evidenceType: "public_record", evidenceUrl: "https://records.example/1", salePrice: "$430,000", saleDate: "2026-01-20" }],
      complete: false,
    };
    await runSource(db, "t2", day(40));
    const sale = db.prepare("SELECT * FROM sales").get() as Row;
    expect(sale.verification).toBe("confirmed");
    expect(sale.sale_price).toBe(430_000);
    expect((db.prepare("SELECT COUNT(*) c FROM sales").get() as Row).c).toBe(1);
  });

  it("ranks industries by sales and sell-through", async () => {
    next = {
      listings: [listing(), listing({ externalId: "A2", title: "Busy Pizzeria in Dublin", city: "Dublin" }), listing({ externalId: "A3", title: "HVAC Contractor in Dublin", industry: "HVAC", city: "Dublin" })],
      complete: true,
    };
    await runSource(db, "t1", day(0));
    next = {
      listings: [],
      sales: [{ businessName: "Established Pizzeria in Hilliard", externalListingId: "A1", verification: "confirmed", evidenceType: "public_record", evidenceUrl: "https://r/1", salePrice: 450_000, saleDate: "2026-02-01" }],
      complete: true,
    };
    await runSource(db, "t1", day(30));
    await runSource(db, "t1", day(37)); // second miss: the other two go off market
    const r = salesReport(db, day(40), 2026);
    const food = r.industries.find((i) => i.name === "Restaurants & Food")!;
    expect(food).toMatchObject({ sales: 1, confirmed: 1, offMarket: 1, sellThroughPct: 50, medianSalePrice: 450_000 });
    expect(r.industries[0].name).toBe("Restaurants & Food"); // most sold first
    expect(r.industries.find((i) => i.name === "Home & Trade Services")).toMatchObject({ sales: 0, offMarket: 1, sellThroughPct: 0 });
  });

  it("compares years like for like", async () => {
    const at = (iso: string) => new Date(iso + "T12:00:00Z");
    next = { listings: [listing(), listing({ externalId: "A2", title: "Busy Pizzeria in Dublin", city: "Dublin" })], complete: true };
    await runSource(db, "t1", at("2025-01-06"));
    next = {
      listings: [listing({ externalId: "A2", title: "Busy Pizzeria in Dublin", city: "Dublin" })],
      sales: [
        { businessName: "Established Pizzeria in Hilliard", externalListingId: "A1", verification: "confirmed", evidenceType: "news", evidenceUrl: "https://n/1", salePrice: 400_000, saleDate: "2025-03-01" },
        { businessName: "Other Diner", city: "Columbus", industry: "Restaurant", verification: "broker_reported", evidenceType: "broker_closed_deal", saleDate: "2025-12-01" },
        { businessName: "Third Cafe", city: "Columbus", industry: "Cafe", verification: "confirmed", evidenceType: "news", evidenceUrl: "https://n/3", salePrice: 300_000, saleDate: "2026-02-01" },
      ],
      complete: false,
    };
    await runSource(db, "t1", at("2026-02-15"));
    const r = yearComparison(db, at("2026-06-30"));
    expect(r.years.map((y) => y.year)).toEqual([2025, 2026]);
    const [y25, y26] = r.years;
    expect(y25).toMatchObject({ sales: 2, confirmed: 1, brokerReported: 1, medianSalePrice: 400_000 });
    expect(y25.samePeriod.sales).toBe(1); // Dec 1 sale falls outside Jan 1 – Jun 30
    expect(y26).toMatchObject({ partial: true, sales: 1 });
    expect(r.industries[0]).toMatchObject({ name: "Restaurants & Food", total: 3 });
  });

  it("skips listings outside the Columbus region", async () => {
    next = { listings: [listing({ city: "Cleveland", county: "Cuyahoga" })], complete: true };
    const r = await runSource(db, "t1", day(0));
    expect(r.skippedOutOfRegion).toBe(1);
    expect((db.prepare("SELECT COUNT(*) c FROM listings").get() as Row).c).toBe(0);
  });

  it("notifies matching saved searches and favorites", async () => {
    db.prepare("INSERT INTO users (id, created_at) VALUES ('u1', 'x')").run();
    db.prepare("INSERT INTO alerts (user_id, name, filters_json, created_at) VALUES ('u1', 'Food', ?, 'x')").run(JSON.stringify({ industry: "Restaurants & Food", maxPrice: 600000 }));
    next = { listings: [listing()], complete: true };
    await runSource(db, "t1", day(0));
    db.prepare("INSERT INTO favorites (user_id, listing_id, created_at) VALUES ('u1', 1, 'x')").run();
    next = { listings: [listing({ askingPrice: 400_000 })], complete: true };
    await runSource(db, "t1", day(7));
    const kinds = (db.prepare("SELECT kind FROM notifications ORDER BY id").all() as Row[]).map((r) => r.kind);
    expect(kinds).toEqual(["new_listing", "price_drop", "favorite_update"]);
  });
});
