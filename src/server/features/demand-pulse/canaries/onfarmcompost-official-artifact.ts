import type { DemandObservationCandidate } from "../types";
import type {
  OfficialPageSeed,
  OfficialPageSnapshot,
} from "./onfarmcompost-official-sources";
import { ONFARMCOMPOST_PROJECT_ID } from "./onfarmcompost-official-store";

const TIME_ZONE = "America/Chicago";

export interface SuccessfulOfficialSourceResult {
  seed: OfficialPageSeed;
  snapshot: OfficialPageSnapshot;
  changed: boolean;
  previousFingerprint: string | null;
  error: null;
}

export interface FailedOfficialSourceResult {
  seed: OfficialPageSeed;
  snapshot: null;
  changed: false;
  previousFingerprint: string | null;
  error: string;
}

export type OfficialSourceResult =
  | SuccessfulOfficialSourceResult
  | FailedOfficialSourceResult;

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

export function isSuccessfulOfficialSource(
  result: OfficialSourceResult,
): result is SuccessfulOfficialSourceResult {
  return result.snapshot !== null;
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

function buildSourceHealth(
  results: OfficialSourceResult[],
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

export function buildOnFarmCompostOfficialMonitorArtifact(
  results: OfficialSourceResult[],
  successful: SuccessfulOfficialSourceResult[],
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
