import { describe, expect, it } from "vitest";
import {
  ONFARM_SCORING_VERSION,
  computeOnFarmFreshness,
  scoreDemandFamily,
  scoreOnFarmFamily,
  selectOnFarmFeed,
  type OnFarmFamilyCandidate,
} from "../scoring";
import type {
  CoverageState,
  DemandObservationCandidate,
  DemandSignalVector,
  OnFarmScorePenaltyVector,
  OnFarmScoreVector,
} from "../types";
import { buildFamilyEvidence } from "../dedupe-evidence";
const vector = (
  overrides: Partial<DemandSignalVector> = {},
): DemandSignalVector => ({
  crossSourceDiversity: 0,
  commercialProximity: 0,
  firstPartyCorroboration: 0,
  searchCorroboration: 0,
  normalizedVelocity: 0,
  recurrence: 0,
  coverageGap: 0,
  sourceReliability: 0,
  icpFit: 0,
  persistence: 0,
  aiSurfaceCorroboration: 0,
  decisionClarity: 0,
  trendAcceleration: 0,
  spamRisk: 0,
  legalRetentionRisk: 0,
  cannibalizationRisk: 0,
  stalenessRisk: 0,
  sourceConcentrationRisk: 0,
  uncertainty: 0,
  ...overrides,
});
describe("scoreDemandFamily", () => {
  it("promotes strong, corroborated demand", () => {
    const result = scoreDemandFamily(
      vector({
        crossSourceDiversity: 0.95,
        commercialProximity: 0.9,
        firstPartyCorroboration: 0.8,
        searchCorroboration: 0.9,
        normalizedVelocity: 0.85,
        recurrence: 0.9,
        coverageGap: 0.85,
        sourceReliability: 0.9,
        icpFit: 0.9,
        persistence: 0.7,
        aiSurfaceCorroboration: 0.6,
        decisionClarity: 0.9,
        trendAcceleration: 0.8,
        uncertainty: 0.1,
      }),
    );
    expect(result.priorityScore).toBeGreaterThanOrEqual(75);
    expect(result.band).toBe("ship_now");
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
  });
  it("penalizes spam and retention risk", () => {
    const base = vector({
      crossSourceDiversity: 0.8,
      commercialProximity: 0.8,
      searchCorroboration: 0.7,
      normalizedVelocity: 0.9,
      recurrence: 0.7,
      coverageGap: 0.8,
      sourceReliability: 0.7,
      icpFit: 0.8,
      decisionClarity: 0.8,
      uncertainty: 0.2,
    });
    const clean = scoreDemandFamily(base);
    const risky = scoreDemandFamily({
      ...base,
      spamRisk: 1,
      legalRetentionRisk: 1,
      sourceConcentrationRisk: 1,
    });
    expect(risky.priorityScore).toBeLessThan(clean.priorityScore);
    expect(risky.penaltyScore).toBeGreaterThan(clean.penaltyScore);
  });
});
const onFarmVector = (
  overrides: Partial<OnFarmScoreVector> = {},
): OnFarmScoreVector => ({
  geography: 0,
  corroboration: 0,
  freshness: 0,
  usefulness: 0,
  coverageGap: 0,
  citation: 0,
  commercial: 0,
  ...overrides,
});
const onFarmPenalty = (
  overrides: Partial<OnFarmScorePenaltyVector> = {},
): OnFarmScorePenaltyVector => ({
  complianceUncertainty: false,
  weakProvenance: false,
  cannibalization: false,
  noOriginalContribution: false,
  unownedMaintenance: false,
  vanity: false,
  ...overrides,
});
describe("computeOnFarmFreshness", () => {
  const now = "2026-07-27T12:00:00.000Z";
  it("returns zero for baseline dates so they never create a recency signal", () => {
    expect(computeOnFarmFreshness("2026-07-20T12:00:00.000Z", now, true)).toBe(
      0,
    );
  });
  it("returns zero for unknown, missing, or null dates", () => {
    expect(computeOnFarmFreshness(null, now)).toBe(0);
    expect(computeOnFarmFreshness(undefined, now)).toBe(0);
    expect(computeOnFarmFreshness("", now)).toBe(0);
    expect(computeOnFarmFreshness("not-a-date", now)).toBe(0);
  });
  it("returns full freshness for recent real dates and zero past the decay window", () => {
    expect(computeOnFarmFreshness("2026-07-26T12:00:00.000Z", now)).toBe(1);
    expect(computeOnFarmFreshness("2025-01-01T00:00:00.000Z", now)).toBe(0);
  });
});
describe("scoreOnFarmFamily", () => {
  it("computes exact positive, fixed-point penalty, and priority math", () => {
    const result = scoreOnFarmFamily(
      onFarmVector({ geography: 1, corroboration: 0.5 }),
      onFarmPenalty({ weakProvenance: true }),
    );
    expect(result.scoringVersion).toBe(ONFARM_SCORING_VERSION);
    expect(result.positiveScore).toBe(30);
    expect(result.positiveComponents.geography).toBe(20);
    expect(result.positiveComponents.corroboration).toBe(10);
    expect(result.penaltyScore).toBe(20);
    expect(result.penaltyComponents.weakProvenance).toBe(20);
    expect(result.penaltyComponents.complianceUncertainty).toBe(0);
    expect(result.priorityScore).toBe(10);
    expect(result.band).toBe("reject");
    expect(result.compliance.blocked).toBe(false);
  });
  it("applies the exact 75/60/45 band boundaries without confidence gating", () => {
    const at45 = scoreOnFarmFamily(
      onFarmVector({ corroboration: 1, usefulness: 1, coverageGap: 1 }),
      onFarmPenalty(),
    );
    expect(at45.priorityScore).toBe(45);
    expect(at45.band).toBe("monitor");
    const below45 = scoreOnFarmFamily(
      onFarmVector({ corroboration: 1, usefulness: 1, coverageGap: 0.9 }),
      onFarmPenalty(),
    );
    expect(below45.priorityScore).toBe(44);
    expect(below45.band).toBe("reject");
    const at60 = scoreOnFarmFamily(
      onFarmVector({
        geography: 1,
        corroboration: 1,
        coverageGap: 1,
        citation: 1,
      }),
      onFarmPenalty(),
    );
    expect(at60.priorityScore).toBe(60);
    expect(at60.band).toBe("validate_next");
    const at75 = scoreOnFarmFamily(
      onFarmVector({
        geography: 1,
        corroboration: 1,
        freshness: 1,
        usefulness: 1,
        coverageGap: 0.5,
      }),
      onFarmPenalty(),
    );
    expect(at75.priorityScore).toBe(75);
    expect(at75.band).toBe("ship_now");
  });
  it("blocks promotion despite a high score when compliance uncertainty applies", () => {
    const result = scoreOnFarmFamily(
      onFarmVector({
        geography: 1,
        corroboration: 1,
        freshness: 1,
        usefulness: 1,
        coverageGap: 1,
        citation: 1,
        commercial: 1,
      }),
      onFarmPenalty({ complianceUncertainty: true }),
    );
    expect(result.positiveScore).toBe(100);
    expect(result.penaltyComponents.complianceUncertainty).toBe(30);
    expect(result.compliance.blocked).toBe(true);
    expect(result.compliance.reason).toBe("compliance_uncertainty");
    expect(result.band).toBe("reject");
  });
  it("honors an explicit compliance block option", () => {
    const result = scoreOnFarmFamily(
      onFarmVector({ geography: 1 }),
      onFarmPenalty(),
      { complianceBlock: true },
    );
    expect(result.compliance.blocked).toBe(true);
    expect(result.band).toBe("reject");
  });
});
const gapCoverage = (): CoverageState => ({
  status: "gap",
  existingCanonicalUrl: null,
  prefersExistingUpdate: true,
  reason: "no existing canonical page",
});
const obs = (
  overrides: Partial<DemandObservationCandidate> = {},
): DemandObservationCandidate => ({
  projectId: "onfarmcompost",
  sourceConnectionId: "s1",
  sourceClass: "community_observed",
  sourcePlatform: "forum",
  externalId: "1",
  canonicalUrl: "https://example.com/a",
  title: "how to start composting in houston texas",
  publishedAt: "2026-07-20T12:00:00.000Z",
  collectedAt: "2026-07-25T12:00:00.000Z",
  ...overrides,
});
const observedCandidate = async (
  familyId: string,
  priorityScore: number,
): Promise<OnFarmFamilyCandidate> => {
  const ratio = priorityScore / 100;
  return {
    familyId,
    projectId: "onfarmcompost",
    title: `family ${familyId}`,
    recommendedAction: "create_supporting_page",
    vector: onFarmVector({
      geography: ratio,
      corroboration: ratio,
      freshness: ratio,
      usefulness: ratio,
      coverageGap: ratio,
      citation: ratio,
      commercial: ratio,
    }),
    penalty: onFarmPenalty(),
    coverage: gapCoverage(),
    evidence: await buildFamilyEvidence(familyId, [
      obs({
        externalId: familyId,
        canonicalUrl: `https://example.com/${familyId}`,
        title: `independent observed evidence for ${familyId}`,
      }),
    ]),
  };
};
describe("selectOnFarmFeed", () => {
  const runDate = "2026-07-27";
  it("never promotes generated-only evidence, derived from the evidence", async () => {
    const generatedEvidence = await buildFamilyEvidence("gen", [
      obs({
        sourceClass: "generated_candidate",
        externalId: "gen",
        canonicalUrl: "https://example.com/gen",
        title: "generated candidate idea",
      }),
    ]);
    expect(generatedEvidence.hasGeneratedOnlyEvidence).toBe(true);
    const generated: OnFarmFamilyCandidate = {
      ...(await observedCandidate("gen", 90)),
      evidence: generatedEvidence,
    };
    const real = await observedCandidate("real", 90);
    const { items, excluded } = await selectOnFarmFeed([generated, real], {
      runDate,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    expect(
      items.every(
        (item) => item.provenance === "observed" && item.promotionPermitted,
      ),
    ).toBe(true);
    expect(excluded.find((entry) => entry.familyId === "gen")?.reason).toBe(
      "generated_only_evidence",
    );
  });
  it("never promotes baseline-only evidence, derived from the evidence", async () => {
    const baselineEvidence = await buildFamilyEvidence("base", [
      obs({
        externalId: "base",
        baselineFingerprint: true,
        publishedAt: null,
      }),
    ]);
    expect(baselineEvidence.baselineOnly).toBe(true);
    const baseline: OnFarmFamilyCandidate = {
      ...(await observedCandidate("base", 90)),
      evidence: baselineEvidence,
    };
    const real = await observedCandidate("real", 90);
    const { items, excluded } = await selectOnFarmFeed([baseline, real], {
      runDate,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    expect(excluded.find((entry) => entry.familyId === "base")?.reason).toBe(
      "baseline_fingerprint_only",
    );
  });
  it("does not combine generated evidence with a baseline into observed provenance", async () => {
    const evidence = await buildFamilyEvidence("mixed", [
      obs({
        sourceClass: "generated_candidate",
        externalId: "generated",
        canonicalUrl: "https://example.com/generated",
      }),
      obs({
        sourceClass: "primary_authoritative",
        sourceConnectionId: "official",
        externalId: "baseline",
        canonicalUrl: "https://example.com/baseline",
        baselineFingerprint: true,
        publishedAt: null,
      }),
    ]);
    const mixed: OnFarmFamilyCandidate = {
      ...(await observedCandidate("mixed", 90)),
      evidence,
    };
    const { items, excluded } = await selectOnFarmFeed([mixed], { runDate });
    expect(items).toEqual([]);
    expect(evidence.hasPromotableObservedEvidence).toBe(false);
    expect(excluded).toContainEqual({
      familyId: "mixed",
      reason: "no_promotable_observed_evidence",
    });
  });
  it("excludes compliance-blocked families via the candidate block", async () => {
    const blocked: OnFarmFamilyCandidate = {
      ...(await observedCandidate("blocked", 90)),
      complianceBlock: true,
    };
    const real = await observedCandidate("real", 90);
    const { items, excluded } = await selectOnFarmFeed([blocked, real], {
      runDate,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    expect(excluded.find((entry) => entry.familyId === "blocked")?.reason).toBe(
      "compliance_blocked",
    );
  });
  it("excludes reject-band families (priority < 45)", async () => {
    const low = await observedCandidate("low", 30);
    const real = await observedCandidate("real", 80);
    const { items, excluded } = await selectOnFarmFeed([low, real], {
      runDate,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    expect(excluded.find((entry) => entry.familyId === "low")?.reason).toBe(
      "below_score_threshold",
    );
  });
  it("forces the monitor-only action for monitor-band items (45-59)", async () => {
    const monitor = await observedCandidate("mon", 50);
    const action = await observedCandidate("act", 80);
    const { items } = await selectOnFarmFeed([monitor, action], { runDate });
    const mon = items.find((item) => item.familyId === "mon");
    const act = items.find((item) => item.familyId === "act");
    expect(mon?.recommendedAction).toBe("monitor_only");
    expect(act?.recommendedAction).toBe("create_supporting_page");
    expect(mon?.compliance.blocked).toBe(false);
  });
  it("emits at most five items and reports overflow as feed_limit", async () => {
    const candidates = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((n) => observedCandidate(`fam-${n}`, 91 - n)),
    );
    const { items, excluded } = await selectOnFarmFeed(candidates, { runDate });
    expect(items).toHaveLength(5);
    const overflow = excluded.filter((entry) => entry.reason === "feed_limit");
    expect(overflow).toHaveLength(2);
    expect(items.every((item) => item.itemId.startsWith("feed_"))).toBe(true);
  });
  it("orders items deterministically by priority then confidence then family id", async () => {
    const a = await observedCandidate("a", 80);
    const b = await observedCandidate("b", 70);
    const c = await observedCandidate("c", 70);
    const first = await selectOnFarmFeed([a, b, c], { runDate });
    const second = await selectOnFarmFeed([c, a, b], { runDate });
    expect(first.items.map((item) => item.familyId)).toEqual(["a", "b", "c"]);
    const firstIds = first.items.map((item) => item.itemId);
    expect(second.items.map((item) => item.itemId)).toEqual(firstIds);
  });
});
