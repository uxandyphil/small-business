import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { analyzeDeal, DEFAULT_ASSUMPTIONS, type FinanceAssumptions } from "../../../server/src/finance";
import { PriceHistoryChart } from "../components/charts";
import { MapView } from "../components/MapView";
import { Badge, BasisBadge, FavoriteButton, glyph, ListingCard, Loading, NewBadge, Section, StatusBadge, VerificationBadge } from "../components/ui";
import { date, EVIDENCE_LABEL, money, mult, pct, STATUS_LABEL, useApi, type Listing, type Sale } from "../lib";

interface EventRow {
  id: number;
  occurred_at: string;
  type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  source_name: string | null;
}

interface Detail {
  listing: Listing;
  events: EventRow[];
  history: { observed_at: string; asking_price: number | null }[];
  favorite: boolean;
  comparables: {
    industry: string;
    activeCount: number;
    medianMultiple: number | null;
    medianCashOnCash: number | null;
    medianMarginPct: number | null;
    medianAsking: number | null;
    similar: Listing[];
    soldComps: (Sale & { multiple: number | null })[];
  };
}

const FIELD_LABEL: Record<string, string> = { asking_price: "Asking price", revenue: "Revenue", cash_flow_sde: "Cash flow", ebitda: "EBITDA" };

function eventText(e: EventRow): { icon: string; text: string } {
  switch (e.type) {
    case "listed":
      return { icon: "＋", text: `First listed${e.new_value ? ` at ${money(Number(e.new_value))}` : ""}` };
    case "price_change": {
      const down = Number(e.new_value) < Number(e.old_value);
      const d = ((Number(e.new_value) - Number(e.old_value)) / Number(e.old_value)) * 100;
      return { icon: down ? "↓" : "↑", text: `Price ${down ? "reduced" : "increased"} ${money(Number(e.old_value))} → ${money(Number(e.new_value))} (${d.toFixed(1)}%)` };
    }
    case "financials_change":
      return { icon: "≈", text: `${FIELD_LABEL[e.field ?? ""] ?? e.field} restated ${money(Number(e.old_value))} → ${money(Number(e.new_value))}` };
    case "status_change":
      return {
        icon: e.new_value === "sold" ? "✓" : "●",
        text: `Status: ${STATUS_LABEL[e.old_value as Listing["status"]] ?? e.old_value} → ${STATUS_LABEL[e.new_value as Listing["status"]] ?? e.new_value}`,
      };
    case "disappeared":
      return { icon: "○", text: "Removed from all tracked sources (no sale record)" };
    case "relisted":
      return { icon: "↺", text: "Reappeared on market" };
    default:
      return { icon: "•", text: e.type };
  }
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className="tnum font-bold text-ink">{fmt(value)}</span>
      </div>
      <input type="range" className="mt-1 w-full accent-[var(--brand)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Calculator({ l }: { l: Listing }) {
  const [a, setA] = useState<FinanceAssumptions>(DEFAULT_ASSUMPTIONS);
  const [price, setPrice] = useState<number>(l.asking_price ?? 0);
  const r = useMemo(() => analyzeDeal({ askingPrice: price || null, sde: l.cash_flow_sde, ebitda: l.ebitda, revenue: l.revenue }, a), [a, price, l]);
  const up = (k: keyof FinanceAssumptions) => (v: number) => setA({ ...a, [k]: v });
  const earnings = r.earnings ?? 0;
  const rows: [string, number | null, string?][] = [
    [r.basis === "ebitda" ? "EBITDA (proxy for cash flow)" : "Seller's discretionary earnings", r.earnings],
    ["− Capex / maintenance reserve", -r.capexReserve],
    ...(a.managerSalary ? ([["− Manager salary", -a.managerSalary]] as [string, number][]) : []),
    ["− SBA loan payments", -(r.annualDebtService - (r.sellerNote ? annualSellerPayment(r.sellerNote, a) : 0))],
    ["− Seller note payments", -(r.sellerNote ? annualSellerPayment(r.sellerNote, a) : 0)],
  ];
  return (
    <Section title="Acquisition & owner income estimator" subtitle="Adjust deal terms. All figures pre-tax and based on reported financials.">
      {!l.asking_price || !(l.cash_flow_sde || l.ebitda) ? (
        <p className="text-sm text-ink-2">This listing does not disclose {l.asking_price ? "earnings" : "an asking price"}, so owner income cannot be estimated.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <Slider label="Offer price" value={price} min={Math.round(l.asking_price * 0.6)} max={Math.round(l.asking_price * 1.1)} step={5000} onChange={setPrice} fmt={(v) => money(v)} />
            <Slider label="Down payment" value={a.downPaymentPct} min={5} max={100} step={1} onChange={up("downPaymentPct")} fmt={(v) => `${v}%`} />
            <Slider label="Seller note" value={a.sellerNotePct} min={0} max={Math.max(0, 100 - a.downPaymentPct)} step={1} onChange={up("sellerNotePct")} fmt={(v) => `${v}%`} />
            <Slider label="SBA interest rate" value={a.sbaRatePct} min={6} max={15} step={0.25} onChange={up("sbaRatePct")} fmt={(v) => `${v.toFixed(2)}%`} />
            <Slider label="SBA term" value={a.sbaTermYears} min={5} max={25} step={1} onChange={up("sbaTermYears")} fmt={(v) => `${v} yrs`} />
            <Slider label="Capex reserve (% of earnings)" value={a.capexReservePct} min={0} max={20} step={1} onChange={up("capexReservePct")} fmt={(v) => `${v}%`} />
            <Slider label="Hire a manager (salary)" value={a.managerSalary} min={0} max={150000} step={5000} onChange={up("managerSalary")} fmt={(v) => (v ? money(v) : "Owner-operated")} />
            <Slider label="Your market salary (for ROI)" value={a.ownerMarketSalary} min={0} max={200000} step={5000} onChange={up("ownerMarketSalary")} fmt={(v) => money(v)} />
            <Slider label="Working capital at close" value={a.workingCapital} min={0} max={Math.max(50000, Math.round(earnings))} step={5000} onChange={up("workingCapital")} fmt={(v) => money(v)} />
            <button className="text-xs font-semibold text-brand" onClick={() => (setA(DEFAULT_ASSUMPTIONS), setPrice(l.asking_price ?? 0))}>
              Reset to defaults
            </button>
          </div>
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-brand-soft p-3">
                <div className="text-xs font-semibold text-brand">Est. owner income / yr</div>
                <div className={`tnum text-2xl font-extrabold ${(r.ownerIncome ?? 0) < 0 ? "text-bad" : "text-ink"}`}>{money(r.ownerIncome)}</div>
                <div className="tnum text-xs text-ink-2">{money((r.ownerIncome ?? 0) / 12)} / month</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs font-semibold text-ink-2">Est. ROI (cash-on-cash)</div>
                <div className="tnum text-2xl font-extrabold">{pct(r.cashOnCashPct)}</div>
                <div className="tnum text-xs text-ink-2">Payback {r.paybackYears ? `${r.paybackYears.toFixed(1)} yrs` : "—"}</div>
              </div>
            </div>
            <table className="tnum mt-4 w-full text-sm">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-b border-line">
                    <td className="py-1.5 text-ink-2">{k}</td>
                    <td className="py-1.5 text-right">{money(v)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-1.5">= Owner income (pre-tax)</td>
                  <td className="py-1.5 text-right">{money(r.ownerIncome)}</td>
                </tr>
              </tbody>
            </table>
            <dl className="tnum mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-2">Cash to close</dt>
              <dd className="text-right font-semibold">{money(r.cashInvested)}</dd>
              <dt className="text-ink-2">SBA loan</dt>
              <dd className="text-right">{money(r.sbaLoan)}</dd>
              <dt className="text-ink-2">Seller note</dt>
              <dd className="text-right">{money(r.sellerNote)}</dd>
              <dt className="text-ink-2">Annual debt service</dt>
              <dd className="text-right">{money(r.annualDebtService)}</dd>
              <dt className="text-ink-2">Debt coverage (DSCR)</dt>
              <dd className={`text-right font-semibold ${r.dscr != null && r.dscr < 1.25 ? "text-bad" : "text-good"}`}>{r.dscr ? `${r.dscr.toFixed(2)}x` : "No debt"}</dd>
              <dt className="text-ink-2">Price / earnings</dt>
              <dd className="text-right">{mult(r.multiple)}</dd>
            </dl>
            {r.flags.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {r.flags.map((f) => (
                  <li key={f} className="flex gap-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
                    <span aria-hidden>⚠</span>
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function annualSellerPayment(principal: number, a: FinanceAssumptions) {
  const r = a.sellerNoteRatePct / 100 / 12;
  const n = a.sellerNoteTermYears * 12;
  return r === 0 ? principal / a.sellerNoteTermYears : ((principal * r) / (1 - Math.pow(1 + r, -n))) * 12;
}

export default function ListingDetail() {
  const { id } = useParams();
  const { data, error } = useApi<Detail>(`/api/listings/${id}`);
  if (error) return <p className="text-bad">{error}</p>;
  if (!data) return <Loading />;
  const { listing: l, comparables: c } = data;
  const years = l.year_established ? new Date().getFullYear() - l.year_established : null;
  const live = l.sources.filter((s) => s.present);

  return (
    <div className="space-y-5">
      <Link to="/browse" className="text-sm font-semibold text-brand">
        ← Back to search
      </Link>
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-3xl" aria-hidden>
            {glyph(l.industry)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={l.status} />
              <NewBadge l={l} />
              <BasisBadge basis={l.financials_basis} />
              {l.price_reduced && <Badge tone="bad">↓ {pct(((l.original_price! - l.asking_price!) / l.original_price!) * 100)} since first seen</Badge>}
              {l.is_franchise && <Badge>Franchise</Badge>}
              {l.real_estate_included && <Badge tone="brand">Real estate included</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{l.title}</h1>
            <p className="text-sm text-ink-2">
              {l.industry} · {l.city ?? "—"}
              {l.county ? `, ${l.county} County` : ""}, OH · {l.days_on_market} days on market
            </p>
          </div>
          <FavoriteButton id={l.id} initial={data.favorite} />
        </div>
        <dl className="tnum mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              ["Asking price", money(l.asking_price)],
              ["Cash flow (SDE)", money(l.cash_flow_sde)],
              ["Revenue", money(l.revenue)],
              ["EBITDA", money(l.ebitda)],
              ["Multiple", mult(l.finance.multiple)],
              ["SDE margin", pct(l.finance.marginPct)],
              ["Employees", l.employees ?? "—"],
              ["Years in business", years != null ? `${years} (est. ${l.year_established})` : "—"],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        {l.description && <p className="mt-4 text-sm leading-relaxed text-ink-2">{l.description}</p>}
      </div>

      {l.sale && (
        <Section title="Sale record" subtitle="Why we consider this business sold">
          <div className="flex flex-wrap items-center gap-3">
            <VerificationBadge v={l.sale.verification} />
            <span className="tnum text-sm">
              Sale price <b>{l.sale.sale_price ? money(l.sale.sale_price) : "not disclosed"}</b> · Closed <b>{date(l.sale.sale_date)}</b>
            </span>
            {l.sale.sale_price && l.asking_price && <span className="tnum text-sm text-ink-2">{pct((l.sale.sale_price / l.asking_price) * 100)} of last asking</span>}
          </div>
          <p className="mt-2 text-sm text-ink-2">
            Evidence: {EVIDENCE_LABEL[l.sale.evidence_type] ?? l.sale.evidence_type}. {l.sale.evidence_note}{" "}
            {l.sale.evidence_url && (
              <a href={l.sale.evidence_url} target="_blank" rel="noreferrer" className="font-semibold text-brand">
                View source ↗
              </a>
            )}
          </p>
        </Section>
      )}
      {l.status === "off_market" && (
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-2">
          <b className="text-ink">Outcome unknown.</b> This listing disappeared from every tracked source without a sale record. It may have sold privately, been withdrawn,
          or expired. We'll mark it sold only if a public record, press report, or broker confirms a sale.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Calculator l={l} />
        <div className="space-y-5">
          <Section title="Price history">
            <PriceHistoryChart data={data.history} />
          </Section>
          <Section title="Listing timeline">
            <ol className="space-y-2.5">
              {[...data.events].reverse().map((e) => {
                const t = eventText(e);
                return (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-ink-2" aria-hidden>
                      {t.icon}
                    </span>
                    <div>
                      <div className="text-ink">{t.text}</div>
                      <div className="text-xs text-muted">
                        {date(e.occurred_at)}
                        {e.source_name ? ` · via ${e.source_name}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Data provenance" subtitle="Every source where this business has been listed">
          <ul className="divide-y divide-line">
            {l.sources.map((s) => (
              <li key={s.source_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <div className="font-semibold">{s.source_name}</div>
                  <div className="text-xs text-muted">
                    {s.broker_name ? `${s.broker_name} · ` : ""}seen {date(s.first_seen_at)} – {date(s.last_seen_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.present ? "brand" : "neutral"}>{s.present ? "Live" : "Removed"}</Badge>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand">
                      Original ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            {live.length > 1 ? `Syndicated on ${live.length} sources and merged into one record. ` : ""}Financials are {l.financials_basis.replace("_", " ")}; verify with tax returns and
            bank statements during diligence.
          </p>
        </Section>
        <Section title="Location" subtitle={l.location_precision === "address" ? "Exact location" : `Approximate (${l.location_precision}-level) — listings rarely disclose addresses`}>
          <MapView
            height={260}
            points={[{ id: l.id, title: l.title, industry: l.industry, city: l.city, lat: l.lat, lng: l.lng, precision: l.location_precision, price: l.asking_price, cashFlow: l.cash_flow_sde, roi: l.finance.cashOnCashPct, status: l.status }]}
            focus={l.lat && l.lng ? { lat: l.lat, lng: l.lng } : null}
          />
        </Section>
      </div>

      <Section title={`How it compares: ${c.industry}`} subtitle={`${c.activeCount} other active listings in this industry`}>
        <div className="tnum grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Multiple", mult(l.finance.multiple), mult(c.medianMultiple), (l.finance.multiple ?? 0) <= (c.medianMultiple ?? 0)],
              ["Est. ROI", pct(l.finance.cashOnCashPct), pct(c.medianCashOnCash), (l.finance.cashOnCashPct ?? 0) >= (c.medianCashOnCash ?? 0)],
              ["SDE margin", pct(l.finance.marginPct), pct(c.medianMarginPct), (l.finance.marginPct ?? 0) >= (c.medianMarginPct ?? 0)],
              ["Asking", money(l.asking_price, { compact: true }), money(c.medianAsking, { compact: true }), null],
            ] as const
          ).map(([k, mine, med, better]) => (
            <div key={k} className="rounded-lg bg-surface-2 p-3">
              <div className="text-xs font-semibold text-muted">{k}</div>
              <div className="text-lg font-bold">{mine}</div>
              <div className="text-xs text-ink-2">
                Industry median {med}
                {better != null && <span className={better ? " text-good" : " text-bad"}> · {better ? "better" : "worse"}</span>}
              </div>
            </div>
          ))}
        </div>
        {c.soldComps.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold">Recent sales with disclosed prices</h3>
            <div className="overflow-x-auto">
              <table className="tnum w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-1.5 font-semibold">Business</th>
                    <th className="py-1.5 font-semibold">Closed</th>
                    <th className="py-1.5 text-right font-semibold">Sale price</th>
                    <th className="py-1.5 text-right font-semibold">Multiple</th>
                    <th className="py-1.5 text-right font-semibold">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {c.soldComps.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0">
                      <td className="py-1.5">{s.listing_id ? <Link to={`/listing/${s.listing_id}`} className="text-brand">{s.business_name}</Link> : s.business_name}</td>
                      <td className="py-1.5">{date(s.sale_date)}</td>
                      <td className="py-1.5 text-right">{money(s.sale_price)}</td>
                      <td className="py-1.5 text-right">{mult(s.multiple)}</td>
                      <td className="py-1.5 text-right">
                        <VerificationBadge v={s.verification} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {c.similar.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold">Similar businesses for sale</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {c.similar.slice(0, 3).map((s) => (
                <ListingCard key={s.id} l={s} />
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
