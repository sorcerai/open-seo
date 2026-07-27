import { executeInBatches } from "@/db/runBatch";
import {
  demandPulseCoverageChecks,
  demandPulseDuplicateEdges,
  demandPulseEvidenceEvents,
  demandPulseFamilies,
  demandPulseFamilyEvidence,
  demandPulseObservationEvents,
  demandPulseObservations,
  demandPulseScores,
} from "@/db/schema";
import {
  assertScoringVersion,
  omit,
  validateRows,
  validateScope,
} from "./DemandPulseEvidenceRepository.types";
import {
  getFamilyEvidenceDetail,
  getProcessingSnapshot,
} from "./DemandPulseEvidenceRepository.read";
import type {
  EvidenceGraphInput,
  FamilyResultsInput,
  DemandPulseScope,
  DemandPulseObservationInput,
} from "./DemandPulseEvidenceRepository.types";
export type {
  DuplicateEdgeInput,
  EvidenceGraphInput,
  FamilyResultsInput,
  DemandPulseCoverageCheckInput,
  DemandPulseEvidenceEvent,
  DemandPulseEvidenceEventInput,
  DemandPulseFamily,
  DemandPulseFamilyEvidence,
  DemandPulseFamilyEvidenceDetail,
  DemandPulseFamilyEvidenceInput,
  DemandPulseFamilyInput,
  DemandPulseObservation,
  DemandPulseObservationEvent,
  DemandPulseObservationEventInput,
  DemandPulseObservationInput,
  DemandPulseProcessingSnapshot,
  DemandPulseScope,
  DemandPulseScore,
  DemandPulseScoreInput,
} from "./DemandPulseEvidenceRepository.types";

async function persistObservations(input: {
  scope: DemandPulseScope;
  rows: readonly DemandPulseObservationInput[];
}): Promise<void> {
  const scope = validateScope(input.scope);
  const rows = validateRows(
    input.rows,
    scope,
    ["projectId", "profileId", "runId"],
    ["profileId", "observationKey"],
    "Demand pulse observation",
  );
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(demandPulseObservations)
      .values(row)
      .onConflictDoUpdate({
        target: [
          demandPulseObservations.profileId,
          demandPulseObservations.observationKey,
        ],
        set: omit(
          row,
          "id",
          "projectId",
          "profileId",
          "observationKey",
          "createdAt",
        ),
      }),
  );
}

async function persistEvidenceGraph(input: EvidenceGraphInput): Promise<void> {
  const scope = validateScope(input.scope);
  const evidenceEvents = validateRows(
    input.evidenceEvents,
    scope,
    ["projectId", "profileId", "runId"],
    ["profileId", "eventKey"],
    "Demand pulse evidence event",
  );
  const observationEvents = validateRows(
    input.observationEvents,
    scope,
    ["projectId", "profileId", "runId", "evidenceVersion"],
    ["profileId", "runId", "observationId", "evidenceVersion"],
    "Demand pulse observation event",
  );
  const duplicateEdges = validateRows(
    input.duplicateEdges,
    scope,
    ["projectId", "profileId", "runId", "evidenceVersion"],
    [
      "profileId",
      "runId",
      "evidenceVersion",
      "leftObservationId",
      "rightObservationId",
      "relation",
    ],
    "Demand pulse duplicate edge",
  );

  await executeInBatches(evidenceEvents, (tx, row) =>
    tx
      .insert(demandPulseEvidenceEvents)
      .values(row)
      .onConflictDoUpdate({
        target: [
          demandPulseEvidenceEvents.profileId,
          demandPulseEvidenceEvents.eventKey,
        ],
        set: omit(row, "id", "projectId", "profileId", "eventKey", "createdAt"),
      }),
  );
  await executeInBatches(observationEvents, (tx, row) =>
    tx
      .insert(demandPulseObservationEvents)
      .values(row)
      .onConflictDoNothing({
        target: [
          demandPulseObservationEvents.profileId,
          demandPulseObservationEvents.runId,
          demandPulseObservationEvents.observationId,
          demandPulseObservationEvents.evidenceVersion,
        ],
      }),
  );
  await executeInBatches(duplicateEdges, (tx, row) =>
    tx
      .insert(demandPulseDuplicateEdges)
      .values(row)
      .onConflictDoNothing({
        target: [
          demandPulseDuplicateEdges.profileId,
          demandPulseDuplicateEdges.runId,
          demandPulseDuplicateEdges.evidenceVersion,
          demandPulseDuplicateEdges.leftObservationId,
          demandPulseDuplicateEdges.rightObservationId,
          demandPulseDuplicateEdges.relation,
        ],
      }),
  );
}

async function persistFamilyResults(input: FamilyResultsInput): Promise<void> {
  const scope = validateScope(input.scope);
  const families = validateRows(
    input.families,
    scope,
    ["projectId", "profileId"],
    ["profileId", "familyKey"],
    "Demand pulse family",
  );
  const familyEvidence = validateRows(
    input.familyEvidence,
    scope,
    ["projectId", "profileId", "runId", "evidenceVersion"],
    ["profileId", "runId", "familyId", "eventId", "evidenceVersion"],
    "Demand pulse family evidence",
  );
  const coverageChecks = validateRows(
    input.coverageChecks,
    scope,
    ["projectId", "profileId", "runId"],
    ["profileId", "runId", "familyId", "evaluatorVersion"],
    "Demand pulse coverage check",
  );
  const scores = validateRows(
    input.scores,
    scope,
    ["projectId", "profileId", "runId", "evidenceVersion"],
    ["profileId", "runId", "familyId", "evidenceVersion", "scoringVersion"],
    "Demand pulse score",
  );
  assertScoringVersion(scores, input.scoringVersion);

  await executeInBatches(families, (tx, row) =>
    tx
      .insert(demandPulseFamilies)
      .values(row)
      .onConflictDoUpdate({
        target: [demandPulseFamilies.profileId, demandPulseFamilies.familyKey],
        set: omit(
          row,
          "id",
          "projectId",
          "profileId",
          "familyKey",
          "createdAt",
        ),
      }),
  );
  await executeInBatches(familyEvidence, (tx, row) =>
    tx
      .insert(demandPulseFamilyEvidence)
      .values(row)
      .onConflictDoNothing({
        target: [
          demandPulseFamilyEvidence.profileId,
          demandPulseFamilyEvidence.runId,
          demandPulseFamilyEvidence.familyId,
          demandPulseFamilyEvidence.eventId,
          demandPulseFamilyEvidence.evidenceVersion,
        ],
      }),
  );
  await executeInBatches(coverageChecks, (tx, row) =>
    tx
      .insert(demandPulseCoverageChecks)
      .values(row)
      .onConflictDoNothing({
        target: [
          demandPulseCoverageChecks.profileId,
          demandPulseCoverageChecks.runId,
          demandPulseCoverageChecks.familyId,
          demandPulseCoverageChecks.evaluatorVersion,
        ],
      }),
  );
  await executeInBatches(scores, (tx, row) =>
    tx
      .insert(demandPulseScores)
      .values(row)
      .onConflictDoNothing({
        target: [
          demandPulseScores.profileId,
          demandPulseScores.runId,
          demandPulseScores.familyId,
          demandPulseScores.evidenceVersion,
          demandPulseScores.scoringVersion,
        ],
      }),
  );
}

export const DemandPulseEvidenceRepository = {
  persistObservations,
  persistEvidenceGraph,
  persistFamilyResults,
  getProcessingSnapshot,
  getFamilyEvidenceDetail,
} as const;
