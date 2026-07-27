import { buildFamilyEvidence } from "../dedupe-evidence";
import type {
  CoverageEvaluationInput,
  CoverageFeedFamily,
  CoverageInventoryAsset,
} from "../coverage";
import type { DemandObservationCandidate } from "../types";

export const NOW = "2026-07-27T12:00:00.000Z";
export const RUN_DATE = "2026-07-27";
export const OBSERVED = "how to start composting in houston texas";

export const obs = (
  overrides: Partial<DemandObservationCandidate> = {},
): DemandObservationCandidate => ({
  projectId: "onfarmcompost",
  sourceConnectionId: "s1",
  sourceClass: "community_observed",
  sourcePlatform: "forum",
  externalId: "1",
  canonicalUrl: "https://example.com/a",
  title: OBSERVED,
  publishedAt: "2026-07-25T12:00:00.000Z",
  collectedAt: "2026-07-25T12:00:00.000Z",
  ...overrides,
});

export const asset = (
  overrides: Partial<CoverageInventoryAsset> = {},
): CoverageInventoryAsset => ({
  kind: "page",
  canonicalUrl: "https://onfarmcompost.example/guide",
  intent: OBSERVED,
  updatedAt: "2026-07-22T00:00:00.000Z",
  ...overrides,
});

export const familyInput = async (
  overrides: Partial<CoverageEvaluationInput> = {},
): Promise<CoverageEvaluationInput> => ({
  familyId: "fam-start-compost-houston",
  projectId: "onfarmcompost",
  title: "How to start composting in Houston, Texas",
  observedLanguage: OBSERVED,
  evidence: await buildFamilyEvidence("fam-start-compost-houston", [obs()]),
  inventory: [asset()],
  ...overrides,
});

export const gapFamily = async (
  familyId: string,
  geography: number,
  overrides: Partial<CoverageFeedFamily> = {},
): Promise<CoverageFeedFamily> => ({
  familyId,
  projectId: "onfarmcompost",
  title: `family ${familyId}`,
  observedLanguage: `observed demand for ${familyId}`,
  evidence: await buildFamilyEvidence(familyId, [
    obs({
      externalId: familyId,
      canonicalUrl: `https://example.com/${familyId}`,
      title: `independent observed evidence for ${familyId}`,
      geography: "houston-tx",
    }),
  ]),
  // Confirmed-empty inventory => every family is a genuine gap.
  inventory: [],
  vector: { geography },
  ...overrides,
});
