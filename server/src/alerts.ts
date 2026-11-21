// Turns listing events into user notifications (saved-search alerts + favorites)
// and optionally emails them when SMTP_URL is configured.
import type { DB, Row } from "./db.js";
import { DEFAULT_ASSUMPTIONS } from "./finance.js";
import { enrich, FiltersSchema, matches } from "./query.js";

const fmt = (v: unknown) => (v == null || v === "" ? "n/a" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);

export async function processAlerts(db: DB, sinceEventId: number, asOf: Date): Promise<number> {
  const events = db
    .prepare(
      `SELECT e.* FROM listing_events e WHERE e.id > ?
         AND (e.type = 'listed' OR (e.type = 'price_change') OR e.type = 'status_change')
       ORDER BY e.id`,
    )
    .all(sinceEventId) as Row[];
  if (events.length === 0) return 0;
  const alerts = db.prepare("SELECT * FROM alerts").all() as Row[];
  const favs = db.prepare("SELECT user_id, listing_id FROM favorites").all() as Row[];
  if (alerts.length === 0 && favs.length === 0) return 0;

  const listingIds = [...new Set(events.map((e) => Number(e.listing_id)))];
  const rows = db.prepare(`SELECT * FROM listings WHERE id IN (${listingIds.map(() => "?").join(",")})`).all(...listingIds) as Row[];
  const views = new Map(enrich(db, rows, DEFAULT_ASSUMPTIONS, asOf).map((v) => [v.id, v]));
  const insert = db.prepare(
    "INSERT OR IGNORE INTO notifications (user_id, alert_id, listing_id, event_id, kind, message, created_at) VALUES (?,?,?,?,?,?,?)",
  );
  let created = 0;
  const now = asOf.toISOString();

  for (const e of events) {
    const l = views.get(Number(e.listing_id));
    if (!l) continue;
    const isDrop = e.type === "price_change" && Number(e.new_value) < Number(e.old_value);
    const kind = e.type === "listed" ? "new_listing" : isDrop ? "price_drop" : e.type === "status_change" ? "status_change" : null;
    const message =
      kind === "new_listing"
        ? `New listing: ${l.title} — ${fmt(l.asking_price)} asking, ${fmt(l.cash_flow_sde)} cash flow`
        : kind === "price_drop"
          ? `Price reduced: ${l.title} ${fmt(e.old_value)} → ${fmt(e.new_value)}`
          : e.type === "price_change"
            ? `Price increased: ${l.title} ${fmt(e.old_value)} → ${fmt(e.new_value)}`
            : `Status change: ${l.title} is now ${String(e.new_value).replace("_", " ")}${e.new_value === "off_market" ? " (no sale verified)" : ""}`;

    for (const a of alerts) {
      if (!kind) continue;
      if (kind === "new_listing" && !a.notify_new) continue;
      if (kind === "price_drop" && !a.notify_price_drop) continue;
      if (kind === "status_change" && !a.notify_status) continue;
      const f = FiltersSchema.parse(JSON.parse(String(a.filters_json)));
      // Status changes should reach watchers even when the new status (sold/off-market) is outside the saved search.
      const f2 = kind === "status_change" ? { ...f, status: ["active", "pending", "sold", "off_market"] } : f;
      if (!matches(l, f2, asOf)) continue;
      created += Number(insert.run(String(a.user_id), Number(a.id), l.id, Number(e.id), kind, `[${a.name}] ${message}`, now).changes);
    }
    for (const fav of favs) {
      if (Number(fav.listing_id) !== l.id || e.type === "listed") continue;
      created += Number(insert.run(String(fav.user_id), null, l.id, Number(e.id), "favorite_update", `★ ${message}`, now).changes);
    }
  }
  await sendPendingEmails(db);
  return created;
}

export async function sendPendingEmails(db: DB): Promise<number> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) return 0;
  const pending = db
    .prepare(
      `SELECT n.id, n.message, n.listing_id, COALESCE(a.email, u.email) AS email
       FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN alerts a ON a.id = n.alert_id
       WHERE n.emailed_at IS NULL AND COALESCE(a.email, u.email) IS NOT NULL`,
    )
    .all() as Row[];
  if (pending.length === 0) return 0;
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(smtp);
  const byEmail = new Map<string, Row[]>();
  for (const p of pending) byEmail.set(String(p.email), [...(byEmail.get(String(p.email)) ?? []), p]);
  const base = process.env.PUBLIC_URL ?? "http://localhost:5173";
  for (const [to, items] of byEmail) {
    await transport.sendMail({
      from: process.env.ALERT_FROM ?? "alerts@localhost",
      to,
      subject: `${items.length} update${items.length > 1 ? "s" : ""} on Columbus businesses for sale`,
      text: items.map((i) => `• ${i.message}\n  ${base}/listing/${i.listing_id}`).join("\n\n"),
    });
    const mark = db.prepare("UPDATE notifications SET emailed_at=? WHERE id=?");
    for (const i of items) mark.run(new Date().toISOString(), Number(i.id));
  }
  return pending.length;
}
