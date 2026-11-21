import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import type { DB, Row } from "./db.js";
import { DEFAULT_ASSUMPTIONS } from "./finance.js";
import { COLUMBUS, REGION_RADIUS_MILES } from "./geo.js";
import { INDUSTRIES } from "./normalize.js";
import { enrich, FiltersSchema, parseAssumptions, searchListings } from "./query.js";
import { dashboardStats, mapPoint, median, salesReport } from "./stats.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

const UUIDish = /^[A-Za-z0-9-]{8,64}$/;

export function createApp(db: DB, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  // Anonymous device identity for favorites & alerts (no PII required).
  app.use("/api", (req, _res, next) => {
    const id = req.header("x-user-id");
    if (id && UUIDish.test(id)) {
      db.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").run(id, new Date().toISOString());
      req.userId = id;
    }
    next();
  });
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: "Missing X-User-Id header" });
    next();
  };

  app.get("/api/meta", (_req, res) => {
    const counties = db.prepare("SELECT county AS name, COUNT(*) c FROM listings WHERE status IN ('active','pending') AND county IS NOT NULL GROUP BY county ORDER BY c DESC").all();
    const cities = db.prepare("SELECT city AS name, county, COUNT(*) c FROM listings WHERE status IN ('active','pending') AND city IS NOT NULL GROUP BY city ORDER BY c DESC").all();
    const demo = db.prepare("SELECT COUNT(*) c FROM listing_sources ls JOIN sources s ON s.id=ls.source_id WHERE s.kind='demo'").get() as Row;
    const real = db.prepare("SELECT COUNT(*) c FROM listing_sources ls JOIN sources s ON s.id=ls.source_id WHERE s.kind!='demo'").get() as Row;
    const lastRun = db.prepare("SELECT MAX(as_of) t FROM ingest_runs WHERE status='ok'").get() as Row;
    res.json({
      industries: INDUSTRIES,
      counties,
      cities,
      region: { center: COLUMBUS, radiusMiles: REGION_RADIUS_MILES },
      demoMode: Number(demo.c) > 0,
      realListingCount: Number(real.c),
      lastUpdated: lastRun.t,
      defaultAssumptions: DEFAULT_ASSUMPTIONS,
    });
  });

  app.get("/api/listings", (req, res) => {
    const f = FiltersSchema.parse(req.query);
    const a = parseAssumptions(req.query);
    const { total, items, all } = searchListings(db, f, a, now());
    res.json({
      total,
      items,
      summary: {
        medianAsking: median(all.map((l) => l.asking_price as number)),
        medianCashFlow: median(all.map((l) => l.cash_flow_sde as number)),
        medianMultiple: median(all.map((l) => l.finance.multiple)),
        medianCashOnCash: median(all.map((l) => l.finance.cashOnCashPct)),
      },
      mapPoints: req.query.map === "1" ? all.map(mapPoint) : undefined,
    });
  });

  app.get("/api/listings/:id", (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const row = db.prepare("SELECT * FROM listings WHERE id=?").get(id) as Row | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    const a = parseAssumptions(req.query);
    const [l] = enrich(db, [row], a, now());
    const events = db
      .prepare("SELECT e.*, s.name AS source_name FROM listing_events e LEFT JOIN sources s ON s.id=e.source_id WHERE listing_id=? ORDER BY occurred_at, e.id")
      .all(id);
    const history = db.prepare("SELECT observed_at, asking_price, cash_flow_sde, revenue FROM price_history WHERE listing_id=? ORDER BY observed_at").all(id);
    const peersRows = db.prepare("SELECT * FROM listings WHERE industry=? AND id != ? AND status IN ('active','pending','sold')").all(String(row.industry), id) as Row[];
    const peers = enrich(db, peersRows, a, now());
    const activePeers = peers.filter((p) => p.status !== "sold");
    const soldComps = db
      .prepare("SELECT s.*, l.cash_flow_sde FROM sales s LEFT JOIN listings l ON l.id = s.listing_id WHERE s.industry=? AND s.sale_price IS NOT NULL AND (s.listing_id IS NULL OR s.listing_id != ?) ORDER BY s.sale_date DESC LIMIT 8")
      .all(String(row.industry), id) as Row[];
    const favorite = req.userId ? Boolean(db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?").get(req.userId, id)) : false;
    res.json({
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
    });
  });

  app.get("/api/stats", (req, res) => {
    const year = z.coerce.number().int().optional().parse(req.query.year);
    res.json(dashboardStats(db, now(), year));
  });

  app.get("/api/sales", (req, res) => {
    const year = z.coerce.number().int().default(now().getUTCFullYear()).parse(req.query.year);
    res.json(salesReport(db, now(), year));
  });

  app.get("/api/sources", (_req, res) => {
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
    res.json({ sources, runs });
  });

  // ---- Favorites
  app.get("/api/favorites", requireUser, (req, res) => {
    const rows = db.prepare("SELECT l.* FROM favorites f JOIN listings l ON l.id=f.listing_id WHERE f.user_id=? ORDER BY f.created_at DESC").all(req.userId!) as Row[];
    res.json({ items: enrich(db, rows, parseAssumptions(req.query), now()) });
  });
  app.put("/api/favorites/:id", requireUser, (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    if (!db.prepare("SELECT 1 FROM listings WHERE id=?").get(id)) return res.status(404).json({ error: "Not found" });
    db.prepare("INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?,?,?)").run(req.userId!, id, new Date().toISOString());
    res.json({ ok: true });
  });
  app.delete("/api/favorites/:id", requireUser, (req, res) => {
    db.prepare("DELETE FROM favorites WHERE user_id=? AND listing_id=?").run(req.userId!, z.coerce.number().int().parse(req.params.id));
    res.json({ ok: true });
  });

  // ---- Alerts (saved searches)
  const AlertBody = z.object({
    name: z.string().min(1).max(80),
    filters: z.record(z.unknown()),
    notifyNew: z.boolean().default(true),
    notifyPriceDrop: z.boolean().default(true),
    notifyStatus: z.boolean().default(true),
    email: z.string().email().max(200).optional().or(z.literal("")),
  });
  app.get("/api/alerts", requireUser, (req, res) => {
    const alerts = db.prepare("SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC").all(req.userId!) as Row[];
    const a = DEFAULT_ASSUMPTIONS;
    res.json({
      items: alerts.map((al) => {
        const filters = JSON.parse(String(al.filters_json));
        const { total } = searchListings(db, FiltersSchema.parse(filters), a, now());
        return { ...al, filters, matchCount: total };
      }),
    });
  });
  app.post("/api/alerts", requireUser, (req, res) => {
    const body = AlertBody.parse(req.body);
    FiltersSchema.parse(body.filters); // validate shape
    const r = db
      .prepare("INSERT INTO alerts (user_id, name, filters_json, notify_new, notify_price_drop, notify_status, email, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(req.userId!, body.name, JSON.stringify(body.filters), +body.notifyNew, +body.notifyPriceDrop, +body.notifyStatus, body.email || null, new Date().toISOString());
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.delete("/api/alerts/:id", requireUser, (req, res) => {
    db.prepare("DELETE FROM alerts WHERE id=? AND user_id=?").run(z.coerce.number().int().parse(req.params.id), req.userId!);
    res.json({ ok: true });
  });
  app.get("/api/notifications", requireUser, (req, res) => {
    const items = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100").all(req.userId!);
    const unread = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL").get(req.userId!) as Row;
    res.json({ items, unread: Number(unread.c) });
  });
  app.post("/api/notifications/read", requireUser, (req, res) => {
    db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(new Date().toISOString(), req.userId!);
    res.json({ ok: true });
  });

  // Serve the built SPA in production.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(webDist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "Invalid request", issues: err.issues });
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });
  return app;
}
