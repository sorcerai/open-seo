import type {
  DemandPulseCanaryEnv,
  DemandPulseCanaryRepository,
  DemandPulseCanarySourceConfig,
  DemandPulseFamilyDefinition,
} from "../services/dailyCanaryOrchestrator";
import type {
  CompleteRunInput,
  DailyRunInput,
  DemandPulseProfile,
  DemandPulseRun,
  DemandPulseSource,
  RecordSourceRunInput,
} from "../repositories/DemandPulseRepository";
import type {
  DemandPulseCoverageCheckInput,
  DemandPulseEvidenceEventInput,
  DemandPulseFamilyEvidenceInput,
  DemandPulseFamilyInput,
  DemandPulseObservationEventInput,
  DemandPulseObservationInput,
  DemandPulseScoreInput,
  DuplicateEdgeInput,
  EvidenceGraphInput,
  FamilyResultsInput,
} from "../repositories/DemandPulseEvidenceRepository";
import type {
  DemandPulseFeedItem,
  DemandPulseFeedItemInput,
  DemandPulseFeedScope,
} from "../repositories/DemandPulseFeedRepository";
import type { DemandSourceAdapter } from "../sources/adapter";
import type { DemandObservationCandidate } from "../types";

export const PROJECT_ID = "project-onfarmcompost";
const PROFILE_ID = "profile-onfarmcompost";
export const RUN_AT = new Date("2026-07-27T12:00:00.000Z");

export class MemoryBucket {
  readonly objects = new Map<string, string>();

  async head(key: string): Promise<unknown> {
    return this.objects.has(key) ? { key } : null;
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: string): Promise<unknown> {
    this.objects.set(key, value);
    return { key };
  }
}

function profile(): DemandPulseProfile {
  return {
    id: PROFILE_ID,
    projectId: PROJECT_ID,
    policyRepository: "sorcerai/onfarmcompost",
    policyCommit: "4d436f12ab2853410e1f4930f4cb0ee3b82cad93",
    policyPath: "docs/CONTENT_INTELLIGENCE_OS.md",
    enabled: true,
    dryRun: true,
    publicationDisabled: true,
    timezone: "America/Chicago",
    dailyBudgetMicros: 1_000_000,
    scoringVersion: "onfarm-demand-pulse-v1.0.0",
    createdAt: RUN_AT.toISOString(),
    updatedAt: RUN_AT.toISOString(),
  };
}

export function source(
  id: string,
  adapter: DemandPulseSource["adapter"],
  sourceClass: DemandPulseSource["sourceClass"],
  recordKey = `${adapter}:${id}`,
): DemandPulseSource {
  return {
    id,
    profileId: PROFILE_ID,
    adapter,
    identityKey: id,
    sourceClass,
    canonicalUrl: null,
    recordKey,
    approvalState: "approved",
    policyState: "allowed",
    enabled: true,
    discoveryProvenance: `test:${adapter}`,
    version: 1,
    reviewedBy: "test",
    reviewedAt: RUN_AT.toISOString(),
    createdAt: RUN_AT.toISOString(),
    updatedAt: RUN_AT.toISOString(),
  };
}

export function observation(
  sourceConnectionId: string,
  sourceClass: DemandObservationCandidate["sourceClass"],
  externalId: string,
): DemandObservationCandidate {
  return {
    projectId: PROJECT_ID,
    sourceConnectionId,
    sourceClass,
    sourcePlatform: sourceConnectionId,
    externalId,
    canonicalUrl: `https://signals.example.test/${externalId}`,
    title: "How do I compost food scraps in Houston?",
    excerpt: "How do I compost food scraps in Houston?",
    publishedAt: RUN_AT.toISOString(),
    collectedAt: RUN_AT.toISOString(),
    locale: "en-US",
    geography: "houston-tx",
    retentionProfile: "test-v1",
  };
}

export function adapterResult(
  observationRow: DemandObservationCandidate,
): DemandSourceAdapter {
  return {
    capabilities: {
      sourcePlatform: observationRow.sourcePlatform,
      supportsBackfill: false,
      supportsIncrementalCursor: false,
      supportsDeletionSync: false,
      supportsEngagementSnapshots: false,
      supportsFullText: true,
      requiresAuthentication: false,
      requiresCommercialApproval: false,
      defaultRawRetentionDays: 30,
    },
    validateConfig: (value) => value,
    discover: async () => ({
      observations: [observationRow],
      sourceRequestCount: 1,
      warnings: [],
      health: {
        status: "healthy",
        policyState: "allowed",
        requestCount: 1,
        costMicros: 0,
        cursor: RUN_AT.toISOString(),
        error: null,
      },
    }),
  };
}

export function failingAdapter(
  observationRow: DemandObservationCandidate,
  message: string,
): DemandSourceAdapter {
  return {
    ...adapterResult(observationRow),
    discover: async () => {
      throw new Error(message);
    },
  };
}

export class MemoryRepository implements DemandPulseCanaryRepository {
  readonly profileRow = profile();
  readonly sources = [
    source("gsc", "gsc-site", "search_observed"),
    source("dataforseo", "dataforseo-discussions", "search_observed"),
    source("manual", "manual-first-party", "first_party_observed"),
    source("local-news", "local-news", "community_observed"),
  ];
  readonly sourceRuns: RecordSourceRunInput[] = [];
  readonly observations: DemandPulseObservationInput[] = [];
  readonly evidenceEvents: DemandPulseEvidenceEventInput[] = [];
  readonly observationEvents: DemandPulseObservationEventInput[] = [];
  readonly duplicateEdges: DuplicateEdgeInput[] = [];
  readonly families: DemandPulseFamilyInput[] = [];
  readonly familyEvidence: DemandPulseFamilyEvidenceInput[] = [];
  readonly coverageChecks: DemandPulseCoverageCheckInput[] = [];
  readonly scores: DemandPulseScoreInput[] = [];
  readonly feedItems: DemandPulseFeedItemInput[] = [];
  readonly runs: DemandPulseRun[] = [];

  async getProfileByProjectId(projectId: string) {
    return projectId === PROJECT_ID ? this.profileRow : null;
  }

  async listSourcesByProject(projectId: string) {
    return projectId === PROJECT_ID ? this.sources : [];
  }

  async claimDailyRun(input: DailyRunInput) {
    const existing = this.runs.find(
      (run) =>
        run.profileId === input.profileId && run.localDate === input.localDate,
    );
    if (existing) return { run: existing, claimed: false };
    const run: DemandPulseRun = {
      id: "run-1",
      profileId: input.profileId,
      localDate: input.localDate,
      status: input.status ?? "pending",
      costMicros: 0,
      sourceCount: 0,
      healthySourceCount: 0,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      unknownSourceCount: 0,
      skippedSourceCount: 0,
      artifactKey: null,
      scoringVersion: input.scoringVersion,
      startedAt: RUN_AT.toISOString(),
      completedAt: null,
      errorMessage: null,
    };
    this.runs.push(run);
    return { run, claimed: true };
  }

  async recordSourceRun(input: RecordSourceRunInput) {
    this.sourceRuns.push(input);
    return input;
  }

  async completeRun(input: CompleteRunInput) {
    const run = this.runs.find((candidate) => candidate.id === input.runId);
    if (!run) return null;
    Object.assign(run, input);
    return run;
  }

  async persistObservations(input: {
    scope: {
      profileId: string;
      projectId: string;
      runId: string;
      evidenceVersion: string;
    };
    rows: readonly DemandPulseObservationInput[];
  }) {
    this.observations.push(...input.rows);
  }

  async persistEvidenceGraph(input: EvidenceGraphInput) {
    this.evidenceEvents.push(...input.evidenceEvents);
    this.observationEvents.push(...input.observationEvents);
    this.duplicateEdges.push(...input.duplicateEdges);
  }

  async persistFamilyResults(input: FamilyResultsInput) {
    this.families.push(...input.families);
    this.familyEvidence.push(...input.familyEvidence);
    this.coverageChecks.push(...input.coverageChecks);
    this.scores.push(...input.scores);
  }

  async persistFeedItems(input: {
    scope: DemandPulseFeedScope;
    rows: readonly DemandPulseFeedItemInput[];
  }): Promise<DemandPulseFeedItem[]> {
    this.feedItems.push(...input.rows);
    return [];
  }
}

export class FailingEvidenceRepository extends MemoryRepository {
  override readonly sources = [source("gsc", "gsc-site", "search_observed")];

  override async persistEvidenceGraph() {
    throw new Error("evidence persistence unavailable");
  }
}

export const env: DemandPulseCanaryEnv = {
  R2: new MemoryBucket(),
  DEMAND_PULSE_ENABLED: "true",
  DEMAND_PULSE_WRITE_ENABLED: "false",
  DEMAND_PULSE_DRY_RUN: "true",
  DEMAND_PULSE_CANARY_ONFARMCOMPOST: "true",
  DEMAND_PULSE_SOURCE_GSC: "true",
  DEMAND_PULSE_SOURCE_DATAFORSEO_DISCUSSIONS: "true",
  DEMAND_PULSE_SOURCE_FIRST_PARTY_IMPORT: "true",
  DEMAND_PULSE_SOURCE_LOCAL_NEWS: "true",
  DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID: PROJECT_ID,
};

export const family: DemandPulseFamilyDefinition = {
  familyKey: "composting-houston",
  title: "How do I compost food scraps in Houston?",
  keywords: ["compost", "houston"],
  inventory: [],
  vector: { geography: 1, commercial: 0.5 },
};

export const configs: Record<string, DemandPulseCanarySourceConfig> = {
  gsc: {},
  dataforseo: {},
  manual: {},
  "local-news": {},
};
