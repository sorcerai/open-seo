import { DEMAND_PULSE_EVIDENCE_VERSION } from "../types";
import type {
  DemandPulseCoverageCheckInput,
  DemandPulseEvidenceEventInput,
  DemandPulseFamilyEvidenceInput,
  DemandPulseFamilyInput,
  DemandPulseObservationEventInput,
  DemandPulseObservationInput,
  DemandPulseScoreInput,
  DuplicateEdgeInput,
  EvidenceGraphInput,
  FamilyResultsInput,
} from "../repositories/DemandPulseEvidenceRepository";
import type { DemandPulseFeedItemInput } from "../repositories/DemandPulseFeedRepository";
import type { DemandPulseFamilyDefinition } from "./dailyCanaryTypes";
import type { DemandObservationCandidate } from "../types";
import type { OnFarmFamilyCandidate } from "../scoring";
import type {
  DemandPulseProfile,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import { buildCoverageCandidate } from "../coverage";
import { scoreOnFarmFamily, selectOnFarmFeed } from "../scoring";
import { buildFamilyEvidence } from "../dedupe-evidence";
import { digestId } from "../dedupe";
import {
  buildFamilyGroups,
  buildObservationRows,
  serializeCandidate,
} from "./dailyCanaryEvidence";
import {
  COVERAGE_EVALUATOR_VERSION,
  FEED_SELECTION_VERSION,
} from "./dailyCanaryTypes";

export interface ProcessEvidenceInput {
  observations: readonly DemandObservationCandidate[];
  profile: DemandPulseProfile;
  runId: string;
  localDate: string;
  generatedAt: string;
  definitions: readonly DemandPulseFamilyDefinition[];
  sourceById: ReadonlyMap<string, DemandPulseSource>;
}

export interface ProcessedEvidence {
  observationRows: DemandPulseObservationInput[];
  evidenceGraph: EvidenceGraphInput;
  familyResults: FamilyResultsInput;
  feedRows: DemandPulseFeedItemInput[];
  feedItems: readonly unknown[];
  families: readonly unknown[];
  coverage: readonly unknown[];
  scores: readonly unknown[];
  excludedFeedItems: readonly unknown[];
}

export async function processEvidence(
  input: ProcessEvidenceInput,
): Promise<ProcessedEvidence> {
  const { observations, profile, runId, localDate, generatedAt, sourceById } =
    input;
  const scope = {
    profileId: profile.id,
    projectId: profile.projectId,
    runId,
    evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
  };
  const observationRows = await buildObservationRows(
    observations,
    sourceById,
    profile,
    runId,
  );
  const groups = await buildFamilyGroups(
    observations,
    input.definitions,
    profile.id,
  );
  const familyEvidenceResults = await Promise.all(
    groups.map(async (group) => ({
      group,
      evidence: await buildFamilyEvidence(group.id, group.observations),
    })),
  );
  const evidenceEvents = familyEvidenceResults.flatMap(
    ({ evidence }) => evidence.events,
  );
  const duplicateEdges = familyEvidenceResults.flatMap(
    ({ evidence }) => evidence.duplicateEdges,
  );
  const observationEvents = evidenceEvents.flatMap((event) =>
    event.memberObservationIds.map((observationId) => ({
      id: `${event.eventId}:${observationId}`,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
      observationId,
      eventId: event.eventId,
    })),
  );
  const evidenceEventRows: DemandPulseEvidenceEventInput[] = evidenceEvents.map(
    (event) => ({
      id: event.eventId,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      eventKey: event.eventId,
      canonicalObservationId: event.canonicalObservationId,
      independentCount: event.independentCount,
      rawObservationCount: event.rawObservationCount,
      firstObservedAt: event.firstObservedAt || generatedAt,
      lastObservedAt: event.lastObservedAt || generatedAt,
    }),
  );
  const observationEventRows: DemandPulseObservationEventInput[] =
    observationEvents;
  const duplicateEdgeRows: DuplicateEdgeInput[] = duplicateEdges.map(
    (edge) => ({
      id: `${edge.leftObservationId}:${edge.rightObservationId}:${edge.relation}`,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
      leftObservationId: edge.leftObservationId,
      rightObservationId: edge.rightObservationId,
      relation: edge.relation,
      similarity: edge.similarity,
      reason: edge.reason,
    }),
  );
  const candidates: OnFarmFamilyCandidate[] = [];
  const families: DemandPulseFamilyInput[] = [];
  const familyEvidenceRows: DemandPulseFamilyEvidenceInput[] = [];
  const coverageRows: DemandPulseCoverageCheckInput[] = [];
  const scoreRows: DemandPulseScoreInput[] = [];
  const serializedFamilies: unknown[] = [];
  const serializedCoverage: unknown[] = [];
  const serializedScores: unknown[] = [];
  const candidateIds = new Map<
    string,
    { coverageId: string; scoreId: string }
  >();

  for (const { group, evidence } of familyEvidenceResults) {
    const definition = group.definition;
    const observedLanguage =
      group.observations.find((row) => row.excerpt?.trim())?.excerpt?.trim() ??
      group.title;
    const candidate = buildCoverageCandidate(
      {
        familyId: group.id,
        projectId: profile.projectId,
        title: group.title,
        evidence,
        observedLanguage,
        inventory: definition?.inventory,
      },
      generatedAt,
      {
        vector: definition?.vector,
        penalty: definition?.penalty,
        complianceBlock: definition?.complianceBlock,
      },
    );
    const score = scoreOnFarmFamily(candidate.vector, candidate.penalty, {
      complianceBlock: candidate.complianceBlock,
    });
    const coverageId = await digestId("coverage", [
      runId,
      group.id,
      COVERAGE_EVALUATOR_VERSION,
    ]);
    const scoreId = await digestId("score", [
      runId,
      group.id,
      profile.scoringVersion,
      DEMAND_PULSE_EVIDENCE_VERSION,
    ]);
    candidateIds.set(group.id, { coverageId, scoreId });
    candidates.push(candidate);
    families.push({
      id: group.id,
      projectId: profile.projectId,
      profileId: profile.id,
      familyKey: group.key,
      version: 1,
      canonicalQuestion: definition?.title ?? group.title,
      problemStatement: definition?.problemStatement ?? group.title,
      decisionBeingMade: definition?.decisionBeingMade ?? null,
      locale: definition?.locale ?? group.observations[0]?.locale ?? null,
      geography:
        definition?.geography ?? group.observations[0]?.geography ?? null,
      intent: definition?.intent ?? null,
      funnelStage: definition?.funnelStage ?? null,
      regime: "unknown",
      lifecycleStatus: "corroborated",
      frozen: false,
      firstObservedAt: evidence.firstObservedAt || null,
      lastObservedAt: evidence.lastObservedAt || null,
      recommendedAction: candidate.recommendedAction,
      recommendedTargetUrl: candidate.coverage.existingCanonicalUrl,
    });
    const observationIds = await Promise.all(
      group.observations.map(async (row) => ({
        row,
        id: await digestId("obs", [
          row.sourcePlatform,
          row.sourceConnectionId,
          row.externalId,
          row.canonicalUrl,
        ]),
      })),
    );
    for (const event of evidence.events) {
      const anchor = observationIds.find(
        ({ id }) => id === event.canonicalObservationId,
      )?.row;
      familyEvidenceRows.push({
        id: `${group.id}:${event.eventId}`,
        projectId: profile.projectId,
        profileId: profile.id,
        runId,
        evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
        familyId: group.id,
        eventId: event.eventId,
        membershipType: "independent",
        observedLanguage: anchor
          ? anchor.excerpt?.trim() || anchor.title
          : observedLanguage,
      });
    }
    coverageRows.push({
      id: coverageId,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      familyId: group.id,
      status: candidate.coverage.status,
      existingCanonicalUrl: candidate.coverage.existingCanonicalUrl,
      targetUrl: null,
      prefersExistingUpdate: candidate.coverage.prefersExistingUpdate,
      observedLanguage,
      recommendedAction: candidate.recommendedAction,
      reason: candidate.coverage.reason,
      evaluatorVersion: COVERAGE_EVALUATOR_VERSION,
    });
    scoreRows.push({
      id: scoreId,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      familyId: group.id,
      coverageCheckId: coverageId,
      scoringVersion: score.scoringVersion,
      evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
      vectorJson: JSON.stringify(candidate.vector),
      positiveComponentsJson: JSON.stringify(score.positiveComponents),
      penaltyComponentsJson: JSON.stringify(score.penaltyComponents),
      positiveScore: score.positiveScore,
      penaltyScore: score.penaltyScore,
      priorityScore: score.priorityScore,
      confidence: score.confidence,
      band: score.band,
      complianceBlocked: score.compliance.blocked,
      complianceReason: score.compliance.reason,
      complianceNote: score.compliance.note,
    });
    serializedFamilies.push({ family: families.at(-1), evidence });
    serializedCoverage.push({
      familyId: group.id,
      coverage: candidate.coverage,
      observedLanguage,
    });
    serializedScores.push({ familyId: group.id, score });
  }
  const feed = await selectOnFarmFeed(candidates, { runDate: localDate });
  const feedRows: DemandPulseFeedItemInput[] = feed.items.map((item, index) => {
    const ids = candidateIds.get(item.familyId);
    if (!ids) {
      throw new Error(`missing feed lineage for family ${item.familyId}`);
    }
    return {
      id: item.itemId,
      projectId: profile.projectId,
      profileId: profile.id,
      runId,
      familyId: item.familyId,
      coverageCheckId: ids.coverageId,
      scoreId: ids.scoreId,
      selectionVersion: FEED_SELECTION_VERSION,
      evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
      rank: index + 1,
      title: item.title,
      recommendedAction: item.recommendedAction,
      provenance: item.provenance,
      reason: item.coverage.reason,
    };
  });
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.familyId, candidate]),
  );
  const feedItems = feed.items.map((item) => {
    const ids = candidateIds.get(item.familyId);
    const candidate = candidatesById.get(item.familyId);
    if (!ids || !candidate) {
      throw new Error(`missing feed lineage for family ${item.familyId}`);
    }
    return serializeCandidate(
      candidate,
      item.score,
      ids.coverageId,
      ids.scoreId,
    );
  });
  return {
    observationRows,
    evidenceGraph: {
      scope,
      evidenceEvents: evidenceEventRows,
      observationEvents: observationEventRows,
      duplicateEdges: duplicateEdgeRows,
    },
    familyResults: {
      scope,
      scoringVersion: profile.scoringVersion,
      families,
      familyEvidence: familyEvidenceRows,
      coverageChecks: coverageRows,
      scores: scoreRows,
    },
    feedRows,
    feedItems,
    families: serializedFamilies,
    coverage: serializedCoverage,
    scores: serializedScores,
    excludedFeedItems: feed.excluded,
  };
}
