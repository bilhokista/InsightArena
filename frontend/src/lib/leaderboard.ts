/**
 * Page-merging rules for the leaderboard.
 *
 * Kept out of `useLeaderboard` so the append behaviour can be tested without
 * mounting a hook or mocking the network.
 */

/** Minimum shape needed to merge; the real entry type is a superset. */
export interface IdentifiableEntry {
  user_id: string;
  rank: number;
}

export const LEADERBOARD_PAGE_SIZE = 50;

/**
 * Appends a freshly fetched page onto the entries already shown.
 *
 * Deduplicates by `user_id`, which matters more than it looks: the ranking is
 * live, so a user who climbs between two requests can legitimately appear on
 * both page 1 and page 2. Appending blindly would show them twice and give
 * React two children with the same key.
 *
 * When a user appears twice the **incoming** copy wins, since it was read more
 * recently, but it keeps the position it already held so rows do not jump
 * around under the reader's cursor while they scroll.
 */
export function mergeLeaderboardPages<T extends IdentifiableEntry>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const positionOf = new Map<string, number>();
  const merged: T[] = [];

  for (const entry of existing) {
    positionOf.set(entry.user_id, merged.length);
    merged.push(entry);
  }

  for (const entry of incoming) {
    const seenAt = positionOf.get(entry.user_id);
    if (seenAt === undefined) {
      positionOf.set(entry.user_id, merged.length);
      merged.push(entry);
    } else {
      merged[seenAt] = entry;
    }
  }

  return merged;
}

export interface PageInfo {
  /** 1-based page number just returned. */
  page: number;
  limit: number;
  total: number;
}

/**
 * Whether another page exists after the one described by `info`.
 *
 * Guards against a `total` of 0 and against a `limit` of 0, which would
 * otherwise divide by zero and report an endless list — an infinite scroll
 * that never stops asking is worse than one that stops early.
 */
export function hasMorePages(info: PageInfo): boolean {
  if (info.limit <= 0 || info.total <= 0) return false;
  return info.page * info.limit < info.total;
}

/**
 * Rank the next page starts at, used to size the tail skeleton so it does not
 * promise more rows than are actually left.
 */
export function remainingCount(info: PageInfo): number {
  if (!hasMorePages(info)) return 0;
  return info.total - info.page * info.limit;
}
