import type { DemandObservationCandidate } from "../types";
import type {
  OfficialPageFetch,
  OfficialPageSeed,
  OfficialPageSnapshot,
} from "./onfarmcompost-official-sources";
import type {
  OfficialPageState,
  OfficialPageStateEntry,
} from "./onfarmcompost-official-store";
import type { DemandPulseSource } from "../repositories/DemandPulseRepository";

export type OfficialSourceRunHealth =
  | "healthy"
  | "failed"
  | "blocked"
  | "unknown"
  | "skipped";

export interface SuccessfulOfficialSourceResult {
  seed: OfficialPageSeed;
  // Database id of the approved, enabled source row this observation came from.
  sourceId: string;
  snapshot: OfficialPageSnapshot;
  // A genuine content change: a previous fingerprint existed and differed.
  changed: boolean;
  // First time this source was observed. The fingerprint becomes the baseline
  // reference; it is metadata, never a fresh velocity signal.
  baseline: boolean;
  previousFingerprint: string | null;
  health: "healthy";
  policyState: string;
  error: null;
}

export interface FailedOfficialSourceResult {
  seed: OfficialPageSeed;
  sourceId: string;
  snapshot: null;
  changed: false;
  baseline: false;
  previousFingerprint: string | null;
  health: "failed";
  policyState: string;
  error: string;
}

export interface BlockedOfficialSourceResult {
  seed: OfficialPageSeed;
  // A registered source row exists, but the source gate prevented collection.
  sourceId: string;
  snapshot: null;
  changed: false;
  baseline: false;
  previousFingerprint: string | null;
  health: "blocked" | "unknown" | "skipped";
  policyState: string;
  error: string;
}

export type OfficialSourceResult =
  | SuccessfulOfficialSourceResult
  | FailedOfficialSourceResult
  | BlockedOfficialSourceResult;

export interface SourceHealthEntry {
  sourceId: string;
  dbSourceId: string | null;
  requestedUrl: string;
  health: OfficialSourceRunHealth;
  policyState: string;
  ok: boolean;
  changed: boolean;
  baseline: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  fingerprint: string | null;
  previousFingerprint: string | null;
  fetchedAt: string;
  contentBytes: number | null;
  error: string | null;
}

export interface OnFarmCompostOfficialMonitorArtifact {
  schemaVersion: "1";
  artifactType: "demand_pulse_official_page_dry_run";
  // The DB run row this artifact belongs to, so R2 evidence joins unambiguously
  // to demand_pulse_runs.id.
  runId: string;
  // Real registered project UUID resolved from the profile — never the slug.
  projectId: string;
  mode: "dry_run";
  publicationAllowed: false;
  generatedAt: string;
  localDate: string;
  timezone: "America/Chicago";
  sourceHealth: SourceHealthEntry[];
  observations: DemandObservationCandidate[];
  candidateCards: [];
  summary: {
    configuredSources: number;
    successfulSources: number;
    failedSources: number;
    changedSources: number;
    baselineSources: number;
    unchangedSources: number;
    skippedSources: number;
  };
  // Non-null only for controlled-failure runs (blocked/incomplete/failed). A
  // clean completed run carries null.
  errorMessage: string | null;
  nextStage: "coverage_clustering_scoring_and_review_not_wired";
}

export type BlockedCause =
  | "corrupt_state"
  | "wrong_project_state"
  | "unsafe_profile"
  | "unsafe_profile_recheck"
  | "claimed_completion_corrupt";

// The monitor's terminal result contract. Lives with the artifact module
// because every variant is derived from the run artifact's status.
export type OnFarmCompostOfficialMonitorResult =
  | { status: "disabled" }
  | { status: "unsafe_configuration" }
  | { status: "before_daily_window"; localDate: string }
  | { status: "profile_not_configured"; projectId?: string }
  | { status: "already_completed"; runId: string; artifactKey: string }
  | {
      status: "blocked";
      runId: string;
      artifactKey: string | null;
      cause: BlockedCause;
    }
  | {
      status: "insufficient_source_health";
      runId: string;
      artifactKey: string | null;
      successfulSources: number;
      configuredSources: number;
    }
  | {
      status: "completed";
      runId: string;
      artifactKey: string | null;
      successfulSources: number;
      changedSources: number;
    }
  | {
      status: "failed";
      runId: string;
      artifactKey: string | null;
      errorMessage: string;
    };

export interface CollectSourceContext {
  seed: OfficialPageSeed;
  sourceId: string;
  policyState: string;
  previousState: OfficialPageState | null;
  nextSources: Record<string, OfficialPageStateEntry>;
  fetchFn: OfficialPageFetch;
  generatedAt: string;
}

// A terminal outcome fed to run finalization: which results were collected,
// whether to emit change observations, and whether to advance fingerprint state.
export interface RunOutcome {
  status: "completed" | "incomplete" | "blocked" | "failed";
  results: OfficialSourceResult[];
  successful: SuccessfulOfficialSourceResult[];
  errorMessage: string | null;
  cause?: BlockedCause;
  emitObservations: boolean;
  nextState: OfficialPageState | null;
}

export interface FetchableSource {
  seed: OfficialPageSeed;
  source: DemandPulseSource;
}
