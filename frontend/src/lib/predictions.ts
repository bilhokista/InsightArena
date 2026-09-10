/**
 * Filtering and summarising for the prediction history page.
 *
 * Kept out of the page component so the rules can be tested directly. The page
 * owns rendering and URL state; everything here is pure.
 */

export type PredictionStatus =
  | "Active"
  | "Won"
  | "Lost"
  | "Pending"
  | "Refunded";

export type FilterTab = "All" | PredictionStatus;

export const FILTER_TABS: readonly FilterTab[] = [
  "All",
  "Active",
  "Pending",
  "Won",
  "Lost",
  "Refunded",
] as const;

export interface FilterablePrediction {
  marketTitle: string;
  status: PredictionStatus;
  /** Amount staked, e.g. "50 XLM". */
  stake: string;
  /** Total returned on a win, e.g. "142.50 XLM". Absent unless won. */
  payout?: string;
}

export interface PredictionFilters {
  status: FilterTab;
  /** Free-text match against the market title. */
  search: string;
}

export const DEFAULT_FILTERS: PredictionFilters = {
  status: "All",
  search: "",
};

/**
 * Leading number from an amount like "142.50 XLM".
 *
 * Returns 0 rather than NaN for anything unparseable: a malformed amount from
 * the API should leave a total unchanged, not turn the whole summary into
 * "NaN XLM".
 */
export function parseAmount(amount: string | undefined): number {
  if (!amount) return 0;
  const match = /-?\d+(\.\d+)?/.exec(amount);
  if (!match) return 0;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Profit or loss for a single prediction.
 *
 * - Won: payout minus stake, i.e. the *net* gain, not the gross return.
 * - Lost: the stake, negated.
 * - Refunded: zero — the stake came back, so nothing was won or lost.
 * - Active / Pending: zero, since the result is not known yet. Counting an
 *   open stake as a loss would make an untouched account look under water.
 */
export function computePnl(prediction: FilterablePrediction): number {
  switch (prediction.status) {
    case "Won":
      return parseAmount(prediction.payout) - parseAmount(prediction.stake);
    case "Lost":
      return -parseAmount(prediction.stake);
    default:
      return 0;
  }
}

export function filterPredictions<T extends FilterablePrediction>(
  predictions: readonly T[],
  filters: PredictionFilters,
): T[] {
  const needle = filters.search.trim().toLowerCase();

  return predictions.filter((prediction) => {
    if (filters.status !== "All" && prediction.status !== filters.status) {
      return false;
    }
    if (!needle) return true;
    return prediction.marketTitle.toLowerCase().includes(needle);
  });
}

export interface PredictionSummary {
  total: number;
  won: number;
  lost: number;
  pending: number;
  active: number;
  refunded: number;
  /** Settled predictions, i.e. those that count towards the win rate. */
  decided: number;
  /**
   * Percentage of *decided* predictions that were won, rounded.
   *
   * Deliberately not `won / total`: while most predictions are still open,
   * dividing by the total reports a win rate that falls as the user places
   * more bets, which reads as though they are getting worse. `null` when
   * nothing has settled yet, so the UI can say "—" instead of "0%".
   */
  winRate: number | null;
  /** Net profit or loss across the set, in the staking unit. */
  netPnl: number;
}

export function summarisePredictions(
  predictions: readonly FilterablePrediction[],
): PredictionSummary {
  const count = (status: PredictionStatus) =>
    predictions.filter((p) => p.status === status).length;

  const won = count("Won");
  const lost = count("Lost");
  const decided = won + lost;

  return {
    total: predictions.length,
    won,
    lost,
    pending: count("Pending"),
    active: count("Active"),
    refunded: count("Refunded"),
    decided,
    winRate: decided > 0 ? Math.round((won / decided) * 100) : null,
    netPnl: predictions.reduce((sum, p) => sum + computePnl(p), 0),
  };
}

/** Signed amount for display, e.g. "+42.50" or "-30.00". */
export function formatSignedAmount(value: number, digits = 2): string {
  const rounded = value.toFixed(digits);
  // `toFixed` on a tiny negative gives "-0.00", which reads as a loss.
  if (Number.parseFloat(rounded) === 0) return (0).toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

// ── URL persistence ────────────────────────────────────────────────────────

export const STATUS_PARAM = "status";
export const SEARCH_PARAM = "q";

function isFilterTab(value: string): value is FilterTab {
  return (FILTER_TABS as readonly string[]).includes(value);
}

/**
 * Reads filters from the query string, falling back to defaults.
 *
 * An unrecognised status is ignored rather than rejected: a stale or
 * hand-edited link should still open the page, just unfiltered.
 */
export function readFiltersFromParams(
  params: URLSearchParams,
): PredictionFilters {
  const status = params.get(STATUS_PARAM) ?? "";
  const search = params.get(SEARCH_PARAM) ?? "";

  return {
    status: isFilterTab(status) ? status : DEFAULT_FILTERS.status,
    search,
  };
}

/**
 * Query string for the given filters, omitting anything at its default so a
 * pristine page keeps a clean URL.
 */
export function buildFilterQuery(filters: PredictionFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_FILTERS.status) {
    params.set(STATUS_PARAM, filters.status);
  }
  if (filters.search.trim()) {
    params.set(SEARCH_PARAM, filters.search.trim());
  }
  return params.toString();
}
