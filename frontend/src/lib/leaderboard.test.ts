import { describe, expect, it } from "vitest";

import {
  IdentifiableEntry,
  LEADERBOARD_PAGE_SIZE,
  hasMorePages,
  mergeLeaderboardPages,
  remainingCount,
} from "./leaderboard";

interface Entry extends IdentifiableEntry {
  username: string;
}

const entry = (user_id: string, rank: number, username = user_id): Entry => ({
  user_id,
  rank,
  username,
});

const page1 = [entry("a", 1), entry("b", 2), entry("c", 3)];
const page2 = [entry("d", 4), entry("e", 5)];

describe("mergeLeaderboardPages", () => {
  it("appends a following page onto the entries already shown", () => {
    const merged = mergeLeaderboardPages(page1, page2);
    expect(merged.map((e) => e.user_id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not duplicate a user who appears on both pages", () => {
    // The ranking is live, so someone who climbs between two requests can
    // legitimately be returned twice.
    const overlapping = [entry("c", 3), entry("d", 4)];
    const merged = mergeLeaderboardPages(page1, overlapping);

    expect(merged.map((e) => e.user_id)).toEqual(["a", "b", "c", "d"]);
    expect(merged).toHaveLength(4);
  });

  it("produces unique keys even when a whole page repeats", () => {
    const merged = mergeLeaderboardPages(page1, page1);
    expect(new Set(merged.map((e) => e.user_id)).size).toBe(merged.length);
  });

  it("takes the newer copy of a duplicated entry", () => {
    const merged = mergeLeaderboardPages(
      [entry("a", 5, "old-name")],
      [entry("a", 2, "new-name")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ rank: 2, username: "new-name" });
  });

  it("keeps a duplicated entry in the position it already held", () => {
    // Moving it would make rows jump under the reader's cursor mid-scroll.
    const merged = mergeLeaderboardPages(page1, [entry("a", 1)]);
    expect(merged[0].user_id).toBe("a");
    expect(merged.map((e) => e.user_id)).toEqual(["a", "b", "c"]);
  });

  it("handles an empty incoming page", () => {
    expect(mergeLeaderboardPages(page1, [])).toEqual(page1);
  });

  it("handles an empty starting list", () => {
    expect(mergeLeaderboardPages([], page1)).toEqual(page1);
  });

  it("does not mutate either input", () => {
    const before1 = JSON.stringify(page1);
    const before2 = JSON.stringify(page2);
    mergeLeaderboardPages(page1, page2);
    expect(JSON.stringify(page1)).toBe(before1);
    expect(JSON.stringify(page2)).toBe(before2);
  });

  it("accumulates correctly across three pages", () => {
    const merged = mergeLeaderboardPages(
      mergeLeaderboardPages(page1, page2),
      [entry("e", 5), entry("f", 6)],
    );
    expect(merged.map((e) => e.user_id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("hasMorePages", () => {
  it("reports more while entries remain", () => {
    expect(hasMorePages({ page: 1, limit: 50, total: 120 })).toBe(true);
    expect(hasMorePages({ page: 2, limit: 50, total: 120 })).toBe(true);
  });

  it("stops on the last page", () => {
    expect(hasMorePages({ page: 3, limit: 50, total: 120 })).toBe(false);
  });

  it("stops when the total lands exactly on a page boundary", () => {
    expect(hasMorePages({ page: 2, limit: 50, total: 100 })).toBe(false);
  });

  it("reports nothing more for an empty leaderboard", () => {
    expect(hasMorePages({ page: 1, limit: 50, total: 0 })).toBe(false);
  });

  it("refuses to scroll forever on a zero limit", () => {
    // Dividing by a zero limit would otherwise describe an endless list.
    expect(hasMorePages({ page: 1, limit: 0, total: 120 })).toBe(false);
  });
});

describe("remainingCount", () => {
  it("counts the entries not yet loaded", () => {
    expect(remainingCount({ page: 1, limit: 50, total: 120 })).toBe(70);
    expect(remainingCount({ page: 2, limit: 50, total: 120 })).toBe(20);
  });

  it("is zero once everything is loaded", () => {
    expect(remainingCount({ page: 3, limit: 50, total: 120 })).toBe(0);
    expect(remainingCount({ page: 1, limit: 50, total: 0 })).toBe(0);
  });
});

describe("LEADERBOARD_PAGE_SIZE", () => {
  it("is a positive page size", () => {
    expect(LEADERBOARD_PAGE_SIZE).toBeGreaterThan(0);
  });
});
