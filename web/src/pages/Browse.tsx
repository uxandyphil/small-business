import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { MapView } from "../components/MapView";
import { Empty, ListingCard, Loading } from "../components/ui";
import { api, money, mult, pct, STATIC_MODE, useApi, type Listing, type MapPoint, type Meta } from "../lib";

interface SearchResult {
  total: number;
  items: Listing[];
  summary: { medianAsking: number | null; medianCashFlow: number | null; medianMultiple: number | null; medianCashOnCash: number | null };
  mapPoints: MapPoint[];
}

const SORTS = [
  ["newest", "Newest"],
  ["roi_desc", "Highest est. ROI"],
  ["owner_income_desc", "Highest owner income"],
  ["cash_flow_desc", "Highest cash flow"],
  ["multiple_asc", "Lowest multiple"],
  ["dscr_desc", "Strongest debt coverage"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["revenue_desc", "Highest revenue"],
] as const;

const PRICE_STEPS = [100e3, 250e3, 500e3, 750e3, 1e6, 1.5e6, 2e6, 3e6, 5e6];
const CF_STEPS = [50e3, 100e3, 150e3, 200e3, 300e3, 500e3, 750e3, 1e6];
const ASSUMPTION_KEYS = ["downPaymentPct", "sbaRatePct", "sbaTermYears", "sellerNotePct", "ownerMarketSalary"] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="border-b border-line py-3 last:border-0">
      <summary className="cursor-pointer select-none text-sm font-bold text-ink">{title}</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"split" | "list" | "map">("split");
  const [alertOpen, setAlertOpen] = useState(false);
  const { data: meta } = useApi<Meta>("/api/meta");
  const { data: favs } = useApi<{ items: Listing[] }>("/api/favorites");
  const favIds = new Set(favs?.items.map((f) => f.id));

  const query = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("map", "1");
    if (!p.get("limit")) p.set("limit", "60");
    return p.toString();
  }, [params]);
  const { data, loading } = useApi<SearchResult>(`/api/listings?${query}`);

  const get = (k: string) => params.get(k) ?? "";
  const getList = (k: string) => (params.get(k) ? params.get(k)!.split(",") : []);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
    p.delete("offset");
    setParams(p, { replace: true });
  };
  const toggleIn = (k: string, v: string) => {
    const cur = new Set(getList(k));
    cur.has(v) ? cur.delete(v) : cur.add(v);
    set(k, [...cur].join(","));
  };
  const filterCount = [...params.keys()].filter((k) => !["sort", "limit", "offset", ...ASSUMPTION_KEYS].includes(k)).length;

  const select = (k: string, steps: number[], placeholder: string) => (
    <select className="input" value={get(k)} onChange={(e) => set(k, e.target.value)}>
      <option value="">{placeholder}</option>
      {steps.map((s) => (
        <option key={s} value={s}>
          {money(s, { compact: true })}
        </option>
      ))}
    </select>
  );

  const statuses = getList("status");
  const filters = (
    <div className="card px-4 py-1">
      <Group title="Status">
        {[
          ["active", "For sale"],
          ["pending", "Under contract"],
          ["sold", "Sold (research)"],
          ["off_market", "Off market (research)"],
        ].map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={statuses.length ? statuses.includes(v) : v === "active" || v === "pending"}
              onChange={() => {
                const base = statuses.length ? statuses : ["active", "pending"];
                const s = new Set(base);
                s.has(v) ? s.delete(v) : s.add(v);
                set("status", [...s].join(",") || "active");
              }}
            />
            {label}
          </label>
        ))}
      </Group>
      <Group title="Price & financials">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min price">{select("minPrice", PRICE_STEPS, "Any")}</Field>
          <Field label="Max price">{select("maxPrice", PRICE_STEPS, "Any")}</Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min cash flow">{select("minCashFlow", CF_STEPS, "Any")}</Field>
          <Field label="Min revenue">{select("minRevenue", [250e3, 500e3, 1e6, 2e6, 5e6], "Any")}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={get("hasFinancials") === "true"} onChange={(e) => set("hasFinancials", e.target.checked ? "true" : null)} />
          Price and cash flow disclosed
        </label>
      </Group>
      <Group title="Profitability">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min est. ROI">
            <select className="input" value={get("minRoi")} onChange={(e) => set("minRoi", e.target.value)}>
              <option value="">Any</option>
              {[0, 25, 50, 75, 100, 150].map((v) => (
                <option key={v} value={v}>
                  {v}%+
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max multiple">
            <select className="input" value={get("maxMultiple")} onChange={(e) => set("maxMultiple", e.target.value)}>
              <option value="">Any</option>
              {[2, 2.5, 3, 3.5, 4, 5].map((v) => (
                <option key={v} value={v}>
                  ≤ {v}x
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min owner income">{select("minOwnerIncome", [50e3, 100e3, 150e3, 200e3, 300e3, 500e3], "Any")}</Field>
          <Field label="Min DSCR">
            <select className="input" value={get("minDscr")} onChange={(e) => set("minDscr", e.target.value)}>
              <option value="">Any</option>
              {[1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v.toFixed(2)}x+
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Group>
      <Group title="Industry" defaultOpen={false}>
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {meta?.industries.map((i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={getList("industry").includes(i)} onChange={() => toggleIn("industry", i)} />
              {i}
            </label>
          ))}
        </div>
      </Group>
      <Group title="Community" defaultOpen={false}>
        <div className={`space-y-1.5 ${(meta?.counties.length ?? 0) <= 1 ? "hidden" : ""}`}>
          {meta?.counties.map((c) => (
            <label key={c.name} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={getList("county").includes(c.name)} onChange={() => toggleIn("county", c.name)} />
                {c.name} County
              </span>
              <span className="tnum text-xs text-muted">{c.c}</span>
            </label>
          ))}
        </div>
        <Field label="City">
          <select className="input" value={get("city")} onChange={(e) => set("city", e.target.value)}>
            <option value="">Any city</option>
            {meta?.cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.c})
              </option>
            ))}
          </select>
        </Field>
      </Group>
      <Group title="Business" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Years in business">
            <select className="input" value={get("minYears")} onChange={(e) => set("minYears", e.target.value)}>
              <option value="">Any</option>
              {[3, 5, 10, 20].map((v) => (
                <option key={v} value={v}>
                  {v}+ years
                </option>
              ))}
            </select>
          </Field>
          <Field label="Employees">
            <select className="input" value={get("minEmployees")} onChange={(e) => set("minEmployees", e.target.value)}>
              <option value="">Any</option>
              {[5, 10, 25, 50].map((v) => (
                <option key={v} value={v}>
                  {v}+
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Franchise">
          <select className="input" value={get("franchise")} onChange={(e) => set("franchise", e.target.value)}>
            <option value="">Any</option>
            <option value="only">Franchises only</option>
            <option value="exclude">Exclude franchises</option>
          </select>
        </Field>
        <Field label="Real estate">
          <select className="input" value={get("realEstate")} onChange={(e) => set("realEstate", e.target.value)}>
            <option value="">Any</option>
            <option value="only">Includes real estate</option>
            <option value="exclude">Business only</option>
          </select>
        </Field>
      </Group>
      <Group title="Activity" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={get("hotNew") === "true"} onChange={(e) => set("hotNew", e.target.checked ? "true" : null)} />
          🔥 Hot new (last 3 days)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={get("newWithinDays") === "14"} onChange={(e) => set("newWithinDays", e.target.checked ? "14" : null)} />
          Newly listed (14 days)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={get("priceReduced") === "true"} onChange={(e) => set("priceReduced", e.target.checked ? "true" : null)} />
          Price reduced
        </label>
      </Group>
      <Group title="Financing assumptions" defaultOpen={false}>
        <p className="text-xs text-ink-2">ROI and owner income recalculate for every listing.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Down payment %">
            <input className="input" type="number" min={0} max={100} placeholder="10" value={get("downPaymentPct")} onChange={(e) => set("downPaymentPct", e.target.value)} />
          </Field>
          <Field label="Seller note %">
            <input className="input" type="number" min={0} max={90} placeholder="10" value={get("sellerNotePct")} onChange={(e) => set("sellerNotePct", e.target.value)} />
          </Field>
          <Field label="SBA rate %">
            <input className="input" type="number" step={0.25} placeholder="10.5" value={get("sbaRatePct")} onChange={(e) => set("sbaRatePct", e.target.value)} />
          </Field>
          <Field label="Term (yrs)">
            <input className="input" type="number" placeholder="10" value={get("sbaTermYears")} onChange={(e) => set("sbaTermYears", e.target.value)} />
          </Field>
        </div>
        <Field label="Your market salary">
          <input className="input" type="number" step={5000} placeholder="75000" value={get("ownerMarketSalary")} onChange={(e) => set("ownerMarketSalary", e.target.value)} />
        </Field>
      </Group>
      {filterCount > 0 && (
        <div className="py-3">
          <button className="btn w-full justify-center" onClick={() => setParams(new URLSearchParams(params.get("sort") ? { sort: params.get("sort")! } : {}))}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );

  const items = data?.items ?? [];
  const showList = view !== "map";
  const showMap = view !== "list";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <input
            className="input !py-2 !pl-9"
            placeholder="Search industry, city, keyword…"
            defaultValue={get("q")}
            onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)}
            onBlur={(e) => set("q", e.target.value)}
          />
          <span className="pointer-events-none absolute left-3 top-2 text-muted" aria-hidden>
            ⌕
          </span>
        </div>
        <button className="btn lg:hidden" onClick={() => setShowFilters((s) => !s)}>
          Filters{filterCount ? ` (${filterCount})` : ""}
        </button>
        <select className="input !w-auto" value={get("sort") || "newest"} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <div className="hidden rounded-lg border border-line-strong p-0.5 sm:flex" role="group" aria-label="View">
          {(["split", "list", "map"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-sm font-semibold capitalize ${view === v ? "bg-brand text-brand-ink" : "text-ink-2"}`}>
              {v}
            </button>
          ))}
        </div>
        {!STATIC_MODE && (
          <button className="btn btn-primary" onClick={() => setAlertOpen(true)}>
            🔔 Alert me
          </button>
        )}
      </div>

      {alertOpen && <AlertDialog params={params} onClose={() => setAlertOpen(false)} />}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className={`${showFilters ? "block" : "hidden"} lg:block`}>{filters}</aside>
        <div className="min-w-0">
          <div className="tnum mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-ink-2">
            <span>
              <b className="text-lg text-ink">{data?.total ?? "…"}</b> businesses
            </span>
            <button
              onClick={() => set("hotNew", get("hotNew") === "true" ? null : "true")}
              aria-pressed={get("hotNew") === "true"}
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${get("hotNew") === "true" ? "bg-[var(--hot)] text-white" : "bg-hot-soft text-hot"}`}
            >
              🔥 Hot new only
            </button>
            {data && (
              <>
                <span>Median ask <b className="text-ink">{money(data.summary.medianAsking, { compact: true })}</b></span>
                <span>Median CF <b className="text-ink">{money(data.summary.medianCashFlow, { compact: true })}</b></span>
                <span>Median multiple <b className="text-ink">{mult(data.summary.medianMultiple)}</b></span>
                <span>Median est. ROI <b className="text-ink">{pct(data.summary.medianCashOnCash)}</b></span>
              </>
            )}
          </div>
          <div className={`grid gap-4 ${showList && showMap ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
            {showList && (
              <div className={`grid content-start gap-3 ${!showMap ? "md:grid-cols-2 2xl:grid-cols-3" : ""}`}>
                {loading && !data && <Loading />}
                {data && items.length === 0 && <Empty>No businesses match these filters. Try widening price or profitability limits.</Empty>}
                {items.map((l) => (
                  <div key={l.id} onMouseEnter={() => setHoverId(l.id)} onMouseLeave={() => setHoverId(null)}>
                    <ListingCard l={l} favorite={favIds.has(l.id)} highlight={hoverId === l.id} />
                  </div>
                ))}
                {data && data.total > items.length && (
                  <button className="btn justify-center" onClick={() => set("limit", String(items.length + 60))}>
                    Show more ({data.total - items.length} remaining)
                  </button>
                )}
              </div>
            )}
            {showMap && (
              <div className={showList ? "order-first xl:order-none" : ""}>
                <div className={`xl:sticky xl:top-20 ${showList ? "h-72 sm:h-96 xl:h-[calc(100vh-140px)]" : "h-[75vh]"}`}>
                  <MapView points={data?.mapPoints ?? []} height="100%" hoverId={hoverId} onHover={setHoverId} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertDialog({ params, onClose }: { params: URLSearchParams; onClose: () => void }) {
  const filters = Object.fromEntries([...params.entries()].filter(([k]) => !["limit", "offset", "map", "sort"].includes(k)));
  const summary = Object.entries(filters).map(([k, v]) => `${k}: ${v}`).join(" · ") || "All active listings";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [opts, setOpts] = useState({ notifyNew: true, notifyPriceDrop: true, notifyStatus: true });
  const [state, setState] = useState<"idle" | "saving" | "done" | string>("idle");
  const save = async () => {
    setState("saving");
    try {
      await api("/api/alerts", { method: "POST", body: JSON.stringify({ name: name || "My search", filters, email, ...opts }) });
      setState("done");
    } catch (e) {
      setState((e as Error).message);
    }
  };
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create alert">
        {state === "done" ? (
          <>
            <h2 className="text-lg font-bold">Alert saved</h2>
            <p className="mt-2 text-sm text-ink-2">You'll be notified on the Saved &amp; alerts page{email ? ` and by email at ${email}` : ""} whenever new data matches.</p>
            <button className="btn btn-primary mt-4" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold">Alert me about this search</h2>
            <p className="mt-1 break-words text-xs text-ink-2">{summary}</p>
            <div className="mt-4 space-y-3">
              <Field label="Alert name">
                <input className="input" placeholder="e.g. Home services under $1M" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email (optional)">
                <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {(
                [
                  ["notifyNew", "New matching listings"],
                  ["notifyPriceDrop", "Price reductions"],
                  ["notifyStatus", "Under contract / sold / off market"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                  {l}
                </label>
              ))}
            </div>
            {state !== "idle" && state !== "saving" && <p className="mt-3 text-sm text-bad">{state}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={state === "saving"}>
                Save alert
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
