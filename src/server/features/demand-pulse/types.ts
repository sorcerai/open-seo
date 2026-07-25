export type DemandSourceClass =
  | "first_party_observed"
  | "search_observed"
  | "community_observed"
  | "market_event_observed"
  | "ai_surface_observed"
  | "generated_candidate";

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
  publishedAt: string;
  updatedAt?: string | null;
  collectedAt: string;
  locale?: string | null;
  geography?: string | null;
  engagement?: DemandEngagement;
  metadata?: Record<string, unknown>;
  retentionProfile?: string;
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

export interface DemandScoreBreakdown {
  scoringVersion: string;
  positiveScore: number;
  penaltyScore: number;
  priorityScore: number;
  confidence: number;
  band: "ship_now" | "validate_next" | "monitor" | "reject";
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
