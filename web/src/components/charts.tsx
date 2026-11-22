import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { date, money, mult, pct } from "../lib";

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 12 },
  tickLine: false,
} as const;

function TipBox({ title, rows }: { title: ReactNode; rows: [string, ReactNode, string?][] }) {
  return (
    <div className="card max-w-xs px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map(([k, v, color]) => (
        <div key={k} className="tnum flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {color && <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}
            {k}
          </span>
          <b className="text-ink">{v}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={i.dashed ? { border: `1.5px dashed ${i.color}` } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface WeekRow {
  week: string;
  new: number;
  sold: number;
  off_market: number;
  price_cuts: number;
}

/** New listings vs. exits per week. Exits split into verified sold vs. disappeared. */
export function WeeklyFlowChart({ data }: { data: WeekRow[] }) {
  return (
    <div>
      <Legend
        items={[
          { label: "New listings", color: "var(--series-1)" },
          { label: "Sold (sale record)", color: "var(--series-3)" },
          { label: "Off market (no sale verified)", color: "var(--series-2)" },
        ]}
      />
      <div className="mt-2 h-64">
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="week" {...axisProps} tickFormatter={(w: string) => new Date(w + "T12:00:00Z").toLocaleDateString("en-US", { month: "short" })} interval={3} />
            <YAxis {...axisProps} allowDecimals={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TipBox
                    title={`Week of ${date(String(payload[0].payload.week))}`}
                    rows={[
                      ["New listings", payload[0].payload.new, "var(--series-1)"],
                      ["Sold", payload[0].payload.sold, "var(--series-3)"],
                      ["Off market", payload[0].payload.off_market, "var(--series-2)"],
                      ["Price cuts", payload[0].payload.price_cuts],
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="new" stackId="in" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={10} />
            <Bar dataKey="sold" stackId="out" fill="var(--series-3)" stroke="var(--surface)" strokeWidth={1} maxBarSize={10} />
            <Bar dataKey="off_market" stackId="out" fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface IndustryRow {
  name: string;
  count: number;
  medianMultiple: number | null;
  medianCashFlow: number | null;
  medianCashOnCash: number | null;
  medianMarginPct: number | null;
}

export function IndustryMultiplesChart({ data }: { data: IndustryRow[] }) {
  const rows = data.filter((d) => d.medianMultiple != null && d.count >= 2).sort((a, b) => (a.medianMultiple ?? 0) - (b.medianMultiple ?? 0));
  return (
    <div style={{ height: Math.max(180, rows.length * 30 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" {...axisProps} tickFormatter={(v: number) => `${v}x`} domain={[0, Math.ceil(Math.max(1, ...rows.map((r) => r.medianMultiple ?? 0)))]} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...axisProps} width={170} axisLine={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={String(payload[0].payload.name)}
                  rows={[
                    ["Median price / cash flow", mult(payload[0].payload.medianMultiple)],
                    ["Median cash flow", money(payload[0].payload.medianCashFlow)],
                    ["Median SDE margin", pct(payload[0].payload.medianMarginPct)],
                    ["Median est. ROI", pct(payload[0].payload.medianCashOnCash)],
                    ["Active listings", payload[0].payload.count],
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="medianMultiple" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={14}>
            <LabelList dataKey="medianMultiple" position="right" formatter={(v: unknown) => mult(Number(v))} style={{ fill: "var(--ink-2)", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ScatterPoint {
  id: number;
  title: string;
  industry: string;
  price: number;
  cashFlow: number;
  multiple: number | null;
  roi: number | null;
}

/** Asking price vs. cash flow with constant-multiple guide lines. Below the 3x line = cheaper per dollar of earnings. */
export function PriceCashFlowScatter({ data }: { data: ScatterPoint[] }) {
  const nav = useNavigate();
  const maxCf = Math.max(...data.map((d) => d.cashFlow), 1);
  const maxP = Math.max(...data.map((d) => d.price), 1);
  return (
    <div>
      <Legend
        items={[
          { label: "Active listing", color: "var(--series-1)" },
          { label: "2x / 3x / 4x cash flow", color: "var(--axis)", dashed: true },
        ]}
      />
      <div className="mt-2 h-72">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="cashFlow" name="Cash flow" {...axisProps} tickFormatter={(v: number) => money(v, { compact: true })} domain={[0, Math.ceil(maxCf / 100e3) * 100e3]} />
            <YAxis type="number" dataKey="price" name="Asking" {...axisProps} tickFormatter={(v: number) => money(v, { compact: true })} domain={[0, Math.ceil(maxP / 500e3) * 500e3]} width={56} />
            <ZAxis range={[60, 60]} />
            {[2, 3, 4].map((m) => (
              <ReferenceLine
                key={m}
                segment={[{ x: 0, y: 0 }, { x: Math.min(maxCf, maxP / m), y: Math.min(maxCf, maxP / m) * m }]}
                stroke="var(--axis)"
                strokeDasharray="4 4"
                label={{ value: `${m}x`, position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }}
              />
            ))}
            <Tooltip
              cursor={false}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(payload[0].payload.title)}
                    rows={[
                      ["Asking", money(payload[0].payload.price)],
                      ["Cash flow", money(payload[0].payload.cashFlow)],
                      ["Multiple", mult(payload[0].payload.multiple)],
                      ["Est. ROI", pct(payload[0].payload.roi)],
                    ]}
                  />
                ) : null
              }
            />
            <Scatter
              isAnimationActive={false}
              data={data}
              fill="var(--series-1)"
              fillOpacity={0.75}
              stroke="var(--surface)"
              strokeWidth={1.5}
              cursor="pointer"
              onClick={(p: unknown) => nav(`/listing/${(p as { payload?: ScatterPoint }).payload?.id ?? (p as ScatterPoint).id}`)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PriceHistoryChart({ data }: { data: { observed_at: string; asking_price: number | null }[] }) {
  const rows = data.filter((d) => d.asking_price != null);
  if (rows.length < 2) return <p className="text-sm text-ink-2">Not enough observations yet for a price history chart.</p>;
  const min = Math.min(...rows.map((r) => r.asking_price!));
  const max = Math.max(...rows.map((r) => r.asking_price!));
  const pad = Math.max((max - min) * 0.3, max * 0.05);
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="observed_at" {...axisProps} tickFormatter={(d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={40} />
          <YAxis {...axisProps} axisLine={false} width={60} domain={[Math.max(0, min - pad), max + pad]} tickFormatter={(v: number) => money(v, { compact: true })} />
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, payload }) =>
              active && payload?.length ? <TipBox title={date(String(payload[0].payload.observed_at))} rows={[["Asking price", money(Number(payload[0].payload.asking_price))]]} /> : null
            }
          />
          <Line type="stepAfter" dataKey="asking_price" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SaleVsAskChart({ data }: { data: { id: number; name: string; ask: number; sale: number }[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.flatMap((d) => [d.ask, d.sale]));
  const top = Math.ceil(max / 500e3) * 500e3;
  return (
    <div>
      <Legend items={[{ label: "Sale with disclosed price", color: "var(--series-3)" }, { label: "Sold at asking", color: "var(--axis)", dashed: true }]} />
      <div className="mt-2 h-64">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="ask" name="Last asking" {...axisProps} domain={[0, top]} tickFormatter={(v: number) => money(v, { compact: true })} />
            <YAxis type="number" dataKey="sale" name="Sale price" {...axisProps} domain={[0, top]} width={56} tickFormatter={(v: number) => money(v, { compact: true })} />
            <ZAxis range={[60, 60]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: top, y: top }]} stroke="var(--axis)" strokeDasharray="4 4" />
            <Tooltip
              cursor={false}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(payload[0].payload.name)}
                    rows={[
                      ["Last asking", money(payload[0].payload.ask)],
                      ["Sale price", money(payload[0].payload.sale)],
                      ["Sale / ask", pct((payload[0].payload.sale / payload[0].payload.ask) * 100)],
                    ]}
                  />
                ) : null
              }
            />
            <Scatter isAnimationActive={false} data={data} fill="var(--series-3)" stroke="var(--surface)" strokeWidth={1.5} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface IndustrySalesRow {
  name: string;
  sales: number;
  confirmed: number;
  brokerReported: number;
  sharePct: number;
  medianDaysOnMarket: number | null;
  sellThroughPct: number | null;
}

/** Total label at the end of each stacked bar, drawn by whichever segment is last. */
function totalLabel(rows: IndustrySalesRow[], onBrokerSegment: boolean) {
  return (props: unknown) => {
    const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
    const r = rows[index];
    if (!r || (r.brokerReported > 0) !== onBrokerSegment) return null;
    return (
      <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2} dominantBaseline="central" fill="var(--ink-2)" fontSize={11}>
        {r.sales}
      </text>
    );
  };
}

/** Sales per industry, split by verification level. Verified = solid aqua; broker-reported = light aqua (same outcome, less certain). */
export function IndustrySalesChart({ data, selected, onSelect }: { data: IndustrySalesRow[]; selected?: string | null; onSelect?: (name: string) => void }) {
  const rows = data.filter((d) => d.sales > 0);
  return (
    <div>
      <Legend
        items={[
          { label: "Verified sales", color: "var(--series-3)" },
          { label: "Broker-reported sales", color: "var(--series-3-soft)" },
        ]}
      />
      <div className="mt-2" style={{ height: Math.max(160, rows.length * 28 + 24) }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" {...axisProps} allowDecimals={false} />
            <YAxis type="category" dataKey="name" {...axisProps} width={170} axisLine={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(payload[0].payload.name)}
                    rows={[
                      ["Verified", payload[0].payload.confirmed, "var(--series-3)"],
                      ["Broker-reported", payload[0].payload.brokerReported, "var(--series-3-soft)"],
                      ["Share of all sales", pct(payload[0].payload.sharePct)],
                      ["Median days to sell", payload[0].payload.medianDaysOnMarket ?? "—"],
                      ["Sell-through", pct(payload[0].payload.sellThroughPct)],
                    ]}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="confirmed"
              stackId="s"
              fill="var(--series-3)"
              stroke="var(--surface)"
              strokeWidth={1}
              barSize={16}
              cursor={onSelect ? "pointer" : undefined}
              onClick={(d: unknown) => onSelect?.(String((d as { payload?: { name: string }; name?: string }).payload?.name ?? (d as { name: string }).name))}
            >
              {rows.map((r) => (
                <Cell key={r.name} fillOpacity={selected && selected !== r.name ? 0.35 : 1} />
              ))}
              <LabelList dataKey="sales" content={totalLabel(rows, false)} />
            </Bar>
            <Bar
              dataKey="brokerReported"
              stackId="s"
              fill="var(--series-3-soft)"
              stroke="var(--surface)"
              strokeWidth={1}
              radius={[0, 4, 4, 0]}
              barSize={16}
              cursor={onSelect ? "pointer" : undefined}
              onClick={(d: unknown) => onSelect?.(String((d as { payload?: { name: string }; name?: string }).payload?.name ?? (d as { name: string }).name))}
            >
              {rows.map((r) => (
                <Cell key={r.name} fillOpacity={selected && selected !== r.name ? 0.35 : 1} />
              ))}
              <LabelList dataKey="sales" content={totalLabel(rows, true)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
