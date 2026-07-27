import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
import type { DemandPulseCanarySourceConfig } from "../services/dailyCanaryOrchestrator";
import { runDemandPulseCanary } from "../services/dailyCanaryOrchestrator";
import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "../canaries/onfarmcompost-official-sources";
import type { DemandSourceAdapter } from "../sources/adapter";
import {
  adapterResult,
  configs,
  env,
  failingAdapter,
  family,
  FailingEvidenceRepository,
  MemoryRepository,
  observation,
  RUN_AT,
  source,
} from "./daily-canary-orchestrator.test-utils";

describe("daily Demand Pulse canary orchestration", () => {
  it("persists source health and successful evidence/feed through one adapter failure", async () => {
    const repository = new MemoryRepository();
    const adapters = {
      "gsc-site": adapterResult(observation("gsc", "search_observed", "gsc-1")),
      "dataforseo-discussions": {
        ...adapterResult(observation("dataforseo", "search_observed", "dfs-1")),
        discover: async () => {
          throw new Error("DataForSEO unavailable");
        },
      },
      "manual-first-party": adapterResult(
        observation("manual", "first_party_observed", "manual-1"),
      ),
      "local-news": adapterResult(
        observation("local-news", "community_observed", "news-1"),
      ),
    };

    const result = await runDemandPulseCanary({
      env,
      now: RUN_AT,
      repository,
      adapters,
      sourceConfigs: configs,
      families: [family],
    });

    expect(result.status).toBe("completed");
    expect(repository.sourceRuns).toHaveLength(4);
    expect(
      repository.sourceRuns.find((row) => row.sourceId === "dataforseo")
        ?.health,
    ).toBe("failed");
    expect(repository.observations.length).toBeGreaterThanOrEqual(3);
    expect(repository.evidenceEvents.length).toBeGreaterThan(0);
    expect(repository.coverageChecks.length).toBeGreaterThan(0);
    expect(repository.scores.length).toBeGreaterThan(0);
    expect(repository.feedItems.length).toBeGreaterThan(0);
    expect(repository.feedItems.length).toBeLessThanOrEqual(5);
    expect(repository.feedItems[0]?.provenance).toBe("observed");
    expect(repository.feedItems[0]?.coverageCheckId).toBe(
      repository.coverageChecks[0]?.id,
    );
    if (result.status === "completed") {
      expect(result.artifact?.publicationAllowed).toBe(false);
      expect(result.artifact?.metrics.failedSourceCount).toBe(1);
    }
  });

  it("records a processing failure message when evidence persistence fails", async () => {
    const repository = new FailingEvidenceRepository();
    const result = await runDemandPulseCanary({
      env,
      now: RUN_AT,
      repository,
      adapters: {
        "gsc-site": adapterResult(
          observation("gsc", "search_observed", "gsc-1"),
        ),
      },
      sourceConfigs: { gsc: {} },
      families: [family],
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error(`Expected failed result, got ${result.status}`);
    }
    expect(result.errorMessage).toContain("evidence persistence unavailable");
    expect(repository.runs[0]?.errorMessage).toContain(
      "evidence persistence unavailable",
    );
  });
  it("fails when persistence fails after a healthy zero-observation acquisition", async () => {
    const repository = new FailingEvidenceRepository();
    const emptyAdapter: DemandSourceAdapter = {
      ...adapterResult(observation("gsc", "search_observed", "gsc-1")),
      discover: async () => ({
        observations: [],
        sourceRequestCount: 1,
        warnings: [],
        health: {
          status: "healthy",
          policyState: "allowed",
          requestCount: 1,
          costMicros: 0,
          cursor: RUN_AT.toISOString(),
          error: null,
        },
      }),
    };
    const result = await runDemandPulseCanary({
      env,
      now: RUN_AT,
      repository,
      adapters: { "gsc-site": emptyAdapter },
      sourceConfigs: { gsc: {} },
      families: [family],
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error(`Expected failed result, got ${result.status}`);
    }

    expect(result.errorMessage).toContain("evidence persistence unavailable");
    expect(repository.runs[0]?.errorMessage).toContain(
      "evidence persistence unavailable",
    );
  });

  it("keeps below-floor runs incomplete without family, score, or feed promotion", async () => {
    const repository = new MemoryRepository();
    const adapters = {
      "gsc-site": adapterResult(observation("gsc", "search_observed", "gsc-1")),
      "dataforseo-discussions": adapterResult(
        observation("dataforseo", "search_observed", "dfs-1"),
      ),
      "manual-first-party": failingAdapter(
        observation("manual", "first_party_observed", "manual-1"),
        "manual source unavailable",
      ),
      "local-news": failingAdapter(
        observation("local-news", "community_observed", "news-1"),
        "local news unavailable",
      ),
    };
    const input = {
      env: { ...env, DEMAND_PULSE_FAMILIES_JSON: "not-json" },
      now: RUN_AT,
      repository,
      adapters,
      sourceConfigs: configs,
    };

    const first = await runDemandPulseCanary(input);

    expect(first.status).toBe("incomplete");
    if (first.status !== "incomplete") {
      throw new Error(`Expected incomplete result, got ${first.status}`);
    }

    expect(first.errorMessage).toContain("Insufficient source health 2/4");
    expect(repository.runs[0]?.status).toBe("incomplete");
    expect(repository.observations).toHaveLength(2);
    expect(repository.families).toHaveLength(0);
    expect(repository.scores).toHaveLength(0);
    expect(repository.feedItems).toHaveLength(0);
    expect(first.artifact?.metrics.feedItemCount).toBe(0);
    expect(first.artifact?.candidateCards).toHaveLength(0);
    expect(
      first.artifact?.errors.some((error) =>
        error.includes("families config parse failed"),
      ) ?? false,
    ).toBe(false);
    const rerun = await runDemandPulseCanary(input);

    expect(rerun.status).toBe("incomplete");
    expect(rerun.status).not.toBe("already_completed");
  });

  it("keeps a zero-healthy run incomplete with no feed promotion", async () => {
    const repository = new MemoryRepository();
    const adapters = {
      "gsc-site": failingAdapter(
        observation("gsc", "search_observed", "gsc-1"),
        "GSC unavailable",
      ),
      "dataforseo-discussions": failingAdapter(
        observation("dataforseo", "search_observed", "dfs-1"),
        "DataForSEO unavailable",
      ),
      "manual-first-party": failingAdapter(
        observation("manual", "first_party_observed", "manual-1"),
        "manual source unavailable",
      ),
      "local-news": failingAdapter(
        observation("local-news", "community_observed", "news-1"),
        "local news unavailable",
      ),
    };

    const result = await runDemandPulseCanary({
      env,
      now: RUN_AT,
      repository,
      adapters,
      sourceConfigs: configs,
      families: [family],
    });

    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") {
      throw new Error(`Expected incomplete result, got ${result.status}`);
    }

    expect(result.errorMessage).toContain("Insufficient source health 0/4");
    expect(repository.runs[0]?.status).toBe("incomplete");
    expect(repository.feedItems).toHaveLength(0);
    expect(repository.families).toHaveLength(0);
    expect(repository.scores).toHaveLength(0);
    expect(result.artifact?.metrics.feedItemCount).toBe(0);
    expect(result.artifact?.candidateCards).toHaveLength(0);
  });

  it("isolates source configuration rejection and continues other adapters", async () => {
    const repository = new MemoryRepository();
    const sourceConfigs = Object.defineProperties(
      {},
      {
        "gsc-site": {
          enumerable: true,
          get() {
            throw new Error("config dependency unavailable");
          },
        },
        "dataforseo-discussions": { enumerable: true, value: {} },
        "manual-first-party": { enumerable: true, value: {} },
        "local-news": { enumerable: true, value: {} },
      },
    ) as Record<string, DemandPulseCanarySourceConfig>;

    const result = await runDemandPulseCanary({
      env,
      now: RUN_AT,
      repository,
      adapters: {
        "gsc-site": adapterResult(
          observation("gsc", "search_observed", "gsc-1"),
        ),
        "dataforseo-discussions": adapterResult(
          observation("dataforseo", "search_observed", "dfs-1"),
        ),
        "manual-first-party": adapterResult(
          observation("manual", "first_party_observed", "manual-1"),
        ),
        "local-news": adapterResult(
          observation("local-news", "community_observed", "news-1"),
        ),
      },
      sourceConfigs,
      families: [family],
    });

    expect(result.status).toBe("completed");
    expect(
      repository.sourceRuns.find((row) => row.sourceId === "gsc")?.health,
    ).toBe("failed");
    expect(
      repository.sourceRuns.find((row) => row.sourceId === "gsc")?.errorMessage,
    ).toContain("config dependency unavailable");
    expect(repository.sourceRuns).toHaveLength(4);
    expect(repository.feedItems.length).toBeGreaterThan(0);
  });

  it("does not double-count an official seed matched by another adapter", async () => {
    const repository = new MemoryRepository();
    const [officialSeed, mismatchedSeed] = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS;
    repository.sources.splice(
      0,
      repository.sources.length,
      source(
        "official",
        "official_page_monitor",
        "primary_authoritative",
        officialSeed.id,
      ),
      source("mismatch", "gsc-site", "search_observed", mismatchedSeed.id),
    );
    const officialFetch = vi.fn(
      async () =>
        new Response(
          `<html><head><title>Official guidance</title></head><body>${"Verified composting guidance ".repeat(20)}</body></html>`,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
    );

    const result = await runDemandPulseCanary({
      env: { ...env, DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "true" },
      now: RUN_AT,
      repository,
      fetchFn: officialFetch,
      adapters: {
        "gsc-site": adapterResult(
          observation("mismatch", "search_observed", "mismatch-1"),
        ),
      },
      sourceConfigs: { "gsc-site": {} },
      families: [family],
    });

    expect(result.status).toBe("completed");
    expect(officialFetch).toHaveBeenCalledTimes(1);
    expect(repository.sourceRuns).toHaveLength(2);
    expect(repository.sourceRuns.map((row) => row.sourceId)).toEqual([
      "official",
      "mismatch",
    ]);
  });
});
