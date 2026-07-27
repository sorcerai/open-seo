export type DemandSourceClass =
  | "first_party_observed"
  | "search_observed"
  | "community_observed"
  | "market_event_observed"
  | "ai_surface_observed"
  | "generated_candidate"
  | "primary_authoritative";

export type DemandLifecycleStatus =
  | "discovered"
  | "normalized"
  | "clustered"
  | "corroborated"
  | "promoted"
  | "actioned"
  | "measured"
  | "decayed"
  | "rejected";

export type DemandRegime =
  | "emerging"
  | "persistent"
  | "seasonal"
  | "event_driven"
  | "evergreen_latent"
  | "decaying"
  | "unknown";

export type DemandActionType =
  | "update_existing_page"
  | "create_supporting_page"
  | "add_faq"
  | "create_comparison"
  | "create_tool"
  | "create_troubleshooter"
  | "update_product_or_offer"
  | "create_sales_enablement"
  | "create_support_article"
  | "monitor_only"
  | "reject";

/**
 * Canary-allowed actions. Mirrors the read-only promotion surface in the MCP
 * contract: every configured action updates, adds, or monitors content. None of
 * them publishes. `reject` lives on DemandActionType for dismissals but is not a
 * promotable feed action, so it is intentionally excluded here. There is no
 * publication action by design.
 */
export const DEMAND_CANARY_ALLOWED_ACTIONS = [
  "update_existing_page",
  "create_supporting_page",
  "add_faq",
  "create_comparison",
  "create_tool",
  "create_troubleshooter",
  "update_product_or_offer",
  "create_sales_enablement",
  "create_support_article",
  "monitor_only",
] as const;

export type DemandCanaryAction = (typeof DEMAND_CANARY_ALLOWED_ACTIONS)[number];

export function isDemandCanaryAction(
  value: unknown,
): value is DemandCanaryAction {
  return (
    typeof value === "string" &&
    (DEMAND_CANARY_ALLOWED_ACTIONS as readonly string[]).includes(value)
  );
}

/** Version stamped on every resolved evidence grouping and score payload. */
export const DEMAND_PULSE_EVIDENCE_VERSION = "demand-pulse-evidence-v1.0.0";

export interface DemandEngagement {
  score?: number | null;
  comments?: number | null;
  views?: number | null;
  reactions?: number | null;
  velocityPerDay?: number | null;
  communityPercentile?: number | null;
}

export interface DemandObservationCandidate {
  projectId: string;
  sourceConnectionId: string;
  sourceClass: DemandSourceClass;
  sourcePlatform: string;
  sourceDomain?: string | null;
  externalId: string;
  canonicalUrl: string;
  outboundUrl?: string | null;
  title: string;
  excerpt?: string | null;
  publishedAt: string | null;
  updatedAt?: string | null;
  collectedAt: string;
  locale?: string | null;
  geography?: string | null;
  engagement?: DemandEngagement;
  metadata?: Record<string, unknown>;
  retentionProfile?: string;
  /**
   * True when publishedAt is a collection-time fallback (no real publication
   * date), e.g. the official-page monitor's baseline fingerprint. Baseline
   * observations carry no recency signal and cannot be promoted on their own.
   */
  baselineFingerprint?: boolean | null;
}

/**
 * Every signal is normalized to [0, 1]. Keep the vector. Never persist only the
 * final priority score, because opaque scores age about as gracefully as milk.
 */
export interface DemandSignalVector {
  crossSourceDiversity: number;
  commercialProximity: number;
  firstPartyCorroboration: number;
  searchCorroboration: number;
  normalizedVelocity: number;
  recurrence: number;
  coverageGap: number;
  sourceReliability: number;
  icpFit: number;
  persistence: number;
  aiSurfaceCorroboration: number;
  decisionClarity: number;
  trendAcceleration: number;

  spamRisk: number;
  legalRetentionRisk: number;
  cannibalizationRisk: number;
  stalenessRisk: number;
  sourceConcentrationRisk: number;
  uncertainty: number;
}

export type DemandScoreBand =
  | "ship_now"
  | "validate_next"
  | "monitor"
  | "reject";

export interface DemandScoreBreakdown {
  scoringVersion: string;
  positiveScore: number;
  penaltyScore: number;
  priorityScore: number;
  confidence: number;
  band: DemandScoreBand;
  positiveComponents: Record<string, number>;
  penaltyComponents: Record<string, number>;
}

export interface PromptFamilyEvidenceSummary {
  observationCount: number;
  independentSourceCount: number;
  sourceClassCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  hasFirstPartyEvidence: boolean;
  hasSearchEvidence: boolean;
  hasAiSurfaceEvidence: boolean;
}

export interface DemandPromptFamily {
  id: string;
  projectId: string;
  canonicalQuestion: string;
  problemStatement: string;
  decisionBeingMade?: string | null;
  entities: string[];
  intent?: string | null;
  funnelStage?: string | null;
  regime: DemandRegime;
  lifecycleStatus: DemandLifecycleStatus;
  evidence: PromptFamilyEvidenceSummary;
  score?: DemandScoreBreakdown;
  recommendedAction?: DemandActionType;
  recommendedTargetUrl?: string | null;
}

export interface SourceCapabilityDescriptor {
  sourcePlatform: string;
  supportsBackfill: boolean;
  supportsIncrementalCursor: boolean;
  supportsDeletionSync: boolean;
  supportsEngagementSnapshots: boolean;
  supportsFullText: boolean;
  requiresAuthentication: boolean;
  requiresCommercialApproval: boolean;
  defaultRawRetentionDays: number;
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Evidence processing contracts (deterministic foundations).
//
// Duplicate observations and independent evidence events are separate relations
// (spec invariant 3). Corroboration counts independent events, never raw copies.
// Confident cross-posts are syndicated duplicates, not independent evidence.
// ---------------------------------------------------------------------------

/** How two observations relate when classified as duplicates. */
export type DuplicateRelationKind =
  | "exact"
  | "canonical"
  | "syndicated"
  | "semantic";

/**
 * One recorded duplicate edge between two observations. Every pair that the
 * dedupe classifier collapses is persisted for audit; the edge never deletes the
 * raw observation (raw copies are retained for the retention window).
 */
export interface DuplicateEdge {
  leftObservationId: string;
  rightObservationId: string;
  relation: DuplicateRelationKind;
  /** Title/token similarity in [0, 1] at classification time. */
  similarity: number;
  /** Classifier reason code (e.g. same_canonical_url). */
  reason: string;
}

/**
 * One independent evidence event: the smallest unit of corroboration. Built by
 * deterministically grouping duplicate observations. A single event always
 * contributes exactly one independent corroboration regardless of how many raw
 * copies were folded into it.
 */
export interface EvidenceEvent {
  /**
   * Stable id derived from the event's canonical content key (normalized title
   * + publication day) of its first-observed anchor observation. Stable across
   * runs: discovering a later duplicate of the same event does not change it.
   */
  eventId: string;
  /** Anchor observation id for the event (the first-observed member). */
  canonicalObservationId: string;
  /** Every observation id folded into this event, sorted. */
  memberObservationIds: readonly string[];
  /** Distinct source classes among members, sorted. */
  sourceClasses: readonly DemandSourceClass[];
  /** Distinct source connections among members, sorted. */
  sourceConnectionIds: readonly string[];
  /** Distinct non-empty geographies among members, sorted. */
  geographies: readonly string[];
  /** Earliest valid publishedAt among members. */
  firstObservedAt: string;
  /** Latest valid publishedAt among members. */
  lastObservedAt: string;
  /** Raw observation copies folded into this event (retained for audit). */
  rawObservationCount: number;
  /** True when every member is a baseline fingerprint (no real publication date). */
  baselineOnly: boolean;
  /** A resolved event is always exactly one independent corroboration. */
  readonly independentCount: 1;
}

/**
 * Aggregated evidence for one prompt family. independentEventCount is the value
 * corroboration scoring must use; rawObservationCount is preserved separately so
 * raw volume can never silently inflate corroboration.
 */
export interface FamilyEvidence {
  /** Identity/scoring contract version used to derive this evidence snapshot. */
  evidenceVersion: typeof DEMAND_PULSE_EVIDENCE_VERSION;
  familyId: string;
  /** Independent events (one corroboration each). */
  events: readonly EvidenceEvent[];
  /** Corroboration count = number of independent events. */
  independentEventCount: number;
  /** Total raw observation copies retained across all events. */
  rawObservationCount: number;
  /** Distinct source classes across all events, sorted. */
  sourceClasses: readonly DemandSourceClass[];
  /** Recorded duplicate edges for audit. */
  duplicateEdges: readonly DuplicateEdge[];
  firstObservedAt: string;
  lastObservedAt: string;
  hasFirstPartyEvidence: boolean;
  hasPrimaryAuthoritativeEvidence: boolean;
  hasSearchEvidence: boolean;
  hasCommunityEvidence: boolean;
  hasAiSurfaceEvidence: boolean;
  /** True only when every contributing source class is generated_candidate. */
  hasGeneratedOnlyEvidence: boolean;
  /** True when every event is baseline-only (no real publication dates). */
  baselineOnly: boolean;
  /** At least one non-generated, non-baseline observation can support promotion. */
  hasPromotableObservedEvidence: boolean;
}

// ---------------------------------------------------------------------------
// Coverage state.
// ---------------------------------------------------------------------------

export type CoverageStatus = "covered" | "partial" | "gap" | "unknown";

/**
 * Result of comparing a family against the existing content inventory. Missing
 * coverage data yields `unknown`, never a clean coverage result (spec failure
 * behavior). Preferring an existing-page update over a new URL is the default.
 */
export interface CoverageState {
  status: CoverageStatus;
  /** Canonical page already addressing the family, if any. */
  existingCanonicalUrl: string | null;
  /** Prefer correcting/updating an existing page over creating a new URL. */
  prefersExistingUpdate: boolean;
  /** Human-readable basis; required and non-empty when status is "unknown". */
  reason: string;
}

// ---------------------------------------------------------------------------
// OnFarmCompost 100-point scoring contracts.
//
// Positive factors sum to a 100-point ceiling. Penalties are explicit
// applicability flags: when a flag is set, the full documented fixed-point
// deduction applies; otherwise it contributes nothing. Compliance uncertainty
// blocks promotion regardless of score.
// ---------------------------------------------------------------------------

/** Positive OnFarm score signals, each normalized to [0, 1]. */
export interface OnFarmScoreVector {
  geography: number;
  corroboration: number;
  freshness: number;
  usefulness: number;
  coverageGap: number;
  citation: number;
  commercial: number;
}

/**
 * OnFarm penalty applicability. Each flag is boolean: when true the full
 * documented fixed-point deduction applies (-30 compliance uncertainty, -20 weak
 * provenance, -20 cannibalization, -10 no original contribution, -10 unowned
 * maintenance, -15 vanity); when false it contributes nothing. Modeling
 * applicability explicitly keeps the documented penalties from being weakened
 * into fractional signals.
 */
export interface OnFarmScorePenaltyVector {
  complianceUncertainty: boolean;
  weakProvenance: boolean;
  cannibalization: boolean;
  noOriginalContribution: boolean;
  unownedMaintenance: boolean;
  vanity: boolean;
}

/**
 * Compliance gate. When blocked, promotion is refused regardless of the numeric
 * priority score (spec: compliance risk can block promotion regardless of score).
 */
export interface ComplianceBlocker {
  blocked: boolean;
  reason: "compliance_uncertainty" | null;
  note: string | null;
}

export interface OnFarmScoreBreakdown {
  scoringVersion: string;
  positiveComponents: Record<keyof OnFarmScoreVector, number>;
  positiveScore: number;
  /** Fixed-point deductions actually applied (0 or the documented max per flag). */
  penaltyComponents: Record<keyof OnFarmScorePenaltyVector, number>;
  penaltyScore: number;
  priorityScore: number;
  confidence: number;
  band: DemandScoreBand;
  compliance: ComplianceBlocker;
}

// ---------------------------------------------------------------------------
// Feed selection and review decisions.
//
// No run emits more than five feed items (spec invariant 8). Generated-only
// candidates and baseline fingerprints cannot be promoted. Decisions never
// trigger publication (spec invariant 9).
// ---------------------------------------------------------------------------

export type FeedItemProvenance =
  | "observed"
  | "baseline_fingerprint"
  | "generated_only";

export interface FeedItemCandidate {
  /** Deterministic id from projectId + familyId + run date (SHA-256). */
  itemId: string;
  familyId: string;
  projectId: string;
  title: string;
  recommendedAction: DemandCanaryAction;
  score: OnFarmScoreBreakdown;
  coverage: CoverageState;
  evidence: FamilyEvidence;
  provenance: FeedItemProvenance;
  /** Compliance gate carried through to the feed item for traceability. */
  compliance: ComplianceBlocker;
  /** Always true for items that survive selection; non-promotable items are excluded. */
  promotionPermitted: true;
}

export type ReviewDecisionKind =
  | "accept"
  | "reject"
  | "defer"
  | "request_research";

/**
 * Human review decision over a feed item. Accepting records a promotable action
 * but never publishes content; publicationTriggered is a literal false contract.
 */
export interface ReviewDecision {
  decisionId: string;
  feedItemId: string;
  familyId: string;
  projectId: string;
  kind: ReviewDecisionKind;
  /** Set when kind is "accept"; must be a canary (non-publication) action. */
  action: DemandCanaryAction | null;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  /** Decisions never trigger publication. */
  readonly publicationTriggered: false;
}
