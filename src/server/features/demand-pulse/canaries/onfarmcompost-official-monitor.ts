import {
  getDemandPulseFeatureFlags,
  type DemandPulseFeatureFlagEnv,
} from "../feature-flags";
import { mapWithConcurrency } from "../sources/adapter";
import {
  blockedOutcome,
  blockedSourceResult,
  collectSource,
  describeError,
  evaluateOfficialSourceGate,
  findConfiguredSource,
  isProfileSafe,
  isSuccessfulOfficialSource,
  selectFetchableSources,
  type FetchableSource,
  type OfficialSourceGateOutcome,
  type OfficialSourceResult,
  type OnFarmCompostOfficialMonitorResult,
  type SuccessfulOfficialSourceResult,
} from "./onfarmcompost-official-artifact";
import {
  finalizeRun,
  type OnFarmCompostOfficialRunContext,
} from "./onfarmcompost-official-finalize";
import {
  ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
  type OfficialPageFetch,
} from "./onfarmcompost-official-sources";
import {
  isProjectUuid,
  readOfficialPageState,
  runArtifactKey,
  type DemandPulseJsonBucket,
  type OfficialPageState,
  type OfficialPageStateEntry,
} from "./onfarmcompost-official-store";
import {
  DemandPulseRepository,
  type CompleteRunInput,
  type DailyRunInput,
  type DemandPulseProfile,
  type DemandPulseRun,
  type DemandPulseSource,
  type RecordSourceRunInput,
} from "../repositories/DemandPulseRepository";

export type { OnFarmCompostOfficialMonitorResult } from "./onfarmcompost-official-artifact";

const TIME_ZONE = "America/Chicago";
const DAILY_RUN_HOUR = 5;
// A half-failed acquisition (3 of 6 healthy) must remain incomplete. The run is
// only completed when at least four official sources are healthy.
const MINIMUM_SUCCESSFUL_SOURCES = 4;
const SEED_COUNT = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length;

export interface OnFarmCompostOfficialMonitorEnv extends DemandPulseFeatureFlagEnv {
  R2: DemandPulseJsonBucket;
  // Real registered project UUID (projects table primary key). Resolved into
  // the OnFarmCompost demand-pulse profile; never the "onfarmcompost" slug.
  DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID?: string;
}

// Structural seam so the daily orchestration can be exercised against an
// in-memory repository in tests without touching D1/Postgres. Production uses
// the shared DemandPulseRepository singleton (default parameter below).
export interface OnFarmCompostOfficialMonitorRepository {
  getProfileByProjectId(projectId: string): Promise<DemandPulseProfile | null>;
  listSourcesByProject(projectId: string): Promise<DemandPulseSource[]>;
  claimDailyRun(
    input: DailyRunInput,
  ): Promise<{ run: DemandPulseRun; claimed: boolean }>;
  recordSourceRun(input: RecordSourceRunInput): Promise<unknown>;
  completeRun(input: CompleteRunInput): Promise<DemandPulseRun | null>;
}

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

const defaultOfficialPageFetch: OfficialPageFetch = (input, init) =>
  fetch(input, init);

function nonFetchableHealth(
  source: DemandPulseSource,
  gate: OfficialSourceGateOutcome,
): "blocked" | "skipped" {
  if (
    !gate.allowed &&
    (gate.rule === "disabled" ||
      (gate.rule === "unapproved" && source.approvalState === "pending"))
  ) {
    return "skipped";
  }
  return "blocked";
}

export function getChicagoDateTime(now: Date): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("Unable to resolve America/Chicago date parts");
  }
  return { date: `${year}-${month}-${day}`, hour, minute };
}

export function isPastDailyRunTime(local: LocalDateTime): boolean {
  return local.hour >= DAILY_RUN_HOUR;
}

async function recheckSafety(
  env: OnFarmCompostOfficialMonitorEnv,
  repository: OnFarmCompostOfficialMonitorRepository,
  projectId: string,
): Promise<{ safe: boolean; reason: string }> {
  const flags = getDemandPulseFeatureFlags(env);
  if (!flags.enabled || !flags.dryRun || flags.writeEnabled) {
    return { safe: false, reason: "environment safety flags changed" };
  }
  const profile = await repository.getProfileByProjectId(projectId);
  if (!profile || !isProfileSafe(profile)) {
    return { safe: false, reason: "profile safety gates changed" };
  }
  return { safe: true, reason: "" };
}

// Read a claimed-completed run artifact and return its identity, or null if it
// is missing/unparseable. Used to verify a claimed completion is real rather
// than reporting already_completed from a constructed key.
async function readClaimedArtifact(
  bucket: DemandPulseJsonBucket,
  key: string,
): Promise<{ projectId: string; runId: string } | null> {
  try {
    const body = await bucket.get(key);
    if (!body) return null;
    const parsed: unknown = JSON.parse(await body.text());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("runId" in parsed)
    ) {
      return null;
    }
    const obj = parsed as { projectId: unknown; runId: unknown };
    return typeof obj.projectId === "string" && typeof obj.runId === "string"
      ? { projectId: obj.projectId, runId: obj.runId }
      : null;
  } catch {
    return null;
  }
}

export async function runScheduledOnFarmCompostOfficialMonitor(
  env: OnFarmCompostOfficialMonitorEnv,
  now = new Date(),
  fetchFn: OfficialPageFetch = defaultOfficialPageFetch,
  repository: OnFarmCompostOfficialMonitorRepository = DemandPulseRepository,
): Promise<OnFarmCompostOfficialMonitorResult> {
  const flags = getDemandPulseFeatureFlags(env);
  if (
    !flags.enabled ||
    !flags.canaryOnFarmCompost ||
    !flags.sourceOfficialPages
  ) {
    return { status: "disabled" };
  }
  if (!flags.dryRun || flags.writeEnabled) {
    console.error(
      "[demand-pulse] OnFarmCompost canary refused unsafe feature flags",
    );
    return { status: "unsafe_configuration" };
  }

  const local = getChicagoDateTime(now);
  if (!isPastDailyRunTime(local)) {
    return { status: "before_daily_window", localDate: local.date };
  }

  const configuredProjectId = env.DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID;
  if (!configuredProjectId || !isProjectUuid(configuredProjectId)) {
    console.error(
      "[demand-pulse] OnFarmCompost monitor missing or invalid DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID",
    );
    return { status: "profile_not_configured" };
  }
  const profile = await repository.getProfileByProjectId(configuredProjectId);
  if (!profile || profile.projectId !== configuredProjectId) {
    console.error(
      `[demand-pulse] OnFarmCompost profile not registered for project ${configuredProjectId}`,
    );
    return { status: "profile_not_configured", projectId: configuredProjectId };
  }
  if (!isProfileSafe(profile)) {
    console.error(
      "[demand-pulse] OnFarmCompost canary refused unsafe profile gates",
    );
    return { status: "unsafe_configuration" };
  }

  const localDate = local.date;
  const generatedAt = now.toISOString();

  const { run, claimed } = await repository.claimDailyRun({
    profileId: profile.id,
    localDate,
    scoringVersion: profile.scoringVersion,
    status: "pending",
  });
  if (!claimed && run.status === "completed") {
    // Do not report already_completed from a constructed key: verify the
    // claimed completion has a valid artifact matching this project+run.
    const key = runArtifactKey(profile.projectId, localDate);
    const artifact = await readClaimedArtifact(env.R2, key);
    if (
      artifact === null ||
      artifact.projectId !== profile.projectId ||
      artifact.runId !== run.id
    ) {
      console.error(
        `[demand-pulse] OnFarmCompost run ${run.id} claimed completed but artifact missing/corrupt at ${key}`,
      );
      return {
        status: "blocked",
        runId: run.id,
        artifactKey: null,
        cause: "claimed_completion_corrupt",
      };
    }
    return { status: "already_completed", runId: run.id, artifactKey: key };
  }
  const runId = run.id;
  const ctx: OnFarmCompostOfficialRunContext = {
    repository,
    bucket: env.R2,
    profile,
    runId,
    localDate,
    generatedAt,
  };

  // Hoisted outside the try so a post-collection failure still retains the
  // acquired source health in the failure artifact.
  let results: OfficialSourceResult[] = [];
  let successful: SuccessfulOfficialSourceResult[] = [];

  try {
    const stateRead = await readOfficialPageState(env.R2, profile.projectId);
    if (stateRead.kind === "corrupt") {
      return await finalizeRun(
        ctx,
        blockedOutcome(
          "corrupt_state",
          "Corrupt official-page state in R2; manual remediation required",
        ),
      );
    }
    if (
      stateRead.kind === "ok" &&
      stateRead.state.projectId !== profile.projectId
    ) {
      return await finalizeRun(
        ctx,
        blockedOutcome(
          "wrong_project_state",
          "Official-page state belongs to a different project",
        ),
      );
    }
    const previousState = stateRead.kind === "ok" ? stateRead.state : null;
    const nextSources: Record<string, OfficialPageStateEntry> = previousState
      ? { ...previousState.sources }
      : {};

    const dbSources = await repository.listSourcesByProject(profile.projectId);
    const configuredSources = dbSources.filter(
      (source) => source.profileId === profile.id,
    );
    const fetchable = selectFetchableSources(
      ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
      configuredSources,
    );
    const fetchedResults = await mapWithConcurrency<
      FetchableSource,
      OfficialSourceResult
    >(fetchable, 3, ({ seed, source }) =>
      collectSource({
        seed,
        sourceId: source.id,
        policyState: source.policyState,
        previousState,
        nextSources,
        fetchFn,
        generatedAt,
      }),
    );
    const fetchedBySeed = new Map(
      fetchedResults.map((result) => [result.seed.id, result]),
    );
    results = [];
    for (const seed of ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS) {
      const fetched = fetchedBySeed.get(seed.id);
      if (fetched) {
        results.push(fetched);
        continue;
      }
      const source = findConfiguredSource(seed, configuredSources);
      if (!source) continue;
      if (source.adapter !== "official_page_monitor") {
        results.push(
          blockedSourceResult({
            seed,
            sourceId: source.id,
            policyState: source.policyState,
            health: "blocked",
            error: `source adapter ${source.adapter} is not official_page_monitor`,
            previousState,
          }),
        );
        continue;
      }
      const gate = evaluateOfficialSourceGate(source);
      results.push(
        blockedSourceResult({
          seed,
          sourceId: source.id,
          policyState: source.policyState,
          health: gate.allowed ? "unknown" : nonFetchableHealth(source, gate),
          error: gate.allowed
            ? "source passed the fetch gate but was not collected"
            : gate.reason,
          previousState,
        }),
      );
    }
    successful = results.filter(isSuccessfulOfficialSource);

    for (const result of results) {
      await repository.recordSourceRun({
        profileId: profile.id,
        runId,
        sourceId: result.sourceId,
        health: result.health,
        policyState: result.policyState,
        requestCount:
          result.health === "healthy" || result.health === "failed" ? 1 : 0,
        costMicros: 0,
        errorMessage: result.error,
        startedAt: generatedAt,
        completedAt: generatedAt,
      });
    }

    const recheck = await recheckSafety(env, repository, profile.projectId);
    if (!recheck.safe) {
      return await finalizeRun(ctx, {
        status: "blocked",
        results,
        successful,
        errorMessage: recheck.reason,
        cause: "unsafe_profile_recheck",
        emitObservations: false,
        nextState: null,
      });
    }

    if (successful.length < MINIMUM_SUCCESSFUL_SOURCES) {
      return await finalizeRun(ctx, {
        status: "incomplete",
        results,
        successful,
        errorMessage: `Insufficient source health ${successful.length}/${SEED_COUNT}`,
        emitObservations: false,
        nextState: null,
      });
    }

    const nextState: OfficialPageState = {
      schemaVersion: "1",
      projectId: profile.projectId,
      updatedAt: generatedAt,
      sources: nextSources,
    };
    return await finalizeRun(ctx, {
      status: "completed",
      results,
      successful,
      errorMessage: null,
      emitObservations: true,
      nextState,
    });
  } catch (error) {
    console.error(
      `[demand-pulse] OnFarmCompost run ${runId} failed: ${describeError(error)}`,
    );
    return await finalizeRun(ctx, {
      status: "failed",
      results,
      successful,
      errorMessage: describeError(error),
      emitObservations: false,
      nextState: null,
    });
  }
}
