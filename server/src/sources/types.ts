// Contract between source adapters and the ingestion pipeline.

export interface RawListing {
  externalId: string;
  url?: string | null;
  title: string;
  description?: string | null;
  industry?: string | null;
  isFranchise?: boolean;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  askingPrice?: number | string | null;
  revenue?: number | string | null;
  cashFlow?: number | string | null; // SDE / seller's discretionary earnings
  ebitda?: number | string | null;
  inventory?: number | string | null;
  ffe?: number | string | null;
  realEstateIncluded?: boolean;
  employees?: number | string | null;
  yearEstablished?: number | string | null;
  listedAt?: string | null;
  brokerName?: string | null;
  financialsBasis?: "seller_reported" | "broker_verified" | "cpa_reviewed";
  /** What the source itself says. "sold" here is only a broker claim, not a verified sale. */
  sourceStatus?: "active" | "pending" | "sold";
}

export interface RawSale {
  businessName: string;
  externalListingId?: string | null; // links the sale to a listing from the same source
  industry?: string | null;
  city?: string | null;
  county?: string | null;
  salePrice?: number | string | null;
  saleDate?: string | null;
  verification: "confirmed" | "broker_reported";
  evidenceType: "public_record" | "press_release" | "news" | "broker_closed_deal" | "party_confirmation";
  evidenceUrl?: string | null;
  evidenceNote?: string | null;
}

export interface FetchResult {
  listings: RawListing[];
  sales?: RawSale[];
  /**
   * True when `listings` is the source's full current inventory. Only complete
   * crawls may mark a missing listing as disappeared; partial crawls (one page
   * failed, rate limit hit) must never be read as "the business went away".
   */
  complete: boolean;
  notes?: string[];
}

export interface SourceContext {
  asOf: Date;
  config: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;            // adapter key, e.g. "csv"
  fetch(ctx: SourceContext): Promise<FetchResult>;
}
