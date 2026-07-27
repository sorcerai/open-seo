import { and, eq } from "drizzle-orm";
import { db } from "@/db";
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
import { validateScope } from "./DemandPulseEvidenceRepository.types";
import type {
  DemandPulseFamilyEvidenceDetail,
  DemandPulseProcessingSnapshot,
  DemandPulseScope,
} from "./DemandPulseEvidenceRepository.types";

const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
  rows.toSorted((left, right) => left.id.localeCompare(right.id));

export async function getProcessingSnapshot(
  input: DemandPulseScope,
): Promise<DemandPulseProcessingSnapshot> {
  const scope = validateScope(input);
  const observations = await db
    .select()
    .from(demandPulseObservations)
    .where(
      and(
        eq(demandPulseObservations.projectId, scope.projectId),
        eq(demandPulseObservations.profileId, scope.profileId),
        eq(demandPulseObservations.runId, scope.runId),
      ),
    );
  const evidenceEvents = await db
    .select()
    .from(demandPulseEvidenceEvents)
    .where(
      and(
        eq(demandPulseEvidenceEvents.projectId, scope.projectId),
        eq(demandPulseEvidenceEvents.profileId, scope.profileId),
        eq(demandPulseEvidenceEvents.runId, scope.runId),
      ),
    );
  const observationEvents = await db
    .select()
    .from(demandPulseObservationEvents)
    .where(
      and(
        eq(demandPulseObservationEvents.projectId, scope.projectId),
        eq(demandPulseObservationEvents.profileId, scope.profileId),
        eq(demandPulseObservationEvents.runId, scope.runId),
        eq(demandPulseObservationEvents.evidenceVersion, scope.evidenceVersion),
      ),
    );
  const duplicateEdges = await db
    .select()
    .from(demandPulseDuplicateEdges)
    .where(
      and(
        eq(demandPulseDuplicateEdges.projectId, scope.projectId),
        eq(demandPulseDuplicateEdges.profileId, scope.profileId),
        eq(demandPulseDuplicateEdges.runId, scope.runId),
        eq(demandPulseDuplicateEdges.evidenceVersion, scope.evidenceVersion),
      ),
    );
  const familyEvidence = await db
    .select()
    .from(demandPulseFamilyEvidence)
    .where(
      and(
        eq(demandPulseFamilyEvidence.projectId, scope.projectId),
        eq(demandPulseFamilyEvidence.profileId, scope.profileId),
        eq(demandPulseFamilyEvidence.runId, scope.runId),
        eq(demandPulseFamilyEvidence.evidenceVersion, scope.evidenceVersion),
      ),
    );
  const familyIds = new Set(familyEvidence.map((row) => row.familyId));
  const allFamilies = await db
    .select()
    .from(demandPulseFamilies)
    .where(
      and(
        eq(demandPulseFamilies.projectId, scope.projectId),
        eq(demandPulseFamilies.profileId, scope.profileId),
      ),
    );
  const families = allFamilies.filter((row) => familyIds.has(row.id));
  const allCoverageChecks = await db
    .select()
    .from(demandPulseCoverageChecks)
    .where(
      and(
        eq(demandPulseCoverageChecks.projectId, scope.projectId),
        eq(demandPulseCoverageChecks.profileId, scope.profileId),
        eq(demandPulseCoverageChecks.runId, scope.runId),
      ),
    );
  const coverageChecks = allCoverageChecks.filter((row) =>
    familyIds.has(row.familyId),
  );
  const scores = await db
    .select()
    .from(demandPulseScores)
    .where(
      and(
        eq(demandPulseScores.projectId, scope.projectId),
        eq(demandPulseScores.profileId, scope.profileId),
        eq(demandPulseScores.runId, scope.runId),
        eq(demandPulseScores.evidenceVersion, scope.evidenceVersion),
      ),
    );
  return {
    observations: byId(observations),
    evidenceEvents: byId(evidenceEvents),
    observationEvents: byId(observationEvents),
    duplicateEdges: byId(duplicateEdges),
    families: byId(families),
    familyEvidence: byId(familyEvidence),
    coverageChecks: byId(coverageChecks),
    scores: byId(scores),
  };
}

export async function getFamilyEvidenceDetail(
  input: DemandPulseScope & { familyId: string },
): Promise<DemandPulseFamilyEvidenceDetail> {
  const scope = validateScope(input);
  if (typeof input.familyId !== "string" || input.familyId.trim() === "") {
    throw new Error("Demand pulse familyId must be non-empty");
  }
  const familyId = input.familyId;
  const [family] = await db
    .select()
    .from(demandPulseFamilies)
    .where(
      and(
        eq(demandPulseFamilies.id, familyId),
        eq(demandPulseFamilies.projectId, scope.projectId),
        eq(demandPulseFamilies.profileId, scope.profileId),
      ),
    );
  const memberships = await db
    .select()
    .from(demandPulseFamilyEvidence)
    .where(
      and(
        eq(demandPulseFamilyEvidence.familyId, familyId),
        eq(demandPulseFamilyEvidence.projectId, scope.projectId),
        eq(demandPulseFamilyEvidence.profileId, scope.profileId),
        eq(demandPulseFamilyEvidence.runId, scope.runId),
        eq(demandPulseFamilyEvidence.evidenceVersion, scope.evidenceVersion),
      ),
    );
  const events = await db
    .select()
    .from(demandPulseEvidenceEvents)
    .where(
      and(
        eq(demandPulseEvidenceEvents.projectId, scope.projectId),
        eq(demandPulseEvidenceEvents.profileId, scope.profileId),
        eq(demandPulseEvidenceEvents.runId, scope.runId),
      ),
    );
  const observations = await db
    .select()
    .from(demandPulseObservations)
    .where(
      and(
        eq(demandPulseObservations.projectId, scope.projectId),
        eq(demandPulseObservations.profileId, scope.profileId),
        eq(demandPulseObservations.runId, scope.runId),
      ),
    );
  const eventsById = new Map(events.map((row) => [row.id, row]));
  const observationsById = new Map(observations.map((row) => [row.id, row]));
  const familyEvidence = memberships
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((membership) => {
      const evidenceEvent = eventsById.get(membership.eventId);
      if (!evidenceEvent) {
        throw new Error(
          `Demand pulse evidence event ${membership.eventId} missing`,
        );
      }
      const observation = observationsById.get(
        evidenceEvent.canonicalObservationId,
      );
      if (!observation) {
        throw new Error(
          `Demand pulse observation ${evidenceEvent.canonicalObservationId} missing`,
        );
      }
      return { membership, evidenceEvent, observation };
    });
  return { family: family ?? null, familyEvidence };
}
