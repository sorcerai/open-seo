import type { DemandObservationCandidate } from "../types";
import type { OfficialPageSeed } from "./onfarmcompost-official-sources";
import { UNREGISTERED_SOURCE_REASON } from "./onfarmcompost-official-artifact-gate";
import type {
  OfficialSourceResult,
  OnFarmCompostOfficialMonitorArtifact,
  SourceHealthEntry,
  SuccessfulOfficialSourceResult,
} from "./onfarmcompost-official-artifact-types";

const TIME_ZONE = "America/Chicago";

function createObservation(
  result: SuccessfulOfficialSourceResult,
  projectId: string,
  runId: string,
): DemandObservationCandidate {
  const { seed, snapshot, sourceId, previousFingerprint } = result;
  return {
    projectId,
    sourceConnectionId: sourceId,
    // Official pages are authoritative primary sources. The locked source-class
    // set includes primary_authoritative; classify observations accordingly.
    sourceClass: "primary_authoritative",
    sourcePlatform: "official_page_monitor",
    sourceDomain: new URL(snapshot.finalUrl).hostname,
    externalId: `${seed.id}:${snapshot.fingerprint.slice(0, 20)}`,
    canonicalUrl: snapshot.finalUrl,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    // Authoritative publication time only when Last-Modified is known. When it
    // is absent, publishedAt is null — fetch/observation time never stands in
    // for a publication date (it lives only in collectedAt).
    publishedAt: snapshot.lastModified ?? null,
    collectedAt: snapshot.fetchedAt,
    locale: "en-US",
    geography: seed.geography,
    metadata: {
      authorityClass: "primary_authoritative",
      sourceId: seed.id,
      // The actual DB source row credited for this evidence, not the seed slug.
      dbSourceId: sourceId,
      runId,
      topics: [...seed.topics],
      fingerprint: snapshot.fingerprint,
      previousFingerprint,
      lastModified: snapshot.lastModified,
      etag: snapshot.etag,
      httpStatus: snapshot.httpStatus,
      contentBytes: snapshot.contentBytes,
      publicationDateBasis: snapshot.lastModified
        ? "last-modified-header"
        : "unknown",
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
    dbSourceId: result.sourceId,
    requestedUrl: result.seed.url,
    health: result.health,
    policyState: result.policyState,
    ok: result.snapshot !== null,
    changed: result.changed,
    baseline: result.baseline,
    httpStatus: result.snapshot?.httpStatus ?? null,
    finalUrl: result.snapshot?.finalUrl ?? null,
    fingerprint: result.snapshot?.fingerprint ?? null,
    previousFingerprint: result.previousFingerprint,
    fetchedAt: generatedAt,
    contentBytes: result.snapshot?.contentBytes ?? null,
    error: result.error,
  }));
}

// One builder serves every terminal outcome (completed, incomplete, blocked,
// failed). Observations are emitted only on a clean completed run; every
// controlled-failure artifact still records source health, the error, and zero
// candidate cards so the failure is visible in R2 and downstream UI/MCP.
export function buildRunArtifact(args: {
  runId: string;
  projectId: string;
  localDate: string;
  generatedAt: string;
  results: OfficialSourceResult[];
  successful: SuccessfulOfficialSourceResult[];
  // All configured seeds, so unregistered sources are synthesized into an
  // explicit health entry rather than disappearing from the artifact.
  configuredSeeds: readonly OfficialPageSeed[];
  emitObservations: boolean;
  errorMessage: string | null;
  unresolvedSource?: {
    health: "blocked" | "unknown" | "skipped";
    policyState: string;
    error: string;
  };
}): OnFarmCompostOfficialMonitorArtifact {
  const {
    runId,
    projectId,
    localDate,
    generatedAt,
    results,
    successful,
    configuredSeeds,
    emitObservations,
    errorMessage,
    unresolvedSource = {
      health: "skipped",
      policyState: "unregistered",
      error: UNREGISTERED_SOURCE_REASON,
    },
  } = args;
  const changedResults = successful.filter((result) => result.changed);
  const observations = emitObservations
    ? changedResults.map((result) =>
        createObservation(result, projectId, runId),
      )
    : [];
  const baselineSources = successful.filter((result) => result.baseline).length;
  const resolvedIds = new Set(results.map((result) => result.seed.id));
  const unresolvedHealth: SourceHealthEntry[] = configuredSeeds
    .filter((seed) => !resolvedIds.has(seed.id))
    .map((seed) => ({
      sourceId: seed.id,
      dbSourceId: null,
      requestedUrl: seed.url,
      health: unresolvedSource.health,
      policyState: unresolvedSource.policyState,
      ok: false,
      changed: false,
      baseline: false,
      httpStatus: null,
      finalUrl: null,
      fingerprint: null,
      previousFingerprint: null,
      fetchedAt: generatedAt,
      contentBytes: null,
      error: unresolvedSource.error,
    }));
  const skippedSources =
    results.filter(
      (result) => result.health !== "healthy" && result.health !== "failed",
    ).length + unresolvedHealth.length;

  return {
    schemaVersion: "1",
    artifactType: "demand_pulse_official_page_dry_run",
    runId,
    projectId,
    mode: "dry_run",
    publicationAllowed: false,
    generatedAt,
    localDate,
    timezone: TIME_ZONE,
    sourceHealth: [
      ...buildSourceHealth(results, generatedAt),
      ...unresolvedHealth,
    ],
    observations,
    candidateCards: [],
    summary: {
      configuredSources: configuredSeeds.length,
      successfulSources: successful.length,
      failedSources: results.filter((result) => result.health === "failed")
        .length,
      changedSources: emitObservations ? changedResults.length : 0,
      baselineSources,
      unchangedSources:
        successful.length - changedResults.length - baselineSources,
      skippedSources,
    },
    errorMessage,
    nextStage: "coverage_clustering_scoring_and_review_not_wired",
  };
}
