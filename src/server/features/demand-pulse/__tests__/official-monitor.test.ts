import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

import {
  extractOfficialPageText,
  isAllowedOfficialRedirect,
  ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
} from "../canaries/onfarmcompost-official-sources";
import {
  getChicagoDateTime,
  isPastDailyRunTime,
} from "../canaries/onfarmcompost-official-monitor";
import type { OnFarmCompostOfficialMonitorResult } from "../canaries/onfarmcompost-official-artifact";
import { readOfficialPageState } from "../canaries/onfarmcompost-official-store";
import { getDemandPulseFeatureFlags } from "../feature-flags";
import {
  DAY1,
  PROJECT_UUID,
  InMemoryRepository,
  MemoryR2,
  approvedSources,
  buildProfile,
  buildSource,
  fetchFailingFor,
  fetchWithoutLastModified,
  firstRun,
  healthyOfficialFetch,
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

const DAY2_AT = new Date("2026-07-27T10:05:00.000Z");

describe("Demand Pulse feature flags", () => {
  it("keeps the canary disabled by default", () => {
    expect(getDemandPulseFeatureFlags({}).canaryOnFarmCompost).toBe(false);
  });

  it("parses the official-source canary flags explicitly", () => {
    const flags = getDemandPulseFeatureFlags({
      DEMAND_PULSE_ENABLED: "true",
      DEMAND_PULSE_DRY_RUN: "yes",
      DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "1",
      DEMAND_PULSE_CANARY_ONFARMCOMPOST: "on",
    });
    expect(flags).toMatchObject({
      enabled: true,
      dryRun: true,
      sourceOfficialPages: true,
      canaryOnFarmCompost: true,
      writeEnabled: false,
    });
  });
});

describe("OnFarmCompost official-source schedule", () => {
  it("uses America/Chicago across daylight and standard time", () => {
    expect(getChicagoDateTime(new Date("2026-07-26T10:05:00.000Z"))).toEqual({
      date: "2026-07-26",
      hour: 5,
      minute: 5,
    });
  });

  it("waits until 05:00 local time", () => {
    expect(isPastDailyRunTime({ date: DAY1, hour: 4, minute: 59 })).toBe(false);
    expect(isPastDailyRunTime({ date: DAY1, hour: 5, minute: 0 })).toBe(true);
  });
});

describe("official page safety helpers", () => {
  it("fingerprints primary content without scripts, styles, or navigation", async () => {
    const extracted = await extractOfficialPageText(`
      <html><head><title> Compost Rules </title><style>.x{}</style></head>
      <body><nav>nav</nav><main>Texas compost guidance</main><script>steal()</script></body>
      </html>`);
    expect(extracted.text).toBe("Texas compost guidance");
    expect(extracted.excerpt).not.toContain("steal");
  });

  it("allows only requested or explicitly approved official hosts", () => {
    const hosts = ["www.tceq.texas.gov", "tceq.texas.gov"];
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/a",
        "https://tceq.texas.gov/b",
        hosts,
      ),
    ).toBe(true);
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/a",
        "https://texas.gov/b",
        hosts,
      ),
    ).toBe(false);
  });
});

describe("runScheduledOnFarmCompostOfficialMonitor", () => {
  let bucket: MemoryR2;
  let repository: InMemoryRepository;

  beforeEach(() => {
    bucket = new MemoryR2();
    repository = new InMemoryRepository();
    repository.profile = buildProfile();
  });

  it("completes a healthy run, writes artifact before state, scopes by project UUID", async () => {
    repository.sources = approvedSources();
    const fetchFn = healthyOfficialFetch();
    const result = await runMonitor(bucket, repository, fetchFn);

    // First run: every source is a baseline, never a velocity event.
    expect(result).toMatchObject({
      status: "completed",
      successfulSources: 6,
      changedSources: 0,
    });
    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(bucket.putOrder).toEqual([runArtifactKeyFor(DAY1), stateKey()]);

    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor(DAY1)) ?? "{}",
    );
    expect(artifact.summary).toEqual({
      configuredSources: 6,
      successfulSources: 6,
      changedSources: 0,
      baselineSources: 6,
      failedSources: 0,
    });
    expect(artifact.observations).toHaveLength(0);
    expect(
      artifact.sourceHealth.every(
        (h) => h.dbSourceId?.startsWith("src-") === true,
      ),
    ).toBe(true);

    const stateRead = await readOfficialPageState(bucket, PROJECT_UUID);
    if (stateRead.kind !== "ok") throw new Error("expected state");
    expect(stateRead.state.projectId).toBe(PROJECT_UUID);
    expect(
      Object.values(stateRead.state.sources).every(
        (s) => s.lastChangedAt === null,
      ),
    ).toBe(true);

    const run = firstRun(repository);
    expect(run?.status).toBe("completed");
    expect(run?.artifactKey).toBe(runArtifactKeyFor(DAY1));
    expect(repository.sourceRuns).toHaveLength(6);
  });

  it("emits primary_authoritative change observations with db sourceId only after a real change", async () => {
    repository.sources = approvedSources();
    await runMonitor(bucket, repository, healthyOfficialFetch());
    const day2 = await runMonitor(
      bucket,
      repository,
      healthyOfficialFetch(2),
      DAY2_AT,
    );
    expect(day2).toMatchObject({ status: "completed", changedSources: 6 });
    assertRunResult(day2);
    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor("2026-07-27")) ?? "{}",
    );
    expect(artifact.observations).toHaveLength(6);
    expect(artifact.observations[0]?.sourceConnectionId).toBe(
      "src-tceq-composting-and-mulching",
    );
    expect(artifact.observations[0]?.metadata?.sourceId).toBe(
      "tceq-composting-and-mulching",
    );
    expect(artifact.observations[0]?.metadata?.dbSourceId).toBe(
      artifact.observations[0]?.sourceConnectionId,
    );
    expect(artifact.observations[0]?.metadata.dbSourceId).toMatch(/^src-/);
    expect(artifact.observations[0]?.metadata.runId).toBe(day2.runId);
    expect(artifact.observations[0]?.publishedAt).toBe(
      "2026-07-26T12:00:00.000Z",
    );
    const stateRead = await readOfficialPageState(bucket, PROJECT_UUID);
    if (stateRead.kind !== "ok") throw new Error("expected state");
    expect(
      Object.values(stateRead.state.sources).every(
        (s) => s.lastChangedAt !== null,
      ),
    ).toBe(true);
  });

  it("leaves publishedAt null and basis unknown when Last-Modified is absent", async () => {
    repository.sources = approvedSources();
    await runMonitor(bucket, repository, healthyOfficialFetch());
    await runMonitor(bucket, repository, fetchWithoutLastModified(), DAY2_AT);
    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor("2026-07-27")) ?? "{}",
    );
    expect(artifact.observations[0]?.publishedAt).toBeNull();
    expect(artifact.observations[0]?.metadata.publicationDateBasis).toBe(
      "unknown",
    );
  });

  it("treats exactly 3/6 healthy as incomplete and writes a failure artifact without advancing state", async () => {
    repository.sources = approvedSources();
    const [, , , d, e, f] = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS;
    const result = await runMonitor(
      bucket,
      repository,
      fetchFailingFor([d.url, e.url, f.url]),
    );
    expect(result).toMatchObject({
      status: "insufficient_source_health",
      successfulSources: 3,
      configuredSources: 6,
    });
    assertRunResult(result);
    expect(result.artifactKey).toBe(runArtifactKeyFor(DAY1));
    const artifact = parseRunArtifact(
      bucket.objects.get(runArtifactKeyFor(DAY1)) ?? "{}",
    );
    expect(artifact.candidateCards).toHaveLength(0);
    expect(artifact.errorMessage).toMatch(/Insufficient source health/);
    expect(artifact.sourceHealth.filter((h) => !h.ok)).toHaveLength(3);
    // Incomplete runs never advance fingerprint state.
    expect(bucket.objects.has(stateKey())).toBe(false);
    expect(firstRun(repository)?.status).toBe("incomplete");
  });

  it("resumes a non-completed run idempotently and completes once healthy", async () => {
    // Day 1: only three sources approved -> incomplete.
    const [a, b, c] = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS;
    repository.sources = [buildSource(a), buildSource(b), buildSource(c)];
    const first = await runMonitor(bucket, repository, healthyOfficialFetch());
    expect(first.status).toBe("insufficient_source_health");
    assertRunResult(first);
    const incompleteRunId = first.runId;
    expect(repository.sourceRuns).toHaveLength(3);

    // Same Chicago date, later cron: all six now approved. The existing
    // non-completed run is resumed (same run id) and completed.
    repository.sources = approvedSources();
    const second = await runMonitor(
      bucket,
      repository,
      healthyOfficialFetch(),
      new Date("2026-07-26T18:00:00.000Z"),
    );
    expect(second.status).toBe("completed");
    assertRunResult(second);
    expect(second.runId).toBe(incompleteRunId);
    // Resumed source-run upserts do not stack duplicates.
    expect(repository.sourceRuns).toHaveLength(6);
    expect(repository.completions).toHaveLength(2);
  });

  it("treats an existing completed run as already_completed", async () => {
    repository.sources = approvedSources();
    await runMonitor(bucket, repository, healthyOfficialFetch());
    const second = await runMonitor(
      bucket,
      repository,
      healthyOfficialFetch(),
      new Date("2026-07-26T18:00:00.000Z"),
    );
    expect(second).toMatchObject({
      status: "already_completed",
      artifactKey: runArtifactKeyFor(DAY1),
    });
  });

  it("blocks a completed claim whose artifact is missing", async () => {
    repository.sources = approvedSources();
    await runMonitor(bucket, repository, healthyOfficialFetch());
    bucket.objects.delete(runArtifactKeyFor(DAY1));

    const result = await runMonitor(
      bucket,
      repository,
      healthyOfficialFetch(),
      new Date("2026-07-26T18:00:00.000Z"),
    );

    expect(result).toMatchObject({
      status: "blocked",
      cause: "claimed_completion_corrupt",
    });
  });
});
