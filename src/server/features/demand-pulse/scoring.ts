import type { DemandScoreBreakdown, DemandSignalVector } from "./types";

export const DEMAND_SCORING_VERSION = "demand-pulse-v1.0.0";

export const DEFAULT_POSITIVE_WEIGHTS = {
  crossSourceDiversity: 0.12,
  commercialProximity: 0.12,
  firstPartyCorroboration: 0.11,
  searchCorroboration: 0.09,
  normalizedVelocity: 0.09,
  recurrence: 0.09,
  coverageGap: 0.08,
  sourceReliability: 0.07,
  icpFit: 0.07,
  persistence: 0.05,
  aiSurfaceCorroboration: 0.05,
  decisionClarity: 0.04,
  trendAcceleration: 0.02,
} as const;

export const DEFAULT_PENALTY_WEIGHTS = {
  spamRisk: 0.25,
  legalRetentionRisk: 0.2,
  cannibalizationRisk: 0.15,
  stalenessRisk: 0.15,
  sourceConcentrationRisk: 0.1,
  uncertainty: 0.15,
} as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function assertWeightsSumToOne(weights: Record<string, number>, label: string): void {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.000_001) {
    throw new Error(`${label} weights must sum to 1; received ${total}`);
  }
}

function weightedScore(
  vector: DemandSignalVector,
  weights: Record<string, number>,
): { score: number; components: Record<string, number> } {
  const components: Record<string, number> = {};
  let score = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const raw = vector[key as keyof DemandSignalVector];
    if (!Number.isFinite(raw)) {
      throw new TypeError(`Demand signal ${key} must be a finite number`);
    }
    const contribution = clamp01(raw) * weight;
    components[key] = round(contribution * 100);
    score += contribution;
  }

  return { score, components };
}

export function scoreDemandFamily(
  vector: DemandSignalVector,
  options: { penaltyCeilingPoints?: number } = {},
): DemandScoreBreakdown {
  assertWeightsSumToOne(DEFAULT_POSITIVE_WEIGHTS, "Positive");
  assertWeightsSumToOne(DEFAULT_PENALTY_WEIGHTS, "Penalty");

  const positive = weightedScore(vector, DEFAULT_POSITIVE_WEIGHTS);
  const penalty = weightedScore(vector, DEFAULT_PENALTY_WEIGHTS);
  const penaltyCeilingPoints = Math.max(0, options.penaltyCeilingPoints ?? 35);

  const positiveScore = positive.score * 100;
  const penaltyScore = penalty.score * penaltyCeilingPoints;
  const priorityScore = Math.min(100, Math.max(0, positiveScore - penaltyScore));

  const confidence = clamp01(
    vector.crossSourceDiversity * 0.22 +
      vector.firstPartyCorroboration * 0.18 +
      vector.searchCorroboration * 0.16 +
      vector.recurrence * 0.14 +
      vector.sourceReliability * 0.14 +
      vector.persistence * 0.1 +
      (1 - clamp01(vector.uncertainty)) * 0.06,
  );

  let band: DemandScoreBreakdown["band"];
  if (priorityScore >= 75 && confidence >= 0.65) {
    band = "ship_now";
  } else if (priorityScore >= 55 && confidence >= 0.45) {
    band = "validate_next";
  } else if (priorityScore >= 35) {
    band = "monitor";
  } else {
    band = "reject";
  }

  return {
    scoringVersion: DEMAND_SCORING_VERSION,
    positiveScore: round(positiveScore),
    penaltyScore: round(penaltyScore),
    priorityScore: round(priorityScore),
    confidence: round(confidence, 4),
    band,
    positiveComponents: positive.components,
    penaltyComponents: penalty.components,
  };
}
