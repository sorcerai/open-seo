import {
  appendRunError,
  buildRunArtifact,
  describeError,
  runResultFromOutcome,
  type OnFarmCompostOfficialMonitorResult,
  type RunOutcome,
} from "./onfarmcompost-official-artifact";
import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "./onfarmcompost-official-sources";
import {
  officialStateKey,
  runArtifactKey,
  writeJsonArtifact,
  type DemandPulseJsonBucket,
} from "./onfarmcompost-official-store";
import type {
  CompleteRunInput,
  DemandPulseProfile,
} from "../repositories/DemandPulseRepository";
import type { OnFarmCompostOfficialMonitorRepository } from "./onfarmcompost-official-monitor";

const SEED_COUNT = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length;

export interface OnFarmCompostOfficialRunContext {
  repository: OnFarmCompostOfficialMonitorRepository;
  bucket: DemandPulseJsonBucket;
  profile: DemandPulseProfile;
  runId: string;
  localDate: string;
  generatedAt: string;
}

// Every terminal outcome writes a bounded R2 artifact before completing the DB
// run. Persistence is never silently swallowed: any artifact/state write or a
// null/throwing completeRun downgrades both the returned and DB status to
// failed. On downgrade a bounded failure artifact is attempted (null pointer if
// that write also fails). Only a clean completed run advances fingerprint state,
// and only after the artifact is durably written.
export async function finalizeRun(
  ctx: OnFarmCompostOfficialRunContext,
  outcome: RunOutcome,
): Promise<OnFarmCompostOfficialMonitorResult> {
  const { repository, bucket, profile, runId, localDate, generatedAt } = ctx;
  const projectId = profile.projectId;
  const successfulCount = outcome.successful.length;
  const failedSourceCount = outcome.results.filter(
    (result) => result.health === "failed",
  ).length;
  const blockedSourceCount = outcome.results.filter(
    (result) => result.health === "blocked",
  ).length;
  const unknownSourceCount = outcome.results.filter(
    (result) => result.health === "unknown",
  ).length;
  const skippedSourceCount =
    outcome.results.filter((result) => result.health === "skipped").length +
    Math.max(0, SEED_COUNT - outcome.results.length);
  const changedSources = outcome.successful.filter((r) => r.changed).length;
  const artifactKey = runArtifactKey(projectId, localDate);
  const build = (msg: string | null, emit: boolean) =>
    buildRunArtifact({
      runId,
      projectId,
      localDate,
      generatedAt,
      results: outcome.results,
      successful: outcome.successful,
      configuredSeeds: ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
      emitObservations: emit,
      errorMessage: msg,
      unresolvedSource:
        outcome.results.length === 0 && outcome.status === "blocked"
          ? {
              health: "blocked",
              policyState: "unknown",
              error: msg ?? "run blocked before source resolution",
            }
          : outcome.results.length === 0 && outcome.status === "failed"
            ? {
                health: "unknown",
                policyState: "unknown",
                error: msg ?? "run failed before source resolution",
              }
            : undefined,
    });
  const meta = {
    projectId,
    runId,
    artifactType: "demand_pulse_official_page_dry_run",
    localDate,
  };
  const runComplete = (
    st: CompleteRunInput["status"],
    ptr: string | null,
    msg: string | null,
  ) =>
    repository.completeRun({
      runId,
      profileId: profile.id,
      status: st,
      sourceCount: outcome.results.length,
      healthySourceCount: successfulCount,
      failedSourceCount,
      blockedSourceCount,
      unknownSourceCount,
      skippedSourceCount,
      artifactKey: ptr,
      errorMessage: msg,
      completedAt: generatedAt,
    });
  // Each persistence op returns its error string (null on success) so the flow
  // stays linear and every failure is folded into the run error message.
  const writeArtifact = async (
    key: string,
    value: unknown,
    m: Record<string, string>,
  ): Promise<string | null> => {
    try {
      await writeJsonArtifact(bucket, key, value, m);
      return null;
    } catch (e) {
      return describeError(e);
    }
  };
  const completeRunSafe = async (
    st: CompleteRunInput["status"],
    ptr: string | null,
    msg: string | null,
  ): Promise<string | null> => {
    try {
      return (await runComplete(st, ptr, msg)) === null
        ? "completeRun returned no row"
        : null;
    } catch (e) {
      return describeError(e);
    }
  };

  let status = outcome.status;
  let errorMessage = outcome.errorMessage;
  let pointer: string | null = null;

  // 1. Write the outcome artifact first.
  const artifactErr = await writeArtifact(
    artifactKey,
    build(errorMessage, outcome.emitObservations),
    { ...meta, status },
  );
  const artifactWritten = artifactErr === null;
  if (artifactWritten) pointer = artifactKey;
  else {
    status = "failed";
    errorMessage = appendRunError(
      errorMessage,
      "artifact write failed",
      artifactErr,
    );
  }

  // 2. Complete the DB run. Success is required before advancing state; a null
  //    return or throw downgrades to failed without advancing state.
  const completeErr = await completeRunSafe(status, pointer, errorMessage);
  const runCompleted = completeErr === null;
  if (!runCompleted) {
    status = "failed";
    errorMessage = appendRunError(errorMessage, completeErr, null);
    const failureArtifactErr = await writeArtifact(
      artifactKey,
      build(errorMessage, false),
      { ...meta, status },
    );
    pointer = failureArtifactErr === null ? artifactKey : null;
    await completeRunSafe("failed", pointer, errorMessage);
  } else if (status === "completed" && outcome.nextState) {
    // Advance fingerprint state only after the DB accepted the completed run.
    const stateErr = await writeArtifact(
      officialStateKey(projectId),
      outcome.nextState,
      { projectId, runId, artifactType: "official-page-state" },
    );
    if (stateErr !== null) {
      status = "failed";
      errorMessage = appendRunError(
        errorMessage,
        "state write failed",
        stateErr,
      );
      const failureArtifactErr = await writeArtifact(
        artifactKey,
        build(errorMessage, false),
        { ...meta, status },
      );
      pointer = failureArtifactErr === null ? artifactKey : null;
      await completeRunSafe("failed", pointer, errorMessage);
    }
  } else if (!artifactWritten) {
    // The first failed completion recorded a null pointer. Retry the bounded
    // failure artifact once, then update that same failed run with its pointer.
    const retryErr = await writeArtifact(
      artifactKey,
      build(errorMessage, false),
      { ...meta, status },
    );
    pointer = retryErr === null ? artifactKey : null;
    await completeRunSafe("failed", pointer, errorMessage);
  }

  return runResultFromOutcome({
    status,
    runId,
    artifactKey: status === "completed" ? artifactKey : pointer,
    successfulSources: successfulCount,
    changedSources,
    configuredSources: SEED_COUNT,
    cause: outcome.cause,
    errorMessage,
  });
}
