import { describe, expect, it } from "vitest";
import {
  canonicalizeDemandUrl,
  compareDemandObservations,
  digestId,
  observationEvidenceId,
} from "../dedupe";
import { buildFamilyEvidence, groupEvidenceEvents } from "../dedupe-evidence";
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
    expect(
      canonicalizeDemandUrl(
        "https://example.com/t?utm_source=x&utm_medium=y&utm_campaign=z&keep=1",
      ),
    ).toBe("https://example.com/t?keep=1");
  });

  it("resolves confident cross-posts as a syndicated duplicate (one independent event)", async () => {
    const crossPost = observation({
      sourcePlatform: "reddit",
      sourceConnectionId: "source-reddit",
      externalId: "reddit-2",
      canonicalUrl: "https://reddit.com/r/home/comments/2",
      title: "Should I paint or restain my kitchen cabinets?",
      publishedAt: "2026-07-22T12:00:00.000Z",
    });
    const result = compareDemandObservations(observation(), crossPost);
    // Confident cross-posts are syndicated duplicates, not independent evidence.
    expect(result.isCrossPost).toBe(true);
    expect(result.isDuplicate).toBe(true);
    expect(result.relation).toBe("syndicated");

    const { events } = await groupEvidenceEvents([observation(), crossPost]);
    expect(events).toHaveLength(1);
    expect(events[0].independentCount).toBe(1);
    expect(events[0].rawObservationCount).toBe(2);
  });
});

describe("evidence grouping", () => {
  it("collapses duplicate observations into one independent event without inflating corroboration", async () => {
    const copies = [
      observation({ sourceConnectionId: "s1", externalId: "a" }),
      observation({ sourceConnectionId: "s2", externalId: "b" }),
      observation({ sourceConnectionId: "s3", externalId: "c" }),
    ];
    const { events, edges } = await groupEvidenceEvents(copies);
    expect(events).toHaveLength(1);
    expect(events[0].independentCount).toBe(1);
    expect(events[0].rawObservationCount).toBe(3);
    expect(edges.every((edge) => edge.relation === "canonical")).toBe(true);
  });

  it("reports independent corroboration separately from raw count at the family level", async () => {
    const copies = [
      observation({ sourceConnectionId: "s1", externalId: "a" }),
      observation({ sourceConnectionId: "s2", externalId: "b" }),
    ];
    const evidence = await buildFamilyEvidence("fam-1", copies);
    expect(evidence.independentEventCount).toBe(1);
    expect(evidence.rawObservationCount).toBe(2);
    expect(evidence.duplicateEdges.length).toBe(1);
  });

  it("keeps independent observations as separate events", async () => {
    const a = observation({
      title: "totally different topic about weather",
      externalId: "w1",
      canonicalUrl: "https://example.com/weather",
    });
    const b = observation({
      title: "another unrelated subject about taxes",
      externalId: "t1",
      canonicalUrl: "https://example.com/taxes",
    });
    const { events } = await groupEvidenceEvents([a, b]);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.independentCount === 1)).toBe(true);
  });

  it("does not collapse URL-less observations on an empty canonical url", async () => {
    const a = observation({
      externalId: "a",
      canonicalUrl: "",
      title: "first party record about composting",
    });
    const b = observation({
      externalId: "b",
      canonicalUrl: "",
      title: "second party record about rainwater",
    });
    const { events } = await groupEvidenceEvents([a, b]);
    expect(events).toHaveLength(2);
  });

  it("collapses URL-less records sharing source connection and external id", async () => {
    const a = observation({
      sourceConnectionId: "fp-1",
      externalId: "rec-1",
      canonicalUrl: "",
      title: "first party record",
    });
    const b = observation({
      sourceConnectionId: "fp-1",
      externalId: "rec-1",
      canonicalUrl: "",
      title: "first party record duplicate",
    });
    const { events } = await groupEvidenceEvents([a, b]);
    expect(events).toHaveLength(1);
    expect(events[0].rawObservationCount).toBe(2);
  });

  it("produces deterministic event ids and order regardless of input order", async () => {
    const a = observation({ sourceConnectionId: "s1", externalId: "a" });
    const b = observation({ sourceConnectionId: "s2", externalId: "b" });
    const c = observation({
      title: "separate independent question about soil health",
      externalId: "d1",
      canonicalUrl: "https://example.com/soil",
    });
    const first = await groupEvidenceEvents([a, b, c]);
    const second = await groupEvidenceEvents([c, b, a]);
    expect(second.events.map((event) => event.eventId)).toEqual(
      first.events.map((event) => event.eventId),
    );
    expect(second.events.map((event) => event.memberObservationIds)).toEqual(
      first.events.map((event) => event.memberObservationIds),
    );
    expect(second.edges).toEqual(first.edges);
  });

  it("keeps a stable event id when a later duplicate is discovered", async () => {
    const earliest = observation({
      sourceConnectionId: "s1",
      externalId: "early",
      publishedAt: "2026-07-18T12:00:00.000Z",
    });
    const earlierRun = await groupEvidenceEvents([earliest]);
    // A later-discovered duplicate (later publishedAt) must not rekey the event.
    const laterRun = await groupEvidenceEvents([
      earliest,
      observation({
        sourceConnectionId: "s2",
        externalId: "late",
        publishedAt: "2026-07-21T12:00:00.000Z",
      }),
    ]);
    expect(laterRun.events[0].eventId).toBe(earlierRun.events[0].eventId);
  });

  it("keeps independent undated same-title observations collision-free", async () => {
    const first = observation({
      externalId: "undated-a",
      canonicalUrl: "https://example.com/undated-a",
      publishedAt: null,
    });
    const second = observation({
      externalId: "undated-b",
      canonicalUrl: "https://example.com/undated-b",
      publishedAt: null,
    });

    const { events } = await groupEvidenceEvents([first, second]);

    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
  });

  it("does not rekey when a later-collected duplicate has an older publication date", async () => {
    const first = observation({
      externalId: "first-seen",
      collectedAt: "2026-07-20T12:00:00.000Z",
      publishedAt: "2026-07-20T10:00:00.000Z",
    });
    const before = await groupEvidenceEvents([first]);
    const after = await groupEvidenceEvents([
      first,
      observation({
        sourceConnectionId: "source-2",
        externalId: "backfill",
        collectedAt: "2026-07-25T12:00:00.000Z",
        publishedAt: "2026-07-18T10:00:00.000Z",
      }),
    ]);

    expect(after.events).toHaveLength(1);
    expect(after.events[0].eventId).toBe(before.events[0].eventId);
  });

  it("uses deterministic domain-separated SHA-256 identities", async () => {
    const observationId = await observationEvidenceId(observation());
    const repeated = await observationEvidenceId(observation());
    const feed = await digestId("feed", [
      "project-1",
      "family-1",
      "2026-07-27",
    ]);
    const nextDay = await digestId("feed", [
      "project-1",
      "family-1",
      "2026-07-28",
    ]);
    const otherDomain = await digestId("evt", [
      "project-1",
      "family-1",
      "2026-07-27",
    ]);

    expect(observationId).toBe(repeated);
    expect(observationId).toMatch(/^obs_[0-9a-f]{64}$/);
    expect(feed).toMatch(/^feed_[0-9a-f]{64}$/);
    expect(feed).not.toBe(nextDay);
    expect(feed.slice("feed_".length)).not.toBe(
      otherDomain.slice("evt_".length),
    );
  });

  it("marks events baseline-only when every member is a baseline fingerprint", async () => {
    const evidence = await buildFamilyEvidence("fam-base", [
      observation({
        sourceConnectionId: "s1",
        externalId: "b1",
        baselineFingerprint: true,
        publishedAt: null,
      }),
      observation({
        sourceConnectionId: "s2",
        externalId: "b2",
        baselineFingerprint: true,
        publishedAt: null,
      }),
    ]);
    expect(evidence.baselineOnly).toBe(true);
    expect(evidence.events.every((event) => event.baselineOnly)).toBe(true);
  });
});

describe("duplicate relation classification", () => {
  it("labels same-connection same-external-id records as exact", () => {
    const result = compareDemandObservations(
      observation({ sourceConnectionId: "s1", externalId: "x" }),
      observation({ sourceConnectionId: "s1", externalId: "x" }),
    );
    expect(result.relation).toBe("exact");
  });

  it("labels url variants as canonical", () => {
    const result = compareDemandObservations(
      observation({
        externalId: "x",
        canonicalUrl: "https://example.com/thread?utm_source=a",
      }),
      observation({
        externalId: "y",
        canonicalUrl: "https://example.com/thread",
      }),
    );
    expect(result.relation).toBe("canonical");
  });

  it("labels confident cross-posts as syndicated", () => {
    const result = compareDemandObservations(
      observation({
        sourcePlatform: "forum",
        sourceConnectionId: "s1",
        externalId: "x",
        canonicalUrl: "https://example.com/a",
        title: "how to compost food scraps",
      }),
      observation({
        sourcePlatform: "reddit",
        sourceConnectionId: "s2",
        externalId: "y",
        canonicalUrl: "https://reddit.com/b",
        title: "how to compost food scraps",
        publishedAt: "2026-07-22T12:00:00.000Z",
      }),
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.relation).toBe("syndicated");
  });

  it("labels same-platform rewording as semantic", () => {
    const result = compareDemandObservations(
      observation({
        sourceConnectionId: "s1",
        externalId: "x",
        canonicalUrl: "https://example.com/a",
        title: "composting kitchen scraps in houston texas",
      }),
      observation({
        sourceConnectionId: "s2",
        externalId: "y",
        canonicalUrl: "https://example.com/b",
        title: "composting food scraps in houston texas",
        publishedAt: "2026-07-22T12:00:00.000Z",
      }),
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.relation).toBe("semantic");
  });
});
