import { Link } from "react-router-dom";
import { IndustryMultiplesChart, PriceCashFlowScatter, WeeklyFlowChart, type IndustryRow, type ScatterPoint, type WeekRow } from "../components/charts";
import { MapView } from "../components/MapView";
import { Kpi, ListingCard, Loading, Section } from "../components/ui";
import { money, mult, pct, useApi, type Listing, type MapPoint } from "../lib";

interface AreaRow {
  name: string;
  count: number;
  medianAsking: number | null;
  medianCashFlow: number | null;
  medianMultiple: number | null;
}

interface Stats {
  year: number;
  kpis: {
    activeListings: number;
    pending: number;
    newLast30: number;
    priceCutsLast30: number;
    medianAsking: number | null;
    medianCashFlow: number | null;
    medianMultiple: number | null;
    medianCashOnCash: number | null;
    totalAsking: number;
    salesConfirmed: number;
    salesBrokerReported: number;
    salesWithPrice: number;
    offMarketUnverified: number;
    medianSaleToAsk: number | null;
    medianDaysOnMarketSold: number | null;
  };
  weekly: WeekRow[];
  byIndustry: IndustryRow[];
  byCounty: AreaRow[];
  byCity: AreaRow[];
  scatter: ScatterPoint[];
  topRoi: Listing[];
  recentlyListed: Listing[];
  mapPoints: MapPoint[];
}

export default function Dashboard() {
  const { data, error } = useApi<Stats>("/api/stats");
  const { data: favs } = useApi<{ items: Listing[] }>("/api/favorites");
  if (error) return <p className="text-bad">Could not load dashboard: {error}</p>;
  if (!data) return <Loading />;
  const k = data.kpis;
  const favIds = new Set(favs?.items.map((f) => f.id));
  // With a single covered county, break the market down by community instead.
  const byCity = data.byCounty.length <= 1;
  const areas = byCity ? data.byCity.filter((c) => c.count >= 2) : data.byCounty;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Franklin County business market</h1>
          <p className="text-sm text-ink-2">Columbus and the rest of Franklin County, Ohio.</p>
        </div>
        <Link to="/browse" className="btn btn-primary">
          Browse {k.activeListings} businesses →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="For sale now" value={k.activeListings} sub={`${k.pending} under contract · ${k.newLast30} new in 30 days`} />
        <Kpi label="Median asking" value={money(k.medianAsking, { compact: true })} sub={`${money(k.totalAsking, { compact: true })} total on market`} />
        <Kpi label="Median cash flow" value={money(k.medianCashFlow, { compact: true })} sub="Seller-reported SDE" />
        <Kpi label="Median multiple" value={mult(k.medianMultiple)} sub="Asking ÷ cash flow" hint="Lower means you pay less per dollar of earnings" />
        <Kpi
          label="Median est. ROI"
          value={pct(k.medianCashOnCash)}
          sub="10% down SBA, after market salary"
          hint="Cash-on-cash return after debt service, capex reserve, and a $75k market salary for your own labor"
        />
        <Kpi label="Price cuts (30d)" value={k.priceCutsLast30} sub="Listings with a reduced asking price" />
      </div>

      <div className="card grid gap-4 p-4 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:items-center sm:p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{data.year} exits</div>
          <p className="mt-1 text-sm text-ink-2">
            We only count a business as <b>sold</b> with a sale record. Listings that just vanish are tracked separately.
          </p>
        </div>
        <div>
          <div className="tnum text-2xl font-bold text-good">✓ {k.salesConfirmed}</div>
          <div className="text-xs text-ink-2">Verified sales (public record / press)</div>
        </div>
        <div>
          <div className="tnum text-2xl font-bold text-warn">! {k.salesBrokerReported}</div>
          <div className="text-xs text-ink-2">Broker-reported sales (unconfirmed)</div>
        </div>
        <div>
          <div className="tnum text-2xl font-bold text-ink-2">○ {k.offMarketUnverified}</div>
          <div className="text-xs text-ink-2">Disappeared, outcome unknown</div>
        </div>
        <div className="text-xs text-ink-2 sm:col-span-4">
          Median sale-to-ask on disclosed prices: <b className="tnum text-ink">{pct(k.medianSaleToAsk != null ? k.medianSaleToAsk * 100 : null)}</b> · median days on market for sold
          businesses: <b className="tnum text-ink">{k.medianDaysOnMarketSold ?? "—"}</b> ·{" "}
          <Link to="/sold" className="font-semibold text-brand">
            See all {data.year} sales →
          </Link>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Market map" subtitle="Active listings, colored by estimated ROI. Click a pin for details.">
          <MapView points={data.mapPoints} height={520} />
        </Section>
        <Section title="Best estimated returns" subtitle="Highest ROI with lender-grade coverage (DSCR ≥ 1.25)" action={<Link to="/browse?sort=roi_desc&minDscr=1.25" className="text-sm font-semibold text-brand">All →</Link>}>
          <div className="space-y-3">
            {data.topRoi.slice(0, 3).map((l) => (
              <ListingCard key={l.id} l={l} favorite={favIds.has(l.id)} />
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Listing flow by week" subtitle={`New listings vs. exits, ${data.year}`}>
          <WeeklyFlowChart data={data.weekly} />
        </Section>
        <Section title="Asking price vs. cash flow" subtitle="Points below the 3x line are priced under three years of earnings">
          <PriceCashFlowScatter data={data.scatter} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Section title="Median multiple by industry" subtitle="Asking price ÷ cash flow, industries with 2+ active listings">
          <IndustryMultiplesChart data={data.byIndustry} />
        </Section>
        <Section title={byCity ? "By community" : "By county"} subtitle={byCity ? "Communities with 2+ active listings" : undefined}>
          <div className="overflow-x-auto">
            <table className="tnum w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 font-semibold">{byCity ? "Community" : "County"}</th>
                  <th className="py-2 text-right font-semibold">Listings</th>
                  <th className="py-2 text-right font-semibold">Median ask</th>
                  <th className="py-2 text-right font-semibold">Median CF</th>
                  <th className="py-2 text-right font-semibold">Multiple</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-0">
                    <td className="py-2">
                      <Link to={`/browse?${byCity ? "city" : "county"}=${encodeURIComponent(c.name)}`} className="font-semibold text-brand">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 text-right">{c.count}</td>
                    <td className="py-2 text-right">{money(c.medianAsking, { compact: true })}</td>
                    <td className="py-2 text-right">{money(c.medianCashFlow, { compact: true })}</td>
                    <td className="py-2 text-right">{mult(c.medianMultiple)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="Newly listed" action={<Link to="/browse?sort=newest" className="text-sm font-semibold text-brand">All new →</Link>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.recentlyListed.map((l) => (
            <ListingCard key={l.id} l={l} favorite={favIds.has(l.id)} />
          ))}
        </div>
      </Section>
    </div>
  );
}
