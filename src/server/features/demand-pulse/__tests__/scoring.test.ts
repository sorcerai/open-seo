import { describe, expect, it } from "vitest";
import { scoreDemandFamily } from "../scoring";
import type { DemandSignalVector } from "../types";

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
