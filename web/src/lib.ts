import { useCallback, useEffect, useState } from "react";
import type { FinanceAssumptions, FinanceResult } from "../../server/src/finance";

export type { FinanceAssumptions, FinanceResult };

export interface SourceRef {
  source_id: string;
  source_name: string;
  source_kind: string;
  url: string | null;
  broker_name: string | null;
  present: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export interface Sale {
  id: number;
  listing_id: number | null;
  business_name: string;
  industry: string | null;
  city: string | null;
  county: string | null;
  sale_price: number | null;
  sale_date: string | null;
  verification: "confirmed" | "broker_reported";
  evidence_type: string;
  evidence_url: string | null;
  evidence_note: string | null;
  source_id: string;
  source_name?: string;
}

export interface Listing {
  id: number;
  title: string;
  description: string | null;
  industry: string;
  is_franchise: boolean;
  city: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  location_precision: "address" | "city" | "county" | "unknown";
  asking_price: number | null;
  revenue: number | null;
  cash_flow_sde: number | null;
  ebitda: number | null;
  inventory: number | null;
  ffe: number | null;
  real_estate_included: boolean;
  employees: number | null;
  year_established: number | null;
  financials_basis: "seller_reported" | "broker_verified" | "cpa_reviewed";
  status: "active" | "pending" | "sold" | "off_market";
  status_changed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  listed_at: string | null;
  finance: FinanceResult;
  sources: SourceRef[];
  original_price: number | null;
  price_reduced: boolean;
  days_on_market: number;
  sale: Sale | null;
}

export interface MapPoint {
  id: number;
  title: string;
  industry: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  precision: string;
  price: number | null;
  cashFlow: number | null;
  roi: number | null;
  status: string;
}

export interface Meta {
  industries: string[];
  counties: { name: string; c: number }[];
  cities: { name: string; county: string; c: number }[];
  region: { center: { lat: number; lng: number }; radiusMiles: number };
  demoMode: boolean;
  realListingCount: number;
  lastUpdated: string | null;
  defaultAssumptions: FinanceAssumptions;
}

// ---- Anonymous device identity (favorites & alerts are tied to it)
export function userId(): string {
  const KEY = "cbt.userId";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anonymous-session";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "X-User-Id": userId(), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// ---- Formatting
export function money(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 0) return `−${money(-v, opts)}`;
  if (opts.compact) {
    const a = Math.abs(v);
    if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
    if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  }
  return `$${Math.round(v).toLocaleString("en-US")}`;
}
export const pct = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`);
export const mult = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const daysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400e3));

export const STATUS_LABEL: Record<Listing["status"], string> = {
  active: "For sale",
  pending: "Under contract",
  sold: "Sold",
  off_market: "Off market",
};
export const BASIS_LABEL: Record<Listing["financials_basis"], string> = {
  seller_reported: "Seller-reported",
  broker_verified: "Broker-reviewed",
  cpa_reviewed: "CPA-reviewed",
};
export const EVIDENCE_LABEL: Record<string, string> = {
  public_record: "Public record",
  press_release: "Press release",
  news: "News report",
  broker_closed_deal: "Broker 'Sold' notice",
  party_confirmation: "Buyer/seller confirmation",
};

/** Small deterministic jitter so listings sharing a city centroid don't stack exactly. */
export function jitter(id: number, precision: string): [number, number] {
  if (precision === "address") return [0, 0];
  const a = ((id * 2654435761) % 360) * (Math.PI / 180);
  const r = (((id * 40503) % 100) / 100) * (precision === "county" ? 0.05 : 0.018);
  return [Math.sin(a) * r, Math.cos(a) * r];
}
