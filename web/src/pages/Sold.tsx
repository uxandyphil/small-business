import { useState } from "react";
import { Link } from "react-router-dom";
import { SaleVsAskChart } from "../components/charts";
import { Badge, Empty, Kpi, Loading, Section, VerificationBadge } from "../components/ui";
import { date, EVIDENCE_LABEL, money, mult, pct, useApi, type Sale, type SourceRef } from "../lib";

interface SaleRow extends Sale {
  listing: { id: number; title: string; asking_price: number | null; original_price: number | null; cash_flow_sde: number | null; revenue: number | null; days_on_market: number; sources: SourceRef[] } | null;
  sale_to_ask: number | null;
  sale_multiple: number | null;
}
interface OffRow {
  id: number;
  title: string;
  industry: string;
  city: string | null;
  county: string | null;
  asking_price: number | null;
  cash_flow_sde: number | null;
  last_seen_at: string;
  status_changed_at: string;
  days_on_market: number;
  sources: SourceRef[];
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};

export default function Sold() {
  const [year, setYear] = useState(2026);
  const [tab, setTab] = useState<"sales" | "off">("sales");
  const [verif, setVerif] = useState<"all" | "confirmed" | "broker_reported">("all");
  const { data } = useApi<{ sales: SaleRow[]; offMarket: OffRow[] }>(`/api/sales?year=${year}`);
  if (!data) return <Loading />;
  const sales = data.sales.filter((s) => verif === "all" || s.verification === verif);
  const priced = data.sales.filter((s) => s.sale_price != null);
  const ratios = data.sales.map((s) => s.sale_to_ask).filter((x): x is number => x != null);
  const multiples = data.sales.map((s) => s.sale_multiple).filter((x): x is number => x != null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Businesses sold in {year}</h1>
          <p className="max-w-3xl text-sm text-ink-2">
            A business appears here only with a sale record. <b>Verified</b> sales are backed by independent evidence (county filings, liquor-permit transfers, press releases, news).{" "}
            <b>Broker-reported</b> sales rely on the broker's “Sold” notice. Listings that simply vanished are listed separately and never counted as sold.
          </p>
        </div>
        <select className="input !w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[2026, 2025].map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Verified sales" value={<span className="text-good">✓ {data.sales.filter((s) => s.verification === "confirmed").length}</span>} sub="Independent evidence" />
        <Kpi label="Broker-reported" value={<span className="text-warn">! {data.sales.filter((s) => s.verification === "broker_reported").length}</span>} sub="Not independently confirmed" />
        <Kpi label="Disappeared" value={<span className="text-ink-2">○ {data.offMarket.length}</span>} sub="Outcome unknown" />
        <Kpi label="Median sale / ask" value={pct(median(ratios) != null ? median(ratios)! * 100 : null)} sub={`${priced.length} sales with disclosed price`} />
        <Kpi label="Median sale multiple" value={mult(median(multiples))} sub="Sale price ÷ listed cash flow" />
      </div>

      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["sales", `Sales (${data.sales.length})`],
            ["off", `Disappeared, unverified (${data.offMarket.length})`],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-[var(--brand)] text-brand" : "border-transparent text-ink-2"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "sales" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Section
            title="Sale records"
            action={
              <select className="input !w-auto" value={verif} onChange={(e) => setVerif(e.target.value as typeof verif)} aria-label="Verification filter">
                <option value="all">All verification levels</option>
                <option value="confirmed">Verified only</option>
                <option value="broker_reported">Broker-reported only</option>
              </select>
            }
          >
            {sales.length === 0 ? (
              <Empty>No sale records for this filter.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tnum w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 font-semibold">Business</th>
                      <th className="py-2 font-semibold">Closed</th>
                      <th className="py-2 pl-4 text-right font-semibold">Last ask</th>
                      <th className="py-2 pl-4 text-right font-semibold">Sale price</th>
                      <th className="py-2 pl-4 text-right font-semibold">Sale/ask</th>
                      <th className="py-2 pl-4 text-right font-semibold">DOM</th>
                      <th className="py-2 pl-3 font-semibold">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-2">
                          {s.listing ? (
                            <Link to={`/listing/${s.listing.id}`} className="font-semibold text-brand">
                              {s.business_name}
                            </Link>
                          ) : (
                            <span className="font-semibold">{s.business_name}</span>
                          )}
                          <div className="text-xs text-muted">
                            {s.industry} · {s.city}
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-2 pl-2">{date(s.sale_date)}</td>
                        <td className="py-2 pl-4 text-right">{money(s.listing?.asking_price, { compact: true })}</td>
                        <td className="py-2 pl-4 text-right font-semibold">{s.sale_price ? money(s.sale_price, { compact: true }) : <span className="font-normal text-muted">Undisclosed</span>}</td>
                        <td className="py-2 pl-4 text-right">{pct(s.sale_to_ask != null ? s.sale_to_ask * 100 : null)}</td>
                        <td className="py-2 pl-4 text-right">{s.listing?.days_on_market ?? "—"}</td>
                        <td className="py-2 pl-3">
                          <VerificationBadge v={s.verification} />
                          <div className="mt-1 text-xs text-ink-2">
                            {EVIDENCE_LABEL[s.evidence_type] ?? s.evidence_type}
                            {s.evidence_url && (
                              <>
                                {" · "}
                                <a href={s.evidence_url} target="_blank" rel="noreferrer" className="text-brand">
                                  source ↗
                                </a>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="Sale price vs. last asking" subtitle="Dots below the dashed line sold under asking">
            <SaleVsAskChart
              data={data.sales
                .filter((s) => s.sale_price && s.listing?.asking_price)
                .map((s) => ({ id: s.id, name: s.business_name, ask: s.listing!.asking_price!, sale: s.sale_price! }))}
            />
          </Section>
        </div>
      ) : (
        <Section title="Disappeared without a verified sale" subtitle="Removed from every tracked source for 2+ consecutive complete crawls. May have sold privately, been withdrawn, or expired.">
          {data.offMarket.length === 0 ? (
            <Empty>None this year.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="tnum w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 font-semibold">Business</th>
                    <th className="py-2 font-semibold">Last seen</th>
                    <th className="py-2 pl-4 text-right font-semibold">Last ask</th>
                    <th className="py-2 pl-4 text-right font-semibold">Cash flow</th>
                    <th className="py-2 pl-4 text-right font-semibold">Days listed</th>
                    <th className="py-2 pl-3 font-semibold">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {data.offMarket.map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className="py-2">
                        <Link to={`/listing/${o.id}`} className="font-semibold text-brand">
                          {o.title}
                        </Link>
                        <div className="text-xs text-muted">
                          {o.industry} · {o.city}
                        </div>
                      </td>
                      <td className="py-2">{date(o.last_seen_at)}</td>
                      <td className="py-2 pl-4 text-right">{money(o.asking_price, { compact: true })}</td>
                      <td className="py-2 pl-4 text-right">{money(o.cash_flow_sde, { compact: true })}</td>
                      <td className="py-2 pl-4 text-right">{o.days_on_market}</td>
                      <td className="py-2 pl-3">
                        <div className="flex flex-wrap gap-1">
                          {o.sources.map((s) => (
                            <Badge key={s.source_id}>{s.source_name}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
