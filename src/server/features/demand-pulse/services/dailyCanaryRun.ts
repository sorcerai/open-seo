import { getDemandPulseFeatureFlags } from "../feature-flags";
import { DemandPulseEvidenceRepository } from "../repositories/DemandPulseEvidenceRepository";
import { DemandPulseFeedRepository } from "../repositories/DemandPulseFeedRepository";
import {
  DemandPulseRepository,
  type DailyRunInput,
  type DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import type {
  DemandObservationCandidate,
  SourceCapabilityDescriptor,
} from "../types";
import {
  DAILY_RUN_HOUR,
  COVERAGE_EVALUATOR_VERSION,
  DEMAND_PULSE_EVIDENCE_VERSION,
  FEED_SELECTION_VERSION,
  type DemandPulseCanaryEnv,
  type DemandPulseCanaryRepository,
  type DemandPulseCanaryResult,
  type DemandPulseCanarySourceHealth,
  type RunDemandPulseCanaryInput,
} from "./dailyCanaryTypes";
import {
  defaultAdapters,
  defaultOfficialFetch,
  errorText,
  isProfileSafe,
  parseJson,
  sourceAdapterForRow,
  sourceConfigFor,
  sourceFlagEnabled,
} from "./dailyCanaryAdapters";
import {
  acquireConfiguredAdapter,
  emptyReservationSeam,
  healthForBlocked,
  localDateFor,
  readArtifactIdentity,
  sourceApprovalGate,
  sourceHealthFromRun,
  type AdapterAcquisitionResult,
} from "./dailyCanaryAcquisition";
import { acquireOfficialSources } from "./dailyCanaryOfficial";
import { parseFamilyDefinitions } from "./dailyCanaryEvidence";
import {
  processEvidence,
  type ProcessedEvidence,
} from "./dailyCanaryProcessing";
import {
  buildArtifact,
  countHealth,
  finalizeRun,
  minimumHealthySourceCount,
  type AcquisitionState,
  type PreparedCanaryRun,
} from "./dailyCanaryArtifact";
import type { DemandSourceRunHealth } from "../sources/adapter";
import { runArtifactKey } from "../canaries/onfarmcompost-official-store";

const defaultRepository: DemandPulseCanaryRepository = {
  ...DemandPulseRepository,
  ...DemandPulseEvidenceRepository,
  ...DemandPulseFeedRepository,
};
interface PreparationResult {
  kind: "ready";
  context: PreparedCanaryRun;
}

interface EarlyResult {
  kind: "result";
  result: DemandPulseCanaryResult;
}
async function prepareCanaryRun(
  input: RunDemandPulseCanaryInput,
): Promise<PreparationResult | EarlyResult> {
  const now = input.now ?? new Date();
  const flags = getDemandPulseFeatureFlags(input.env);
  if (!flags.enabled || !flags.canaryOnFarmCompost) {
    return { kind: "result", result: { status: "disabled" } };
  }
  if (!flags.dryRun || flags.writeEnabled) {
    return {
      kind: "result",
      result: { status: "unsafe_configuration" },
    };
  }
  const local = localDateFor(now);
  if (local.hour < DAILY_RUN_HOUR) {
    return {
      kind: "result",
      result: { status: "before_daily_window", localDate: local.date },
    };
  }
  const projectId = input.env.DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID;
  if (!projectId) {
    return {
      kind: "result",
      result: { status: "profile_not_configured" },
    };
  }
  const repository = input.repository ?? defaultRepository;
  const profile = await repository.getProfileByProjectId(projectId);
  if (!profile || profile.projectId !== projectId) {
    return {
      kind: "result",
      result: { status: "profile_not_configured", projectId },
    };
  }
  if (!isProfileSafe(profile)) {
    return {
      kind: "result",
      result: { status: "unsafe_configuration" },
    };
  }
  const { run, claimed } = await repository.claimDailyRun({
    profileId: profile.id,
    localDate: local.date,
    scoringVersion: profile.scoringVersion,
    status: "pending",
  } satisfies DailyRunInput);
  const artifactKey = runArtifactKey(projectId, local.date);
  if (!claimed && run.status === "completed") {
    const identity = await readArtifactIdentity(input.env.R2, artifactKey);
    if (
      !identity ||
      identity.projectId !== projectId ||
      identity.runId !== run.id
    ) {
      return {
        kind: "result",
        result: {
          status: "failed",
          runId: run.id,
          artifactKey: null,
          artifact: null,
          metrics: {
            ...countHealth([]),
            configuredSourceCount: 0,
            observationCount: 0,
            evidenceEventCount: 0,
            observationEventCount: 0,
            duplicateEdgeCount: 0,
            familyCount: 0,
            coverageCheckCount: 0,
            scoreCount: 0,
            feedItemCount: 0,
          },
          errorMessage: "claimed completion artifact missing or corrupt",
        },
      };
    }
    return {
      kind: "result",
      result: { status: "already_completed", runId: run.id, artifactKey },
    };
  }
  if (
    !claimed &&
    run.status !== "pending" &&
    run.status !== "failed" &&
    run.status !== "incomplete"
  ) {
    return {
      kind: "result",
      result: { status: "already_running", runId: run.id },
    };
  }
  return {
    kind: "ready",
    context: {
      input,
      flags,
      now,
      localDate: local.date,
      projectId,
      repository,
      profile,
      run,
      artifactKey,
    },
  };
}

function blockedAdapterResult(
  source: DemandPulseSource,
  capabilities: SourceCapabilityDescriptor | null,
  health: DemandSourceRunHealth,
): AdapterAcquisitionResult & { source: DemandPulseSource } {
  return {
    source,
    capabilities,
    observations: [],
    health,
    warnings: health.error ? [health.error] : [],
    rawArtifactPointers: [],
  };
}
async function acquireSources(
  context: PreparedCanaryRun,
): Promise<AcquisitionState> {
  const { input, flags, profile, repository, run, projectId } = context;
  const generatedAt = context.now.toISOString();
  const errors: string[] = [];
  const sources = await repository.listSourcesByProject(projectId);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceHealth: DemandPulseCanarySourceHealth[] = [];
  const observations: DemandObservationCandidate[] = [];
  const official = await acquireOfficialSources({
    env: input.env,
    flags,
    repository,
    profile,
    runId: run.id,
    projectId,
    localDate: context.localDate,
    sources,
    generatedAt,
    fetchFn: input.fetchFn ?? defaultOfficialFetch,
  });
  sourceHealth.push(...official.sourceHealth);
  observations.push(...official.observations);
  errors.push(...official.errors);

  const reservation = emptyReservationSeam(profile);
  const adapterSources = sources.filter(
    (source) => source.adapter !== "official_page_monitor",
  );
  const adapterResults = await Promise.all(
    adapterSources.map(async (source) => {
      const adapterKey = sourceAdapterForRow(source);
      if (!adapterKey) {
        return blockedAdapterResult(
          source,
          null,
          healthForBlocked(
            "unknown",
            sourceApprovalGate(source).policyState,
            `no adapter registered for ${source.adapter}`,
          ),
        );
      }
      const capabilities =
        input.adapters?.[adapterKey]?.capabilities ??
        defaultAdapters[adapterKey].capabilities;
      if (!sourceFlagEnabled(adapterKey, flags, input.env)) {
        return blockedAdapterResult(
          source,
          capabilities,
          healthForBlocked(
            "skipped",
            sourceApprovalGate(source).policyState,
            `${adapterKey} disabled by feature flag`,
          ),
        );
      }
      let config: unknown;
      try {
        config = await sourceConfigFor(
          adapterKey,
          source,
          input,
          errors,
          projectId,
        );
      } catch (error) {
        const message = `${adapterKey} source configuration failed: ${errorText(error)}`;
        errors.push(message);
        return blockedAdapterResult(
          source,
          capabilities,
          healthForBlocked(
            "failed",
            sourceApprovalGate(source).policyState,
            message,
          ),
        );
      }
      const result = await acquireConfiguredAdapter({
        adapterKey,
        customAdapter: input.adapters?.[adapterKey],
        source,
        config,
        projectId,
        collectedAt: generatedAt,
        cursor: null,
        fetchFn: input.adapterFetchFn ?? fetch,
        reservation,
      });
      return { source, ...result };
    }),
  );
  for (const result of adapterResults) {
    observations.push(...result.observations);
    sourceHealth.push(
      sourceHealthFromRun(
        result.source,
        result.capabilities,
        result.health,
        result.observations.length,
        result.warnings,
      ),
    );
    await repository.recordSourceRun({
      profileId: profile.id,
      runId: run.id,
      sourceId: result.source.id,
      health: result.health.status,
      policyState: result.health.policyState,
      requestCount: result.health.requestCount,
      costMicros: result.health.costMicros,
      errorMessage: result.health.error,
      cursor: result.health.cursor,
      artifactPointer: result.rawArtifactPointers[0] ?? null,
    });
  }
  return { sources, sourceById, sourceHealth, observations, errors };
}

async function processAndPersist(
  context: PreparedCanaryRun,
  state: AcquisitionState,
  promoteResults: boolean,
): Promise<ProcessedEvidence | null> {
  const { input, repository, profile, run, localDate } = context;
  try {
    const definitions = promoteResults
      ? parseFamilyDefinitions(
          input.families ??
            parseJson(
              input.env.DEMAND_PULSE_FAMILIES_JSON,
              "families",
              state.errors,
            ),
          state.errors,
        )
      : [];
    const processed = await processEvidence({
      observations: state.observations,
      profile,
      runId: run.id,
      localDate,
      generatedAt: context.now.toISOString(),
      definitions,
      sourceById: state.sourceById,
    });
    await repository.persistObservations({
      scope: processed.evidenceGraph.scope,
      rows: processed.observationRows,
    });
    if (promoteResults) {
      await repository.persistEvidenceGraph(processed.evidenceGraph);
      await repository.persistFamilyResults(processed.familyResults);
      await repository.persistFeedItems({
        scope: processed.evidenceGraph.scope,
        rows: processed.feedRows,
      });
    }
    return processed;
  } catch (error) {
    state.errors.push(
      `Demand Pulse processing persistence failed: ${errorText(error)}`,
    );
    return null;
  }
}

export async function runDemandPulseCanary(
  input: RunDemandPulseCanaryInput,
): Promise<DemandPulseCanaryResult> {
  const preparation = await prepareCanaryRun(input);
  if (preparation.kind === "result") return preparation.result;
  const state = await acquireSources(preparation.context);
  const promoteResults =
    countHealth(state.sourceHealth).successfulSourceCount >=
    minimumHealthySourceCount(state.sources.length);
  const processed = await processAndPersist(
    preparation.context,
    state,
    promoteResults,
  );
  const artifactState = buildArtifact(preparation.context, state, processed);
  return finalizeRun(preparation.context, state, processed, artifactState);
}

export async function runScheduledDemandPulse(
  env: DemandPulseCanaryEnv,
  now = new Date(),
  input: Omit<RunDemandPulseCanaryInput, "env" | "now"> = {},
): Promise<DemandPulseCanaryResult> {
  return runDemandPulseCanary({ ...input, env, now });
}

export {
  DEMAND_PULSE_EVIDENCE_VERSION,
  FEED_SELECTION_VERSION,
  COVERAGE_EVALUATOR_VERSION,
};
