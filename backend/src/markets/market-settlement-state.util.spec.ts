import { MarketSettlementState } from './entities/market.entity';
import {
  ALLOWED_SETTLEMENT_TRANSITIONS,
  canTransition,
  describeIllegalTransition,
} from './market-settlement-state.util';

const ALL_STATES = Object.values(MarketSettlementState);

/** Every transition the lifecycle is meant to permit, listed out by hand so
 *  the test states the rules rather than re-deriving them from the table. */
const VALID: ReadonlyArray<[MarketSettlementState, MarketSettlementState]> = [
  [MarketSettlementState.PENDING, MarketSettlementState.PROPOSED],
  [MarketSettlementState.PROPOSED, MarketSettlementState.SETTLING],
  [MarketSettlementState.PROPOSED, MarketSettlementState.CHALLENGED],
  [MarketSettlementState.SETTLING, MarketSettlementState.SETTLING],
  [MarketSettlementState.SETTLING, MarketSettlementState.SETTLED],
  [MarketSettlementState.CHALLENGED, MarketSettlementState.SETTLED],
];

const isValid = (from: MarketSettlementState, to: MarketSettlementState) =>
  VALID.some(([f, t]) => f === from && t === to);

describe('market settlement transitions', () => {
  it.each(VALID)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const INVALID = ALL_STATES.flatMap((from) =>
    ALL_STATES.filter((to) => !isValid(from, to)).map(
      (to) => [from, to] as const,
    ),
  );

  it.each(INVALID)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('covers every pair of states exactly once', () => {
    expect(VALID.length + INVALID.length).toBe(
      ALL_STATES.length * ALL_STATES.length,
    );
  });

  it('treats settled as terminal', () => {
    expect(ALLOWED_SETTLEMENT_TRANSITIONS[MarketSettlementState.SETTLED]).toEqual(
      [],
    );
    for (const to of ALL_STATES) {
      expect(canTransition(MarketSettlementState.SETTLED, to)).toBe(false);
    }
  });

  it('has a table entry for every state, so a new state cannot be forgotten', () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_SETTLEMENT_TRANSITIONS[state]).toBeDefined();
    }
    expect(Object.keys(ALLOWED_SETTLEMENT_TRANSITIONS).sort()).toEqual(
      [...ALL_STATES].sort(),
    );
  });

  describe('describeIllegalTransition', () => {
    it('names both states and what would have been allowed instead', () => {
      const message = describeIllegalTransition(
        MarketSettlementState.PENDING,
        MarketSettlementState.SETTLED,
      );
      expect(message).toContain('"pending"');
      expect(message).toContain('"settled"');
      expect(message).toContain('proposed');
    });

    it('says so plainly when the source state is terminal', () => {
      expect(
        describeIllegalTransition(
          MarketSettlementState.SETTLED,
          MarketSettlementState.PROPOSED,
        ),
      ).toContain('terminal state');
    });
  });
});
