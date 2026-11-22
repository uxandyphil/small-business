import { useState, type ReactNode } from "react";
import { YearExitsChart } from "../components/charts";
import { Section } from "../components/ui";
import { date, money, mult, pct } from "../lib";

interface PeriodCounts {
  sales: number;
  confirmed: number;
  brokerReported: number;
  offMarket: number;
  newListings: number;
  sellThroughPct: number | null;
}
export interface YearStat extends PeriodCounts {
  year: number;
  partial: boolean;
  incomplete: boolean;
  medianSalePrice: number | null;
  medianSaleMultiple: number | null;
  medianSaleToAsk: number | null;
  medianDaysOnMarket: number | null;
  medianAskingMultiple: number | null;
  samePeriod: PeriodCounts;
  topIndustries: { name: string; count: number }[];
}
export interface Comparison {
  asOf: string;
  currentYear: number;
  samePeriodEnd: string;
  years: YearStat[];
  industries: { name: string; total: number; perYear: { year: number; sales: number; sharePct: number; sellThroughPct: number | null }[] }[];
}

type Mode = "full" | "same";

function Delta({ cur, prev, kind, invert = false }: { cur: number | null; prev: number | null; kind: "pct" | "pts" | "abs"; invert?: boolean }) {
  if (cur == null || prev == null || (kind === "pct" && prev === 0)) return <span className="text-muted">—</span>;
  const d = kind === "pct" ? ((cur - prev) / prev) * 100 : cur - prev;
  if (Math.abs(d) < 0.05) return <span className="text-ink-2">0</span>;
  const up = d > 0;
  const good = invert ? !up : up;
  const text = kind === "pct" ? `${Math.abs(d).toFixed(0)}%` : kind === "pts" ? `${Math.abs(d).toFixed(1)} pts` : Math.abs(d).toFixed(Number.isInteger(d) ? 0 : 2);
  return (
    <span className={good ? "text-good" : "text-bad"}>
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

export function YearCompare({ data, onPickIndustry, selectedIndustry }: { data: Comparison; onPickIndustry: (n: string | null) => void; selectedIndustry: string | null }) {
  const [mode, setMode] = useState<Mode>("same");
  const years = data.years;
  if (years.length < 2) return null;
  const cur = years[years.length - 1];
  const prev = years[years.length - 2];
  const end = date(`${data.currentYear}-${data.samePeriodEnd}`).replace(/, \d{4}$/, "");
  const counts = (y: YearStat): PeriodCounts => (mode === "same" ? y.samePeriod : y);
  const colLabel = (y: YearStat) => (y.partial ? `${y.year} YTD` : mode === "same" ? `${y.year}*` : String(y.year));

  // Counts always compare like for like (current YTD vs. prior year's same period).
  const rows: { label: string; hint?: string; cell: (y: YearStat) => ReactNode; delta: ReactNode }[] = [
    {
      label: "Businesses sold",
      hint: "Verified + broker-reported sale records",
      cell: (y) => (
        <>
          <b>{counts(y).sales}</b>
          <span className="text-xs text-muted">
            {" "}
            ({counts(y).confirmed}✓ {counts(y).brokerReported}!)
          </span>
        </>
      ),
      delta: <Delta cur={cur.samePeriod.sales} prev={prev.samePeriod.sales} kind="pct" />,
    },
    {
      label: "Disappeared, no sale",
      hint: "Left every source without a sale record",
      cell: (y) => counts(y).offMarket,
      delta: <Delta cur={cur.samePeriod.offMarket} prev={prev.samePeriod.offMarket} kind="pct" invert />,
    },
    {
      label: "Sell-through",
      hint: "Sales ÷ (sales + disappeared)",
      cell: (y) => pct(counts(y).sellThroughPct),
      delta: <Delta cur={cur.samePeriod.sellThroughPct} prev={prev.samePeriod.sellThroughPct} kind="pts" />,
    },
    {
      label: "New listings",
      cell: (y) => counts(y).newListings,
      delta: <Delta cur={cur.samePeriod.newListings} prev={prev.samePeriod.newListings} kind="pct" />,
    },
    { label: "Median sale price", cell: (y) => money(y.medianSalePrice, { compact: true }), delta: <Delta cur={cur.medianSalePrice} prev={prev.medianSalePrice} kind="pct" /> },
    {
      label: "Median sale multiple",
      hint: "Sale price ÷ listed cash flow",
      cell: (y) => mult(y.medianSaleMultiple),
      delta: <Delta cur={cur.medianSaleMultiple} prev={prev.medianSaleMultiple} kind="abs" />,
    },
    {
      label: "Median asking multiple",
      hint: "First asking price ÷ cash flow, for listings that came to market that year",
      cell: (y) => mult(y.medianAskingMultiple),
      delta: <Delta cur={cur.medianAskingMultiple} prev={prev.medianAskingMultiple} kind="abs" invert />,
    },
    {
      label: "Sale-to-ask",
      cell: (y) => pct(y.medianSaleToAsk != null ? y.medianSaleToAsk * 100 : null),
      delta: <Delta cur={cur.medianSaleToAsk != null ? cur.medianSaleToAsk * 100 : null} prev={prev.medianSaleToAsk != null ? prev.medianSaleToAsk * 100 : null} kind="pts" />,
    },
    {
      label: "Median days to sell",
      cell: (y) => (y.medianDaysOnMarket != null ? Math.round(y.medianDaysOnMarket) : "—"),
      delta: <Delta cur={cur.medianDaysOnMarket} prev={prev.medianDaysOnMarket} kind="pct" invert />,
    },
  ];

  const maxSales = Math.max(1, ...data.industries.flatMap((i) => i.perYear.map((p) => p.sales)));
  const shade = (n: number) => {
    if (n === 0) return { background: "transparent", color: "var(--muted)" };
    const t = n / maxSales;
    const bg = t > 0.75 ? "var(--seq-4)" : t > 0.5 ? "var(--seq-3)" : t > 0.25 ? "var(--seq-2)" : "var(--seq-1)";
    return { background: bg, color: t > 0.5 ? "#fff" : "var(--ink)" };
  };

  return (
    <Section
      title={`${years[0].year}–${cur.year} compared`}
      subtitle={`${cur.year} runs through ${end}. Changes compare ${cur.year} with the same period of ${prev.year}.`}
      action={
        <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Period">
          {(
            [
              ["same", `Jan 1 – ${end} each year`],
              ["full", "Full years"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === k ? "bg-brand text-brand-ink" : "text-ink-2"}`}>
              {l}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-bold">Exits by year</h3>
          <YearExitsChart data={years.map((y) => ({ label: colLabel(y), confirmed: counts(y).confirmed, brokerReported: counts(y).brokerReported, offMarket: counts(y).offMarket }))} />
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="tnum w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-semibold">Metric</th>
                {years.map((y) => (
                  <th key={y.year} className="py-2 pl-3 text-right font-semibold">
                    {colLabel(y)}
                  </th>
                ))}
                <th className="py-2 pl-3 text-right font-semibold" title={`${cur.year} vs ${prev.year}; counts compare the same period`}>
                  vs {prev.year}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-2 text-ink-2" title={r.hint}>
                    {r.label}
                  </td>
                  {years.map((y) => (
                    <td key={y.year} className={`py-1.5 pl-3 text-right ${y.partial ? "bg-surface-2" : ""}`}>
                      {r.cell(y)}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-right text-xs font-semibold">{r.delta}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 align-top text-ink-2">Top industries</td>
                {years.map((y) => (
                  <td key={y.year} className={`py-1.5 pl-3 text-right align-top text-xs ${y.partial ? "bg-surface-2" : ""}`}>
                    {y.topIndustries.map((t) => (
                      <div key={t.name}>
                        {t.name} <span className="text-muted">({t.count})</span>
                      </div>
                    ))}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            ✓ verified · ! broker-reported.{mode === "same" ? ` * Jan 1 – ${end} of that year.` : ` ${cur.year} is year to date.`} Sale prices, multiples and days to sell are full-year medians of
            sales with disclosed figures.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-bold">Industries sold, by year</h3>
        <p className="mb-2 text-xs text-ink-2">Full-year sale counts (darker = more sales). Click an industry to filter the sales list below.</p>
        <div className="overflow-x-auto">
          <table className="tnum w-full min-w-[560px] max-w-4xl text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-semibold">Industry</th>
                {years.map((y) => (
                  <th key={y.year} className="w-20 py-2 text-center font-semibold">
                    {y.partial ? `${y.year} YTD` : y.year}
                  </th>
                ))}
                <th className="py-2 pl-3 text-right font-semibold">Total</th>
                <th className="py-2 pl-3 text-right font-semibold" title={`Share of all sales, ${cur.year} vs ${prev.year}`}>
                  Share trend
                </th>
              </tr>
            </thead>
            <tbody>
              {data.industries.map((ind) => {
                const c = ind.perYear[ind.perYear.length - 1];
                const p = ind.perYear[ind.perYear.length - 2];
                return (
                  <tr key={ind.name} className={`border-b border-line last:border-0 ${selectedIndustry === ind.name ? "outline outline-2 outline-[var(--brand)]" : ""}`}>
                    <td className="py-1 pr-2">
                      <button className="text-left font-semibold text-brand" onClick={() => onPickIndustry(selectedIndustry === ind.name ? null : ind.name)}>
                        {ind.name}
                      </button>
                    </td>
                    {ind.perYear.map((py) => (
                      <td key={py.year} className="px-0.5 py-0.5">
                        <div
                          className="rounded py-1 text-center text-xs font-semibold"
                          style={shade(py.sales)}
                          title={`${ind.name}, ${py.year}: ${py.sales} sales (${pct(py.sharePct)} of all), sell-through ${pct(py.sellThroughPct)}`}
                        >
                          {py.sales || "·"}
                        </div>
                      </td>
                    ))}
                    <td className="py-1 pl-3 text-right font-semibold">{ind.total}</td>
                    <td className="py-1 pl-3 text-right text-xs">
                      {pct(c.sharePct)} <Delta cur={c.sharePct} prev={p.sharePct} kind="pts" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
