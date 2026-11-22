# Columbus Business Tracker

An investment dashboard that tracks businesses for sale, and businesses sold, in Columbus, Ohio and the surrounding counties (within 60 miles of downtown). It puts verified information first. Every figure links back to its source. A business counts as **sold** only when a sale record exists. A listing that just disappears is tracked as **off market, outcome unknown**.

> The repo ships with a **synthetic demo dataset** (fictional businesses, brokers and sales) so the whole pipeline can be exercised without collecting anyone's data. The UI shows a banner while demo data is present.

## Quick start

```bash
npm install
npm run seed      # builds data/tracker.db by replaying 46 weekly demo crawls (Jan–Nov 2026)
npm run dev       # API on :8787, web on http://localhost:5173
```

Production: `npm run build && npm start` (Express serves the built SPA on `PORT`, default 8787).
Tests: `npm test`. Type-check: `npm run typecheck`. Requires Node ≥ 22.13 (uses the built-in `node:sqlite`).

## Read-only version on GitHub Pages

`npm run build:static` produces a fully static site in `web/dist/` that needs no server. It ships a snapshot of the database (personal data such as favorites, alerts and emails is stripped), and the browser runs the same query code on it using SQLite compiled to WebAssembly. Dashboard, browse, filters, map, charts, listing pages, the financing calculator, sold reports and methodology all work. Favorites are kept in the visitor's browser. Alerts, notifications and data collection need the server version.

To publish:
1. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge this code into `main`. `.github/workflows/pages.yml` builds and deploys on every push to `main`. You can also run it from the **Actions** tab with **Run workflow**.
3. The site appears at `https://<your-username>.github.io/<repo-name>/` (shown on the Pages settings page and in the workflow run).

Notes: a Pages site is public even if the repo is private, and Pages on private repos requires a paid GitHub plan. The workflow currently builds the synthetic demo data. Once real sources are connected, replace the `npm run seed` step with your ingest step. The snapshot only changes when the workflow runs.

Map tiles come from OpenStreetMap and need no key. OSM's tile policy only covers light use, so for a busy site set `VITE_TILE_URL` (and `VITE_TILE_ATTRIBUTION`) at build time to a provider you have an account with, e.g. MapTiler or Stadia Maps.

To preview the static build locally: `npm run build:static && npx vite preview --outDir web/dist` (from the repo root), then open the URL it prints.

## Features

| Area | What it does |
|---|---|
| **Dashboard** | KPIs (active, new, median ask, cash flow, multiple, estimated ROI, price cuts), 2026 exits split into verified / broker-reported / disappeared, a market map, weekly listing flow, price vs. cash-flow scatter with 2x/3x/4x guides, multiples by industry, county table |
| **Browse** | Zillow-style list + map split. Filter by status, price, cash flow, revenue, est. ROI, owner income, multiple, DSCR, industry, county/city, years in business, employees, franchise, real estate, new or price-reduced. Sort by ROI, owner income, multiple, DSCR and more. Financing assumptions are editable and recompute every listing |
| **Listing detail** | Interactive acquisition calculator (offer price, down payment, seller note, SBA rate/term, capex, manager, working capital), price-history chart, full change timeline, data provenance across sources, sale evidence, industry comparables and sold comps |
| **Sold in 2026** | Sale records with verification level, evidence type and link, sale-to-ask, days on market, and a separate tab for listings that disappeared without a verified sale |
| **Saved & alerts** | Favorites and saved-search alerts (new listings, price drops, status changes), an in-app notification feed, and optional email over SMTP |
| **Data & methodology** | Every source with its access method, compliance note, live/total counts and last run; status rules; the finance formulas; ingestion run log |

## Architecture

```
server/  Express + node:sqlite (TypeScript via tsx)
  src/sources/       adapters: csv, json_feed, licensed_feed, broker_html, demo
  src/sources/compliance.ts   robots.txt, per-host rate limit, restricted-host block
  src/ingest.ts      normalize → region filter → dedupe → diff/events → price history → disappearance → sales
  src/finance.ts     acquisition model (shared with the web calculator)
  src/alerts.ts      events → notifications (+ optional email)
  src/query.ts       filters/sort, src/stats.ts dashboard aggregates, src/app.ts REST API
web/     React 19 + Vite + Tailwind v4 + Recharts + Leaflet
data/    SQLite DB (git-ignored) and CSV import templates
```

### Data model highlights
- `listings` holds one row per real business. `listing_sources` holds each site's copy (syndicated listings are merged by fingerprint: industry + city + price band + title keywords).
- `listing_events` is an append-only log: listed, price_change, financials_change, status_change, disappeared, relisted.
- `price_history` holds one observation per listing per crawl day.
- `sales` records `verification` (`confirmed` | `broker_reported`), `evidence_type`, and `evidence_url`.

### Status rules
- **For sale**: present on at least one source.
- **Under contract**: a source says pending, LOI, or contingent. It reverts if the listing comes back as active.
- **Sold, verified**: independent evidence (public record, press release, news, or party confirmation) plus a URL. A broker's "Sold" notice is never enough for *confirmed*.
- **Sold, broker-reported**: the broker marked it sold. It is upgraded automatically when independent evidence arrives.
- **Off market**: missing from *every* source for `MISSES_BEFORE_OFF_MARKET` (default 2) consecutive **complete** crawls. Partial or failed crawls never count as a miss.

### Owner income and ROI
```
Owner income = SDE − capex reserve − manager salary − (SBA payment + seller-note payment)
Est. ROI     = (Owner income − your market salary) ÷ (down payment + closing costs + working capital)
DSCR         = (SDE − capex − manager) ÷ debt service
```
Defaults: 10% down, 10% seller note (7%, 5 yr), SBA 7(a) for the rest (10.5%, 10 yr), 3% closing, 5% capex reserve, $75k market salary. If SDE is missing, EBITDA is used as a conservative proxy and the listing is flagged.

## Connecting real data (compliantly)

**BizBuySell / BizQuest.** Their terms of use restrict automated scraping, so the crawler **refuses those hosts** (`RESTRICTED_HOSTS` in `compliance.ts`). To include their listings, get a data license or partner feed and set `BIZBUYSELL_FEED_URL` / `BIZBUYSELL_API_KEY` (or the BizQuest equivalents). Then:
```bash
npm run sources -- enable bizbuysell
npm run ingest -- bizbuysell
```
Adjust `itemsPath` / `fieldMap` in `server/src/sources/registry.ts` to match the feed.

**Independent broker sites.** Copy the `broker-example` source in `registry.ts`, set `startUrls` and CSS `selectors`, and enable it. Use this only where robots.txt and the site's terms allow crawling (written permission from the broker is best). The crawler honors robots.txt and Crawl-delay, waits at least 5s between requests, stops on HTTP 429, and marks the run partial if anything fails.

**Broker JSON feeds.** Use the `json_feed` adapter with `url` or `path`, plus `itemsPath` and an optional `salesItemsPath`.

**Manual / licensed CSVs.** Put files in `data/imports/` (see the `*.example.csv` templates), enable `manual-import` and/or `public-records`, then run `npm run ingest`. Column names are matched flexibly ("asking_price", "price", "cash flow", "SDE", …), and money strings like `$1.2M` or `450K` are parsed.

**Verified sales.** Curate `data/imports/verified_sales.csv` from county records (bulk-sale notices, UCC filings, Ohio liquor-permit transfers), press releases, and local business news. Rows without an `evidence_url`, or whose evidence is only a broker notice, are stored as broker-reported.

List sources with `npm run sources -- sources`. To turn off demo data, run `npm run sources -- disable demo-marketplace` (and `demo-broker`, `demo-records`) and delete `data/tracker.db`.

Scheduled ingestion: set `INGEST_EVERY_HOURS` (runs enabled non-demo sources from the API process), or run `npm run ingest` from cron.

## Users, favorites and alerts
For now, identity is an anonymous per-browser ID (`X-User-Id`, kept in localStorage). Before running this as a multi-user public service, add real authentication (e.g. magic-link email) and map it to the `users` table. Email alerts are sent when `SMTP_URL` is set; see `.env.example`.

## Disclaimer
Financials are as reported by sellers or brokers and are not audited. Estimates are pre-tax and are not investment advice.
