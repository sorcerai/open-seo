import type {
  ComplianceBlocker,
  CoverageState,
  DemandCanaryAction,
  DemandScoreBand,
  DemandScoreBreakdown,
  DemandSignalVector,
  FamilyEvidence,
  FeedItemCandidate,
  FeedItemProvenance,
  OnFarmScoreBreakdown,
  OnFarmScorePenaltyVector,
  OnFarmScoreVector,
} from "./types";
import { digestId } from "./dedupe";

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

function assertWeightsSumToOne(
  weights: Record<string, number>,
  label: string,
): void {
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
  const signals: Record<string, number> = { ...vector };
  let score = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const raw = signals[key];
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
  const priorityScore = Math.min(
    100,
    Math.max(0, positiveScore - penaltyScore),
  );

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

// ---------------------------------------------------------------------------
// OnFarmCompost 100-point scoring.
//
// Positive factors sum to a 100-point ceiling (20 geography, 20 corroboration,
// 15 freshness, 15 usefulness, 10 coverage gap, 10 citation, 10 commercial).
// Penalties are explicit applicability flags that apply the full documented
// fixed-point deduction when set (-30 compliance uncertainty, -20 weak
// provenance, -20 cannibalization, -10 no original contribution, -10 unowned
// maintenance, -15 vanity). Score bands are the exact 75/60/45 boundaries.
// Compliance uncertainty blocks promotion regardless of score. No run emits
// more than five feed items; generated-only and baseline evidence cannot
// promote; reject (<45) is excluded and monitor (45-59) is monitor-only.
// ---------------------------------------------------------------------------

export const ONFARM_SCORING_VERSION = "onfarm-demand-pulse-v1.0.0";
export const ONFARM_FEED_MAX_ITEMS = 5;
export const ONFARM_FRESHNESS_FULL_DAYS = 7;
export const ONFARM_FRESHNESS_ZERO_DAYS = 90;
/** Score band boundaries (exact). */
export const ONFARM_SHIP_NOW_THRESHOLD = 75;
export const ONFARM_VALIDATE_NEXT_THRESHOLD = 60;
export const ONFARM_MONITOR_THRESHOLD = 45;

export const ONFARM_POSITIVE_MAX_POINTS: Record<
  keyof OnFarmScoreVector,
  number
> = {
  geography: 20,
  corroboration: 20,
  freshness: 15,
  usefulness: 15,
  coverageGap: 10,
  citation: 10,
  commercial: 10,
};

export const ONFARM_PENALTY_MAX_POINTS: Record<
  keyof OnFarmScorePenaltyVector,
  number
> = {
  complianceUncertainty: 30,
  weakProvenance: 20,
  cannibalization: 20,
  noOriginalContribution: 10,
  unownedMaintenance: 10,
  vanity: 15,
};

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;
const clampPriority = (value: number): number =>
  Math.min(100, Math.max(0, value));

/**
 * Freshness signal for an OnFarm family. Baseline dates (collection-time
 * fallbacks with no real publication date) and unknown/missing/null/unparseable
 * dates contribute zero freshness, so they never create a recency signal.
 * Otherwise freshness is 1.0 within FULL_DAYS and decays linearly to 0.0 at
 * ZERO_DAYS, mirroring how the official-page monitor treats stale authority.
 */
export function computeOnFarmFreshness(
  publishedAt: string | null | undefined,
  now: string,
  isBaseline = false,
): number {
  if (isBaseline) return 0;
  if (!publishedAt) return 0;
  const ts = Date.parse(publishedAt);
  const nowTs = Date.parse(now);
  if (!Number.isFinite(ts) || !Number.isFinite(nowTs)) return 0;
  const ageDays = Math.max(0, (nowTs - ts) / 86_400_000);
  if (ageDays <= ONFARM_FRESHNESS_FULL_DAYS) return 1;
  if (ageDays >= ONFARM_FRESHNESS_ZERO_DAYS) return 0;
  return round4(
    (ONFARM_FRESHNESS_ZERO_DAYS - ageDays) /
      (ONFARM_FRESHNESS_ZERO_DAYS - ONFARM_FRESHNESS_FULL_DAYS),
  );
}

const factorPoints = (signal: number, max: number): number => {
  if (!Number.isFinite(signal)) {
    throw new TypeError("OnFarm signal must be a finite number");
  }
  return round2(clamp01(signal) * max);
};

function positiveOnFarmComponents(
  vector: OnFarmScoreVector,
): Record<keyof OnFarmScoreVector, number> {
  return {
    geography: factorPoints(
      vector.geography,
      ONFARM_POSITIVE_MAX_POINTS.geography,
    ),
    corroboration: factorPoints(
      vector.corroboration,
      ONFARM_POSITIVE_MAX_POINTS.corroboration,
    ),
    freshness: factorPoints(
      vector.freshness,
      ONFARM_POSITIVE_MAX_POINTS.freshness,
    ),
    usefulness: factorPoints(
      vector.usefulness,
      ONFARM_POSITIVE_MAX_POINTS.usefulness,
    ),
    coverageGap: factorPoints(
      vector.coverageGap,
      ONFARM_POSITIVE_MAX_POINTS.coverageGap,
    ),
    citation: factorPoints(
      vector.citation,
      ONFARM_POSITIVE_MAX_POINTS.citation,
    ),
    commercial: factorPoints(
      vector.commercial,
      ONFARM_POSITIVE_MAX_POINTS.commercial,
    ),
  };
}

/**
 * Fixed-point penalty applicability. Each applied flag contributes its full
 * documented deduction; an unapplied flag contributes nothing. Penalties are
 * never fractional.
 */
function penaltyOnFarmComponents(
  penalty: OnFarmScorePenaltyVector,
): Record<keyof OnFarmScorePenaltyVector, number> {
  return {
    complianceUncertainty: penalty.complianceUncertainty
      ? ONFARM_PENALTY_MAX_POINTS.complianceUncertainty
      : 0,
    weakProvenance: penalty.weakProvenance
      ? ONFARM_PENALTY_MAX_POINTS.weakProvenance
      : 0,
    cannibalization: penalty.cannibalization
      ? ONFARM_PENALTY_MAX_POINTS.cannibalization
      : 0,
    noOriginalContribution: penalty.noOriginalContribution
      ? ONFARM_PENALTY_MAX_POINTS.noOriginalContribution
      : 0,
    unownedMaintenance: penalty.unownedMaintenance
      ? ONFARM_PENALTY_MAX_POINTS.unownedMaintenance
      : 0,
    vanity: penalty.vanity ? ONFARM_PENALTY_MAX_POINTS.vanity : 0,
  };
}

const sumComponents = (components: Record<string, number>): number =>
  Object.values(components).reduce((sum, value) => sum + value, 0);

/** Exact 75/60/45 band boundaries. Blocked always forces reject. */
function resolveOnFarmBand(
  priorityScore: number,
  blocked: boolean,
): DemandScoreBand {
  if (blocked) return "reject";
  if (priorityScore >= ONFARM_SHIP_NOW_THRESHOLD) return "ship_now";
  if (priorityScore >= ONFARM_VALIDATE_NEXT_THRESHOLD) return "validate_next";
  if (priorityScore >= ONFARM_MONITOR_THRESHOLD) return "monitor";
  return "reject";
}

/**
 * Score an OnFarm family against the documented 100-point factors and
 * fixed-point penalties. Compliance uncertainty (the penalty flag) or an
 * explicit compliance block forces a "reject" band and blocks promotion
 * regardless of the numeric priority score.
 */
export function scoreOnFarmFamily(
  vector: OnFarmScoreVector,
  penalty: OnFarmScorePenaltyVector,
  options: { complianceBlock?: boolean } = {},
): OnFarmScoreBreakdown {
  const positiveComponents = positiveOnFarmComponents(vector);
  const penaltyComponents = penaltyOnFarmComponents(penalty);

  const positiveScore = Math.min(100, sumComponents(positiveComponents));
  const penaltyScore = sumComponents(penaltyComponents);
  const priorityScore = clampPriority(positiveScore - penaltyScore);

  const blocked =
    penalty.complianceUncertainty || options.complianceBlock === true;
  const compliance: ComplianceBlocker = blocked
    ? {
        blocked: true,
        reason: "compliance_uncertainty",
        note: "Compliance uncertainty blocks promotion regardless of score.",
      }
    : { blocked: false, reason: null, note: null };

  // Confidence rewards independent corroboration and citation (real evidence)
  // and is eroded by unresolved compliance uncertainty. It is reported for the
  // feed but does not gate the band (bands are the exact 75/60/45 boundaries).
  const confidence = round4(
    clamp01(
      0.35 * clamp01(vector.corroboration) +
        0.25 * clamp01(vector.citation) +
        0.2 * clamp01(vector.geography) +
        0.2 * (penalty.complianceUncertainty ? 0 : 1),
    ),
  );

  return {
    scoringVersion: ONFARM_SCORING_VERSION,
    positiveComponents,
    positiveScore: round2(positiveScore),
    penaltyComponents,
    penaltyScore: round2(penaltyScore),
    priorityScore: round2(priorityScore),
    confidence,
    band: resolveOnFarmBand(priorityScore, blocked),
    compliance,
  };
}

export interface OnFarmFamilyCandidate {
  familyId: string;
  projectId: string;
  title: string;
  recommendedAction: DemandCanaryAction;
  vector: OnFarmScoreVector;
  penalty: OnFarmScorePenaltyVector;
  coverage: CoverageState;
  evidence: FamilyEvidence;
  /**
   * Externally determined compliance block (e.g. a legal/manual hold). Carried
   * through to scoring and feed selection so a hard block is never lost on the
   * promotion path; complianceUncertainty in the penalty vector is the other
   * way compliance enters.
   */
  complianceBlock?: boolean;
}

export interface OnFarmFeedSelection {
  items: readonly FeedItemCandidate[];
  /**
   * Every candidate considered but excluded from the promoted feed, with a
   * stable reason: generated_only_evidence, baseline_fingerprint_only,
   * compliance_blocked, below_score_threshold, or feed_limit (otherwise
   * promotable families truncated by the five-item cap).
   */
  excluded: ReadonlyArray<{ familyId: string; reason: string }>;
}

const feedItemId = async (
  projectId: string,
  familyId: string,
  runDate: string,
): Promise<string> => digestId("feed", [projectId, familyId, runDate]);

interface ScoredCandidate {
  candidate: OnFarmFamilyCandidate;
  score: OnFarmScoreBreakdown;
  generatedOnly: boolean;
  baselineOnly: boolean;
}

/**
 * Select at most five promotable feed items from scored OnFarm families.
 *
 * Generated-only status and baseline provenance are DERIVED from the family
 * evidence (hasGeneratedOnlyEvidence / empty evidence, and baselineOnly), not
 * asserted by the caller. Compliance-blocked families (penalty flag or explicit
 * candidate block) and reject-band families (priorityScore < 45) are excluded.
 * Surviving families are ordered by priority, then confidence, then family id;
 * the top five become feed items and the remaining promotable overflow is
 * returned in `excluded` with reason `feed_limit`. Monitor-band items
 * (45-59) are emitted with the `monitor_only` action; validate_next/ship_now
 * keep their recommended action.
 */
export async function selectOnFarmFeed(
  candidates: readonly OnFarmFamilyCandidate[],
  options: { runDate: string },
): Promise<OnFarmFeedSelection> {
  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const score = scoreOnFarmFamily(candidate.vector, candidate.penalty, {
      complianceBlock: candidate.complianceBlock,
    });
    const generatedOnly =
      candidate.evidence.hasGeneratedOnlyEvidence ||
      candidate.evidence.independentEventCount === 0;
    const baselineOnly = candidate.evidence.baselineOnly;
    return { candidate, score, generatedOnly, baselineOnly };
  });

  const excluded: Array<{ familyId: string; reason: string }> = [];
  const promotable: ScoredCandidate[] = [];

  for (const row of scored) {
    const familyId = row.candidate.familyId;
    if (row.generatedOnly) {
      excluded.push({ familyId, reason: "generated_only_evidence" });
    } else if (row.baselineOnly) {
      excluded.push({ familyId, reason: "baseline_fingerprint_only" });
    } else if (!row.candidate.evidence.hasPromotableObservedEvidence) {
      excluded.push({
        familyId,
        reason: "no_promotable_observed_evidence",
      });
    } else if (row.score.compliance.blocked) {
      excluded.push({ familyId, reason: "compliance_blocked" });
    } else if (row.score.priorityScore < ONFARM_MONITOR_THRESHOLD) {
      excluded.push({ familyId, reason: "below_score_threshold" });
    } else {
      promotable.push(row);
    }
  }

  const ranked = promotable.toSorted((a, b) => {
    if (b.score.priorityScore !== a.score.priorityScore) {
      return b.score.priorityScore - a.score.priorityScore;
    }
    if (b.score.confidence !== a.score.confidence) {
      return b.score.confidence - a.score.confidence;
    }
    return a.candidate.familyId.localeCompare(b.candidate.familyId);
  });

  const selected = ranked.slice(0, ONFARM_FEED_MAX_ITEMS);
  for (const row of ranked.slice(ONFARM_FEED_MAX_ITEMS)) {
    excluded.push({ familyId: row.candidate.familyId, reason: "feed_limit" });
  }

  const items: FeedItemCandidate[] = await Promise.all(
    selected.map(async (row) => {
      const forceMonitorOnly = row.score.band === "monitor";
      const provenance: FeedItemProvenance = "observed";
      return {
        itemId: await feedItemId(
          row.candidate.projectId,
          row.candidate.familyId,
          options.runDate,
        ),
        familyId: row.candidate.familyId,
        projectId: row.candidate.projectId,
        title: row.candidate.title,
        recommendedAction: forceMonitorOnly
          ? "monitor_only"
          : row.candidate.recommendedAction,
        score: row.score,
        coverage: row.candidate.coverage,
        evidence: row.candidate.evidence,
        provenance,
        compliance: row.score.compliance,
        promotionPermitted: true as const,
      };
    }),
  );

  return {
    items,
    excluded: excluded.toSorted((a, b) => a.familyId.localeCompare(b.familyId)),
  };
}
