import { describe, expect, it, vi } from "vitest";
import {
  localNewsDemandSource,
  type LocalNewsSourceConfig,
} from "../sources/local-news";
import {
  allowedGate,
  buildContext,
  buildMalformedFailedLocalNewsConfig,
  createLocalNewsResolver,
} from "./acquisition-adapters.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(async () => false),
}));

type LocalNewsSearchHits = Extract<
  LocalNewsSourceConfig["discovery"],
  { status: "ok" }
>["hits"];

function buildDiscovery(hits: LocalNewsSearchHits) {
  return { status: "ok" as const, provenance: "local-news-v1", hits };
}

describe("localNewsDemandSource resolution boundary", () => {
  it("rejects malformed resolved articles without throwing or persisting evidence", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => ({
      url: "not-a-url",
      title: "   ",
      excerpt: 42,
      publishedAt: "not-a-date",
      publisherDomain: "",
    }));
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          {
            query: "q",
            title: "search title",
            url: "https://example-gazette.com/a",
          },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(result.observations).toHaveLength(1);
    expect(
      result.observations.filter(
        (observation) =>
          observation.metadata?.evidenceKind === "original_publisher",
      ),
    ).toHaveLength(0);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/degraded/);
    expect(result.health?.metrics?.resolutionFailures).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/validation|rejected/i)]),
    );
  });

  it("resolver throw degrades health while preserving search observations", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => {
      throw new Error("upstream timeout");
    });
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          { query: "q", title: "t", url: "https://example-gazette.com/a" },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(result.observations).toHaveLength(1); // Search preserved.
    expect(result.observations[0].metadata?.evidenceKind).toBe("search_hit");
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/degraded/);
    expect(result.health?.metrics?.resolutionFailures).toBe(1);
  });

  it("resolver null degrades health while preserving search observations", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          { query: "q", title: "t", url: "https://example-gazette.com/a" },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(result.observations).toHaveLength(1);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.metrics?.originalResolutions).toBe(0);
  });

  it("partial resolution failure degrades to unknown health", async () => {
    let attempts = 0;
    const resolveOriginal = createLocalNewsResolver(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          url: "https://example-gazette.com/a",
          title: "A",
          publishedAt: "2026-07-24T00:00:00.000Z",
          publisherDomain: "example-gazette.com",
        };
      }
      throw new Error("timeout");
    });
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          { query: "q", title: "a", url: "https://example-gazette.com/a" },
          { query: "q", title: "b", url: "https://example-gazette.com/b" },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(result.health?.status).toBe("unknown");
    expect(result.health?.metrics?.originalResolutions).toBe(1);
    expect(result.health?.metrics?.resolutionFailures).toBe(1);
  });

  it("drops an original whose final url host is not allowlisted (redirect)", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => ({
      url: "https://blocked-tabloid.net/redirected",
      title: "Redirected",
      publishedAt: "2026-07-24T00:00:00.000Z",
      publisherDomain: "blocked-tabloid.net",
    }));
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          { query: "q", title: "t", url: "https://example-gazette.com/a" },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    const originals = result.observations.filter(
      (observation) =>
        observation.metadata?.evidenceKind === "original_publisher",
    );
    expect(originals).toHaveLength(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/final host/)]),
    );
  });

  it("failed discovery yields failed health with zero observations and no resolver call", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      buildMalformedFailedLocalNewsConfig(resolveOriginal),
    );
    expect(resolveOriginal).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
    expect(result.sourceRequestCount).toBe(0);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/discovery failed/);
    expect(result.health?.metrics?.searchHits).toBe(0);
  });

  it("bounds original resolutions to maxResolutions", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => ({
      url: "https://example-gazette.com/x",
      title: "X",
      publishedAt: "2026-07-24T00:00:00.000Z",
      publisherDomain: "example-gazette.com",
    }));
    const hits = Array.from({ length: 5 }, (_, index) => ({
      query: "q",
      title: `t${index}`,
      url: `https://example-gazette.com/a${index}`,
    }));
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery(hits),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 2,
      },
    );
    expect(resolveOriginal).toHaveBeenCalledTimes(2);
    expect(result.sourceRequestCount).toBe(2);
  });
});
