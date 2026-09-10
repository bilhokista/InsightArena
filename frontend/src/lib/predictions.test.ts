import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  FilterablePrediction,
  buildFilterQuery,
  computePnl,
  filterPredictions,
  formatSignedAmount,
  parseAmount,
  readFiltersFromParams,
  summarisePredictions,
} from "./predictions";

function make(
  overrides: Partial<FilterablePrediction> & { marketTitle: string },
): FilterablePrediction {
  return { status: "Active", stake: "50 XLM", ...overrides };
}

/** Mirrors the shape of the page's fixture data. */
const SAMPLE: FilterablePrediction[] = [
  make({ marketTitle: "Will XLM close above $0.20 this week?" }),
  make({ marketTitle: "Bitcoin price above $100k by year end?", stake: "25 XLM" }),
  make({
    marketTitle: "Ethereum ETF approval by end of month",
    status: "Won",
    stake: "75 XLM",
    payout: "142.50 XLM",
  }),
  make({
    marketTitle: "Will top 10 DeFi TVL increase this week?",
    status: "Lost",
    stake: "30 XLM",
  }),
  make({ marketTitle: "NFT market cap to reach $50B?", status: "Pending", stake: "40 XLM" }),
  make({ marketTitle: "Cancelled market", status: "Refunded", stake: "10 XLM" }),
];

describe("parseAmount", () => {
  it("reads the leading number out of an amount", () => {
    expect(parseAmount("142.50 XLM")).toBe(142.5);
    expect(parseAmount("50 XLM")).toBe(50);
  });

  it("returns 0 rather than NaN for missing or unparseable input", () => {
    // A malformed amount must leave a total unchanged, not poison it.
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("XLM")).toBe(0);
  });
});

describe("computePnl", () => {
  it("counts a win as payout minus stake, not the gross payout", () => {
    expect(
      computePnl(make({ marketTitle: "m", status: "Won", stake: "75 XLM", payout: "142.50 XLM" })),
    ).toBe(67.5);
  });

  it("counts a loss as the negated stake", () => {
    expect(computePnl(make({ marketTitle: "m", status: "Lost", stake: "30 XLM" }))).toBe(-30);
  });

  it("counts a refund as neutral", () => {
    expect(computePnl(make({ marketTitle: "m", status: "Refunded", stake: "10 XLM" }))).toBe(0);
  });

  it("does not treat an open stake as a loss", () => {
    // Otherwise an untouched account with open bets looks under water.
    expect(computePnl(make({ marketTitle: "m", status: "Active" }))).toBe(0);
    expect(computePnl(make({ marketTitle: "m", status: "Pending" }))).toBe(0);
  });
});

describe("filterPredictions", () => {
  it("returns everything with the default filters", () => {
    expect(filterPredictions(SAMPLE, DEFAULT_FILTERS)).toHaveLength(SAMPLE.length);
  });

  it("narrows to a single status", () => {
    const won = filterPredictions(SAMPLE, { status: "Won", search: "" });
    expect(won).toHaveLength(1);
    expect(won[0].marketTitle).toContain("Ethereum ETF");
  });

  it("includes refunded predictions under their own tab", () => {
    expect(filterPredictions(SAMPLE, { status: "Refunded", search: "" })).toHaveLength(1);
  });

  it("searches the market title case-insensitively", () => {
    expect(filterPredictions(SAMPLE, { status: "All", search: "BITCOIN" })).toHaveLength(1);
    expect(filterPredictions(SAMPLE, { status: "All", search: "week" })).toHaveLength(2);
  });

  it("ignores surrounding whitespace in the search term", () => {
    expect(filterPredictions(SAMPLE, { status: "All", search: "   " })).toHaveLength(
      SAMPLE.length,
    );
    expect(filterPredictions(SAMPLE, { status: "All", search: "  bitcoin  " })).toHaveLength(1);
  });

  it("applies status and search together", () => {
    expect(filterPredictions(SAMPLE, { status: "Active", search: "week" })).toHaveLength(1);
    expect(filterPredictions(SAMPLE, { status: "Won", search: "bitcoin" })).toHaveLength(0);
  });

  it("does not mutate the input", () => {
    const copy = [...SAMPLE];
    filterPredictions(SAMPLE, { status: "Won", search: "e" });
    expect(SAMPLE).toEqual(copy);
  });
});

describe("summarisePredictions", () => {
  it("counts each status across the whole set", () => {
    const s = summarisePredictions(SAMPLE);
    expect(s).toMatchObject({
      total: 6,
      won: 1,
      lost: 1,
      active: 2,
      pending: 1,
      refunded: 1,
      decided: 2,
    });
  });

  it("computes the win rate over settled predictions only", () => {
    // 1 won of 2 settled = 50%. Over all six it would read 17% and fall
    // further with every new open bet.
    expect(summarisePredictions(SAMPLE).winRate).toBe(50);
  });

  it("reports no win rate when nothing has settled", () => {
    const open = SAMPLE.filter((p) => p.status === "Active");
    expect(summarisePredictions(open).winRate).toBeNull();
  });

  it("nets wins against losses", () => {
    // +67.50 from the win, -30 from the loss.
    expect(summarisePredictions(SAMPLE).netPnl).toBeCloseTo(37.5);
  });

  it("summarises an empty set without dividing by zero", () => {
    expect(summarisePredictions([])).toMatchObject({
      total: 0,
      decided: 0,
      winRate: null,
      netPnl: 0,
    });
  });

  it("reflects the filtered set rather than the whole history", () => {
    const lost = filterPredictions(SAMPLE, { status: "Lost", search: "" });
    const s = summarisePredictions(lost);

    expect(s.total).toBe(1);
    expect(s.winRate).toBe(0);
    expect(s.netPnl).toBe(-30);
  });
});

describe("formatSignedAmount", () => {
  it("marks a gain with a plus sign", () => {
    expect(formatSignedAmount(37.5)).toBe("+37.50");
  });

  it("keeps the minus sign on a loss", () => {
    expect(formatSignedAmount(-30)).toBe("-30.00");
  });

  it("never renders a negative zero", () => {
    // "-0.00" reads as a loss when the user broke even.
    expect(formatSignedAmount(0)).toBe("0.00");
    expect(formatSignedAmount(-0.0001)).toBe("0.00");
  });
});

describe("URL persistence", () => {
  it("round-trips filters through the query string", () => {
    const filters = { status: "Won" as const, search: "bitcoin" };
    const restored = readFiltersFromParams(new URLSearchParams(buildFilterQuery(filters)));
    expect(restored).toEqual(filters);
  });

  it("keeps a pristine URL clean", () => {
    expect(buildFilterQuery(DEFAULT_FILTERS)).toBe("");
  });

  it("omits a search term that is only whitespace", () => {
    expect(buildFilterQuery({ status: "All", search: "   " })).toBe("");
  });

  it("falls back to defaults for an unknown status instead of failing", () => {
    // A stale or hand-edited link should still open the page.
    expect(readFiltersFromParams(new URLSearchParams("status=Bogus"))).toEqual(
      DEFAULT_FILTERS,
    );
  });

  it("reads defaults from an empty query string", () => {
    expect(readFiltersFromParams(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
  });
});
