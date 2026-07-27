import { describe, expect, it, vi } from "vitest";
import {
  localNewsDemandSource,
  type LocalNewsSourceConfig,
} from "../sources/local-news";
import {
  allowedGate,
  buildContext,
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

describe("localNewsDemandSource policy boundary", () => {
  it("empty discovery is healthy, deterministic, and never resolves originals", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: {
          status: "empty",
          provenance: "local-news-v1",
          hits: [],
        },
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(resolveOriginal).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
    expect(result.sourceRequestCount).toBe(0);
    expect(result.health?.status).toBe("healthy");
    expect(result.health?.metrics?.searchHits).toBe(0);
  });

  it("rejects strict discovery payload variants", () => {
    const base = {
      allowlistedPublisherDomains: ["example-gazette.com"],
      resolveOriginal: createLocalNewsResolver(async () => null),
      maxResolutions: 5,
    };
    expect(() =>
      localNewsDemandSource.validateConfig({
        ...base,
        discovery: {
          status: "failed",
          provenance: "local-news-v1",
          error: "search api 503",
          hits: [
            { query: "q", title: "t", url: "https://example-gazette.com/a" },
          ],
        },
      }),
    ).toThrow();
  });

  it("policy-blocks a claimed publisher that does not match the url host", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          {
            query: "q",
            title: "t",
            url: "https://example-gazette.com/a",
            publisherDomain: "evil.com",
          },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(resolveOriginal).not.toHaveBeenCalled();
    // Search observation still emitted; no original.
    const originals = result.observations.filter(
      (observation) =>
        observation.metadata?.evidenceKind === "original_publisher",
    );
    expect(originals).toHaveLength(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/does not match url host/),
      ]),
    );
  });

  it("policy-blocks a non-allowlisted publisher host", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          {
            query: "q",
            title: "t",
            url: "https://blocked-tabloid.net/scoop",
          },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    expect(resolveOriginal).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/non-allowlisted publisher: blocked-tabloid.net/),
      ]),
    );
  });

  it("resolves an allowlisted original as market_event_observed, distinct from search_observed", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => ({
      url: "https://example-gazette.com/heights-compost",
      title: "Heights pilot expands food scrap drop-off",
      excerpt: "Three sites added.",
      publishedAt: "2026-07-24T00:00:00.000Z",
      publisherDomain: "example-gazette.com",
    }));
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate }),
      {
        discovery: buildDiscovery([
          {
            query: "compost houston",
            title: "Heights pilot",
            url: "https://example-gazette.com/heights-compost",
          },
        ]),
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 5,
      },
    );
    const search = result.observations.filter(
      (observation) => observation.metadata?.evidenceKind === "search_hit",
    );
    const originals = result.observations.filter(
      (observation) =>
        observation.metadata?.evidenceKind === "original_publisher",
    );
    expect(search).toHaveLength(1);
    expect(originals).toHaveLength(1);
    expect(search[0].sourceClass).toBe("search_observed");
    expect(originals[0].sourceClass).toBe("market_event_observed");
    expect(originals[0].externalId).toMatch(/^local-news:original:/);
    expect(search[0].externalId).toMatch(/^local-news:search:/);
    expect(result.health?.status).toBe("healthy");
    expect(result.health?.requestCount).toBe(1);
  });
});
