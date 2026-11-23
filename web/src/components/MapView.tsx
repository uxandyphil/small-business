import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import { jitter, money, pct, type MapPoint } from "../lib";

// Franklin County
const CENTER: [number, number] = [39.97, -83.0];

// Keyless OpenStreetMap tiles by default (fine for light traffic under the OSM
// tile usage policy). For heavier traffic, set VITE_TILE_URL / VITE_TILE_ATTRIBUTION
// at build time to a provider you have an account with.
const CUSTOM_TILES = Boolean(import.meta.env.VITE_TILE_URL);
const TILE_URL: string = import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION: string =
  import.meta.env.VITE_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function useDark() {
  const q = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const read = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : Boolean(q?.matches);
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const on = () => setDark(read());
    q?.addEventListener("change", on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      q?.removeEventListener("change", on);
      mo.disconnect();
    };
  }, []);
  return dark;
}

// ROI tiers on a single-hue sequential ramp (light -> dark = higher return).
const TIERS = [
  { max: 0, color: "var(--seq-1)", label: "< 0%" },
  { max: 40, color: "var(--seq-2)", label: "0–40%" },
  { max: 100, color: "var(--seq-3)", label: "40–100%" },
  { max: Infinity, color: "var(--seq-4)", label: "100%+" },
];
const tierColor = (roi: number | null) => (roi == null ? "var(--muted)" : TIERS.find((t) => roi < t.max)!.color);

function FitOnFocus({ focus }: { focus?: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

export function MapView({
  points,
  height = 420,
  hoverId,
  onHover,
  focus,
}: {
  points: MapPoint[];
  height?: number | string;
  hoverId?: number | null;
  onHover?: (id: number | null) => void;
  focus?: { lat: number; lng: number } | null;
}) {
  const dark = useDark();
  const maxCf = useMemo(() => Math.max(1, ...points.map((p) => p.cashFlow ?? 0)), [points]);
  return (
    <div className={`relative overflow-hidden rounded-xl border border-line ${dark && !CUSTOM_TILES ? "map-dark" : ""}`} style={{ height }}>
      <MapContainer center={CENTER} zoom={10} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        <FitOnFocus focus={focus} />
        {points
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => {
            const [dy, dx] = jitter(p.id, p.precision);
            const r = 5 + 9 * Math.sqrt((p.cashFlow ?? 0) / maxCf);
            const hot = hoverId === p.id;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat! + dy, p.lng! + dx]}
                radius={hot ? r + 3 : r}
                pathOptions={{ color: hot ? "var(--ink)" : p.hot ? "var(--hot)" : "var(--surface)", weight: hot || p.hot ? 2.5 : 1.5, fillColor: tierColor(p.roi), fillOpacity: 0.9 }}
                eventHandlers={{ mouseover: () => onHover?.(p.id), mouseout: () => onHover?.(null) }}
              >
                <Popup>
                  <div className="min-w-48 text-xs">
                    {p.hot && <div className="mb-0.5 text-[11px] font-bold text-hot">🔥 Hot new</div>}
                    <Link to={`/listing/${p.id}`} className="block text-sm font-semibold text-brand">
                      {p.title}
                    </Link>
                    <div className="mt-1 text-ink-2">
                      {p.industry} · {p.city}
                    </div>
                    <div className="tnum mt-1">
                      {money(p.price, { compact: true })} asking · {money(p.cashFlow, { compact: true })} cash flow · ROI {pct(p.roi)}
                    </div>
                    {p.precision !== "address" && <div className="mt-1 text-muted">Approximate location ({p.precision}-level)</div>}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] rounded-lg bg-[var(--surface)]/95 px-2.5 py-2 text-[11px] text-ink-2 shadow">
        <div className="mb-1 font-semibold text-ink">Est. ROI · size = cash flow</div>
        <div className="flex gap-2">
          {TIERS.map((t) => (
            <span key={t.label} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
              {t.label}
            </span>
          ))}
        </div>
        <div className="mt-1 text-muted">
          <span className="font-semibold text-hot">○</span> orange ring = hot new · pins are city-level (approx.)
        </div>
      </div>
    </div>
  );
}
