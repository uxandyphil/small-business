// Polite, compliant HTTP access for any adapter that fetches remote pages.
//  - robots.txt is fetched and honored (including Crawl-delay)
//  - per-host rate limiting
//  - identifiable User-Agent with a contact URL
//  - hard block on hosts whose terms prohibit automated collection unless an
//    operator has recorded written permission / a license for that host.

export const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ?? "ColumbusBizTracker/0.1 (+https://example.com/bot; respects robots.txt)";

/**
 * Marketplaces whose terms of use restrict automated scraping. Data from these
 * must come through a licensed feed, partner API, or manual export the user is
 * entitled to — never through broker_html crawling.
 */
export const RESTRICTED_HOSTS = ["bizbuysell.com", "bizquest.com", "businessesforsale.com", "loopnet.com", "dealstream.com"];

export function isRestrictedHost(url: string, permittedHosts: string[] = []): boolean {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (permittedHosts.some((h) => host === h || host.endsWith("." + h))) return false;
  return RESTRICTED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelaySec: number | null;
}

/** Parse robots.txt, keeping only the group that applies to our UA (or "*"). */
export function parseRobots(txt: string, ua = USER_AGENT): RobotsRules {
  const uaToken = ua.split("/")[0].toLowerCase();
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let cur: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: { disallow: [], allow: [], crawlDelaySec: null } };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.rules.disallow.push(val);
    else if (key === "allow" && val) cur.rules.allow.push(val);
    else if (key === "crawl-delay") cur.rules.crawlDelaySec = parseFloat(val) || null;
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && uaToken.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  return (specific ?? star)?.rules ?? { disallow: [], allow: [], crawlDelaySec: null };
}

function ruleToRegex(rule: string): RegExp {
  const esc = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + (esc.endsWith("\\$") ? esc.slice(0, -2) + "$" : esc));
}

/** Longest-match wins, Allow beats Disallow on ties (Google/RFC 9309 semantics). */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules.disallow) if (ruleToRegex(r).test(path) && (!best || r.length > best.len)) best = { len: r.length, allow: false };
  for (const r of rules.allow) if (ruleToRegex(r).test(path) && (!best || r.length >= best.len)) best = { len: r.length, allow: true };
  return best ? best.allow : true;
}

const robotsCache = new Map<string, Promise<RobotsRules>>();
const lastHit = new Map<string, number>();

async function getRobots(origin: string): Promise<RobotsRules> {
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      fetch(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT } })
        .then(async (r) => {
          if (r.status >= 500) return { disallow: ["/"], allow: [], crawlDelaySec: null }; // be conservative
          if (!r.ok) return { disallow: [], allow: [], crawlDelaySec: null };
          return parseRobots(await r.text());
        })
        .catch(() => ({ disallow: ["/"], allow: [], crawlDelaySec: null })),
    );
  }
  return robotsCache.get(origin)!;
}

export class ComplianceError extends Error {}

export async function politeFetch(
  url: string,
  opts: { minIntervalMs?: number; permittedHosts?: string[]; accept?: string } = {},
): Promise<string> {
  if (isRestrictedHost(url, opts.permittedHosts)) {
    throw new ComplianceError(
      `${new URL(url).hostname} restricts automated collection in its terms of use. Use a licensed feed or manual export instead.`,
    );
  }
  const u = new URL(url);
  const robots = await getRobots(u.origin);
  if (!robotsAllows(robots, u.pathname + u.search)) {
    throw new ComplianceError(`robots.txt disallows ${u.pathname} on ${u.hostname}`);
  }
  const interval = Math.max(opts.minIntervalMs ?? 3000, (robots.crawlDelaySec ?? 0) * 1000);
  const wait = (lastHit.get(u.host) ?? 0) + interval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(u.host, Date.now());
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: opts.accept ?? "text/html,application/json" } });
  if (res.status === 429) throw new ComplianceError(`Rate limited by ${u.hostname}; stopping this run.`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
