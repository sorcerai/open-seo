import type {
  CoverageState,
  CoverageStatus,
  DemandCanaryAction,
  FamilyEvidence,
  OnFarmScorePenaltyVector,
  OnFarmScoreVector,
} from "./types";
import { jaccardSimilarity, normalizeDemandText } from "./dedupe";
import {
  computeOnFarmFreshness,
  selectOnFarmFeed,
  type OnFarmFamilyCandidate,
  type OnFarmFeedSelection,
} from "./scoring";

// ---------------------------------------------------------------------------
// OnFarmCompost coverage evaluation and feed candidate enrichment.
//
// Pure and deterministic: no I/O, no clocks, no randomness. Given family
// evidence, a known canonical inventory (pages / assets / support workflows
// with intent, observed language, and freshness), and an explicit run time,
// this module decides how well a family is already covered and which canary
// action best addresses it, then enriches a candidate that the existing
// `selectOnFarmFeed` accepts.
//
// Invariants enforced here (spec: demand-pulse-v1):
// - Missing/unavailable inventory yields `unknown`, never a clean coverage
//   result (failure behavior: missing coverage data yields unknown).
// - An existing canonical intent match prefers correcting or updating that
//   page, adding a direct answer/asset, or changing a service/support workflow
//   before recommending a new URL. A duplicate URL is never recommended.
// - Cannibalization risk is surfaced (and blocks a duplicate-URL action) when a
//   family overlaps an existing canonical asset.
// - Every evaluation carries concise why-now, exact observed language, and
//   provenance through `CoverageState.reason` into the feed item.
// ---------------------------------------------------------------------------

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Minimum intent/language similarity (Jaccard over normalized tokens) for an
 * inventory asset to count as an existing canonical match. Below this, the
 * family is a genuine coverage gap. Exact normalized-string equality always
 * matches regardless of the threshold.
 */
export const COVERAGE_INTENT_MATCH_THRESHOLD = 0.34;

/**
 * An existing canonical asset whose freshness falls below this signal is
 * treated as stale, so coverage is `partial` (refresh to recapture) rather than
 * `covered`. Mirrors the OnFarm freshness decay (1.0 within 7 days, 0 at 90).
 */
export const COVERAGE_STALE_FRESHNESS = 0.5;

/**
 * The kind of canonical inventory asset. Drives the recommended canary action
 * when an existing intent match is found. `supporting_page` is a generic
 * catch-all page; the richer kinds map to the specific update/extend action.
 */
export type CoverageAssetKind =
  | "page"
  | "supporting_page"
  | "faq"
  | "tool"
  | "troubleshooter"
  | "product_or_offer"
  | "support_article";

/**
 * One known canonical page, asset, or support workflow in the OnFarmCompost
 * inventory. Coverage checks compare family evidence against these to decide
 * update-vs-create and to surface cannibalization risk.
 */
export interface CoverageInventoryAsset {
  kind: CoverageAssetKind;
  canonicalUrl: string;
  /** Canonical question or need the asset addresses. */
  intent: string;
  /**
   * Exact observed language known to map to this asset, when available. Used
   * for the strongest (exact) match and retained for feed provenance.
   */
  observedLanguage?: string;
  /** Real publication/update date; null when the asset is undated. */
  updatedAt: string | null;
}

/**
 * One family to evaluate. The exact observed language and family evidence are
 * required; the inventory is optional (missing => coverage unknown).
 */
export interface CoverageEvaluationInput {
  familyId: string;
  projectId: string;
  title: string;
  evidence: FamilyEvidence;
  /** Verbatim phrase that caused the family match (exact observed language). */
  observedLanguage: string;
  /**
   * Known canonical inventory. `undefined` or `inventoryUnavailable` yields
   * coverage `unknown`. An empty array means "confirmed nothing exists" and
   * yields a genuine `gap`, not `unknown`.
   */
  inventory?: readonly CoverageInventoryAsset[];
  /** Explicit inventory-unavailable override (e.g., acquisition failure). */
  inventoryUnavailable?: boolean;
}

/** A resolved inventory match for a family. */
export interface CoverageMatch {
  asset: CoverageInventoryAsset;
  /** [0, 1] intent/language similarity; 1.0 for an exact normalized match. */
  strength: number;
  exact: boolean;
}

/**
 * Pure coverage decision for one family. `coverage` is the exact
 * {@link CoverageState} the feed item carries; the score signals seed the
 * OnFarm vector/penalty so the existing scorer stays the single source of
 * truth for the numeric priority.
 */
export interface CoverageEvaluation {
  coverage: CoverageState;
  recommendedAction: DemandCanaryAction;
  /** [0, 1] coverage-gap signal for the OnFarm positive vector. */
  coverageGap: number;
  /** [0, 1] evidence-recency signal for the OnFarm positive vector. */
  freshness: number;
  /** [0, 1] cannibalization-risk signal for the OnFarm penalty vector. */
  cannibalizationRisk: number;
  /** Best matched inventory asset, if any. null for gap/unknown. */
  match: CoverageMatch | null;
  /** True when inventory data was unavailable (coverage is unknown). */
  inventoryUnavailable: boolean;
}

/**
 * Map an existing canonical asset kind to the canary action that addresses it
 * without creating a duplicate URL. A matched `supporting_page` is updated
 * rather than duplicated, so it also maps to `update_existing_page`.
 * `create_supporting_page` is intentionally absent: a new URL is only
 * recommended for a genuine gap (no existing match).
 */
const ASSET_KIND_ACTION: Record<CoverageAssetKind, DemandCanaryAction> = {
  page: "update_existing_page",
  supporting_page: "update_existing_page",
  faq: "add_faq",
  tool: "create_tool",
  troubleshooter: "create_troubleshooter",
  product_or_offer: "update_product_or_offer",
  support_article: "create_support_article",
};

/**
 * Tie-break priority for matched asset kinds. When two assets match with equal
 * strength, the most direct existing-page update wins before richer asset
 * types; a generic `supporting_page` loses to everything. Deterministic.
 */
const KIND_PRIORITY: Record<CoverageAssetKind, number> = {
  page: 0,
  product_or_offer: 1,
  support_article: 2,
  faq: 3,
  troubleshooter: 4,
  tool: 5,
  supporting_page: 6,
};

function distinctGeographies(evidence: FamilyEvidence): number {
  const geos = new Set<string>();
  for (const event of evidence.events) {
    for (const geo of event.geographies) {
      if (geo) geos.add(geo);
    }
  }
  return geos.size;
}

/**
 * Default OnFarm positive vector derived from evidence. Coverage owns
 * coverageGap and freshness (overridden by the evaluation); the remaining
 * factors get a sensible canary default that the real pipeline may override.
 */
function defaultVectorFromEvidence(
  evidence: FamilyEvidence,
): OnFarmScoreVector {
  const geoCount = distinctGeographies(evidence);
  return {
    geography: geoCount >= 2 ? 1 : geoCount === 1 ? 0.5 : 0,
    corroboration: clamp01(evidence.independentEventCount / 3),
    freshness: 0,
    usefulness:
      evidence.hasFirstPartyEvidence || evidence.hasSearchEvidence ? 0.6 : 0.3,
    coverageGap: 0,
    citation: evidence.hasPrimaryAuthoritativeEvidence
      ? 0.8
      : evidence.hasSearchEvidence
        ? 0.4
        : 0,
    commercial: 0,
  };
}

/**
 * Default OnFarm penalty applicability derived from evidence. Coverage owns
 * cannibalization (overridden by the evaluation); the remaining flags get a
 * sensible canary default that the real pipeline may override.
 */
function defaultPenaltyFromEvidence(
  evidence: FamilyEvidence,
): OnFarmScorePenaltyVector {
  return {
    complianceUncertainty: false,
    weakProvenance: evidence.hasGeneratedOnlyEvidence,
    cannibalization: false,
    noOriginalContribution: false,
    unownedMaintenance: false,
    vanity: false,
  };
}

function provenanceLabel(evidence: FamilyEvidence): string {
  const classes = evidence.sourceClasses;
  const count = evidence.independentEventCount;
  if (classes.length > 0) {
    return `${classes.join(", ")}; ${count} independent`;
  }
  return `${count} independent events`;
}

function unknownReason(
  observedLanguage: string,
  evidence: FamilyEvidence,
): string {
  return `coverage unknown: inventory unavailable; observed "${observedLanguage}"; ${provenanceLabel(evidence)}`;
}

function gapReason(observedLanguage: string, evidence: FamilyEvidence): string {
  return `no existing canonical coverage; observed "${observedLanguage}"; ${provenanceLabel(evidence)}; new page to capture demand`;
}

function matchReason(ctx: {
  observedLanguage: string;
  evidence: FamilyEvidence;
  match: CoverageMatch;
  status: CoverageStatus;
  stale: boolean;
  assetFreshness: number;
}): string {
  const whyNow =
    ctx.status === "covered"
      ? "already addressed; monitor for drift"
      : ctx.stale
        ? `canonical page stale (freshness ${ctx.assetFreshness.toFixed(2)}); refresh to recapture demand`
        : "partial coverage; extend existing page to fully answer";
  return `${whyNow}; ${ctx.match.asset.kind} ${ctx.match.asset.canonicalUrl}; observed "${ctx.observedLanguage}"; ${provenanceLabel(ctx.evidence)}`;
}

/**
 * Similarity between a family and one inventory asset across intent and exact
 * observed language. Returns 1.0 for an exact normalized match, else the best
 * Jaccard similarity over the candidate text pairs.
 */
function assetMatchScore(
  asset: CoverageInventoryAsset,
  needles: readonly string[],
): { score: number; exact: boolean } {
  const haystacks = [asset.intent, asset.observedLanguage ?? ""].filter(
    (value): value is string => value.length > 0,
  );
  let best = 0;
  let exact = false;
  for (const needle of needles) {
    const normalizedNeedle = normalizeDemandText(needle);
    if (!normalizedNeedle) continue;
    for (const haystack of haystacks) {
      if (normalizedNeedle === normalizeDemandText(haystack)) {
        exact = true;
        best = 1;
        break;
      }
      best = Math.max(best, jaccardSimilarity(needle, haystack));
    }
    if (exact) break;
  }
  return { score: best, exact };
}

function compareMatch(a: CoverageMatch, b: CoverageMatch): number {
  // Lower return value = a is better. Highest strength wins; ties prefer the
  // exact match, then the higher-priority kind, then the lower canonical URL.
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  const byKind = KIND_PRIORITY[a.asset.kind] - KIND_PRIORITY[b.asset.kind];
  if (byKind !== 0) return byKind;
  return a.asset.canonicalUrl.localeCompare(b.asset.canonicalUrl);
}

/**
 * Find the best existing canonical match for a family, or null when no asset
 * clears the intent-match threshold. Deterministic: equal-strength ties break
 * by kind priority then canonical URL.
 */
export function findBestCoverageMatch(
  input: CoverageEvaluationInput,
): CoverageMatch | null {
  const inventory = input.inventory ?? [];
  const needles = [input.observedLanguage, input.title].filter(
    (value): value is string => value.length > 0,
  );
  let best: CoverageMatch | null = null;
  for (const asset of inventory) {
    const { score, exact } = assetMatchScore(asset, needles);
    if (!exact && score < COVERAGE_INTENT_MATCH_THRESHOLD) continue;
    const candidate: CoverageMatch = {
      asset,
      strength: exact ? 1 : score,
      exact,
    };
    if (best === null || compareMatch(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Evaluate coverage for one family against the inventory. Pure and
 * deterministic. Missing inventory => `unknown`; an existing canonical match
 * prefers the update/extend action for that asset (never a duplicate URL); a
 * confirmed gap => `create_supporting_page`. Freshness, gap, and
 * cannibalization signals seed the OnFarm score.
 */
export function evaluateCoverage(
  input: CoverageEvaluationInput,
  now: string,
): CoverageEvaluation {
  const evidence = input.evidence;
  const baselineOnly = evidence.baselineOnly;
  const freshness = computeOnFarmFreshness(
    evidence.lastObservedAt,
    now,
    baselineOnly,
  );

  const inventoryUnavailable =
    input.inventoryUnavailable === true || input.inventory === undefined;

  if (inventoryUnavailable) {
    return {
      coverage: {
        status: "unknown",
        existingCanonicalUrl: null,
        prefersExistingUpdate: false,
        reason: unknownReason(input.observedLanguage, evidence),
      },
      recommendedAction: "monitor_only",
      coverageGap: 0,
      freshness,
      cannibalizationRisk: 0,
      match: null,
      inventoryUnavailable: true,
    };
  }

  const match = findBestCoverageMatch(input);
  if (match === null) {
    // Inventory was available but nothing matched: a genuine, confirmed gap.
    return {
      coverage: {
        status: "gap",
        existingCanonicalUrl: null,
        prefersExistingUpdate: false,
        reason: gapReason(input.observedLanguage, evidence),
      },
      recommendedAction: "create_supporting_page",
      coverageGap: 1,
      freshness,
      cannibalizationRisk: 0,
      match: null,
      inventoryUnavailable: false,
    };
  }

  const assetFreshness = computeOnFarmFreshness(match.asset.updatedAt, now);
  const stale = assetFreshness < COVERAGE_STALE_FRESHNESS;
  const status: CoverageStatus = match.exact && !stale ? "covered" : "partial";

  // A new URL here would duplicate an existing canonical asset. The
  // recommendation is forced to the asset's update/extend action (never
  // create_supporting_page), and when the page is already well-covered the
  // cannibalization penalty lowers priority so genuine gaps ship first.
  const cannibalizationRisk = status === "covered" ? match.strength : 0;
  const coverageGap = status === "covered" ? 0.1 : 0.5;

  return {
    coverage: {
      status,
      existingCanonicalUrl: match.asset.canonicalUrl,
      prefersExistingUpdate: true,
      reason: matchReason({
        observedLanguage: input.observedLanguage,
        evidence,
        match,
        status,
        stale,
        assetFreshness,
      }),
    },
    recommendedAction: ASSET_KIND_ACTION[match.asset.kind],
    coverageGap,
    freshness,
    cannibalizationRisk,
    match,
    inventoryUnavailable: false,
  };
}

export interface CoverageCandidateOptions {
  /** Overrides for the non-coverage positive factors (geography, citation...). */
  vector?: Partial<OnFarmScoreVector>;
  /** Overrides for the non-coverage penalty factors. */
  penalty?: Partial<OnFarmScorePenaltyVector>;
  /** External/manual legal or policy hold; always blocks promotion. */
  complianceBlock?: boolean;
}

/**
 * Build an OnFarm candidate enriched with the coverage evaluation. Coverage
 * owns `coverageGap`, `freshness`, and `cannibalization`; the caller (or the
 * evidence-derived default) supplies the remaining score factors. The result
 * is accepted by the existing `selectOnFarmFeed`, which enforces the
 * generated-only / baseline-fingerprint / compliance gates and the five-item
 * cap, and emits the final FeedItemCandidate.
 */
export function buildCoverageCandidate(
  input: CoverageEvaluationInput,
  now: string,
  options: CoverageCandidateOptions = {},
): OnFarmFamilyCandidate {
  const evaluation = evaluateCoverage(input, now);
  const evidence = input.evidence;
  const baseVector = defaultVectorFromEvidence(evidence);
  const basePenalty = defaultPenaltyFromEvidence(evidence);
  const overrideVector = options.vector ?? {};
  const overridePenalty = options.penalty ?? {};
  // Coverage owns coverageGap, freshness, and cannibalization; the caller (or
  // the evidence-derived default) supplies every other factor. Each field is
  // resolved explicitly so the boolean penalty flags and numeric signals keep
  // their exact types through to the shared scorer.
  const vector: OnFarmScoreVector = {
    geography: overrideVector.geography ?? baseVector.geography,
    corroboration: overrideVector.corroboration ?? baseVector.corroboration,
    freshness: evaluation.freshness,
    usefulness: overrideVector.usefulness ?? baseVector.usefulness,
    coverageGap: evaluation.coverageGap,
    citation: overrideVector.citation ?? baseVector.citation,
    commercial: overrideVector.commercial ?? baseVector.commercial,
  };
  const penalty: OnFarmScorePenaltyVector = {
    complianceUncertainty:
      overridePenalty.complianceUncertainty ??
      basePenalty.complianceUncertainty,
    weakProvenance:
      overridePenalty.weakProvenance ?? basePenalty.weakProvenance,
    // A strong coverage overlap applies the full cannibalization deduction;
    // otherwise the flag is off (no fractional penalty).
    cannibalization: evaluation.cannibalizationRisk >= 0.5,
    noOriginalContribution:
      overridePenalty.noOriginalContribution ??
      basePenalty.noOriginalContribution,
    unownedMaintenance:
      overridePenalty.unownedMaintenance ?? basePenalty.unownedMaintenance,
    vanity: overridePenalty.vanity ?? basePenalty.vanity,
  };
  return {
    familyId: input.familyId,
    projectId: input.projectId,
    title: input.title,
    recommendedAction: evaluation.recommendedAction,
    vector,
    penalty,
    complianceBlock: options.complianceBlock,
    coverage: evaluation.coverage,
    evidence,
  };
}

/**
 * One family in a coverage feed run, with optional score-factor overrides.
 */
export interface CoverageFeedFamily extends CoverageEvaluationInput {
  vector?: Partial<OnFarmScoreVector>;
  penalty?: Partial<OnFarmScorePenaltyVector>;
  complianceBlock?: boolean;
}

export interface CoverageFeedSelectionOptions {
  /** Run date (YYYY-MM-DD), used for deterministic feed item ids. */
  runDate: string;
  /** Run time anchor for freshness; never read from the system clock. */
  now: string;
}

/**
 * Evaluate coverage for every family and select the feed through the existing
 * `selectOnFarmFeed`. Delegates ordering, the five-item cap, and the
 * generated-only / baseline / compliance exclusion rules entirely to the
 * shared scorer so coverage stays pure and the feed contract stays single-sourced.
 */
export async function selectCoverageFeed(
  families: readonly CoverageFeedFamily[],
  options: CoverageFeedSelectionOptions,
): Promise<OnFarmFeedSelection> {
  const candidates = families.map((family) =>
    buildCoverageCandidate(family, options.now, {
      vector: family.vector,
      penalty: family.penalty,
      complianceBlock: family.complianceBlock,
    }),
  );
  return selectOnFarmFeed(candidates, { runDate: options.runDate });
}
