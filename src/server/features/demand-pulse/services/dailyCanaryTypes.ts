import { DEMAND_PULSE_EVIDENCE_VERSION } from "../types";
import type {
  DemandPulseObservationInput,
  EvidenceGraphInput,
  FamilyResultsInput,
} from "../repositories/DemandPulseEvidenceRepository";
import type {
  DemandPulseFeedItem,
  DemandPulseFeedItemInput,
  DemandPulseFeedScope,
} from "../repositories/DemandPulseFeedRepository";
import type {
  DemandObservationCandidate,
  OnFarmScorePenaltyVector,
  OnFarmScoreVector,
} from "../types";
import type { DemandPulseFeatureFlagEnv } from "../feature-flags";
import type { CoverageInventoryAsset } from "../coverage";
import type { OfficialPageFetch } from "../canaries/onfarmcompost-official-sources";
import type { DemandPulseJsonBucket } from "../canaries/onfarmcompost-official-store";
import type { OnFarmCompostOfficialMonitorRepository } from "../canaries/onfarmcompost-official-monitor";
import type {
  DemandSourceAdapter,
  DemandSourceRunHealth,
} from "../sources/adapter";

export const TIME_ZONE = "America/Chicago";
export const DAILY_RUN_HOUR = 5;
export const FEED_SELECTION_VERSION = "demand-pulse-feed-v1.0.0";
export const COVERAGE_EVALUATOR_VERSION = "demand-pulse-coverage-v1.0.0";
export const CANARY_ARTIFACT_VERSION = "demand-pulse-canary-v1";
export const MAX_FEED_ITEMS = 5;
export { DEMAND_PULSE_EVIDENCE_VERSION };

export type AdapterKey =
  | "gsc-site"
  | "dataforseo-discussions"
  | "manual-first-party"
  | "local-news"
  | "hacker-news";

export type DemandPulseCanarySourceConfig = unknown;

/** Adapter contract exposed at the canary boundary. */
export type DemandPulseCanaryAdapter = DemandSourceAdapter;

export type DemandPulseCanaryAdapters = Partial<
  Record<AdapterKey, DemandPulseCanaryAdapter>
>;

export interface DemandPulseFamilyDefinition {
  familyKey: string;
  title: string;
  keywords?: readonly string[];
  match?: (observation: DemandObservationCandidate) => boolean;
  problemStatement?: string;
  decisionBeingMade?: string | null;
  locale?: string | null;
  geography?: string | null;
  intent?: string | null;
  funnelStage?: string | null;
  inventory?: readonly CoverageInventoryAsset[];
  vector?: Partial<OnFarmScoreVector>;
  penalty?: Partial<OnFarmScorePenaltyVector>;
  complianceBlock?: boolean;
}

export interface DemandPulseCanaryEnv extends DemandPulseFeatureFlagEnv {
  R2: DemandPulseJsonBucket;
  DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID?: string;
  DEMAND_PULSE_SOURCE_GSC?: string;
  DEMAND_PULSE_SOURCE_LOCAL_NEWS?: string;
  DEMAND_PULSE_FIRST_PARTY_IMPORT_JSON?: string;
  DEMAND_PULSE_DATAFORSEO_QUERIES?: string;
  DEMAND_PULSE_DATAFORSEO_LOCATION_CODE?: string;
  DEMAND_PULSE_DATAFORSEO_LANGUAGE_CODE?: string;
  DEMAND_PULSE_DATAFORSEO_OPERATION_KEY?: string;
  DEMAND_PULSE_DATAFORSEO_BILLING_EMAIL?: string;
  DEMAND_PULSE_DATAFORSEO_BILLING_USER_ID?: string;
  DEMAND_PULSE_LOCAL_NEWS_CONFIG_JSON?: string;
  DEMAND_PULSE_HACKER_NEWS_CONFIG_JSON?: string;
  DEMAND_PULSE_FAMILIES_JSON?: string;
}

export interface DemandPulseCanaryRepository extends OnFarmCompostOfficialMonitorRepository {
  persistObservations(input: {
    scope: EvidenceGraphInput["scope"];
    rows: readonly DemandPulseObservationInput[];
  }): Promise<void>;
  persistEvidenceGraph(input: EvidenceGraphInput): Promise<void>;
  persistFamilyResults(input: FamilyResultsInput): Promise<void>;
  persistFeedItems(input: {
    scope: DemandPulseFeedScope;
    rows: readonly DemandPulseFeedItemInput[];
  }): Promise<DemandPulseFeedItem[]>;
}

export interface DemandPulseCanaryArtifact {
  schemaVersion: "1";
  artifactType: typeof CANARY_ARTIFACT_VERSION;
  runId: string;
  projectId: string;
  profileId: string;
  localDate: string;
  generatedAt: string;
  timezone: string;
  mode: "dry_run";
  publicationAllowed: false;
  sourceHealth: readonly DemandPulseCanarySourceHealth[];
  observations: readonly DemandObservationCandidate[];
  evidence: {
    events: readonly unknown[];
    observationEvents: readonly unknown[];
    duplicateEdges: readonly unknown[];
  };
  families: readonly unknown[];
  coverage: readonly unknown[];
  scores: readonly unknown[];
  candidateCards: readonly unknown[];
  metrics: DemandPulseCanaryMetrics;
  errors: readonly string[];
  excludedFeedItems: readonly unknown[];
  nextStage: "complete_demand_pulse_v1_no_publication";
}

export interface DemandPulseCanarySourceHealth {
  sourceId: string;
  adapter: string;
  sourcePlatform: string | null;
  health: DemandSourceRunHealth["status"];
  policyState: string;
  requestCount: number;
  costMicros: number;
  cursor: string | null;
  error: string | null;
  observationCount: number;
  warnings: readonly string[];
}

export interface DemandPulseCanaryMetrics {
  configuredSourceCount: number;
  sourceRunCount: number;
  successfulSourceCount: number;
  failedSourceCount: number;
  blockedSourceCount: number;
  unknownSourceCount: number;
  skippedSourceCount: number;
  observationCount: number;
  evidenceEventCount: number;
  observationEventCount: number;
  duplicateEdgeCount: number;
  familyCount: number;
  coverageCheckCount: number;
  scoreCount: number;
  feedItemCount: number;
  feedLimit: number;
  publicationAllowed: false;
}

export type DemandPulseCanaryResult =
  | { status: "disabled" }
  | { status: "unsafe_configuration" }
  | { status: "before_daily_window"; localDate: string }
  | { status: "profile_not_configured"; projectId?: string }
  | { status: "already_completed"; runId: string; artifactKey: string }
  | { status: "already_running"; runId: string }
  | {
      status: "completed" | "incomplete" | "failed";
      runId: string;
      artifactKey: string | null;
      artifact: DemandPulseCanaryArtifact | null;
      metrics: DemandPulseCanaryMetrics;
      errorMessage: string | null;
    };

export interface RunDemandPulseCanaryInput {
  env: DemandPulseCanaryEnv;
  now?: Date;
  fetchFn?: OfficialPageFetch;
  adapterFetchFn?: typeof fetch;
  repository?: DemandPulseCanaryRepository;
  adapters?: DemandPulseCanaryAdapters;
  sourceConfigs?: Partial<Record<string, DemandPulseCanarySourceConfig>>;
  families?: readonly DemandPulseFamilyDefinition[];
}
