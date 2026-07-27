import type { DemandPulseFamilyDefinition } from "./dailyCanaryTypes";
import type { DemandPulseObservationInput } from "../repositories/DemandPulseEvidenceRepository";
import type {
  DemandPulseProfile,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import type {
  DemandObservationCandidate,
  OnFarmScoreBreakdown,
  OnFarmScorePenaltyVector,
  OnFarmScoreVector,
} from "../types";
import {
  canonicalizeDemandUrl,
  digestId,
  normalizeDemandText,
} from "../dedupe";
import type { CoverageAssetKind, CoverageInventoryAsset } from "../coverage";
import type { OnFarmFamilyCandidate } from "../scoring";

export interface DemandPulseFamilyGroup {
  id: string;
  key: string;
  title: string;
  observations: DemandObservationCandidate[];
  definition?: DemandPulseFamilyDefinition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCoverageAssetKind(value: unknown): value is CoverageAssetKind {
  switch (value) {
    case "page":
    case "supporting_page":
    case "faq":
    case "tool":
    case "troubleshooter":
    case "product_or_offer":
    case "support_article":
      return true;
    default:
      return false;
  }
}

function isCoverageAsset(value: unknown): value is CoverageInventoryAsset {
  if (!isRecord(value)) return false;
  return (
    isCoverageAssetKind(value.kind) &&
    typeof value.canonicalUrl === "string" &&
    typeof value.intent === "string" &&
    (value.observedLanguage === undefined ||
      typeof value.observedLanguage === "string") &&
    isNullableString(value.updatedAt)
  );
}

const SCORE_VECTOR_KEYS: readonly (keyof OnFarmScoreVector)[] = [
  "geography",
  "corroboration",
  "freshness",
  "usefulness",
  "coverageGap",
  "citation",
  "commercial",
];

const SCORE_PENALTY_KEYS: readonly (keyof OnFarmScorePenaltyVector)[] = [
  "complianceUncertainty",
  "weakProvenance",
  "cannibalization",
  "noOriginalContribution",
  "unownedMaintenance",
  "vanity",
];

function isPartialScoreVector(
  value: unknown,
): value is Partial<OnFarmScoreVector> {
  return (
    isRecord(value) &&
    SCORE_VECTOR_KEYS.every(
      (key) =>
        value[key] === undefined ||
        (typeof value[key] === "number" && Number.isFinite(value[key])),
    )
  );
}

function isPartialScorePenalty(
  value: unknown,
): value is Partial<OnFarmScorePenaltyVector> {
  return (
    isRecord(value) &&
    SCORE_PENALTY_KEYS.every(
      (key) => value[key] === undefined || typeof value[key] === "boolean",
    )
  );
}

function isFamilyDefinition(
  value: unknown,
): value is DemandPulseFamilyDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.familyKey !== "string" || typeof value.title !== "string") {
    return false;
  }
  if (
    value.keywords !== undefined &&
    (!Array.isArray(value.keywords) ||
      !value.keywords.every((keyword) => typeof keyword === "string"))
  ) {
    return false;
  }
  if (value.match !== undefined && typeof value.match !== "function") {
    return false;
  }
  if (
    value.problemStatement !== undefined &&
    typeof value.problemStatement !== "string"
  ) {
    return false;
  }
  for (const key of [
    "decisionBeingMade",
    "locale",
    "geography",
    "intent",
    "funnelStage",
  ] as const) {
    if (value[key] !== undefined && !isNullableString(value[key])) {
      return false;
    }
  }
  if (
    value.inventory !== undefined &&
    (!Array.isArray(value.inventory) ||
      !value.inventory.every((asset) => isCoverageAsset(asset)))
  ) {
    return false;
  }
  if (value.vector !== undefined && !isPartialScoreVector(value.vector)) {
    return false;
  }
  if (value.penalty !== undefined && !isPartialScorePenalty(value.penalty)) {
    return false;
  }
  return (
    value.complianceBlock === undefined ||
    typeof value.complianceBlock === "boolean"
  );
}

export function parseFamilyDefinitions(
  value: unknown,
  errors: string[],
): readonly DemandPulseFamilyDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("families config must be an array");
    return [];
  }
  const definitions = value.filter(isFamilyDefinition);
  if (definitions.length !== value.length) {
    errors.push("families config contains invalid family definitions");
  }
  return definitions;
}

function matchesFamily(
  observation: DemandObservationCandidate,
  definition: DemandPulseFamilyDefinition,
): boolean {
  if (definition.match) return definition.match(observation);
  const normalized = normalizeDemandText(
    `${observation.title} ${observation.excerpt ?? ""}`,
  );
  return (definition.keywords ?? []).every((keyword) =>
    normalized.includes(normalizeDemandText(keyword)),
  );
}

export async function buildFamilyGroups(
  observations: readonly DemandObservationCandidate[],
  definitions: readonly DemandPulseFamilyDefinition[],
  profileId: string,
): Promise<DemandPulseFamilyGroup[]> {
  const groups = new Map<string, Omit<DemandPulseFamilyGroup, "id">>();
  for (const observation of observations) {
    const definition = definitions.find((candidate) =>
      matchesFamily(observation, candidate),
    );
    const key =
      definition?.familyKey ??
      `auto:${normalizeDemandText(observation.title).slice(0, 120)}`;
    const group = groups.get(key) ?? {
      key,
      title: definition?.title ?? observation.title,
      observations: [],
      definition,
    };
    group.observations.push(observation);
    groups.set(key, group);
  }
  return Promise.all(
    [...groups.values()]
      .toSorted((a, b) => a.key.localeCompare(b.key))
      .map(async (group) => ({
        ...group,
        id: await digestId("family", [profileId, group.key]),
      })),
  );
}

function retentionExpiresAt(
  observation: DemandObservationCandidate,
  days: number,
): string | null {
  const timestamp = Date.parse(observation.collectedAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + days * 86_400_000).toISOString();
}

export async function buildObservationRows(
  observations: readonly DemandObservationCandidate[],
  sourceById: ReadonlyMap<string, DemandPulseSource>,
  profile: DemandPulseProfile,
  runId: string,
): Promise<DemandPulseObservationInput[]> {
  return Promise.all(
    observations.map(async (observation) => {
      const source = sourceById.get(observation.sourceConnectionId);
      const observationId = await digestId("obs", [
        observation.sourcePlatform,
        observation.sourceConnectionId,
        observation.externalId,
        observation.canonicalUrl,
      ]);
      const canonicalUrl = canonicalizeDemandUrl(observation.canonicalUrl);
      return {
        id: observationId,
        projectId: profile.projectId,
        profileId: profile.id,
        runId,
        sourceId: observation.sourceConnectionId,
        sourceClass: observation.sourceClass,
        sourcePlatform: observation.sourcePlatform,
        sourceDomain: observation.sourceDomain ?? null,
        externalId: observation.externalId,
        canonicalUrl: observation.canonicalUrl,
        outboundUrl: observation.outboundUrl ?? null,
        title: observation.title,
        excerpt: observation.excerpt ?? null,
        observedLanguage: observation.excerpt?.trim() || observation.title,
        publishedAt: observation.publishedAt ?? null,
        sourceUpdatedAt: observation.updatedAt ?? null,
        collectedAt: observation.collectedAt,
        locale: observation.locale ?? null,
        geography: observation.geography ?? null,
        provenance:
          source?.discoveryProvenance ??
          `adapter:${observation.sourcePlatform}`,
        retentionProfile: observation.retentionProfile ?? "default",
        retentionExpiresAt: retentionExpiresAt(observation, 30),
        rawArtifactKey: null,
        canonicalUrlHash: await digestId("url", [canonicalUrl]),
        contentHash: await digestId("content", [
          normalizeDemandText(observation.title),
          observation.excerpt ?? "",
        ]),
        question: null,
        problemStatement: null,
        decisionBeingMade: null,
        intent: null,
        funnelStage: null,
        engagementScore: observation.engagement?.score ?? null,
        engagementComments: observation.engagement?.comments ?? null,
        engagementViews: observation.engagement?.views ?? null,
        engagementReactions: observation.engagement?.reactions ?? null,
        engagementVelocityPerDay:
          observation.engagement?.velocityPerDay ?? null,
        engagementCommunityPercentile:
          observation.engagement?.communityPercentile ?? null,
        observationKey: observationId,
      };
    }),
  );
}

export function serializeCandidate(
  candidate: OnFarmFamilyCandidate,
  score: OnFarmScoreBreakdown,
  coverageId: string,
  scoreId: string,
) {
  return {
    familyId: candidate.familyId,
    projectId: candidate.projectId,
    title: candidate.title,
    recommendedAction: candidate.recommendedAction,
    coverage: candidate.coverage,
    score,
    coverageCheckId: coverageId,
    scoreId,
    provenance: candidate.evidence.hasPromotableObservedEvidence
      ? "observed"
      : "baseline_fingerprint",
  };
}
