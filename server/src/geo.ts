// Columbus metro geography. Coordinates are municipal centroids (approximate).
// Business-for-sale listings almost never publish a street address, so the map
// plots city-level positions and labels them as approximate.

export const COLUMBUS = { lat: 39.9612, lng: -82.9988 };
/**
 * Counties the tracker covers. Listings and sales elsewhere are dropped at
 * ingestion. Override with REGION_COUNTIES="Franklin,Delaware,Licking".
 */
export const REGION_COUNTIES: string[] = (
  // globalThis lookup keeps this module usable in the browser (static build).
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.REGION_COUNTIES ?? "Franklin"
)
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
const inCounties = (county: string | null | undefined) => county != null && REGION_COUNTIES.includes(county);

export interface Place {
  city: string;
  county: string;
  lat: number;
  lng: number;
}

export const PLACES: Place[] = [
  { city: "Columbus", county: "Franklin", lat: 39.9612, lng: -82.9988 },
  { city: "Dublin", county: "Franklin", lat: 40.0992, lng: -83.1141 },
  { city: "Westerville", county: "Franklin", lat: 40.1262, lng: -82.9291 },
  { city: "Worthington", county: "Franklin", lat: 40.0931, lng: -83.018 },
  { city: "Hilliard", county: "Franklin", lat: 40.0334, lng: -83.1582 },
  { city: "Grove City", county: "Franklin", lat: 39.8815, lng: -83.093 },
  { city: "Gahanna", county: "Franklin", lat: 40.0192, lng: -82.8793 },
  { city: "Reynoldsburg", county: "Franklin", lat: 39.9548, lng: -82.8121 },
  { city: "Upper Arlington", county: "Franklin", lat: 40.027, lng: -83.0624 },
  { city: "Grandview Heights", county: "Franklin", lat: 39.9795, lng: -83.0407 },
  { city: "Bexley", county: "Franklin", lat: 39.9687, lng: -82.9377 },
  { city: "Whitehall", county: "Franklin", lat: 39.9667, lng: -82.8855 },
  { city: "New Albany", county: "Franklin", lat: 40.0812, lng: -82.8088 },
  { city: "Canal Winchester", county: "Franklin", lat: 39.8428, lng: -82.8046 },
  { city: "Groveport", county: "Franklin", lat: 39.8784, lng: -82.8838 },
  { city: "Pickerington", county: "Fairfield", lat: 39.8842, lng: -82.7535 },
  { city: "Lancaster", county: "Fairfield", lat: 39.7137, lng: -82.5993 },
  { city: "Delaware", county: "Delaware", lat: 40.2987, lng: -83.068 },
  { city: "Powell", county: "Delaware", lat: 40.1578, lng: -83.0752 },
  { city: "Lewis Center", county: "Delaware", lat: 40.1984, lng: -83.0102 },
  { city: "Sunbury", county: "Delaware", lat: 40.2426, lng: -82.8591 },
  { city: "Newark", county: "Licking", lat: 40.0581, lng: -82.4013 },
  { city: "Heath", county: "Licking", lat: 40.0228, lng: -82.4446 },
  { city: "Granville", county: "Licking", lat: 40.0681, lng: -82.5196 },
  { city: "Pataskala", county: "Licking", lat: 39.9956, lng: -82.6743 },
  { city: "Johnstown", county: "Licking", lat: 40.1537, lng: -82.6852 },
  { city: "Marysville", county: "Union", lat: 40.2364, lng: -83.3671 },
  { city: "Plain City", county: "Madison", lat: 40.1073, lng: -83.2674 },
  { city: "London", county: "Madison", lat: 39.8865, lng: -83.4483 },
  { city: "Circleville", county: "Pickaway", lat: 39.6006, lng: -82.946 },
  { city: "Ashville", county: "Pickaway", lat: 39.7156, lng: -82.953 },
  { city: "Mount Vernon", county: "Knox", lat: 40.3934, lng: -82.4857 },
  { city: "Marion", county: "Marion", lat: 40.5887, lng: -83.1285 },
  { city: "Chillicothe", county: "Ross", lat: 39.3331, lng: -82.9824 },
];

// County seat / centroid fallbacks when a listing gives only a county.
export const COUNTIES: Record<string, { lat: number; lng: number }> = {
  Franklin: { lat: 39.9695, lng: -83.0091 },
  Delaware: { lat: 40.2789, lng: -83.0047 },
  Licking: { lat: 40.0917, lng: -82.4835 },
  Fairfield: { lat: 39.7514, lng: -82.6305 },
  Pickaway: { lat: 39.6416, lng: -83.0244 },
  Madison: { lat: 39.8965, lng: -83.4006 },
  Union: { lat: 40.2995, lng: -83.3711 },
  Knox: { lat: 40.3988, lng: -82.4215 },
  Marion: { lat: 40.5871, lng: -83.1601 },
  Ross: { lat: 39.3376, lng: -83.0567 },
  Morrow: { lat: 40.5241, lng: -82.7937 },
  Champaign: { lat: 40.1374, lng: -83.7697 },
  Perry: { lat: 39.7375, lng: -82.2361 },
  Hocking: { lat: 39.4970, lng: -82.4791 },
};

// Common neighborhood / suburb aliases that map to a canonical place.
const ALIASES: Record<string, string> = {
  "short north": "Columbus",
  "german village": "Columbus",
  clintonville: "Columbus",
  easton: "Columbus",
  polaris: "Lewis Center",
  "upper arlington": "Upper Arlington",
  ua: "Upper Arlington",
  grandview: "Grandview Heights",
  "columbus metro": "Columbus",
  "central ohio": "Columbus",
  "columbus area": "Columbus",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface ResolvedLocation {
  city: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  precision: "address" | "city" | "county" | "unknown";
  inRegion: boolean;
}

/** Resolve free-text city/county (and optional coordinates) into a canonical Columbus-area place. */
export function resolveLocation(input: {
  city?: string | null;
  county?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
}): ResolvedLocation {
  const state = (input.state ?? "OH").toUpperCase();
  if (state !== "OH" && state !== "OHIO") {
    return { city: input.city ?? null, county: input.county ?? null, lat: null, lng: null, precision: "unknown", inRegion: false };
  }
  const countyIn = input.county ? titleCase(norm(input.county).replace(/ county$/, "")) : null;

  if (input.lat != null && input.lng != null) {
    const nearest = nearestPlace(input.lat, input.lng);
    const county = countyIn ?? nearest.county;
    return {
      city: input.city ? titleCase(norm(input.city)) : nearest.city,
      county,
      lat: input.lat,
      lng: input.lng,
      precision: "address",
      inRegion: inCounties(county),
    };
  }

  if (input.city) {
    const key = norm(input.city.replace(/,?\s*(oh|ohio)\b.*$/i, ""));
    const canonical = ALIASES[key] ?? key;
    const place = PLACES.find((p) => norm(p.city) === norm(canonical));
    if (place) {
      return { city: place.city, county: place.county, lat: place.lat, lng: place.lng, precision: "city", inRegion: inCounties(place.county) };
    }
  }

  if (countyIn && COUNTIES[countyIn]) {
    const c = COUNTIES[countyIn];
    return {
      city: input.city ? titleCase(norm(input.city)) : null,
      county: countyIn,
      lat: c.lat,
      lng: c.lng,
      precision: "county",
      inRegion: inCounties(countyIn),
    };
  }

  return { city: input.city ?? null, county: countyIn, lat: null, lng: null, precision: "unknown", inRegion: false };
}

function nearestPlace(lat: number, lng: number): Place {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = milesBetween(p, { lat, lng });
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
