import { useEffect, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { date, STATIC_MODE, useApi, type Meta } from "./lib";

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => {
    try {
      return localStorage.getItem("cbt.theme");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem("cbt.theme", theme);
      else localStorage.removeItem("cbt.theme");
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const next = theme === null ? "dark" : theme === "dark" ? "light" : null;
  const label = theme === null ? "Auto" : theme === "dark" ? "Dark" : "Light";
  return (
    <button className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-2" onClick={() => setTheme(next)} title="Toggle theme">
      {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"} {label}
    </button>
  );
}

function Bell() {
  const { data } = useApi<{ unread: number }>("/api/notifications");
  return (
    <Link to="/saved" className="relative rounded-lg px-2 py-1 text-lg text-ink-2 hover:bg-surface-2" aria-label={`Alerts${data?.unread ? `, ${data.unread} unread` : ""}`}>
      <span aria-hidden>🔔</span>
      {!!data?.unread && (
        <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-4 text-white">{data.unread}</span>
      )}
    </Link>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/browse", label: "Browse" },
  { to: "/sold", label: "Sold" },
  { to: "/saved", label: STATIC_MODE ? "Saved" : "Saved & alerts" },
  { to: "/sources", label: "Data & methodology" },
];

export default function App() {
  const { data: meta } = useApi<Meta>("/api/meta");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-[1000] border-b border-line bg-[var(--surface)]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
            <span className="text-[15px] font-extrabold tracking-tight text-ink">
              Columbus<span className="text-brand">Biz</span>Tracker
            </span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {!STATIC_MODE && <Bell />}
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `shrink-0 rounded-lg px-3 py-1 text-sm font-semibold ${isActive ? "bg-brand-soft text-brand" : "text-ink-2"}`}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {STATIC_MODE && (
        <div className="border-b border-line bg-brand-soft">
          <div className="mx-auto max-w-[1400px] px-4 py-2 text-sm text-brand">
            <b>Read-only snapshot</b> as of {date(meta?.lastUpdated)}. Favorites are saved in this browser only; alerts and live data collection need the full
            server version.
          </div>
        </div>
      )}
      {meta?.demoMode && (
        <div className="border-b border-line bg-warn-soft">
          <div className="mx-auto max-w-[1400px] px-4 py-2 text-sm text-warn">
            <b>Demo data.</b> Listings and sales shown are synthetic and fictional, generated to demonstrate the pipeline. Connect licensed feeds, broker
            feeds, or CSV imports on the <Link to="/sources" className="font-semibold underline">Data &amp; methodology</Link> page to track real businesses.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-[1400px] px-4 py-5">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-4 text-xs text-muted">
        Financials are as reported by sellers or brokers and are not audited. Owner income and ROI are estimates under stated assumptions, not
        investment advice. Last data refresh: {date(meta?.lastUpdated)}.
      </footer>
    </div>
  );
}
