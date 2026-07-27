import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));
import {
  collectSqlObjects,
  collectSqlParams,
} from "./DemandPulseRepository.test-utils";
import {
  demandPulseDuplicateEdges,
  demandPulseEvidenceEvents,
  demandPulseFamilyEvidence,
  demandPulseFamilies,
  demandPulseObservations,
} from "@/db/schema";
import type {
  DemandPulseEvidenceEventInput,
  DemandPulseFamilyEvidenceInput,
  DemandPulseFamilyInput,
  DemandPulseObservationEventInput,
  DemandPulseObservationInput,
  DemandPulseScope,
  DemandPulseScoreInput,
  DuplicateEdgeInput,
} from "./DemandPulseEvidenceRepository";
import {
  DemandPulseEvidenceRepository,
  harness,
} from "./DemandPulseEvidenceRepository.test-harness";

const scope: DemandPulseScope = {
  profileId: "profile-1",
  projectId: "project-1",
  runId: "run-1",
  evidenceVersion: "evidence-v1",
};

const observation = {
  id: "observation-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  sourceId: "source-1",
  sourceClass: "community_observed",
  sourcePlatform: "forum",
  sourceDomain: "example.com",
  externalId: "external-1",
  canonicalUrl: "https://example.com/questions/1",
  outboundUrl: null,
  title: "Question",
  excerpt: "Excerpt",
  observedLanguage: "en",
  publishedAt: "2026-07-27T12:00:00.000Z",
  sourceUpdatedAt: null,
  collectedAt: "2026-07-27T12:01:00.000Z",
  locale: "en-US",
  geography: "US",
  provenance: "source",
  retentionProfile: "default",
  retentionExpiresAt: null,
  rawArtifactKey: null,
  canonicalUrlHash: "url-hash",
  contentHash: "content-hash",
  question: "What is this?",
  problemStatement: "Need an answer",
  decisionBeingMade: "Choose",
  intent: "informational",
  funnelStage: "consideration",
  engagementScore: 1,
  engagementComments: 1,
  engagementViews: 1,
  engagementReactions: 1,
  engagementVelocityPerDay: 1,
  engagementCommunityPercentile: 1,
  deletionStatus: "active",
  deletedAt: null,
  observationKey: "observation-key",
} as DemandPulseObservationInput;

const event = {
  id: "event-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  eventKey: "event-key",
  canonicalObservationId: observation.id,
  independentCount: 1,
  rawObservationCount: 1,
  firstObservedAt: "2026-07-27T12:00:00.000Z",
  lastObservedAt: "2026-07-27T12:00:00.000Z",
} as DemandPulseEvidenceEventInput;

const observationEvent = {
  id: "observation-event-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  evidenceVersion: scope.evidenceVersion,
  observationId: observation.id,
  eventId: event.id,
} as DemandPulseObservationEventInput;

const duplicateEdge = {
  id: "edge-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  evidenceVersion: scope.evidenceVersion,
  leftObservationId: observation.id,
  rightObservationId: "observation-2",
  relation: "semantic",
  similarity: 0.9,
  reason: "same question",
} as DuplicateEdgeInput;

const family = {
  id: "family-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  familyKey: "family-key",
  version: 1,
  canonicalQuestion: "What is this?",
  problemStatement: "Need an answer",
  decisionBeingMade: "Choose",
  locale: "en-US",
  geography: "US",
  intent: "informational",
  funnelStage: "consideration",
  regime: "emerging",
  lifecycleStatus: "discovered",
  frozen: false,
  firstObservedAt: "2026-07-27T12:00:00.000Z",
  lastObservedAt: "2026-07-27T12:00:00.000Z",
  recommendedAction: "monitor_only",
  recommendedTargetUrl: null,
} as DemandPulseFamilyInput;

const familyEvidence = {
  id: "family-evidence-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  evidenceVersion: scope.evidenceVersion,
  familyId: family.id,
  eventId: event.id,
  membershipType: "independent",
  observedLanguage: "en",
} as DemandPulseFamilyEvidenceInput;

const coverageCheck = {
  id: "coverage-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  familyId: family.id,
  status: "gap",
  existingCanonicalUrl: null,
  targetUrl: "https://example.com/help",
  prefersExistingUpdate: false,
  observedLanguage: "en",
  recommendedAction: "create_support_article",
  reason: "No answer exists",
  evaluatorVersion: "coverage-v1",
} as const;

const score = {
  id: "score-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  familyId: family.id,
  coverageCheckId: coverageCheck.id,
  scoringVersion: "score-v1",
  evidenceVersion: scope.evidenceVersion,
  vectorJson: "{}",
  positiveComponentsJson: "{}",
  penaltyComponentsJson: "{}",
  positiveScore: 1,
  penaltyScore: 0,
  priorityScore: 1,
  confidence: 1,
  band: "ship_now",
  complianceBlocked: false,
  complianceReason: null,
  complianceNote: null,
} as DemandPulseScoreInput;

describe("DemandPulseEvidenceRepository", () => {
  beforeEach(() => harness.reset());

  it("rejects mixed observation scopes before issuing a batch write", async () => {
    await expect(
      DemandPulseEvidenceRepository.persistObservations({
        scope,
        rows: [
          observation,
          { ...observation, id: "observation-2", projectId: "project-2" },
        ],
      }),
    ).rejects.toThrow(/projectId mismatch/);
    expect(harness.executeInBatches).not.toHaveBeenCalled();
  });

  it("rejects cross-profile evidence graph rows before issuing any write", async () => {
    await expect(
      DemandPulseEvidenceRepository.persistEvidenceGraph({
        scope,
        evidenceEvents: [{ ...event, profileId: "profile-2" }],
        observationEvents: [observationEvent],
        duplicateEdges: [duplicateEdge],
      }),
    ).rejects.toThrow(/profileId mismatch/);
    expect(harness.executeInBatches).not.toHaveBeenCalled();
  });

  it("uses immutable evidence-version keys so replay is idempotent and prior snapshots remain", async () => {
    await DemandPulseEvidenceRepository.persistEvidenceGraph({
      scope,
      evidenceEvents: [event],
      observationEvents: [observationEvent],
      duplicateEdges: [duplicateEdge],
    });
    await DemandPulseEvidenceRepository.persistEvidenceGraph({
      scope,
      evidenceEvents: [event],
      observationEvents: [observationEvent],
      duplicateEdges: [duplicateEdge],
    });
    expect(harness.persistedRows.size).toBe(3);
    const priorRows = harness.persistedRows.size;
    const nextScope = { ...scope, evidenceVersion: "evidence-v2" };
    await DemandPulseEvidenceRepository.persistEvidenceGraph({
      scope: nextScope,
      evidenceEvents: [{ ...event, id: "event-2", eventKey: "event-key-2" }],
      observationEvents: [
        {
          ...observationEvent,
          id: "observation-event-2",
          evidenceVersion: nextScope.evidenceVersion,
        },
      ],
      duplicateEdges: [
        {
          ...duplicateEdge,
          id: "edge-2",
          evidenceVersion: nextScope.evidenceVersion,
        },
      ],
    });

    expect(harness.persistedRows.size).toBe(priorRows + 3);
    const edgeConflict = harness.writes.find(
      (write) => write.table === demandPulseDuplicateEdges,
    );
    expect(edgeConflict?.conflict.target).toEqual([
      demandPulseDuplicateEdges.profileId,
      demandPulseDuplicateEdges.runId,
      demandPulseDuplicateEdges.evidenceVersion,
      demandPulseDuplicateEdges.leftObservationId,
      demandPulseDuplicateEdges.rightObservationId,
      demandPulseDuplicateEdges.relation,
    ]);
    const eventConflict = harness.writes.find(
      (write) => write.table === demandPulseEvidenceEvents,
    );
    expect(eventConflict?.conflict.target).toEqual([
      demandPulseEvidenceEvents.profileId,
      demandPulseEvidenceEvents.eventKey,
    ]);
  });

  it("requires scoring lineage in family result rows", async () => {
    await expect(
      DemandPulseEvidenceRepository.persistFamilyResults({
        scope,
        scoringVersion: "score-v1",
        families: [family],
        familyEvidence: [familyEvidence],
        coverageChecks: [coverageCheck],
        scores: [{ ...score, scoringVersion: "score-v2" }],
      }),
    ).rejects.toThrow(/scoringVersion mismatch/);
    expect(harness.executeInBatches).not.toHaveBeenCalled();
  });

  it("filters processing snapshots by exact project, profile, run, and evidence version", async () => {
    await DemandPulseEvidenceRepository.getProcessingSnapshot(scope);
    expect(harness.selectWheres).toHaveLength(8);
    const expectedParams = [
      [scope.projectId, scope.profileId, scope.runId],
      [scope.projectId, scope.profileId, scope.runId],
      [scope.projectId, scope.profileId, scope.runId, scope.evidenceVersion],
      [scope.projectId, scope.profileId, scope.runId, scope.evidenceVersion],
      [scope.projectId, scope.profileId, scope.runId, scope.evidenceVersion],
      [scope.projectId, scope.profileId],
      [scope.projectId, scope.profileId, scope.runId],
      [scope.projectId, scope.profileId, scope.runId, scope.evidenceVersion],
    ];
    harness.selectWheres.forEach((where, index) => {
      expect(collectSqlParams(where)).toEqual(
        expect.arrayContaining(expectedParams[index]),
      );
    });
    expect(collectSqlObjects(harness.selectWheres[0])).toEqual(
      expect.arrayContaining([
        demandPulseObservations.projectId,
        demandPulseObservations.profileId,
        demandPulseObservations.runId,
      ]),
    );
  });

  it("returns family evidence with exact family provenance", async () => {
    harness.rowsByTable.set(demandPulseFamilies, [family]);
    harness.rowsByTable.set(demandPulseFamilyEvidence, [familyEvidence]);
    harness.rowsByTable.set(demandPulseEvidenceEvents, [event]);
    harness.rowsByTable.set(demandPulseObservations, [observation]);

    const detail = await DemandPulseEvidenceRepository.getFamilyEvidenceDetail({
      ...scope,
      familyId: family.id,
    });

    expect(detail.family).toEqual(family);
    expect(detail.familyEvidence).toEqual([
      { membership: familyEvidence, evidenceEvent: event, observation },
    ]);
    expect(harness.selectWheres).toHaveLength(4);
    const expectedParams = [
      [family.id, scope.projectId, scope.profileId],
      [
        family.id,
        scope.projectId,
        scope.profileId,
        scope.runId,
        scope.evidenceVersion,
      ],
      [scope.projectId, scope.profileId, scope.runId],
      [scope.projectId, scope.profileId, scope.runId],
    ];
    harness.selectWheres.forEach((where, index) => {
      expect(collectSqlParams(where)).toEqual(
        expect.arrayContaining(expectedParams[index]),
      );
    });
  });
});
