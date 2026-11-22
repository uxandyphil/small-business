import { Link } from "react-router-dom";
import { Empty, ListingCard, Loading, Section } from "../components/ui";
import { api, date, STATIC_MODE, useApi, type Listing } from "../lib";

interface AlertRow {
  id: number;
  name: string;
  filters: Record<string, string>;
  notify_new: number;
  notify_price_drop: number;
  notify_status: number;
  email: string | null;
  created_at: string;
  matchCount: number;
}
interface Notification {
  id: number;
  listing_id: number | null;
  kind: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

const KIND_ICON: Record<string, string> = { new_listing: "＋", price_drop: "↓", status_change: "●", favorite_update: "♥" };

export default function Saved() {
  const favs = useApi<{ items: Listing[] }>("/api/favorites");
  const alerts = useApi<{ items: AlertRow[] }>("/api/alerts");
  const notes = useApi<{ items: Notification[]; unread: number }>("/api/notifications");

  const removeAlert = async (id: number) => {
    await api(`/api/alerts/${id}`, { method: "DELETE" });
    alerts.reload();
  };
  const markRead = async () => {
    await api("/api/notifications/read", { method: "POST" });
    notes.reload();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{STATIC_MODE ? "Saved businesses" : "Saved & alerts"}</h1>
        <p className="text-sm text-ink-2">
          {STATIC_MODE
            ? "Saved in this browser. This read-only version can't send alerts; run the full server version for saved-search alerts and email."
            : "Saved on this device. Alerts are checked every time new data is ingested."}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Section className={STATIC_MODE ? "xl:col-span-2" : ""} title={`Saved businesses${favs.data ? ` (${favs.data.items.length})` : ""}`} subtitle={STATIC_MODE ? "Stored in this browser only." : "You'll get an update when a saved listing changes price or status."}>
          {!favs.data ? (
            <Loading />
          ) : favs.data.items.length === 0 ? (
            <Empty>
              Tap ♡ on any listing to save it. <Link to="/browse" className="font-semibold text-brand">Browse businesses →</Link>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {favs.data.items.map((l) => (
                <ListingCard key={l.id} l={l} favorite />
              ))}
            </div>
          )}
        </Section>

        <div className={`space-y-5 ${STATIC_MODE ? "hidden" : ""}`}>
          <Section
            title="Notifications"
            action={
              notes.data?.unread ? (
                <button className="text-sm font-semibold text-brand" onClick={markRead}>
                  Mark all read
                </button>
              ) : undefined
            }
          >
            {!notes.data ? (
              <Loading />
            ) : notes.data.items.length === 0 ? (
              <Empty>No notifications yet. They'll appear after the next data refresh that matches your alerts or saved listings.</Empty>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {notes.data.items.map((n) => (
                  <li key={n.id} className={`flex gap-3 rounded-lg p-2 text-sm ${n.read_at ? "" : "bg-brand-soft"}`}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold" aria-hidden>
                      {KIND_ICON[n.kind] ?? "•"}
                    </span>
                    <div className="min-w-0">
                      {n.listing_id ? (
                        <Link to={`/listing/${n.listing_id}`} className="text-ink hover:text-brand">
                          {n.message}
                        </Link>
                      ) : (
                        n.message
                      )}
                      <div className="text-xs text-muted">{date(n.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Search alerts" subtitle="Create one from the Browse page with “Alert me”.">
            {!alerts.data ? (
              <Loading />
            ) : alerts.data.items.length === 0 ? (
              <Empty>
                No alerts yet. <Link to="/browse" className="font-semibold text-brand">Set filters and click “Alert me” →</Link>
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.data.items.map((a) => {
                  const qs = new URLSearchParams(a.filters).toString();
                  const types = [a.notify_new && "new", a.notify_price_drop && "price cuts", a.notify_status && "status"].filter(Boolean).join(", ");
                  return (
                    <li key={a.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={`/browse?${qs}`} className="font-semibold text-brand">
                            {a.name}
                          </Link>
                          <div className="mt-0.5 break-words text-xs text-ink-2">{Object.entries(a.filters).map(([k, v]) => `${k}: ${v}`).join(" · ") || "All active listings"}</div>
                          <div className="mt-1 text-xs text-muted">
                            {a.matchCount} current matches · notifies on {types}
                            {a.email ? ` · emails ${a.email}` : ""}
                          </div>
                        </div>
                        <button className="text-xs font-semibold text-bad" onClick={() => removeAlert(a.id)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
