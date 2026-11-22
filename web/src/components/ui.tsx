import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, BASIS_LABEL, daysAgo, money, mult, pct, STATUS_LABEL, type Listing } from "../lib";

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "good" | "warn" | "bad" | "brand"; children: ReactNode; title?: string }) {
  const cls = {
    neutral: "bg-surface-2 text-ink-2",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    brand: "bg-brand-soft text-brand",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: Listing["status"] }) {
  const tone = status === "active" ? "brand" : status === "pending" ? "warn" : status === "sold" ? "good" : "neutral";
  const icon = status === "active" ? "●" : status === "pending" ? "◐" : status === "sold" ? "✓" : "○";
  return (
    <Badge tone={tone} title={status === "off_market" ? "Removed from all sources with no verified sale. Outcome unknown." : undefined}>
      <span aria-hidden>{icon}</span> {STATUS_LABEL[status]}
    </Badge>
  );
}

export function VerificationBadge({ v }: { v: "confirmed" | "broker_reported" }) {
  return v === "confirmed" ? (
    <Badge tone="good" title="Independently evidenced: public record, press release, news, or party confirmation.">
      <span aria-hidden>✓</span> Verified sale
    </Badge>
  ) : (
    <Badge tone="warn" title="Reported sold by the listing broker; not independently confirmed.">
      <span aria-hidden>!</span> Broker-reported
    </Badge>
  );
}

export function BasisBadge({ basis }: { basis: Listing["financials_basis"] }) {
  return (
    <Badge tone={basis === "seller_reported" ? "neutral" : "brand"} title="Who stands behind the financial figures">
      {BASIS_LABEL[basis]} financials
    </Badge>
  );
}

export function Kpi({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="card p-4" title={hint}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="tnum mt-1 text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export function Section({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FavoriteButton({ id, initial, onChange, compact }: { id: number; initial: boolean; onChange?: (v: boolean) => void; compact?: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api(`/api/favorites/${id}`, { method: on ? "DELETE" : "PUT" });
      setOn(!on);
      onChange?.(!on);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? "Remove from saved" : "Save listing"}
      className={compact ? "rounded-full p-1.5 text-lg leading-none hover:bg-surface-2" : "btn"}
      style={{ color: on ? "var(--bad)" : undefined }}
    >
      <span aria-hidden>{on ? "♥" : "♡"}</span>
      {!compact && (on ? "Saved" : "Save")}
    </button>
  );
}

const INDUSTRY_GLYPH: Record<string, string> = {
  "Restaurants & Food": "🍽",
  Retail: "🛍",
  "Home & Trade Services": "🔧",
  "Business Services": "💼",
  Automotive: "🚗",
  "Health & Medical": "⚕",
  "Beauty & Personal Care": "✂",
  Manufacturing: "🏭",
  Construction: "🏗",
  "Transportation & Logistics": "🚚",
  "Wholesale & Distribution": "📦",
  "Technology & IT": "💻",
  "Education & Childcare": "🎓",
  "Hospitality & Entertainment": "🎟",
  "Fitness & Recreation": "🏋",
  "Online & E-commerce": "🛒",
  Agriculture: "🌾",
};
export const glyph = (industry: string) => INDUSTRY_GLYPH[industry] ?? "🏢";

export function ListingCard({ l, favorite = false, highlight }: { l: Listing; favorite?: boolean; highlight?: boolean }) {
  const f = l.finance;
  const isNew = daysAgo(l.first_seen_at) <= 14 && (l.status === "active" || l.status === "pending");
  return (
    <Link
      to={`/listing/${l.id}`}
      className={`card group block p-4 transition hover:shadow-md ${highlight ? "ring-2 ring-[var(--brand)]" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xl" aria-hidden>
          {glyph(l.industry)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={l.status} />
            {isNew && <Badge tone="brand">New</Badge>}
            {l.price_reduced && <Badge tone="bad">↓ Price cut</Badge>}
            {l.is_franchise && <Badge>Franchise</Badge>}
          </div>
          <h3 className="mt-1.5 line-clamp-2 font-semibold text-ink group-hover:text-brand">{l.title}</h3>
          <p className="text-xs text-muted">
            {l.industry} · {l.city ?? l.county ?? "Location n/a"}
            {l.county ? `, ${l.county} Co.` : ""}
          </p>
        </div>
        <FavoriteButton id={l.id} initial={favorite} compact />
      </div>
      <dl className="tnum mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Asking</dt>
          <dd className="font-bold">{money(l.asking_price, { compact: true })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Cash flow</dt>
          <dd className="font-bold">{money(l.cash_flow_sde ?? l.ebitda, { compact: true })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Revenue</dt>
          <dd className="font-bold">{money(l.revenue, { compact: true })}</dd>
        </div>
      </dl>
      <div className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
        <span title="Pre-tax take-home after debt service and capex reserve (default financing)">
          Owner income <b className={f.ownerIncome != null && f.ownerIncome < 0 ? "text-bad" : "text-ink"}>{money(f.ownerIncome, { compact: true })}</b>
        </span>
        <span title="Return on cash invested, after paying yourself a market salary">
          Est. ROI <b className="text-ink">{pct(f.cashOnCashPct)}</b>
        </span>
        <span>
          Multiple <b className="text-ink">{mult(f.multiple)}</b>
        </span>
        {f.dscr != null && (
          <span className={f.dscr < 1.25 ? "text-bad" : ""}>
            DSCR <b>{f.dscr.toFixed(2)}</b>
          </span>
        )}
      </div>
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-ink-2">{children}</div>;
}

export function Loading() {
  return <div className="p-8 text-center text-sm text-muted">Loading…</div>;
}
