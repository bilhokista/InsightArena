import { MarketSettlementState } from './entities/market.entity';

/**
 * The single source of truth for which settlement transitions are legal.
 *
 * Until now these rules were spelled out three times as ad-hoc `if` checks in
 * `markets.service.ts` and once more as an eligibility predicate in
 * `market-settlement.scheduler.ts`. Each copy was correct, but nothing tied
 * them together, so a new state or a changed rule had to be found in four
 * places by hand.
 *
 * The lifecycle, as implemented today:
 *
 *   PENDING ──propose──▶ PROPOSED ──grace window expires──▶ SETTLING ──▶ SETTLED
 *                            │
 *                            └──challenge──▶ CHALLENGED ──admin adjudicates──▶ SETTLED
 *
 * SETTLED is terminal. Cancellation is deliberately absent: it is carried by
 * the separate `is_cancelled` flag rather than by this enum, and folding it in
 * here would change behaviour rather than describe it.
 */
export const ALLOWED_SETTLEMENT_TRANSITIONS: Readonly<
  Record<MarketSettlementState, readonly MarketSettlementState[]>
> = Object.freeze({
  [MarketSettlementState.PENDING]: [MarketSettlementState.PROPOSED],
  [MarketSettlementState.PROPOSED]: [
    MarketSettlementState.SETTLING,
    MarketSettlementState.CHALLENGED,
  ],
  // Re-entrant: the scheduler may re-claim a market it already marked
  // SETTLING when a previous attempt crashed between claiming and settling.
  [MarketSettlementState.SETTLING]: [
    MarketSettlementState.SETTLING,
    MarketSettlementState.SETTLED,
  ],
  [MarketSettlementState.CHALLENGED]: [MarketSettlementState.SETTLED],
  [MarketSettlementState.SETTLED]: [],
});

export function canTransition(
  from: MarketSettlementState,
  to: MarketSettlementState,
): boolean {
  return ALLOWED_SETTLEMENT_TRANSITIONS[from].includes(to);
}

/**
 * Message for a rejected transition. Names both states and what would have
 * been allowed instead, so the caller is told what to do rather than only
 * that they were wrong.
 */
export function describeIllegalTransition(
  from: MarketSettlementState,
  to: MarketSettlementState,
): string {
  const allowed = ALLOWED_SETTLEMENT_TRANSITIONS[from];
  const suffix = allowed.length
    ? `allowed from "${from}": ${allowed.join(', ')}`
    : `"${from}" is a terminal state`;
  return `Cannot move market settlement from "${from}" to "${to}" (${suffix})`;
}
