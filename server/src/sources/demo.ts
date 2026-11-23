// Synthetic demo universe. Every business, broker, and sale here is fictional
// and is labeled as such throughout the UI. It exists so the full pipeline
// (dedupe, price history, disappearance tracking, sale verification, alerts)
// can be exercised end-to-end without scraping anyone.
//
// The demo has three "channels" that mimic real source types:
//   marketplace – a listing marketplace (drops listings when they leave market)
//   broker      – an independent brokerage site (keeps "Sold" tiles for a while)
//   records     – independently verified sale records (public filings / press)
import { PLACES, REGION_COUNTIES } from "../geo.js";
import type { RawListing, RawSale, SourceAdapter } from "./types.js";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  industry: string;
  names: string[];
  revenue: [number, number];
  margin: [number, number]; // SDE / revenue
  multiple: [number, number];
  employees: [number, number];
}

const PROFILES: Profile[] = [
  { industry: "Restaurants & Food", names: ["Neighborhood Pizzeria", "Fast-Casual Taco Restaurant", "Specialty Coffee Shop", "Family Diner", "Craft Brewery Taproom", "Catering Company", "Artisan Bakery", "Sandwich Shop"], revenue: [350e3, 2.2e6], margin: [0.1, 0.2], multiple: [1.6, 2.8], employees: [6, 35] },
  { industry: "Home & Trade Services", names: ["HVAC Contractor", "Residential Plumbing Company", "Commercial Cleaning Company", "Landscaping & Snow Removal", "Pest Control Service", "Roofing Contractor", "Garage Door Service", "Restoration Company"], revenue: [500e3, 4.5e6], margin: [0.15, 0.28], multiple: [2.4, 3.8], employees: [4, 40] },
  { industry: "Automotive", names: ["Express Car Wash", "Auto Repair Shop", "Collision Center", "Tire & Service Center", "Auto Detailing Studio"], revenue: [400e3, 3e6], margin: [0.14, 0.26], multiple: [2.2, 3.6], employees: [4, 22] },
  { industry: "Health & Medical", names: ["Home Health Agency", "Physical Therapy Clinic", "Veterinary Practice", "Chiropractic Practice", "Dental Practice", "Med Spa"], revenue: [600e3, 3.5e6], margin: [0.16, 0.3], multiple: [2.6, 4.5], employees: [6, 45] },
  { industry: "Beauty & Personal Care", names: ["Hair Salon", "Barbershop", "Day Spa", "Nail Salon"], revenue: [200e3, 900e3], margin: [0.15, 0.3], multiple: [1.5, 2.6], employees: [3, 15] },
  { industry: "Manufacturing", names: ["CNC Machine Shop", "Metal Fabrication Company", "Custom Cabinet Manufacturer", "Plastics Molding Company"], revenue: [1.2e6, 7e6], margin: [0.14, 0.24], multiple: [3, 4.8], employees: [8, 60] },
  { industry: "Business Services", names: ["Staffing Agency", "Bookkeeping & Tax Practice", "Insurance Agency", "Sign & Graphics Company", "Digital Marketing Agency"], revenue: [300e3, 2.5e6], margin: [0.2, 0.38], multiple: [2.2, 3.8], employees: [3, 25] },
  { industry: "Retail", names: ["Liquor Store", "Pet Supply Store", "Boutique Clothing Store", "Florist", "Hardware Store", "Convenience Store"], revenue: [400e3, 2.8e6], margin: [0.08, 0.18], multiple: [1.6, 2.8], employees: [3, 18] },
  { industry: "Transportation & Logistics", names: ["Regional Trucking Company", "Courier & Delivery Service", "Moving Company"], revenue: [800e3, 5e6], margin: [0.1, 0.2], multiple: [2.2, 3.4], employees: [8, 50] },
  { industry: "Education & Childcare", names: ["Licensed Childcare Center", "Tutoring Center", "Preschool"], revenue: [400e3, 2e6], margin: [0.15, 0.25], multiple: [2.4, 3.6], employees: [8, 40] },
  { industry: "Technology & IT", names: ["Managed IT Services Provider", "Web Development Agency", "Cybersecurity Consultancy"], revenue: [500e3, 3e6], margin: [0.2, 0.35], multiple: [3, 5], employees: [4, 25] },
  { industry: "Construction", names: ["Concrete Contractor", "Kitchen & Bath Remodeler", "Excavation Company"], revenue: [900e3, 5e6], margin: [0.12, 0.22], multiple: [2.2, 3.4], employees: [6, 35] },
  { industry: "Fitness & Recreation", names: ["Boutique Fitness Studio", "Martial Arts Academy", "Indoor Golf Simulator Venue"], revenue: [250e3, 1.1e6], margin: [0.15, 0.3], multiple: [1.8, 3], employees: [3, 15] },
  { industry: "Wholesale & Distribution", names: ["Janitorial Supply Distributor", "Specialty Food Distributor"], revenue: [1.5e6, 8e6], margin: [0.08, 0.15], multiple: [2.8, 4.2], employees: [6, 30] },
  { industry: "Online & E-commerce", names: ["E-commerce Home Goods Brand", "Subscription Box Business"], revenue: [300e3, 2e6], margin: [0.15, 0.3], multiple: [2.4, 3.8], employees: [1, 8] },
];

const YEAR_MULTIPLE: Record<number, number> = { 2022: 0.94, 2023: 0.96, 2024: 0.99, 2025: 1.02, 2026: 1.05 };
// Relative chance a listing ends in a sale, by industry and listing year (synthetic trends).
const DEMAND: Record<string, Record<number, number>> = {
  "Home & Trade Services": { 2023: 1.0, 2024: 1.15, 2025: 1.25, 2026: 1.3 },
  "Health & Medical": { 2023: 1.05, 2024: 1.1, 2025: 1.2, 2026: 1.2 },
  "Restaurants & Food": { 2023: 0.95, 2024: 0.85, 2025: 0.8, 2026: 0.75 },
  Retail: { 2023: 0.95, 2024: 0.9, 2025: 0.85, 2026: 0.85 },
  "Technology & IT": { 2023: 1.2, 2024: 1.0, 2025: 1.05, 2026: 1.15 },
  "Online & E-commerce": { 2023: 1.1, 2024: 0.9, 2025: 0.95, 2026: 1.0 },
  "Business Services": { 2023: 1.0, 2024: 1.05, 2025: 1.1, 2026: 1.1 },
};

const DESCRIPTORS = ["Established", "Profitable", "Turnkey", "Growing", "Absentee-Run", "Well-Known", "Award-Winning", "Recession-Resistant"];
const BROKERS = ["Scioto Demo Business Brokers", "Olentangy Demo Advisors", "Buckeye Demo M&A"];
const OUT_OF_REGION = [
  { city: "Newark", county: "Licking" },
  { city: "Delaware", county: "Delaware" },
  { city: "Cleveland", county: "Cuyahoga" },
  { city: "Cincinnati", county: "Hamilton" },
  { city: "Toledo", county: "Lucas" },
];

export interface DemoBusiness {
  id: string;
  title: string;
  industry: string;
  isFranchise: boolean;
  city: string;
  county: string;
  revenue: number;
  sde: number;
  ebitda: number | null;
  initialPrice: number;
  priceSchedule: { at: Date; price: number }[];
  employees: number;
  yearEstablished: number;
  listedAt: Date;
  endAt: Date | null;
  pendingAt: Date | null;
  outcome: "active" | "sold_confirmed" | "sold_broker" | "vanished";
  salePrice: number | null;
  saleDate: Date | null;
  onMarketplace: boolean;
  onBroker: boolean;
  broker: string;
  realEstate: boolean;
  description: string;
}

const DAY = 86400e3;
const round = (n: number, to: number) => Math.round(n / to) * to;

// Businesses arrive as a random (Poisson) stream from START to HORIZON. Each
// business's whole life (listing, price cuts, sale or disappearance) is fixed at
// generation, and visibility is decided by the crawl date. So the demo market
// moves forward with the calendar while its past never changes.
const START = new Date("2022-07-01").getTime();
const HORIZON = new Date("2030-12-31").getTime();
const MEAN_DAYS_BETWEEN_LISTINGS = 2.4;

let cache: DemoBusiness[] | null = null;
export function demoUniverse(): DemoBusiness[] {
  if (cache) return cache;
  const rnd = mulberry32(20260101);
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const pickOne = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const covered = PLACES.filter((p) => REGION_COUNTIES.includes(p.county));
  const weighted = (covered.length ? covered : PLACES).flatMap((p) => (p.city === "Columbus" ? Array(6).fill(p) : [p]));
  const out: DemoBusiness[] = [];
  let arrival = START;
  for (let i = 0; ; i++) {
    arrival += -Math.log(1 - rnd()) * MEAN_DAYS_BETWEEN_LISTINGS * DAY;
    if (arrival > HORIZON) break;
    const prof = pickOne(PROFILES);
    const outOfRegion = rnd() < 0.04;
    const place = outOfRegion ? pickOne(OUT_OF_REGION) : pickOne(weighted);
    const listedAt = new Date(arrival);
    const yr = Math.min(listedAt.getUTCFullYear(), 2026); // trends hold flat after 2026
    const revenue = round(between(...prof.revenue), 5000);
    const sde = round(revenue * between(...prof.margin), 1000);
    // Gentle market drift so year-over-year comparisons have something to show.
    const multiple = between(...prof.multiple) * (YEAR_MULTIPLE[yr] ?? 1) * (rnd() < 0.08 ? 1.6 : 1); // a few overpriced listings
    const realEstate = rnd() < 0.08;
    const initialPrice = round(sde * multiple + (realEstate ? between(300e3, 900e3) : 0), 5000);
    const descriptor = pickOne(DESCRIPTORS);
    const baseName = pickOne(prof.names);
    const isFranchise = rnd() < 0.12;
    const title = `${descriptor} ${isFranchise ? "Franchise " : ""}${baseName} in ${place.city}`;

    // Price drops
    const schedule: { at: Date; price: number }[] = [{ at: listedAt, price: initialPrice }];
    let p = initialPrice;
    let t = listedAt.getTime();
    const drops = rnd() < 0.35 ? (rnd() < 0.3 ? 2 : 1) : 0;
    for (let d = 0; d < drops; d++) {
      t += between(35, 110) * DAY;
      p = round(p * between(0.85, 0.95), 5000);
      schedule.push({ at: new Date(t), price: p });
    }

    // Lifecycle
    const durationDays = between(50, 330);
    const endAt = new Date(listedAt.getTime() + durationDays * DAY);
    const r = rnd();
    const soldP = Math.min(0.85, 0.55 * (DEMAND[prof.industry]?.[yr] ?? 1));
    const outcome: DemoBusiness["outcome"] = r < soldP * 0.55 ? "sold_confirmed" : r < soldP ? "sold_broker" : "vanished";
    const pendingAt = outcome !== "vanished" ? new Date(endAt.getTime() - between(20, 45) * DAY) : null;
    const priceAt = (d: Date) => schedule.filter((s) => s.at <= d).at(-1)?.price ?? initialPrice;
    const saleDate = outcome !== "vanished" ? new Date(endAt.getTime() - between(0, 6) * DAY) : null;
    const salePrice =
      saleDate && (outcome === "sold_confirmed" || rnd() < 0.5) ? round(priceAt(saleDate) * between(0.82, 0.99), 5000) : null;
    const yearEstablished = Math.round(between(1972, 2021));
    const employees = Math.round(between(...prof.employees));
    const onBroker = rnd() < 0.45;
    const onMarketplace = !onBroker || rnd() < 0.7; // syndicated listings appear on both
    out.push({
      id: `D${(1000 + i).toString()}`,
      title,
      industry: prof.industry,
      isFranchise,
      city: place.city,
      county: place.county,
      revenue,
      sde,
      ebitda: rnd() < 0.3 ? round(sde * between(0.55, 0.75), 1000) : null,
      initialPrice,
      priceSchedule: schedule,
      employees,
      yearEstablished,
      listedAt,
      endAt,
      pendingAt,
      outcome,
      salePrice,
      saleDate,
      onMarketplace,
      onBroker,
      broker: pickOne(BROKERS),
      realEstate,
      description: `${descriptor} ${baseName.toLowerCase()} serving ${place.city} and greater ${place.county} County since ${yearEstablished}. ${employees} employees${realEstate ? "; real estate included in asking price" : ""}. Synthetic demo listing — not a real business.`,
    });
  }
  cache = out;
  return out;
}

function priceAt(b: DemoBusiness, d: Date): number {
  return b.priceSchedule.filter((s) => s.at <= d).at(-1)?.price ?? b.initialPrice;
}

function toRaw(b: DemoBusiness, asOf: Date, channel: "marketplace" | "broker"): RawListing {
  const pending = b.pendingAt && asOf >= b.pendingAt;
  const soldOnBroker = channel === "broker" && b.endAt && asOf >= b.endAt && b.outcome !== "vanished";
  // Marketplace copies sometimes omit revenue; broker copies sometimes omit SDE —
  // the pipeline should merge the best available fields across sources.
  const hideRevenue = channel === "marketplace" && parseInt(b.id.slice(1)) % 9 === 0;
  return {
    externalId: channel === "marketplace" ? `MK-${b.id}` : `BR-${b.id}`,
    url: `https://example.com/demo/${channel}/${b.id}`,
    title: channel === "broker" ? `Turnkey ${b.title.replace(/^Turnkey /, "")}` : b.title,
    description: b.description,
    industry: b.industry,
    isFranchise: b.isFranchise,
    city: b.city,
    county: b.county,
    state: "OH",
    askingPrice: priceAt(b, asOf),
    revenue: hideRevenue ? null : b.revenue,
    cashFlow: b.sde,
    ebitda: b.ebitda,
    employees: b.employees,
    yearEstablished: b.yearEstablished,
    realEstateIncluded: b.realEstate,
    listedAt: b.listedAt.toISOString().slice(0, 10),
    brokerName: channel === "broker" ? b.broker : null,
    financialsBasis: channel === "broker" ? "broker_verified" : "seller_reported",
    sourceStatus: soldOnBroker ? "sold" : pending ? "pending" : "active",
  };
}

export const demoAdapter: SourceAdapter = {
  id: "demo",
  async fetch({ asOf, config }) {
    const channel = String(config.channel ?? "marketplace") as "marketplace" | "broker" | "records";
    const all = demoUniverse();
    if (channel === "records") {
      const sales: RawSale[] = all
        .filter((b) => b.outcome === "sold_confirmed" && b.saleDate && b.saleDate.getTime() + 21 * DAY <= asOf.getTime())
        .map((b, i) => ({
          businessName: b.title,
          externalListingId: b.onMarketplace ? `MK-${b.id}` : `BR-${b.id}`,
          industry: b.industry,
          city: b.city,
          county: b.county,
          salePrice: b.salePrice,
          saleDate: b.saleDate!.toISOString().slice(0, 10),
          verification: "confirmed",
          evidenceType: i % 3 === 0 ? "press_release" : "public_record",
          evidenceUrl: `https://example.com/demo/records/${b.id}`,
          evidenceNote: i % 3 === 0 ? "Synthetic press release announcing the acquisition." : "Synthetic county filing (bulk sale / UCC / liquor permit transfer).",
        }));
      return { listings: [], sales, complete: false };
    }
    const listings: RawListing[] = [];
    const sales: RawSale[] = [];
    for (const b of all) {
      const onChannel = channel === "marketplace" ? b.onMarketplace : b.onBroker;
      if (!onChannel || b.listedAt > asOf) continue;
      // Marketplace removes at endAt; broker keeps "Sold" tile ~5 weeks.
      const removeAt = b.endAt ? (channel === "broker" && b.outcome !== "vanished" ? b.endAt.getTime() + 35 * DAY : b.endAt.getTime()) : Infinity;
      if (asOf.getTime() >= removeAt) continue;
      listings.push(toRaw(b, asOf, channel));
      if (channel === "broker" && b.endAt && asOf >= b.endAt && b.outcome !== "vanished") {
        sales.push({
          businessName: b.title,
          externalListingId: `BR-${b.id}`,
          industry: b.industry,
          city: b.city,
          county: b.county,
          salePrice: b.outcome === "sold_broker" ? b.salePrice : null, // brokers often withhold price
          saleDate: b.saleDate?.toISOString().slice(0, 10) ?? null,
          verification: "broker_reported",
          evidenceType: "broker_closed_deal",
          evidenceUrl: `https://example.com/demo/broker/${b.id}`,
          evidenceNote: `Marked "Sold" on ${b.broker} website (synthetic).`,
        });
      }
    }
    return { listings, sales, complete: true };
  },
};
