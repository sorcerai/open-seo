import type {
  DemandPulseCanaryEnv,
  DemandPulseCanaryRepository,
  DemandPulseCanarySourceHealth,
} from "./dailyCanaryTypes";
import type { DemandPulseFeatureFlags } from "../feature-flags";
import type {
  DemandPulseProfile,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import type { DemandObservationCandidate } from "../types";
import {
  ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
  type OfficialPageFetch,
} from "../canaries/onfarmcompost-official-sources";
import {
  buildRunArtifact as buildOfficialArtifact,
  blockedSourceResult,
  collectSource,
  evaluateOfficialSourceGate,
  findConfiguredSource,
  isSuccessfulOfficialSource,
  type OfficialSourceResult,
} from "../canaries/onfarmcompost-official-artifact";
import {
  isProjectUuid,
  officialStateKey,
  readOfficialPageState,
  writeJsonArtifact,
  type OfficialPageState,
  type OfficialPageStateEntry,
} from "../canaries/onfarmcompost-official-store";
import { buildRunHealth } from "../sources/adapter";
import {
  healthForBlocked,
  normalizePolicyState,
  sourceApprovalGate,
  sourceHealthFromRun,
} from "./dailyCanaryAcquisition";

export interface OfficialAcquisitionResult {
  sourceHealth: DemandPulseCanarySourceHealth[];
  observations: DemandObservationCandidate[];
  errors: string[];
}

export async function acquireOfficialSources(input: {
  env: DemandPulseCanaryEnv;
  flags: DemandPulseFeatureFlags;
  repository: DemandPulseCanaryRepository;
  profile: DemandPulseProfile;
  runId: string;
  projectId: string;
  localDate: string;
  sources: readonly DemandPulseSource[];
  generatedAt: string;
  fetchFn: OfficialPageFetch;
}): Promise<OfficialAcquisitionResult> {
  const officialSources = input.sources.filter(
    (source) => source.adapter === "official_page_monitor",
  );
  const sourceHealth: DemandPulseCanarySourceHealth[] = [];
  const observations: DemandObservationCandidate[] = [];
  const errors: string[] = [];
  let previousState: OfficialPageState | null = null;
  let nextSources: Record<string, OfficialPageStateEntry> = {};

  if (input.flags.sourceOfficialPages && officialSources.length > 0) {
    const absentState: { kind: "absent" } = { kind: "absent" };
    const stateRead = isProjectUuid(input.projectId)
      ? await readOfficialPageState(input.env.R2, input.projectId)
      : absentState;
    if (stateRead.kind === "corrupt") {
      errors.push(
        "official page state is corrupt; official acquisition blocked",
      );
      for (const source of officialSources) {
        const health = healthForBlocked(
          "blocked",
          sourceApprovalGate(source).policyState,
          "corrupt official page state",
        );
        sourceHealth.push(
          sourceHealthFromRun(
            source,
            null,
            health,
            0,
            health.error ? [health.error] : [],
          ),
        );
        await input.repository.recordSourceRun({
          profileId: input.profile.id,
          runId: input.runId,
          sourceId: source.id,
          health: health.status,
          policyState: health.policyState,
          requestCount: 0,
          costMicros: 0,
          errorMessage: health.error,
        });
      }
    } else {
      previousState = stateRead.kind === "ok" ? stateRead.state : null;
      nextSources = { ...previousState?.sources };
      const results: OfficialSourceResult[] = [];
      for (const seed of ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS) {
        const source = findConfiguredSource(seed, input.sources);
        if (!source || source.adapter !== "official_page_monitor") continue;
        const gate = evaluateOfficialSourceGate(source);
        const result = gate.allowed
          ? await collectSource({
              seed,
              sourceId: source.id,
              policyState: gate.policyState,
              previousState,
              nextSources,
              fetchFn: input.fetchFn,
              generatedAt: input.generatedAt,
            })
          : blockedSourceResult({
              seed,
              sourceId: source.id,
              policyState: gate.policyState,
              health:
                gate.rule === "disabled" || gate.rule === "unapproved"
                  ? "skipped"
                  : "blocked",
              error: gate.reason,
              previousState,
            });
        results.push(result);
        const health = buildRunHealth({
          status: result.health,
          policyState: normalizePolicyState(result.policyState),
          requestCount: result.snapshot ? 1 : 0,
          error: result.error,
        });
        sourceHealth.push(
          sourceHealthFromRun(
            source,
            null,
            health,
            result.snapshot && result.changed ? 1 : 0,
            result.error ? [result.error] : [],
          ),
        );
        await input.repository.recordSourceRun({
          profileId: input.profile.id,
          runId: input.runId,
          sourceId: source.id,
          health: health.status,
          policyState: health.policyState,
          requestCount: health.requestCount,
          costMicros: 0,
          errorMessage: health.error,
          cursor: null,
        });
      }
      const successful = results.filter(isSuccessfulOfficialSource);
      const officialArtifact = buildOfficialArtifact({
        runId: input.runId,
        projectId: input.projectId,
        localDate: input.localDate,
        generatedAt: input.generatedAt,
        results,
        successful,
        configuredSeeds: ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
        emitObservations: true,
        errorMessage: null,
      });
      observations.push(...officialArtifact.observations);
      if (isProjectUuid(input.projectId) && results.length > 0) {
        await writeJsonArtifact(
          input.env.R2,
          officialStateKey(input.projectId),
          {
            schemaVersion: "1",
            projectId: input.projectId,
            updatedAt: input.generatedAt,
            sources: nextSources,
          },
          { projectId: input.projectId, artifactType: "official-page-state" },
        );
      }
    }
  } else {
    for (const source of officialSources) {
      const health = healthForBlocked(
        "skipped",
        sourceApprovalGate(source).policyState,
        "official page source disabled by feature flag",
      );
      sourceHealth.push(
        sourceHealthFromRun(
          source,
          null,
          health,
          0,
          health.error ? [health.error] : [],
        ),
      );
      await input.repository.recordSourceRun({
        profileId: input.profile.id,
        runId: input.runId,
        sourceId: source.id,
        health: health.status,
        policyState: health.policyState,
        requestCount: 0,
        costMicros: 0,
        errorMessage: health.error,
      });
    }
  }
  return { sourceHealth, observations, errors };
}
