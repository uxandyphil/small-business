// Normalization of raw, inconsistent listing data from many sources.

export const INDUSTRIES = [
  "Restaurants & Food",
  "Retail",
  "Home & Trade Services",
  "Business Services",
  "Automotive",
  "Health & Medical",
  "Beauty & Personal Care",
  "Manufacturing",
  "Construction",
  "Transportation & Logistics",
  "Wholesale & Distribution",
  "Technology & IT",
  "Education & Childcare",
  "Hospitality & Entertainment",
  "Fitness & Recreation",
  "Online & E-commerce",
  "Agriculture",
  "Other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

// Ordered: first match wins, so more specific patterns come first.
const INDUSTRY_RULES: [RegExp, Industry][] = [
  [/e-?commerce|amazon|shopify|online store|website|saas|subscription box/i, "Online & E-commerce"],
  [/day ?care|childcare|preschool|tutor|learning center|school|education/i, "Education & Childcare"],
  [/salon|barber|spa\b|nail|med ?spa|esthetic|tanning|beauty|lash/i, "Beauty & Personal Care"],
  [/gym|fitness|yoga|pilates|martial arts|crossfit|golf|bowling|recreation/i, "Fitness & Recreation"],
  [/restaurant|pizza|cafe|coffee|bakery|bar\b|brewery|tavern|grill|food truck|catering|deli|ice cream|donut|sandwich|taco|diner|kitchen/i, "Restaurants & Food"],
  [/hotel|motel|inn\b|event venue|entertainment|banquet|arcade/i, "Hospitality & Entertainment"],
  [/dental|dentist|medical|clinic|pharmacy|home health|chiropract|physical therapy|veterinar|optometr|senior care|hospice/i, "Health & Medical"],
  [/auto|car wash|collision|tire|towing|oil change|mechanic|transmission|detailing|dealership/i, "Automotive"],
  [/hvac|plumb|electric(al)? contractor|roof|landscap|lawn|pest|cleaning|janitorial|maid|pool service|handyman|restoration|painting|garage door|tree service|home service/i, "Home & Trade Services"],
  [/construction|contractor|excavat|concrete|remodel|builder|paving/i, "Construction"],
  [/manufactur|machin|fabricat|cnc|printing plant|plastics|metal/i, "Manufacturing"],
  [/trucking|logistics|freight|courier|delivery|moving|transport|limo/i, "Transportation & Logistics"],
  [/wholesale|distribut|supply/i, "Wholesale & Distribution"],
  [/it services|managed service|software|tech|computer|cyber|web dev|msp/i, "Technology & IT"],
  [/farm|agri|nursery|greenhouse|orchard/i, "Agriculture"],
  [/staffing|accounting|bookkeeping|insurance agency|marketing|consult|payroll|sign company|print shop|business service|cpa/i, "Business Services"],
  [/retail|store|shop|boutique|liquor|convenience|gas station|florist|pet supply|hardware/i, "Retail"],
];

export function normalizeIndustry(raw: string | null | undefined, title?: string | null): Industry {
  const exact = INDUSTRIES.find((i) => i.toLowerCase() === (raw ?? "").toLowerCase());
  if (exact) return exact;
  const hay = `${raw ?? ""} ${title ?? ""}`;
  for (const [re, ind] of INDUSTRY_RULES) if (re.test(hay)) return ind;
  return "Other";
}

/**
 * Parse loose money strings: "$1,250,000", "1.25M", "$450K", "450k+", "Not Disclosed".
 * Returns null for undisclosed / unparseable values rather than guessing.
 */
export function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v).trim().toLowerCase();
  if (!s || /not disclosed|undisclosed|call|contact|n\/a|tbd|negotiable|request/.test(s)) return null;
  const m = s.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(k|m|mm|million|thousand|b)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2];
  if (unit === "k" || unit === "thousand") n *= 1e3;
  else if (unit === "m" || unit === "mm" || unit === "million") n *= 1e6;
  else if (unit === "b") n *= 1e9;
  return n >= 0 ? Math.round(n) : null;
}

export function parseIntLoose(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const m = String(v).replace(/,/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** "Established 2009", "15 years", 2009 -> 2009 (relative to the observation year). */
export function parseYearEstablished(v: unknown, asOfYear: number): number | null {
  if (v == null || v === "") return null;
  const s = String(v);
  const year = s.match(/\b(19|20)\d{2}\b/);
  if (year) return parseInt(year[0], 10);
  const yrs = s.match(/(\d+)\s*(\+)?\s*(years|yrs)/i);
  if (yrs) return asOfYear - parseInt(yrs[1], 10);
  const n = parseIntLoose(s);
  if (n != null && n > 1800 && n <= asOfYear) return n;
  if (n != null && n < 150) return asOfYear - n;
  return null;
}

/**
 * Cross-source dedupe key. Brokers syndicate the same listing to BizBuySell,
 * BizQuest and their own site with slightly different titles, so we key on
 * industry + city + price bucket + a few title tokens.
 */
export function fingerprint(l: { title: string; industry: string; city: string | null; asking_price: number | null }): string {
  const stop = new Set(["the", "a", "an", "for", "sale", "in", "of", "and", "business", "ohio", "oh", "columbus", "area", "established", "profitable", "turnkey", "with", "llc", "inc"]);
  const tokens = l.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t))
    .sort()
    .slice(0, 4)
    .join("-");
  const priceBucket = l.asking_price ? Math.round(Math.log(l.asking_price) * 20) : "na"; // ~5% buckets
  return [l.industry, (l.city ?? "").toLowerCase(), priceBucket, tokens].join("|");
}
