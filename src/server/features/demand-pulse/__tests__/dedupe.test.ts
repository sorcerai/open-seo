import { describe, expect, it } from "vitest";
import { canonicalizeDemandUrl, compareDemandObservations } from "../dedupe";
import type { DemandObservationCandidate } from "../types";

const observation = (
  overrides: Partial<DemandObservationCandidate> = {},
): DemandObservationCandidate => ({
  projectId: "project-1",
  sourceConnectionId: "source-1",
  sourceClass: "community_observed",
  sourcePlatform: "forum",
  externalId: "1",
  canonicalUrl: "https://example.com/thread",
  title: "Should I paint or restain kitchen cabinets?",
  publishedAt: "2026-07-20T12:00:00.000Z",
  collectedAt: "2026-07-25T12:00:00.000Z",
  ...overrides,
});

describe("demand pulse deduplication", () => {
  it("removes tracking parameters", () => {
    expect(
      canonicalizeDemandUrl(
        "https://EXAMPLE.com/thread/?utm_source=x&b=2&a=1#comments",
      ),
    ).toBe("https://example.com/thread?a=1&b=2");
  });

  it("removes every tracking parameter when they are adjacent", () => {
    // Deleting from a live URLSearchParams iterator shifts the remaining
    // entries and skips one, so consecutive params are the case that catches it.
    expect(
      canonicalizeDemandUrl(
        "https://example.com/t?utm_source=x&utm_medium=y&utm_campaign=z&keep=1",
      ),
    ).toBe("https://example.com/t?keep=1");
  });

  it("detects cross-posts without collapsing independent evidence", () => {
    const result = compareDemandObservations(
      observation(),
      observation({
        sourcePlatform: "reddit",
        externalId: "reddit-2",
        canonicalUrl: "https://reddit.com/r/home/comments/2",
        title: "Should I paint or restain my kitchen cabinets?",
        publishedAt: "2026-07-22T12:00:00.000Z",
      }),
    );
    expect(result.isCrossPost).toBe(true);
    expect(result.isDuplicate).toBe(false);
  });
});
