import {
  getDemandPulseFeatureFlags,
  type DemandPulseFeatureFlagEnv,
} from "../feature-flags";
import { mapWithConcurrency } from "../sources/adapter";
import type { DemandObservationCandidate } from "../types";
import {
  fetchOfficialPageSnapshot,
  ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
  type OfficialPageFetch,
  type OfficialPageSeed,
  type OfficialPageSnapshot,
} from "./onfarmcompost-official-sources";
import {
  ONFARMCOMPOST_ARTIFACT_PREFIX,
  ONFARMCOMPOST_OFFICIAL_STATE_KEY,
  ONFARMCOMPOST_PROJECT_ID,
  readOfficialPageState,
  writeJsonArtifact,
  type DemandPulseJsonBucket,
  type OfficialPageState,
  type OfficialPageStateEntry,
} from "./onfarmcompost-official-store";

const TIME_ZONE = "America/Chicago";
const DAILY_RUN_HOUR = 5;
const MINIMUM_SUCCESSFUL_SOURCES = 3;

export interface OnFarmCompostOfficialMonitorEnv extends DemandPulseFeatureFlagEnv {
  R2: DemandPulseJsonBucket;
}

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

interface SuccessfulSourceResult {
  seed: OfficialPageSeed;
  snapshot: OfficialPageSnapshot;
  changed: boolean;
  previousFingerprint: string | null;
  error: null;
}

interface FailedSourceResult {
  seed: OfficialPageSeed;
  snapshot: null;
  changed: false;
  previousFingerprint: string | null;
  error: string;
}

type SourceResult = SuccessfulSourceResult | FailedSourceResult;

interface SourceHealthEntry {
  sourceId: string;
  requestedUrl: string;
  ok: boolean;
  changed: boolean;
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
  projectId: typeof ONFARMCOMPOST_PROJECT_ID;
  mode: "dry_run";
  publicationAllowed: false;
  generatedAt: string;
  localDate: string;
  timezone: typeof TIME_ZONE;
  sourceHealth: SourceHealthEntry[];
  observations: DemandObservationCandidate[];
  candidateCards: [];
  summary: {
    configuredSources: number;
    successfulSources: number;
    failedSources: number;
    changedSources: number;
    unchangedSources: number;
  };
  nextStage: "coverage_clustering_scoring_and_review_not_wired";
}

export type OnFarmCompostOfficialMonitorResult =
  | { status: "disabled" }
  | { status: "unsafe_configuration" }
  | { status: "before_daily_window"; localDate: string }
  | { status: "already_completed"; artifactKey: string }
  | {
      status: "insufficient_source_health";
      successfulSources: number;
      configuredSources: number;
    }
  | {
      status: "completed";
      artifactKey: string;
      successfulSources: number;
      changedSources: number;
    };

const defaultOfficialPageFetch: OfficialPageFetch = (input, init) =>
  fetch(input, init);

export function getChicagoDateTime(now: Date): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("Unable to resolve America/Chicago date parts");
  }

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

export function isPastDailyRunTime(local: LocalDateTime): boolean {
  return local.hour >= DAILY_RUN_HOUR;
}

function createObservation(
  seed: OfficialPageSeed,
  snapshot: OfficialPageSnapshot,
  previousFingerprint: string | null,
): DemandObservationCandidate {
  return {
    projectId: ONFARMCOMPOST_PROJECT_ID,
    sourceConnectionId: `official-page:${seed.id}`,
    sourceClass: "market_event_observed",
    sourcePlatform: "official_page_monitor",
    sourceDomain: new URL(snapshot.finalUrl).hostname,
    externalId: `${seed.id}:${snapshot.fingerprint.slice(0, 20)}`,
    canonicalUrl: snapshot.finalUrl,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    publishedAt: snapshot.lastModified ?? snapshot.fetchedAt,
    collectedAt: snapshot.fetchedAt,
    locale: "en-US",
    geography: seed.geography,
    metadata: {
      authorityClass: "primary_authoritative",
      sourceId: seed.id,
      topics: [...seed.topics],
      fingerprint: snapshot.fingerprint,
      previousFingerprint,
      lastModified: snapshot.lastModified,
      etag: snapshot.etag,
      httpStatus: snapshot.httpStatus,
      contentBytes: snapshot.contentBytes,
      publicationDateBasis: snapshot.lastModified
        ? "last-modified-header"
        : "collection-time-fallback",
      fullTextRetained: false,
    },
    retentionProfile: "official-public-metadata-v1",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

async function collectSource(
  seed: OfficialPageSeed,
  previousState: OfficialPageState | null,
  nextSources: Record<string, OfficialPageStateEntry>,
  fetchFn: OfficialPageFetch,
  generatedAt: string,
): Promise<SourceResult> {
  const previous = previousState?.sources[seed.id] ?? null;

  try {
    const snapshot = await fetchOfficialPageSnapshot(
      seed,
      fetchFn,
      generatedAt,
    );
    const changed = previous?.fingerprint !== snapshot.fingerprint;

    nextSources[seed.id] = {
      fingerprint: snapshot.fingerprint,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      lastFetchedAt: generatedAt,
      lastChangedAt: changed
        ? generatedAt
        : (previous?.lastChangedAt ?? generatedAt),
      lastModified: snapshot.lastModified,
      etag: snapshot.etag,
    };

    return {
      seed,
      snapshot,
      changed,
      previousFingerprint: previous?.fingerprint ?? null,
      error: null,
    };
  } catch (error) {
    return {
      seed,
      snapshot: null,
      changed: false,
      previousFingerprint: previous?.fingerprint ?? null,
      error: errorMessage(error),
    };
  }
}

function isSuccessfulSource(
  result: SourceResult,
): result is SuccessfulSourceResult {
  return result.snapshot !== null;
}

function buildSourceHealth(
  results: SourceResult[],
  generatedAt: string,
): SourceHealthEntry[] {
  return results.map((result) => ({
    sourceId: result.seed.id,
    requestedUrl: result.seed.url,
    ok: result.snapshot !== null,
    changed: result.changed,
    httpStatus: result.snapshot?.httpStatus ?? null,
    finalUrl: result.snapshot?.finalUrl ?? null,
    fingerprint: result.snapshot?.fingerprint ?? null,
    previousFingerprint: result.previousFingerprint,
    fetchedAt: generatedAt,
    contentBytes: result.snapshot?.contentBytes ?? null,
    error: result.error,
  }));
}

function buildArtifact(
  results: SourceResult[],
  successful: SuccessfulSourceResult[],
  localDate: string,
  generatedAt: string,
): OnFarmCompostOfficialMonitorArtifact {
  const observations = successful
    .filter((result) => result.changed)
    .map((result) =>
      createObservation(
        result.seed,
        result.snapshot,
        result.previousFingerprint,
      ),
    );

  return {
    schemaVersion: "1",
    artifactType: "demand_pulse_official_page_dry_run",
    projectId: ONFARMCOMPOST_PROJECT_ID,
    mode: "dry_run",
    publicationAllowed: false,
    generatedAt,
    localDate,
    timezone: TIME_ZONE,
    sourceHealth: buildSourceHealth(results, generatedAt),
    observations,
    candidateCards: [],
    summary: {
      configuredSources: results.length,
      successfulSources: successful.length,
      failedSources: results.length - successful.length,
      changedSources: observations.length,
      unchangedSources: successful.length - observations.length,
    },
    nextStage: "coverage_clustering_scoring_and_review_not_wired",
  };
}

export async function runScheduledOnFarmCompostOfficialMonitor(
  env: OnFarmCompostOfficialMonitorEnv,
  now = new Date(),
  fetchFn: OfficialPageFetch = defaultOfficialPageFetch,
): Promise<OnFarmCompostOfficialMonitorResult> {
  const flags = getDemandPulseFeatureFlags(env);
  if (
    !flags.enabled ||
    !flags.canaryOnFarmCompost ||
    !flags.sourceOfficialPages
  ) {
    return { status: "disabled" };
  }

  if (!flags.dryRun || flags.writeEnabled) {
    console.error(
      "[demand-pulse] OnFarmCompost canary refused unsafe feature flags",
    );
    return { status: "unsafe_configuration" };
  }

  const local = getChicagoDateTime(now);
  if (!isPastDailyRunTime(local)) {
    return { status: "before_daily_window", localDate: local.date };
  }

  const artifactKey = `${ONFARMCOMPOST_ARTIFACT_PREFIX}/runs/${local.date}.json`;
  if (await env.R2.head(artifactKey)) {
    return { status: "already_completed", artifactKey };
  }

  const generatedAt = now.toISOString();
  const previousState = await readOfficialPageState(env.R2);
  const nextSources: Record<string, OfficialPageStateEntry> = previousState
    ? { ...previousState.sources }
    : {};

  const results = await mapWithConcurrency(
    ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
    3,
    (seed) =>
      collectSource(seed, previousState, nextSources, fetchFn, generatedAt),
  );
  const successful = results.filter(isSuccessfulSource);

  if (successful.length < MINIMUM_SUCCESSFUL_SOURCES) {
    console.error(
      `[demand-pulse] OnFarmCompost official monitor source health ${successful.length}/${ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length}; retrying on the next cron`,
    );
    return {
      status: "insufficient_source_health",
      successfulSources: successful.length,
      configuredSources: ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length,
    };
  }

  const artifact = buildArtifact(results, successful, local.date, generatedAt);
  const nextState: OfficialPageState = {
    schemaVersion: "1",
    projectId: ONFARMCOMPOST_PROJECT_ID,
    updatedAt: generatedAt,
    sources: nextSources,
  };

  // Preserve the evidence artifact before advancing fingerprints. If the state
  // write fails, a later day may emit a duplicate change, but no change is lost.
  await writeJsonArtifact(env.R2, artifactKey, artifact, {
    projectId: ONFARMCOMPOST_PROJECT_ID,
    artifactType: artifact.artifactType,
    localDate: local.date,
  });
  await writeJsonArtifact(env.R2, ONFARMCOMPOST_OFFICIAL_STATE_KEY, nextState, {
    projectId: ONFARMCOMPOST_PROJECT_ID,
    artifactType: "official-page-state",
  });

  console.log(
    `[demand-pulse] OnFarmCompost dry run wrote ${artifactKey}: ${artifact.summary.changedSources} changed, ${successful.length}/${results.length} healthy`,
  );

  return {
    status: "completed",
    artifactKey,
    successfulSources: successful.length,
    changedSources: artifact.summary.changedSources,
  };
}
