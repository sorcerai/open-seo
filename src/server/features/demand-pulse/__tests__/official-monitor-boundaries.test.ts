import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "../canaries/onfarmcompost-official-sources";
import {
  runScheduledOnFarmCompostOfficialMonitor,
  type OnFarmCompostOfficialMonitorEnv,
} from "../canaries/onfarmcompost-official-monitor";
import type { OnFarmCompostOfficialMonitorResult } from "../canaries/onfarmcompost-official-artifact";
import {
  DAY1,
  DAY1_AT,
  InMemoryRepository,
  MemoryR2,
  approvedSources,
  buildProfile,
  buildSource,
  enabledEnv,
  fetchFailingFor,
  firstRun,
  healthyOfficialFetch,
  overridingRepo,
  parseRunArtifact,
  runArtifactKeyFor,
  runMonitor,
  stateKey,
} from "./official-monitor.test-utils";

function assertRunResult(
  result: OnFarmCompostOfficialMonitorResult,
): asserts result is Extract<
  OnFarmCompostOfficialMonitorResult,
  { runId: string }
> {
  if (!("runId" in result))
    throw new Error(`expected run result, got ${result.status}`);
}

describe("runScheduledOnFarmCompostOfficialMonitor failure boundaries", () => {
  let bucket: MemoryR2;
  let repository: InMemoryRepository;

  beforeEach(() => {
    bucket = new MemoryR2();
    repository = new InMemoryRepository();
    repository.profile = buildProfile();
  });

  it("fails closed when write mode is enabled", async () => {
    repository.sources = approvedSources();
    const env: OnFarmCompostOfficialMonitorEnv = {
      ...enabledEnv(bucket),
      DEMAND_PULSE_WRITE_ENABLED: "true",
    };
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      env,
      DAY1_AT,
      healthyOfficialFetch(),
      repository,
    );
    expect(result).toEqual({ status: "unsafe_configuration" });
    expect(repository.completions).toHaveLength(0);
  });

  it("fails closed on corrupt R2 state and writes a blocked artifact", async () => {
    repository.sources = approvedSources();
    bucket.objects.set(stateKey(), "{ not valid json ");
    const fetchFn = healthyOfficialFetch();
    const result = await runMonitor(bucket, repository, fetchFn);
    expect(result).toMatchObject({
      status: "blocked",
      artifactKey: runArtifactKeyFor(DAY1),
      cause: "corrupt_state",
    });
    expect(fetchFn).not.toHaveBeenCalled();
    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor(DAY1)) ?? "{}",
    );
    expect(artifact.errorMessage).toMatch(/Corrupt official-page state/);
    expect(firstRun(repository)?.status).toBe("blocked");
  });

  it("classifies an R2 read failure as corrupt and blocks (never a thrown exception)", async () => {
    repository.sources = approvedSources();
    bucket.getFailure = new Error("r2 unavailable");
    const result = await runMonitor(bucket, repository, healthyOfficialFetch());
    expect(result).toMatchObject({ status: "blocked", cause: "corrupt_state" });
  });

  it("blocks when persisted state belongs to a different project", async () => {
    repository.sources = approvedSources();
    bucket.objects.set(
      stateKey(),
      JSON.stringify({
        schemaVersion: "1",
        projectId: "00000000-0000-4000-8000-000000000000",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sources: {},
      }),
    );
    const result = await runMonitor(bucket, repository, healthyOfficialFetch());
    expect(result).toMatchObject({
      status: "blocked",
      cause: "wrong_project_state",
    });
  });

  it("does not fetch unapproved, disabled, or foreign-adapter sources", async () => {
    const [seedA, seedB, seedC] = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS;
    repository.sources = [
      buildSource(seedA),
      buildSource(seedB, { approvalState: "pending", enabled: false }),
      buildSource(seedC, { adapter: "manual", canonicalUrl: seedC.url }),
    ];
    const fetchFn = healthyOfficialFetch();
    const result = await runMonitor(bucket, repository, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "insufficient_source_health",
      successfulSources: 1,
    });
  });

  it("persists explicit source states for every configured seed without anonymous skips", async () => {
    const [approved, pending, rejected, disabled, policyBlocked, unregistered] =
      ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS;
    repository.sources = [
      buildSource(approved, { policyState: "allowed" }),
      buildSource(pending, {
        approvalState: "pending",
        enabled: false,
        policyState: "allowed",
      }),
      buildSource(rejected, {
        approvalState: "rejected",
        enabled: true,
        policyState: "blocked",
      }),
      buildSource(disabled, {
        enabled: false,
        policyState: "allowed",
      }),
      buildSource(policyBlocked, {
        policyState: "blocked",
      }),
    ];
    const result = await runMonitor(bucket, repository, healthyOfficialFetch());
    expect(result).toMatchObject({
      status: "insufficient_source_health",
      successfulSources: 1,
      configuredSources: 6,
    });

    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor(DAY1)) ?? "{}",
    );
    const healthBySeed = new Map(
      artifact.sourceHealth.map((entry) => [entry.sourceId, entry]),
    );
    expect(healthBySeed.get(approved.id)).toMatchObject({
      dbSourceId: `src-${approved.id}`,
      health: "healthy",
      policyState: "allowed",
      error: null,
    });
    expect(healthBySeed.get(pending.id)).toMatchObject({
      dbSourceId: `src-${pending.id}`,
      health: "skipped",
      policyState: "allowed",
    });
    expect(healthBySeed.get(rejected.id)).toMatchObject({
      dbSourceId: `src-${rejected.id}`,
      health: "blocked",
      policyState: "blocked",
    });
    expect(healthBySeed.get(disabled.id)).toMatchObject({
      dbSourceId: `src-${disabled.id}`,
      health: "skipped",
      policyState: "allowed",
    });
    expect(healthBySeed.get(policyBlocked.id)).toMatchObject({
      dbSourceId: `src-${policyBlocked.id}`,
      health: "blocked",
      policyState: "blocked",
    });
    expect(healthBySeed.get(unregistered.id)).toMatchObject({
      dbSourceId: null,
      health: "skipped",
      policyState: "unregistered",
    });
    expect(
      artifact.sourceHealth
        .filter((entry) => entry.health !== "healthy")
        .every((entry) => entry.error !== null),
    ).toBe(true);

    expect(repository.sourceRuns).toHaveLength(5);
    expect(
      new Map(repository.sourceRuns.map((run) => [run.sourceId, run])).get(
        `src-${pending.id}`,
      ),
    ).toMatchObject({ health: "skipped", policyState: "allowed" });
    expect(
      new Map(repository.sourceRuns.map((run) => [run.sourceId, run])).get(
        `src-${rejected.id}`,
      ),
    ).toMatchObject({ health: "blocked", policyState: "blocked" });
    expect(
      new Map(repository.sourceRuns.map((run) => [run.sourceId, run])).get(
        `src-${disabled.id}`,
      ),
    ).toMatchObject({ health: "skipped", policyState: "allowed" });
    expect(
      new Map(repository.sourceRuns.map((run) => [run.sourceId, run])).get(
        `src-${policyBlocked.id}`,
      ),
    ).toMatchObject({ health: "blocked", policyState: "blocked" });
    expect(firstRun(repository)).toMatchObject({
      sourceCount: 5,
      healthySourceCount: 1,
      failedSourceCount: 0,
      blockedSourceCount: 2,
      skippedSourceCount: 3,
    });
  });

  it("persists every source failure and remains incomplete below the health floor", async () => {
    repository.sources = approvedSources();
    const result = await runMonitor(
      bucket,
      repository,
      fetchFailingFor(ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((s) => s.url)),
    );
    expect(result.status).toBe("insufficient_source_health");
    expect(repository.sourceRuns).toHaveLength(6);
    expect(repository.sourceRuns.every((r) => r.health === "failed")).toBe(
      true,
    );
    expect(firstRun(repository)?.status).toBe("incomplete");
  });

  it("finalizes a failed run when a repository operation throws post-claim", async () => {
    repository.sources = approvedSources();
    const failingRepo = overridingRepo(repository, {
      listSourcesByProject: async () => {
        throw new Error("db unavailable");
      },
    });
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket),
      DAY1_AT,
      healthyOfficialFetch(),
      failingRepo,
    );
    expect(result.status).toBe("failed");
    assertRunResult(result);
    expect(result.artifactKey).toBe(runArtifactKeyFor(DAY1));
    expect(firstRun(repository)?.status).toBe("failed");
  });

  it("retains acquired source health in the failure artifact when recording throws after collection", async () => {
    repository.sources = approvedSources();
    const failingRepo = overridingRepo(repository, {
      recordSourceRun: async () => {
        throw new Error("db write failed");
      },
    });
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket),
      DAY1_AT,
      healthyOfficialFetch(),
      failingRepo,
    );
    expect(result.status).toBe("failed");
    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor(DAY1)) ?? "{}",
    );
    expect(artifact.sourceHealth).toHaveLength(6);
  });

  it("downgrades to failed when the artifact write fails (R2 put failure)", async () => {
    repository.sources = approvedSources();
    bucket.putFailure = new Error("r2 put unavailable");
    const result = await runMonitor(bucket, repository, healthyOfficialFetch());
    expect(result.status).toBe("failed");
    assertRunResult(result);
    expect(result.artifactKey).toBeNull();
    expect(firstRun(repository)?.status).toBe("failed");
  });

  it("downgrades to failed when completeRun returns null, never completed", async () => {
    repository.sources = approvedSources();
    const nullCompleting = overridingRepo(repository, {
      completeRun: async () => null,
    });
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket),
      DAY1_AT,
      healthyOfficialFetch(),
      nullCompleting,
    );
    expect(result.status).toBe("failed");
  });

  it("refuses an unsafe profile (non-dry-run / publication-enabled / disabled)", async () => {
    repository.sources = approvedSources();
    for (const overrides of [
      { dryRun: false },
      { publicationDisabled: false },
      { enabled: false },
    ]) {
      repository.profile = { ...buildProfile(), ...overrides };
      const result = await runMonitor(
        bucket,
        repository,
        healthyOfficialFetch(),
      );
      expect(result.status).toBe("unsafe_configuration");
    }
    expect(repository.completions).toHaveLength(0);
  });

  it("blocks at the final boundary if profile gates change mid-run", async () => {
    repository.sources = approvedSources();
    let calls = 0;
    const flipping = overridingRepo(repository, {
      // The final-boundary recheck (the second resolution) sees a
      // publication-enabled profile.
      getProfileByProjectId: async (id) => {
        const profile = await repository.getProfileByProjectId(id);
        calls += 1;
        return calls >= 2 && profile
          ? { ...profile, publicationDisabled: false }
          : profile;
      },
    });
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket),
      DAY1_AT,
      healthyOfficialFetch(),
      flipping,
    );
    expect(result).toMatchObject({
      status: "blocked",
      cause: "unsafe_profile_recheck",
    });
    expect(firstRun(repository)?.status).toBe("blocked");
  });

  it("fails closed when the project UUID is missing, invalid, or unregistered", async () => {
    const fetchFn = healthyOfficialFetch();
    const missing = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket, { DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID: "" }),
      DAY1_AT,
      fetchFn,
      repository,
    );
    expect(missing.status).toBe("profile_not_configured");
    const invalid = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket, {
        DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID: "onfarmcompost",
      }),
      DAY1_AT,
      fetchFn,
      repository,
    );
    expect(invalid.status).toBe("profile_not_configured");
    repository.profile = null;
    const unregistered = await runMonitor(bucket, repository, fetchFn);
    expect(unregistered).toMatchObject({ status: "profile_not_configured" });
    expect(repository.completions).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
