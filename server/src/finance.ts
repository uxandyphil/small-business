// Acquisition financing model: what would an owner-operator actually take home?
//
// All inputs are pre-tax. Seller-reported SDE is the starting point; we never
// treat it as verified. Assumptions are explicit and user-adjustable.

export interface FinanceAssumptions {
  downPaymentPct: number;     // buyer equity, % of price (SBA 7(a) typically >= 10%)
  sellerNotePct: number;      // seller financing, % of price
  sbaRatePct: number;         // annual interest on the senior (SBA) loan
  sbaTermYears: number;       // 10 years typical for non-real-estate deals
  sellerNoteRatePct: number;
  sellerNoteTermYears: number;
  closingCostPct: number;     // legal, diligence, SBA guarantee fee, etc. paid in cash
  workingCapital: number;     // cash reserved for operations at close
  capexReservePct: number;    // % of SDE set aside for replacements / maintenance
  managerSalary: number;      // 0 if owner-operator; market salary if hiring a GM
  ownerMarketSalary: number;  // what your own labor is worth; deducted before computing ROI
}

export const DEFAULT_ASSUMPTIONS: FinanceAssumptions = {
  downPaymentPct: 10,
  sellerNotePct: 10,
  sbaRatePct: 10.5,
  sbaTermYears: 10,
  sellerNoteRatePct: 7,
  sellerNoteTermYears: 5,
  closingCostPct: 3,
  workingCapital: 0,
  capexReservePct: 5,
  managerSalary: 0,
  ownerMarketSalary: 75000,
};

export interface FinanceInput {
  askingPrice: number | null;
  sde: number | null;
  ebitda?: number | null;
  revenue?: number | null;
}

export interface FinanceResult {
  basis: "sde" | "ebitda" | null;      // which earnings figure was used
  earnings: number | null;
  multiple: number | null;             // price / earnings
  sbaLoan: number;
  sellerNote: number;
  equity: number;
  cashInvested: number;                // equity + closing costs + working capital
  annualDebtService: number;
  capexReserve: number;
  ownerIncome: number | null;          // pre-tax take-home incl. your own pay: earnings - capex - manager - debt service
  excessReturn: number | null;         // ownerIncome - ownerMarketSalary (return on capital, not on labor)
  dscr: number | null;                 // (earnings - capex - manager) / debt service
  cashOnCashPct: number | null;        // excessReturn / cashInvested ("estimated ROI")
  paybackYears: number | null;
  marginPct: number | null;            // earnings / revenue
  flags: string[];
}

/** Standard amortizing loan payment, annualized from monthly payments. */
export function annualPayment(principal: number, ratePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / years;
  return ((principal * r) / (1 - Math.pow(1 + r, -n))) * 12;
}

export function analyzeDeal(input: FinanceInput, a: FinanceAssumptions = DEFAULT_ASSUMPTIONS): FinanceResult {
  const flags: string[] = [];
  const price = input.askingPrice ?? null;
  let basis: FinanceResult["basis"] = null;
  let earnings: number | null = null;
  if (input.sde != null && input.sde > 0) {
    basis = "sde";
    earnings = input.sde;
  } else if (input.ebitda != null && input.ebitda > 0) {
    // EBITDA excludes owner compensation already, so it's a conservative stand-in for SDE.
    basis = "ebitda";
    earnings = input.ebitda;
    flags.push("Cash flow not disclosed; EBITDA used as a conservative proxy.");
  }

  const empty: FinanceResult = {
    basis, earnings, multiple: null, sbaLoan: 0, sellerNote: 0, equity: 0, cashInvested: 0,
    annualDebtService: 0, capexReserve: 0, ownerIncome: null, excessReturn: null, dscr: null, cashOnCashPct: null,
    paybackYears: null, marginPct: null, flags,
  };
  if (price == null || price <= 0) {
    flags.push("Asking price not disclosed.");
    return empty;
  }

  const equity = (price * a.downPaymentPct) / 100;
  const sellerNote = (price * a.sellerNotePct) / 100;
  const sbaLoan = Math.max(0, price - equity - sellerNote);
  const closing = (price * a.closingCostPct) / 100;
  const cashInvested = equity + closing + a.workingCapital;
  const annualDebtService =
    annualPayment(sbaLoan, a.sbaRatePct, a.sbaTermYears) + annualPayment(sellerNote, a.sellerNoteRatePct, a.sellerNoteTermYears);

  if (earnings == null) {
    flags.push("No earnings disclosed; owner income cannot be estimated.");
    return { ...empty, sbaLoan, sellerNote, equity, cashInvested, annualDebtService };
  }

  const capexReserve = (earnings * a.capexReservePct) / 100;
  const available = earnings - capexReserve - a.managerSalary;
  const ownerIncome = available - annualDebtService;
  const excessReturn = ownerIncome - a.ownerMarketSalary;
  const dscr = annualDebtService > 0 ? available / annualDebtService : null;
  const multiple = price / earnings;
  const revenue = input.revenue ?? null;
  const marginPct = revenue && revenue > 0 ? (earnings / revenue) * 100 : null;

  if (dscr != null && dscr < 1.25) flags.push(`DSCR ${dscr.toFixed(2)} is below the 1.25x most SBA lenders require.`);
  if (multiple > 4.5) flags.push(`Priced at ${multiple.toFixed(1)}x earnings, above the typical 2–4x Main Street range.`);
  if (marginPct != null && marginPct > 45) flags.push("Reported margin is unusually high; verify add-backs in diligence.");
  if (ownerIncome < 0) flags.push("Debt service exceeds available cash flow at these terms.");
  else if (excessReturn < 0) flags.push("Take-home is below the market salary assumed for your own labor.");

  return {
    basis,
    earnings,
    multiple,
    sbaLoan,
    sellerNote,
    equity,
    cashInvested,
    annualDebtService,
    capexReserve,
    ownerIncome,
    excessReturn,
    dscr,
    cashOnCashPct: cashInvested > 0 ? (excessReturn / cashInvested) * 100 : null,
    paybackYears: excessReturn > 0 ? cashInvested / excessReturn : null,
    marginPct,
    flags,
  };
}
