import type { OfficialPageSeed } from "./onfarmcompost-official-sources";
import { fetchOfficialPageSnapshot } from "./onfarmcompost-official-sources";
import type { OfficialPageState } from "./onfarmcompost-official-store";
import type { DemandPulseSource } from "../repositories/DemandPulseRepository";
import { describeError } from "./onfarmcompost-official-artifact-helpers";
import { evaluateOfficialSourceGate } from "./onfarmcompost-official-artifact-gate";
import type {
  BlockedOfficialSourceResult,
  CollectSourceContext,
  OfficialSourceResult,
  SuccessfulOfficialSourceResult,
  FetchableSource,
} from "./onfarmcompost-official-artifact-types";

// Fetch one official source and produce its collection result, advancing the
// caller's next-state map. The first fingerprint is baseline metadata, never a
// velocity event; lastChangedAt stays null until a genuine change.
export async function collectSource(
  ctx: CollectSourceContext,
): Promise<OfficialSourceResult> {
  const {
    seed,
    sourceId,
    policyState,
    previousState,
    nextSources,
    fetchFn,
    generatedAt,
  } = ctx;
  const previous = previousState?.sources[seed.id] ?? null;
  const baseline = previous?.fingerprint == null;
  try {
    const snapshot = await fetchOfficialPageSnapshot(
      seed,
      fetchFn,
      generatedAt,
    );
    const changed = !baseline && previous?.fingerprint !== snapshot.fingerprint;
    nextSources[seed.id] = {
      fingerprint: snapshot.fingerprint,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      lastFetchedAt: generatedAt,
      lastChangedAt: changed ? generatedAt : (previous?.lastChangedAt ?? null),
      lastModified: snapshot.lastModified,
      etag: snapshot.etag,
    };
    return {
      seed,
      sourceId,
      snapshot,
      changed,
      baseline,
      previousFingerprint: previous?.fingerprint ?? null,
      health: "healthy",
      policyState,
      error: null,
    };
  } catch (error) {
    return {
      seed,
      sourceId,
      snapshot: null,
      changed: false,
      baseline: false,
      previousFingerprint: previous?.fingerprint ?? null,
      health: "failed",
      policyState,
      error: describeError(error),
    };
  }
}

export function blockedSourceResult(args: {
  seed: OfficialPageSeed;
  sourceId: string;
  policyState: string;
  health: "blocked" | "unknown" | "skipped";
  error: string;
  previousState: OfficialPageState | null;
}): BlockedOfficialSourceResult {
  return {
    seed: args.seed,
    sourceId: args.sourceId,
    snapshot: null,
    changed: false,
    baseline: false,
    previousFingerprint:
      args.previousState?.sources[args.seed.id]?.fingerprint ?? null,
    health: args.health,
    policyState: args.policyState,
    error: args.error,
  };
}

function matchesSeed(
  seed: OfficialPageSeed,
  source: DemandPulseSource,
): boolean {
  if (source.canonicalUrl != null) return source.canonicalUrl === seed.url;
  return source.recordKey === seed.id || source.identityKey === seed.id;
}

// Resolve a configured seed against a source row without treating an
// incompatible adapter as if the seed were unregistered. An official adapter
// row wins when duplicate source rows share the same canonical identity.
export function findConfiguredSource(
  seed: OfficialPageSeed,
  sources: readonly DemandPulseSource[],
): DemandPulseSource | undefined {
  const matches = sources.filter((source) => matchesSeed(seed, source));
  return (
    matches.find((source) => source.adapter === "official_page_monitor") ??
    matches[0]
  );
}

// Select the fetchable (seed, source) pairs for a configured seed set. Only
// approved, enabled, policy-allowed official-page rows may reach the network.
export function selectFetchableSources(
  seeds: readonly OfficialPageSeed[],
  sources: readonly DemandPulseSource[],
): FetchableSource[] {
  const fetchable: FetchableSource[] = [];
  for (const seed of seeds) {
    const source = findConfiguredSource(seed, sources);
    if (
      source &&
      source.adapter === "official_page_monitor" &&
      evaluateOfficialSourceGate(source).allowed
    ) {
      fetchable.push({ seed, source });
    }
  }
  return fetchable;
}

export function isSuccessfulOfficialSource(
  result: OfficialSourceResult,
): result is SuccessfulOfficialSourceResult {
  return result.snapshot !== null;
}
