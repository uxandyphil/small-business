import { useState } from "react";
import { Link } from "react-router-dom";
import { IndustrySalesChart, SaleVsAskChart } from "../components/charts";
import { Badge, Empty, glyph, Kpi, Loading, Section, VerificationBadge } from "../components/ui";
import { YearCompare, type Comparison } from "./YearCompare";
import { date, EVIDENCE_LABEL, money, mult, pct, useApi, type Sale, type SourceRef } from "../lib";

interface SaleRow extends Sale {
  listing: { id: number; title: string; asking_price: number | null; original_price: number | null; cash_flow_sde: number | null; revenue: number | null; days_on_market: number; sources: SourceRef[] } | null;
  sale_to_ask: number | null;
  sale_multiple: number | null;
}
interface IndustryRow {
  name: string;
  sales: number;
  confirmed: number;
  brokerReported: number;
  sharePct: number;
  medianSalePrice: number | null;
  medianSaleMultiple: number | null;
  medianSaleToAsk: number | null;
  medianDaysOnMarket: number | null;
  offMarket: number;
  sellThroughPct: number | null;
  activeNow: number;
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

type IndSort = "sales" | "fastest" | "sellThrough" | "multiple";
const IND_SORTS: [IndSort, string][] = [
  ["sales", "Most sold"],
  ["fastest", "Fastest to sell"],
  ["sellThrough", "Best sell-through"],
  ["multiple", "Highest sale multiple"],
];
const byNullable = (a: number | null, b: number | null, dir: 1 | -1) => (a == null ? 1 : b == null ? -1 : (a - b) * dir);
function sortIndustries(rows: IndustryRow[], k: IndSort) {
  const withSales = rows.filter((r) => r.sales > 0);
  const tie = (a: IndustryRow, b: IndustryRow) => b.sales - a.sales;
  switch (k) {
    case "fastest":
      return [...withSales].sort((a, b) => byNullable(a.medianDaysOnMarket, b.medianDaysOnMarket, 1) || tie(a, b));
    case "sellThrough":
      return [...withSales].sort((a, b) => byNullable(a.sellThroughPct, b.sellThroughPct, -1) || tie(a, b));
    case "multiple":
      return [...withSales].sort((a, b) => byNullable(a.medianSaleMultiple, b.medianSaleMultiple, -1) || tie(a, b));
    default:
      return [...withSales].sort((a, b) => tie(a, b) || byNullable(a.sellThroughPct, b.sellThroughPct, -1));
  }
}

/** Highlight cards only consider industries with enough activity to mean something. */
function leaders(rows: IndustryRow[]) {
  const pick = (xs: IndustryRow[], f: (r: IndustryRow) => number | null, dir: 1 | -1) =>
    xs.filter((r) => f(r) != null).sort((a, b) => (f(a)! - f(b)!) * dir || b.sales - a.sales)[0];
  return {
    mostSold: pick(rows, (r) => r.sales, -1),
    fastest: pick(rows.filter((r) => r.sales >= 2), (r) => r.medianDaysOnMarket, 1),
    sellThrough: pick(rows.filter((r) => r.sales + r.offMarket >= 3), (r) => r.sellThroughPct, -1),
    multiple: pick(rows.filter((r) => r.sales >= 2), (r) => r.medianSaleMultiple, -1),
  };
}

function IndustryInsights({ rows, selected, onSelect, year }: { rows: IndustryRow[]; selected: string | null; onSelect: (n: string | null) => void; year: number }) {
  const [sort, setSort] = useState<IndSort>("sales");
  if (rows.every((r) => r.sales === 0)) return null;
  const top = leaders(rows);
  const sorted = sortIndustries(rows, sort);
  const toggle = (n: string) => onSelect(selected === n ? null : n);
  const cards: [string, IndustryRow | undefined, string, string][] = [
    ["Most sold", top.mostSold, top.mostSold ? `${top.mostSold.sales} sales · ${pct(top.mostSold.sharePct)} of all` : "", "Highest number of sale records"],
    ["Fastest to sell", top.fastest, top.fastest ? `${top.fastest.medianDaysOnMarket} median days on market` : "", "Lowest median days from listing to sale (2+ sales)"],
    ["Best sell-through", top.sellThrough, top.sellThrough ? `${pct(top.sellThrough.sellThroughPct)} of exits were sales` : "", "Share of listings leaving the market that had a sale record, not just disappeared (3+ exits)"],
    ["Highest sale multiple", top.multiple, top.multiple ? `${mult(top.multiple.medianSaleMultiple)} sale price ÷ cash flow` : "", "Buyers paid the most per dollar of earnings (2+ priced sales)"],
  ];
  return (
    <Section
      title={`Industries selling in ${year}`}
      subtitle="Which kinds of businesses are actually changing hands. Click an industry to filter the sales below."
      action={
        selected ? (
          <button className="text-sm font-semibold text-brand" onClick={() => onSelect(null)}>
            Clear industry filter ✕
          </button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, r, detail, hint]) =>
          r ? (
            <button
              key={label}
              title={hint}
              onClick={() => toggle(r.name)}
              className={`rounded-lg border p-3 text-left transition hover:border-[var(--brand)] ${selected === r.name ? "border-[var(--brand)] bg-brand-soft" : "border-line bg-surface-2"}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
              <div className="mt-1 flex items-center gap-1.5 font-bold text-ink">
                <span aria-hidden>{glyph(r.name)}</span>
                {r.name}
              </div>
              <div className="tnum mt-0.5 text-xs text-ink-2">{detail}</div>
            </button>
          ) : null,
        )}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-bold">Sales by industry</h3>
          <IndustrySalesChart data={rows} selected={selected} onSelect={toggle} />
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold">Ranking</h3>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Rank industries by">
              {IND_SORTS.map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sort === k ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-2 hover:text-ink"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tnum w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 font-semibold">#</th>
                  <th className="py-2 font-semibold">Industry</th>
                  <th className="py-2 pl-3 text-right font-semibold" title="Verified + broker-reported">Sales</th>
                  <th className="py-2 pl-3 text-right font-semibold">Median price</th>
                  <th className="py-2 pl-3 text-right font-semibold" title="Sale price ÷ listed cash flow">Multiple</th>
                  <th className="py-2 pl-3 text-right font-semibold" title="Median days from listing to sale">Days</th>
                  <th className="py-2 pl-3 text-right font-semibold" title="Sales ÷ (sales + listings that disappeared) this year">Sell-through</th>
                  <th className="py-2 pl-3 text-right font-semibold">For sale now</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.name} className={`border-b border-line last:border-0 ${selected === r.name ? "bg-brand-soft" : ""}`}>
                    <td className="py-1.5 text-muted">{i + 1}</td>
                    <td className="py-1.5">
                      <button className="text-left font-semibold text-brand" onClick={() => toggle(r.name)}>
                        {r.name}
                      </button>
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <b>{r.sales}</b>
                      <span className="text-xs text-muted">
                        {" "}
                        ({r.confirmed}✓{r.brokerReported ? ` ${r.brokerReported}!` : ""})
                      </span>
                    </td>
                    <td className="py-1.5 pl-3 text-right">{money(r.medianSalePrice, { compact: true })}</td>
                    <td className="py-1.5 pl-3 text-right">{mult(r.medianSaleMultiple)}</td>
                    <td className="py-1.5 pl-3 text-right">{r.medianDaysOnMarket != null ? Math.round(r.medianDaysOnMarket) : "—"}</td>
                    <td className="py-1.5 pl-3 text-right">{pct(r.sellThroughPct)}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <Link to={`/browse?industry=${encodeURIComponent(r.name)}`} className="text-brand">
                        {r.activeNow}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            ✓ verified · ! broker-reported. Sell-through counts only listings that left the market in {year}; a low rate means many listings disappeared without a recorded sale.
            Small counts, so treat rankings as directional.
          </p>
        </div>
      </div>
    </Section>
  );
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};

export default function Sold() {
  const [year, setYear] = useState(2026);
  const [tab, setTab] = useState<"sales" | "off">("sales");
  const [verif, setVerif] = useState<"all" | "confirmed" | "broker_reported">("all");
  const [industry, setIndustry] = useState<string | null>(null);
  const { data } = useApi<{ sales: SaleRow[]; offMarket: OffRow[]; industries: IndustryRow[] }>(`/api/sales?year=${year}`);
  const { data: compare } = useApi<Comparison>("/api/sales/compare");
  if (!data) return <Loading />;
  const yearOptions = compare?.years.map((y) => y.year).reverse() ?? [year];
  const sales = data.sales.filter((s) => (verif === "all" || s.verification === verif) && (!industry || s.industry === industry));
  const offMarket = data.offMarket.filter((o) => !industry || o.industry === industry);
  const priced = data.sales.filter((s) => s.sale_price != null);
  const ratios = data.sales.map((s) => s.sale_to_ask).filter((x): x is number => x != null);
  const multiples = data.sales.map((s) => s.sale_multiple).filter((x): x is number => x != null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Businesses sold</h1>
          <p className="max-w-3xl text-sm text-ink-2">
            A business appears here only with a sale record. <b>Verified</b> sales are backed by independent evidence (county filings, liquor-permit transfers, press releases, news).{" "}
            <b>Broker-reported</b> sales rely on the broker's “Sold” notice. Listings that simply vanished are listed separately and never counted as sold.
          </p>
        </div>
      </div>

      {compare && <YearCompare data={compare} selectedIndustry={industry} onPickIndustry={setIndustry} />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <h2 className="text-xl font-extrabold tracking-tight">{year} in detail</h2>
        <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Year">
          {yearOptions.map((y) => (
            <button key={y} onClick={() => setYear(y)} className={`rounded-md px-3 py-1 text-sm font-semibold ${y === year ? "bg-brand text-brand-ink" : "text-ink-2"}`}>
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Verified sales" value={<span className="text-good">✓ {data.sales.filter((s) => s.verification === "confirmed").length}</span>} sub="Independent evidence" />
        <Kpi label="Broker-reported" value={<span className="text-warn">! {data.sales.filter((s) => s.verification === "broker_reported").length}</span>} sub="Not independently confirmed" />
        <Kpi label="Disappeared" value={<span className="text-ink-2">○ {data.offMarket.length}</span>} sub="Outcome unknown" />
        <Kpi label="Median sale / ask" value={pct(median(ratios) != null ? median(ratios)! * 100 : null)} sub={`${priced.length} sales with disclosed price`} />
        <Kpi label="Median sale multiple" value={mult(median(multiples))} sub="Sale price ÷ listed cash flow" />
      </div>

      <IndustryInsights rows={data.industries} selected={industry} onSelect={setIndustry} year={year} />

      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["sales", `Sales (${sales.length})`],
            ["off", `Disappeared, unverified (${offMarket.length})`],
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
            title={industry ? `Sale records: ${industry}` : "Sale records"}
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
                .filter((s) => (!industry || s.industry === industry) && s.sale_price && s.listing?.asking_price)
                .map((s) => ({ id: s.id, name: s.business_name, ask: s.listing!.asking_price!, sale: s.sale_price! }))}
            />
          </Section>
        </div>
      ) : (
        <Section title="Disappeared without a verified sale" subtitle="Removed from every tracked source for 2+ consecutive complete crawls. May have sold privately, been withdrawn, or expired.">
          {offMarket.length === 0 ? (
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
                  {offMarket.map((o) => (
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
