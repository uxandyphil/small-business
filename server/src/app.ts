import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import type { DB, Row } from "./db.js";
import { DEFAULT_ASSUMPTIONS } from "./finance.js";
import { getListingDetail, getMeta, getSales, getSources, getStats, getYearComparison, listByIds, listListings } from "./handlers.js";
import { FiltersSchema, searchListings } from "./query.js";

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

  app.get("/api/meta", (_req, res) => res.json(getMeta(db)));
  app.get("/api/listings", (req, res) => res.json(listListings(db, req.query, now())));
  app.get("/api/listings/:id", (req, res) => {
    const favorite = req.userId ? Boolean(db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?").get(req.userId, Number(req.params.id))) : false;
    const detail = getListingDetail(db, req.params.id, req.query, now(), favorite);
    if (!detail) return res.status(404).json({ error: "Not found" });
    res.json(detail);
  });
  app.get("/api/stats", (req, res) => res.json(getStats(db, req.query, now())));
  app.get("/api/sales/compare", (_req, res) => res.json(getYearComparison(db, now())));
  app.get("/api/sales", (req, res) => res.json(getSales(db, req.query, now())));
  app.get("/api/sources", (_req, res) => res.json(getSources(db)));

  // ---- Favorites
  app.get("/api/favorites", requireUser, (req, res) => {
    const ids = (db.prepare("SELECT listing_id FROM favorites WHERE user_id=? ORDER BY created_at DESC").all(req.userId!) as Row[]).map((r) => Number(r.listing_id));
    res.json(listByIds(db, ids, req.query, now()));
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
