import { Badge, Loading, Section } from "../components/ui";
import { date, money, useApi, type Meta } from "../lib";

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  adapter: string;
  homepage: string | null;
  access_method: string;
  compliance_note: string;
  enabled: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  live_listings: number;
  total_listings: number;
  sales: number;
}
interface RunRow {
  id: number;
  source_id: string;
  as_of: string;
  status: string;
  seen: number;
  created: number;
  disappeared: number;
  message: string | null;
}

export default function Sources() {
  const { data } = useApi<{ sources: SourceRow[]; runs: RunRow[] }>("/api/sources");
  const { data: meta } = useApi<Meta>("/api/meta");
  if (!data) return <Loading />;
  const a = meta?.defaultAssumptions;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Data sources &amp; methodology</h1>
        <p className="max-w-3xl text-sm text-ink-2">
          Every number on this site traces to a source listed here. We collect data only through channels that permit it: licensed feeds, broker-provided feeds, polite crawling of
          sites that allow it, and imports the operator has rights to.
        </p>
      </div>

      <Section title="Sources">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-semibold">Source</th>
                <th className="py-2 font-semibold">Access method &amp; compliance</th>
                <th className="py-2 text-right font-semibold">Live / total</th>
                <th className="py-2 text-right font-semibold">Sales</th>
                <th className="py-2 pl-4 font-semibold">Last run</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={s.id} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3">
                    <div className="font-semibold">
                      {s.homepage ? (
                        <a href={s.homepage} target="_blank" rel="noreferrer" className="text-brand">
                          {s.name} ↗
                        </a>
                      ) : (
                        s.name
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={s.enabled ? "good" : "neutral"}>{s.enabled ? "● Enabled" : "○ Not connected"}</Badge>
                      <Badge>{s.kind.replace("_", " ")}</Badge>
                    </div>
                  </td>
                  <td className="max-w-md py-3 pr-3">
                    <div className="font-medium text-ink">{s.access_method}</div>
                    <div className="mt-0.5 text-xs text-ink-2">{s.compliance_note}</div>
                  </td>
                  <td className="tnum py-3 text-right">
                    {s.live_listings} / {s.total_listings}
                  </td>
                  <td className="tnum py-3 text-right">{s.sales}</td>
                  <td className="py-3 pl-4 text-xs">
                    {s.last_run_at ? (
                      <>
                        <div className={s.last_run_status === "error" ? "font-semibold text-bad" : "font-semibold"}>{date(s.last_run_at)}</div>
                        <div className="text-ink-2">{s.last_run_message}</div>
                      </>
                    ) : (
                      <span className="text-muted">Never run</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="How a listing's status is determined">
          <dl className="space-y-3 text-sm">
            {(
              [
                ["● For sale", "Present on at least one tracked source."],
                ["◐ Under contract", "A source marks it pending, under LOI, or contingent. Reverts to For sale if it returns as active."],
                ["✓ Sold — verified", "A sale record backed by independent evidence: county filings (bulk-sale, UCC, liquor-permit transfer), press release, news, or buyer/seller confirmation. Requires an evidence link."],
                ["! Sold — broker-reported", "The listing broker marked it sold. Shown as sold, labeled unconfirmed, and upgraded automatically if independent evidence arrives."],
                ["○ Off market", "Missing from every source for 2+ consecutive complete crawls with no sale record. Outcome unknown, never counted as a sale. Partial or failed crawls never trigger this."],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="How owner income and ROI are estimated">
          <div className="space-y-3 text-sm text-ink-2">
            <p>
              Starting from seller-reported <b className="text-ink">cash flow (SDE)</b>, or EBITDA as a conservative stand-in when SDE isn't disclosed:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink">
{`Owner income  = SDE − capex reserve − manager salary − debt service
Debt service  = SBA loan payment + seller-note payment
Est. ROI      = (Owner income − your market salary) ÷ cash to close
Cash to close = down payment + closing costs + working capital
DSCR          = (SDE − capex − manager) ÷ debt service`}
            </pre>
            {a && (
              <p>
                Defaults: {a.downPaymentPct}% down, {a.sellerNotePct}% seller note at {a.sellerNoteRatePct}% over {a.sellerNoteTermYears} yrs, SBA 7(a) loan for the rest at {a.sbaRatePct}% over{" "}
                {a.sbaTermYears} yrs, {a.closingCostPct}% closing costs, {a.capexReservePct}% capex reserve, {money(a.ownerMarketSalary)} market salary. All adjustable on Browse
                and on each listing.
              </p>
            )}
            <p>Estimates are pre-tax, assume reported financials hold up in diligence, and are not investment advice. Lenders typically require DSCR ≥ 1.25.</p>
          </div>
        </Section>
      </div>

      <Section title="Coverage area & deduplication">
        <div className="grid gap-4 text-sm text-ink-2 md:grid-cols-3">
          <p>
            <b className="text-ink">Region.</b> {(meta?.region.counties ?? ["Franklin"]).join(", ")} County, Ohio: Columbus, Dublin, Westerville, Hilliard, Grove City and
            the other Franklin County communities. Listings and sales elsewhere are dropped at ingestion (the REGION_COUNTIES setting widens this).
          </p>
          <p>
            <b className="text-ink">Duplicates.</b> Brokers often syndicate one listing to several marketplaces. We merge copies by industry, city, price band, and title keywords, and
            keep every source link for provenance.
          </p>
          <p>
            <b className="text-ink">Locations.</b> Sellers rarely publish addresses, so map pins sit at the city (or county) centroid with a small offset and are labeled approximate.
          </p>
        </div>
      </Section>

      <Section title="Recent ingestion runs">
        <div className="overflow-x-auto">
          <table className="tnum w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-semibold">Run</th>
                <th className="py-2 font-semibold">Source</th>
                <th className="py-2 font-semibold">Data as of</th>
                <th className="py-2 text-right font-semibold">Seen</th>
                <th className="py-2 text-right font-semibold">New</th>
                <th className="py-2 text-right font-semibold">Gone</th>
                <th className="py-2 pl-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-1.5">#{r.id}</td>
                  <td className="py-1.5">{r.source_id}</td>
                  <td className="py-1.5">{date(r.as_of)}</td>
                  <td className="py-1.5 text-right">{r.seen}</td>
                  <td className="py-1.5 text-right">{r.created}</td>
                  <td className="py-1.5 text-right">{r.disappeared}</td>
                  <td className="py-1.5 pl-3">
                    <Badge tone={r.status === "ok" ? "good" : "bad"}>{r.status}</Badge> {r.message && <span className="text-xs text-ink-2">{r.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
