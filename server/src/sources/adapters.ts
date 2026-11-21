import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { politeFetch, ComplianceError } from "./compliance.js";
import { mapRow, mapSaleRow, parseCsv } from "./mapped.js";
import type { FetchResult, RawListing, SourceAdapter, SourceContext } from "./types.js";
import { demoAdapter } from "./demo.js";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * CSV import: for manual exports, broker-provided spreadsheets, or files you
 * are licensed to use. Config: { listingsPath, salesPath?, fieldMap?, complete? }
 */
const csvAdapter: SourceAdapter = {
  id: "csv",
  async fetch(ctx) {
    const listingsPath = str(ctx.config.listingsPath);
    const salesPath = str(ctx.config.salesPath);
    const fieldMap = (ctx.config.fieldMap ?? {}) as Record<string, string[]>;
    const listings = listingsPath
      ? parseCsv(await readFile(listingsPath, "utf8")).map((r) => mapRow(r, fieldMap)).filter(Boolean) as RawListing[]
      : [];
    const sales = salesPath ? parseCsv(await readFile(salesPath, "utf8")).map(mapSaleRow).filter((s) => s !== null) : [];
    // A CSV is a full snapshot only if the operator says so.
    return { listings, sales, complete: ctx.config.complete === true };
  },
};

/**
 * JSON feed from a broker or partner who provides one.
 * Config: { url | path, itemsPath?: "data.listings", salesPath?, fieldMap?, headers? }
 */
async function loadJson(ctx: SourceContext, urlKey = "url", pathKey = "path"): Promise<unknown> {
  const url = str(ctx.config[urlKey]);
  const path = str(ctx.config[pathKey]);
  if (path) return JSON.parse(await readFile(path, "utf8"));
  if (!url) throw new Error("json_feed requires config.url or config.path");
  const text = await politeFetch(url, {
    accept: "application/json",
    permittedHosts: (ctx.config.permittedHosts as string[]) ?? [],
    minIntervalMs: Number(ctx.config.minIntervalMs ?? 3000),
  });
  return JSON.parse(text);
}

function dig(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const jsonFeedAdapter: SourceAdapter = {
  id: "json_feed",
  async fetch(ctx) {
    const body = await loadJson(ctx);
    const items = dig(body, str(ctx.config.itemsPath));
    if (!Array.isArray(items)) throw new Error("Feed did not contain a listings array at itemsPath");
    const fieldMap = (ctx.config.fieldMap ?? {}) as Record<string, string[]>;
    const listings = items.map((r) => mapRow(r as Record<string, unknown>, fieldMap)).filter(Boolean) as RawListing[];
    const salesRaw = dig(body, str(ctx.config.salesItemsPath));
    const sales = Array.isArray(salesRaw) ? salesRaw.map((r) => mapSaleRow(r as Record<string, unknown>)).filter((s) => s !== null) : [];
    return { listings, sales, complete: ctx.config.complete !== false };
  },
};

/**
 * Licensed marketplace feed (BizBuySell, BizQuest, etc.). These marketplaces do
 * not permit scraping; this adapter only runs when an operator has a data
 * license / partner feed and supplies its endpoint + key via env vars.
 * Config: { urlEnv: "BIZBUYSELL_FEED_URL", keyEnv: "BIZBUYSELL_API_KEY", itemsPath, fieldMap }
 */
const licensedFeedAdapter: SourceAdapter = {
  id: "licensed_feed",
  async fetch(ctx) {
    const url = process.env[String(ctx.config.urlEnv ?? "")];
    const key = process.env[String(ctx.config.keyEnv ?? "")];
    if (!url || !key) {
      throw new ComplianceError(
        `No licensed feed configured (set ${ctx.config.urlEnv} and ${ctx.config.keyEnv}). ` +
          "This marketplace's terms prohibit scraping; request a data license or partner feed.",
      );
    }
    const host = new URL(url).hostname;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Licensed feed returned HTTP ${res.status} (${host})`);
    const body = await res.json();
    const items = dig(body, str(ctx.config.itemsPath));
    if (!Array.isArray(items)) throw new Error("Licensed feed did not contain a listings array");
    const fieldMap = (ctx.config.fieldMap ?? {}) as Record<string, string[]>;
    return {
      listings: items.map((r) => mapRow(r as Record<string, unknown>, fieldMap)).filter(Boolean) as RawListing[],
      complete: true,
    };
  },
};

/**
 * Configurable HTML crawler for independent broker websites that allow it
 * (robots.txt + terms). Never used for restricted marketplaces — politeFetch
 * refuses those hosts.
 *
 * Config: {
 *   startUrls: string[], maxPages?: number, nextSelector?: string,
 *   selectors: { item, title, link, price?, cashFlow?, revenue?, location?, industry?, status?, id? },
 *   brokerName?: string
 * }
 */
const brokerHtmlAdapter: SourceAdapter = {
  id: "broker_html",
  async fetch(ctx) {
    const sel = ctx.config.selectors as Record<string, string> | undefined;
    const startUrls = (ctx.config.startUrls as string[]) ?? [];
    if (!sel?.item || !sel.title || startUrls.length === 0) throw new Error("broker_html requires startUrls and selectors.item/title");
    const maxPages = Number(ctx.config.maxPages ?? 10);
    const listings: RawListing[] = [];
    const notes: string[] = [];
    let complete = true;
    for (const start of startUrls) {
      let url: string | null = start;
      let pages = 0;
      while (url && pages < maxPages) {
        let html: string;
        try {
          html = await politeFetch(url, { minIntervalMs: Number(ctx.config.minIntervalMs ?? 5000) });
        } catch (e) {
          complete = false; // never infer disappearance from a partial crawl
          notes.push(`Stopped at ${url}: ${(e as Error).message}`);
          break;
        }
        const $ = cheerio.load(html);
        $(sel.item).each((_, el) => {
          const $el = $(el);
          const text = (s?: string) => (s ? $el.find(s).first().text().trim() || null : null);
          const href = sel.link ? $el.find(sel.link).first().attr("href") : undefined;
          const abs = href ? new URL(href, url!).toString() : null;
          const title = text(sel.title);
          const id = (sel.id ? $el.find(sel.id).first().text().trim() || $el.attr(sel.id) : null) ?? abs;
          if (!title || !id) return;
          const loc = text(sel.location) ?? "";
          const [city, state] = loc.split(",").map((s) => s.trim());
          const status = (text(sel.status) ?? "").toLowerCase();
          listings.push({
            externalId: id,
            url: abs,
            title,
            industry: text(sel.industry),
            city: city || null,
            state: state?.slice(0, 2) || "OH",
            askingPrice: text(sel.price),
            cashFlow: text(sel.cashFlow),
            revenue: text(sel.revenue),
            brokerName: str(ctx.config.brokerName) ?? null,
            sourceStatus: /sold|closed/.test(status) ? "sold" : /pending|contract/.test(status) ? "pending" : "active",
          });
        });
        pages++;
        const next: string | undefined = ctx.config.nextSelector ? $(String(ctx.config.nextSelector)).attr("href") : undefined;
        url = next ? new URL(next, url).toString() : null;
        if (url && pages >= maxPages) {
          complete = false;
          notes.push(`maxPages (${maxPages}) reached; crawl treated as partial.`);
        }
      }
    }
    return { listings, complete, notes };
  },
};

export const ADAPTERS: Record<string, SourceAdapter> = {
  csv: csvAdapter,
  json_feed: jsonFeedAdapter,
  licensed_feed: licensedFeedAdapter,
  broker_html: brokerHtmlAdapter,
  demo: demoAdapter,
};

export type { FetchResult };
