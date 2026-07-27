import { vi } from "vitest";
import { z } from "zod";
import type { OfficialPageFetch } from "../canaries/onfarmcompost-official-sources";
import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "../canaries/onfarmcompost-official-sources";
import {
  runScheduledOnFarmCompostOfficialMonitor,
  type OnFarmCompostOfficialMonitorEnv,
  type OnFarmCompostOfficialMonitorRepository,
  type OnFarmCompostOfficialMonitorResult,
} from "../canaries/onfarmcompost-official-monitor";
import {
  officialStateKey,
  runArtifactKey,
} from "../canaries/onfarmcompost-official-store";
import type {
  DemandPulseJsonBody,
  DemandPulseJsonBucket,
} from "../canaries/onfarmcompost-official-store";
import type {
  CompleteRunInput,
  DailyRunInput,
  DemandPulseProfile,
  DemandPulseRun,
  DemandPulseSource,
  RecordSourceRunInput,
} from "../repositories/DemandPulseRepository";

// Valid RFC-4122 v4 UUID (version nibble 4, variant 8/9/a/b) so the monitor's
// UUID validation accepts it — the prior all-ones fixture is not a real v4.
export const PROJECT_UUID = "5a1c2b3d-4e5f-4a6b-9c8d-7e8f9a0b1c2d";
export const PROFILE_ID = "profile-onfarmcompost-1";

export function stateKey(): string {
  return officialStateKey(PROJECT_UUID);
}

export function runArtifactKeyFor(localDate: string): string {
  return runArtifactKey(PROJECT_UUID, localDate);
}

// Minimal R2 double that records put ordering and can inject read/write
// failures so the post-claim failure boundary is exercisable.
export class MemoryR2 implements DemandPulseJsonBucket {
  readonly objects = new Map<string, string>();
  readonly putOrder: string[] = [];
  getFailure: Error | null = null;
  putFailure: Error | null = null;

  async head(key: string): Promise<unknown> {
    return this.objects.has(key) ? { key } : null;
  }

  async get(key: string): Promise<DemandPulseJsonBody | null> {
    if (this.getFailure) throw this.getFailure;
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      text: async () => value,
    };
  }

  async put(key: string, value: string): Promise<unknown> {
    if (this.putFailure) throw this.putFailure;
    this.objects.set(key, value);
    this.putOrder.push(key);
    return { key };
  }
}

type SourceRunRow = Omit<
  RecordSourceRunInput,
  "profileId" | "runId" | "sourceId"
> & {
  profileId: string;
  runId: string;
  sourceId: string;
};

// In-memory repository covering exactly the seams the monitor consumes. It
// validates project/profile/run/source ownership (so wrong-scope rows are
// detectable), mirrors claimDailyRun's {run, claimed} contract, and upserts
// source runs by (runId, sourceId) so resumed runs are idempotent. Rows are
// constructed as fully-typed objects — never via type assertions.
export class InMemoryRepository implements OnFarmCompostOfficialMonitorRepository {
  profile: DemandPulseProfile | null = null;
  sources: DemandPulseSource[] = [];
  private readonly runs = new Map<string, DemandPulseRun>();
  private readonly runsByClaimKey = new Map<string, DemandPulseRun>();
  readonly sourceRuns: SourceRunRow[] = [];
  readonly completions: CompleteRunInput[] = [];

  async getProfileByProjectId(
    projectId: string,
  ): Promise<DemandPulseProfile | null> {
    if (this.profile && this.profile.projectId === projectId)
      return this.profile;
    return null;
  }

  async listSourcesByProject(projectId: string): Promise<DemandPulseSource[]> {
    if (!this.profile || this.profile.projectId !== projectId) return [];
    return this.sources.filter((s) => s.profileId === this.profile!.id);
  }

  async claimDailyRun(
    input: DailyRunInput,
  ): Promise<{ run: DemandPulseRun; claimed: boolean }> {
    const claimKey = `${input.profileId}|${input.localDate}`;
    const existing = this.runsByClaimKey.get(claimKey);
    if (existing) return { run: existing, claimed: false };
    const run: DemandPulseRun = {
      id: crypto.randomUUID(),
      profileId: input.profileId,
      localDate: input.localDate,
      status: input.status ?? "pending",
      costMicros: 0,
      sourceCount: 0,
      healthySourceCount: 0,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      unknownSourceCount: 0,
      skippedSourceCount: 0,
      artifactKey: null,
      scoringVersion: input.scoringVersion,
      startedAt: new Date(0).toISOString(),
      completedAt: null,
      errorMessage: null,
    };
    this.runs.set(run.id, run);
    this.runsByClaimKey.set(claimKey, run);
    return { run, claimed: true };
  }

  getRun(runId: string): DemandPulseRun | undefined {
    return this.runs.get(runId);
  }

  async recordSourceRun(input: RecordSourceRunInput): Promise<SourceRunRow> {
    const run = this.runs.get(input.runId);
    if (!run || run.profileId !== input.profileId) {
      throw new Error("source run references unknown run/profile");
    }
    const row: SourceRunRow = {
      profileId: input.profileId,
      runId: input.runId,
      sourceId: input.sourceId,
      health: input.health,
      policyState: input.policyState,
      requestCount: input.requestCount,
      costMicros: input.costMicros,
      cursor: input.cursor ?? null,
      artifactPointer: input.artifactPointer ?? null,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt ?? new Date(0).toISOString(),
      completedAt: input.completedAt ?? null,
    };
    // Idempotent upsert by (runId, sourceId) so a resumed run does not stack
    // duplicate source-run rows.
    const index = this.sourceRuns.findIndex(
      (existing) =>
        existing.runId === row.runId && existing.sourceId === row.sourceId,
    );
    if (index >= 0) this.sourceRuns[index] = row;
    else this.sourceRuns.push(row);
    return row;
  }

  async completeRun(input: CompleteRunInput): Promise<DemandPulseRun | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.profileId !== input.profileId) return null;
    this.completions.push(input);
    Object.assign(run, input);
    return run;
  }
}

export function buildProfile(): DemandPulseProfile {
  return {
    id: PROFILE_ID,
    projectId: PROJECT_UUID,
    policyRepository: "sorcerai/onfarmcompost",
    policyCommit: "4d436f12ab2853410e1f4930f4cb0ee3b82cad93",
    policyPath: "docs/CONTENT_INTELLIGENCE_OS.md",
    enabled: true,
    dryRun: true,
    publicationDisabled: true,
    timezone: "America/Chicago",
    dailyBudgetMicros: 1_000_000,
    scoringVersion: "demand-pulse-v1",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

type OfficialSeed = (typeof ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS)[number];

export function buildSource(
  seed: OfficialSeed,
  overrides: Partial<DemandPulseSource> = {},
): DemandPulseSource {
  return {
    id: `src-${seed.id}`,
    profileId: PROFILE_ID,
    adapter: "official_page_monitor",
    identityKey: seed.id,
    sourceClass: "primary_authoritative",
    canonicalUrl: seed.url,
    recordKey: seed.id,
    approvalState: "approved",
    policyState: "allowed",
    enabled: true,
    discoveryProvenance: "onfarmcompost-canary-seed",
    version: 1,
    reviewedBy: "ops",
    reviewedAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

export function approvedSources(
  seeds: readonly OfficialSeed[] = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
): DemandPulseSource[] {
  return seeds.map((seed) => buildSource(seed));
}

export function healthyOfficialFetch(variant = 1): OfficialPageFetch {
  const body = `<html><head><title>Official compost guidance</title></head><body>
    <nav>Frequently changing navigation</nav>
    <main>${`Verified public composting guidance and program information. `.repeat(20)}${variant > 1 ? `Revision ${variant}. ` : ""}</main>
    <script>window.secret = "do not retain";</script>
  </body></html>`;
  return vi.fn(
    async () =>
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "last-modified": "Sun, 26 Jul 2026 12:00:00 GMT",
          etag: variant > 1 ? `"official-v${variant}"` : '"official-v1"',
        },
      }),
  );
}

// A fetch that omits Last-Modified so publicationDateBasis is "unknown" and
// publishedAt is null.
export function fetchWithoutLastModified(): OfficialPageFetch {
  const body = `<html><head><title>Official compost guidance</title></head><body>
    <main>${`Verified public composting guidance without a publication date. `.repeat(20)}</main>
  </body></html>`;
  return vi.fn(
    async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );
}

export function enabledEnv(
  bucket: DemandPulseJsonBucket,
  overrides: Record<string, string> = {},
): OnFarmCompostOfficialMonitorEnv {
  return {
    R2: bucket,
    DEMAND_PULSE_ENABLED: "true",
    DEMAND_PULSE_WRITE_ENABLED: "false",
    DEMAND_PULSE_DRY_RUN: "true",
    DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "true",
    DEMAND_PULSE_CANARY_ONFARMCOMPOST: "true",
    DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID: PROJECT_UUID,
    ...overrides,
  };
}

// Strict view of the run artifact: requires the run id, real project UUID, DB
// source ids in source health, error message, and the canonical observation
// metadata. Validated through zod rather than asserted from raw JSON.
export const artifactTestSchema = z.object({
  schemaVersion: z.literal("1"),
  runId: z.string().min(1),
  projectId: z.literal(PROJECT_UUID),
  mode: z.literal("dry_run"),
  publicationAllowed: z.literal(false),
  generatedAt: z.string(),
  localDate: z.string(),
  observations: z.array(
    z.object({
      sourceConnectionId: z.string().min(1),
      sourceClass: z.literal("primary_authoritative"),
      excerpt: z.string(),
      publishedAt: z.string().nullable(),
      metadata: z.object({
        sourceId: z.string().min(1),
        authorityClass: z.literal("primary_authoritative"),
        dbSourceId: z.string().min(1),
        runId: z.string().min(1),
        publicationDateBasis: z.string(),
      }),
    }),
  ),
  candidateCards: z.array(z.unknown()).length(0),
  sourceHealth: z.array(
    z.object({
      sourceId: z.string().min(1),
      health: z.enum(["healthy", "failed", "blocked", "unknown", "skipped"]),
      policyState: z.string().min(1),
      dbSourceId: z.string().min(1).nullable(),
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
  summary: z.object({
    configuredSources: z.literal(6),
    successfulSources: z.number(),
    changedSources: z.number(),
    baselineSources: z.number(),
    failedSources: z.number(),
  }),
  errorMessage: z.string().nullable(),
  nextStage: z.literal("coverage_clustering_scoring_and_review_not_wired"),
});

// Parse a run-artifact JSON blob through the schema. Routing JSON.parse through
// an intermediate `unknown` binding keeps the unvalidated `any` out of the zod
// call site, so the parsed shape is never the product of an unsafe argument.
export function parseRunArtifact(rawJson: string) {
  const parsed: unknown = JSON.parse(rawJson);
  return artifactTestSchema.parse(parsed);
}

// Build a repository that delegates every method to a base fake, with selected
// methods overridden — for failure injection (throwing/nulling a seam).
export function overridingRepo(
  base: InMemoryRepository,
  overrides: Partial<OnFarmCompostOfficialMonitorRepository>,
): OnFarmCompostOfficialMonitorRepository {
  return {
    getProfileByProjectId: (id) => base.getProfileByProjectId(id),
    listSourcesByProject: (id) => base.listSourcesByProject(id),
    claimDailyRun: (input) => base.claimDailyRun(input),
    recordSourceRun: (input) => base.recordSourceRun(input),
    completeRun: (input) => base.completeRun(input),
    ...overrides,
  };
}

export const DAY1 = "2026-07-26";
export const DAY1_AT = new Date(`${DAY1}T10:05:00.000Z`);

// Common-case call wrapper. The bare runScheduledOnFarmCompostOfficialMonitor
// call wraps to five lines under prettier (width 80); this collapses the
// repeated (enabledEnv, date, fetchFn, repository) shape to one line.
export async function runMonitor(
  bucket: DemandPulseJsonBucket,
  repository: OnFarmCompostOfficialMonitorRepository,
  fetchFn: OfficialPageFetch,
  date: Date = DAY1_AT,
): Promise<OnFarmCompostOfficialMonitorResult> {
  return runScheduledOnFarmCompostOfficialMonitor(
    enabledEnv(bucket),
    date,
    fetchFn,
    repository,
  );
}

export function firstRun(repository: InMemoryRepository) {
  return repository.completions[0];
}

// A fetch that throws for the given seed URLs and is otherwise healthy, so a
// run can be driven to an exact healthy/failed split.
export function fetchFailingFor(
  failingUrls: readonly string[],
): OfficialPageFetch {
  const healthy = healthyOfficialFetch();
  const failing = new Set(failingUrls);
  return vi.fn(async (input: string) => {
    if (failing.has(input)) throw new Error("upstream timeout");
    return healthy(input);
  });
}
