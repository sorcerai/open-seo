import type {
  CompleteRunInput,
  DemandPulseProfile,
  DemandPulseRun,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import type { DemandObservationCandidate } from "../types";
import type { DemandPulseFeatureFlags } from "../feature-flags";
import { errorText } from "./dailyCanaryAdapters";
import {
  CANARY_ARTIFACT_VERSION,
  MAX_FEED_ITEMS,
  TIME_ZONE,
  type DemandPulseCanaryArtifact,
  type DemandPulseCanaryMetrics,
  type DemandPulseCanaryRepository,
  type DemandPulseCanaryResult,
  type DemandPulseCanarySourceHealth,
  type RunDemandPulseCanaryInput,
} from "./dailyCanaryTypes";
import type { ProcessedEvidence } from "./dailyCanaryProcessing";
import { writeJsonArtifact } from "../canaries/onfarmcompost-official-store";

export interface PreparedCanaryRun {
  input: RunDemandPulseCanaryInput;
  flags: DemandPulseFeatureFlags;
  now: Date;
  localDate: string;
  projectId: string;
  repository: DemandPulseCanaryRepository;
  profile: DemandPulseProfile;
  run: DemandPulseRun;
  artifactKey: string;
}

export interface AcquisitionState {
  sources: DemandPulseSource[];
  sourceById: ReadonlyMap<string, DemandPulseSource>;
  sourceHealth: DemandPulseCanarySourceHealth[];
  observations: DemandObservationCandidate[];
  errors: string[];
}

export interface ArtifactState {
  artifact: DemandPulseCanaryArtifact;
  metrics: DemandPulseCanaryMetrics;
}

export function countHealth(
  sourceHealth: readonly DemandPulseCanarySourceHealth[],
): Omit<
  DemandPulseCanaryMetrics,
  | "configuredSourceCount"
  | "observationCount"
  | "evidenceEventCount"
  | "observationEventCount"
  | "duplicateEdgeCount"
  | "familyCount"
  | "coverageCheckCount"
  | "scoreCount"
  | "feedItemCount"
> {
  return {
    sourceRunCount: sourceHealth.length,
    successfulSourceCount: sourceHealth.filter(
      (row) => row.health === "healthy",
    ).length,
    failedSourceCount: sourceHealth.filter((row) => row.health === "failed")
      .length,
    blockedSourceCount: sourceHealth.filter((row) => row.health === "blocked")
      .length,
    unknownSourceCount: sourceHealth.filter((row) => row.health === "unknown")
      .length,
    skippedSourceCount: sourceHealth.filter((row) => row.health === "skipped")
      .length,
    feedLimit: MAX_FEED_ITEMS,
    publicationAllowed: false,
  };
}

export function minimumHealthySourceCount(
  configuredSourceCount: number,
): number {
  return Math.ceil((configuredSourceCount * 2) / 3);
}

export function buildArtifact(
  context: PreparedCanaryRun,
  state: AcquisitionState,
  processed: ProcessedEvidence | null,
): ArtifactState {
  const healthFloorMet =
    countHealth(state.sourceHealth).successfulSourceCount >=
    minimumHealthySourceCount(state.sources.length);
  const promotable = healthFloorMet ? processed : null;
  const metrics: DemandPulseCanaryMetrics = {
    ...countHealth(state.sourceHealth),
    configuredSourceCount: state.sources.length,
    observationCount: state.observations.length,
    evidenceEventCount: promotable?.evidenceGraph.evidenceEvents.length ?? 0,
    observationEventCount:
      promotable?.evidenceGraph.observationEvents.length ?? 0,
    duplicateEdgeCount: promotable?.evidenceGraph.duplicateEdges.length ?? 0,
    familyCount: promotable?.familyResults.families.length ?? 0,
    coverageCheckCount: promotable?.familyResults.coverageChecks.length ?? 0,
    scoreCount: promotable?.familyResults.scores.length ?? 0,
    feedItemCount: promotable?.feedRows.length ?? 0,
  };
  const artifact: DemandPulseCanaryArtifact = {
    schemaVersion: "1",
    artifactType: CANARY_ARTIFACT_VERSION,
    runId: context.run.id,
    projectId: context.projectId,
    profileId: context.profile.id,
    localDate: context.localDate,
    generatedAt: context.now.toISOString(),
    timezone: TIME_ZONE,
    mode: "dry_run",
    publicationAllowed: false,
    sourceHealth: state.sourceHealth,
    observations: state.observations,
    evidence: {
      events: promotable?.evidenceGraph.evidenceEvents ?? [],
      observationEvents: promotable?.evidenceGraph.observationEvents ?? [],
      duplicateEdges: promotable?.evidenceGraph.duplicateEdges ?? [],
    },
    families: promotable?.families ?? [],
    coverage: promotable?.coverage ?? [],
    scores: promotable?.scores ?? [],
    candidateCards: promotable?.feedItems ?? [],
    metrics,
    errors: state.errors,
    excludedFeedItems: promotable?.excludedFeedItems ?? [],
    nextStage: "complete_demand_pulse_v1_no_publication",
  };
  return { artifact, metrics };
}

export async function finalizeRun(
  context: PreparedCanaryRun,
  state: AcquisitionState,
  processed: ProcessedEvidence | null,
  artifactState: ArtifactState,
): Promise<DemandPulseCanaryResult> {
  const insufficientHealthMessage = `Insufficient source health ${artifactState.metrics.successfulSourceCount}/${artifactState.metrics.configuredSourceCount}`;
  const belowHealthFloor =
    processed !== null &&
    artifactState.metrics.successfulSourceCount <
      minimumHealthySourceCount(artifactState.metrics.configuredSourceCount);
  if (processed === null && state.errors.length === 0) {
    state.errors.push("Demand Pulse processing failed");
  }
  if (belowHealthFloor) state.errors.push(insufficientHealthMessage);

  let artifactWriteError: string | null = null;
  try {
    await writeJsonArtifact(
      context.input.env.R2,
      context.artifactKey,
      artifactState.artifact,
      {
        projectId: context.projectId,
        runId: context.run.id,
        artifactType: CANARY_ARTIFACT_VERSION,
      },
    );
  } catch (error) {
    artifactWriteError = `artifact write failed: ${errorText(error)}`;
    state.errors.push(artifactWriteError);
  }
  const status =
    artifactWriteError || processed === null
      ? "failed"
      : belowHealthFloor
        ? "incomplete"
        : "completed";
  const persistedError = state.errors.join("; ");
  const errorMessage =
    status === "failed"
      ? persistedError || "Demand Pulse processing failed"
      : status === "incomplete"
        ? insufficientHealthMessage
        : null;
  const completeInput: CompleteRunInput = {
    runId: context.run.id,
    profileId: context.profile.id,
    status,
    sourceCount: state.sourceHealth.length,
    healthySourceCount: artifactState.metrics.successfulSourceCount,
    failedSourceCount: artifactState.metrics.failedSourceCount,
    blockedSourceCount: artifactState.metrics.blockedSourceCount,
    unknownSourceCount: artifactState.metrics.unknownSourceCount,
    skippedSourceCount: artifactState.metrics.skippedSourceCount,
    artifactKey: artifactWriteError ? null : context.artifactKey,
    errorMessage,
    completedAt: context.now.toISOString(),
  };
  await context.repository.completeRun(completeInput);
  return {
    status,
    runId: context.run.id,
    artifactKey: artifactWriteError ? null : context.artifactKey,
    artifact: artifactState.artifact,
    metrics: artifactState.metrics,
    errorMessage,
  };
}
