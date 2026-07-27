import {
  DEMAND_PULSE_EVIDENCE_VERSION,
  type DemandObservationCandidate,
  type DuplicateEdge,
  type EvidenceEvent,
  type FamilyEvidence,
} from "./types";
import {
  canonicalEvidenceId,
  compareDemandObservations,
  digestId,
  normalizeDemandText,
  observationEvidenceId,
} from "./dedupe";

// Day bucket for event identity. Missing/invalid dates contribute "" so they
// never fabricate a time anchor (baseline/unknown dates create no freshness).
function parseObservationDay(value: string | null): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : "";
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].toSorted((a, b) => a.localeCompare(b));
}

// Earliest observation date, preferring parsed timestamps and falling back to
// lexicographic order when no timestamp is parseable.
function minObservedDate(values: readonly (string | null)[]): string {
  const parsed = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp));
  if (parsed.length > 0) {
    return parsed.reduce((earliest, current) =>
      current.timestamp < earliest.timestamp ? current : earliest,
    ).value;
  }
  return (
    values.filter((value): value is string => Boolean(value)).toSorted()[0] ??
    ""
  );
}

// Latest observation date, mirroring minObservedDate.
function maxObservedDate(values: readonly (string | null)[]): string {
  const parsed = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp));
  if (parsed.length > 0) {
    return parsed.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest,
    ).value;
  }
  return (
    values
      .filter((value): value is string => Boolean(value))
      .toSorted()
      .at(-1) ?? ""
  );
}

function isBaselineObservation(
  observation: Pick<DemandObservationCandidate, "baselineFingerprint">,
): boolean {
  return observation.baselineFingerprint === true;
}

export interface EvidenceGrouping {
  events: readonly EvidenceEvent[];
  edges: readonly DuplicateEdge[];
}

interface IndexedObservation {
  observation: DemandObservationCandidate;
  obsId: string;
  eventKey: string;
  publishedTs: number;
}

/**
 * Group observations into independent evidence events deterministically.
 *
 * Two observations collapse into one event only when the duplicate classifier
 * returns an exact/canonical/syndicated/semantic relation (confident
 * cross-posts are syndicated). Distinct items stay separate so independent
 * corroboration is never inflated. Each event represents exactly one
 * independent corroboration while retaining its raw member count. The event id
 * is the canonical content key of the event's first-observed anchor member
 * (stable against later-duplicate discovery). Output order is deterministic.
 */
export async function groupEvidenceEvents(
  observations: readonly DemandObservationCandidate[],
): Promise<EvidenceGrouping> {
  if (observations.length === 0) return { events: [], edges: [] };

  const indexed: IndexedObservation[] = await Promise.all(
    observations.map(async (observation) => ({
      observation,
      obsId: await observationEvidenceId(observation),
      eventKey: await canonicalEvidenceId(observation),
      publishedTs: Date.parse(observation.publishedAt ?? ""),
    })),
  );
  // Deterministic input order: canonical event key, then observation id.
  const ordered = indexed.toSorted((a, b) =>
    a.eventKey === b.eventKey
      ? a.obsId.localeCompare(b.obsId)
      : a.eventKey.localeCompare(b.eventKey),
  );

  // Union-find over confident duplicate pairs.
  const parent = Array.from({ length: ordered.length }, (_, i) => i);
  const find = (x: number): number => {
    let current = x;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const seenEdges = new Set<string>();
  const edges: DuplicateEdge[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const decision = compareDemandObservations(
        ordered[i].observation,
        ordered[j].observation,
      );
      if (!decision.isDuplicate || !decision.relation) continue;
      union(i, j);
      const [leftId, rightId] = [ordered[i].obsId, ordered[j].obsId].toSorted(
        (a, b) => a.localeCompare(b),
      );
      const key = `${leftId}\u0000${rightId}\u0000${decision.relation}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        leftObservationId: leftId,
        rightObservationId: rightId,
        relation: decision.relation,
        similarity: Math.round(decision.titleSimilarity * 1e4) / 1e4,
        reason: decision.reason,
      });
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < ordered.length; i += 1) {
    const root = find(i);
    const bucket = components.get(root) ?? [];
    bucket.push(i);
    components.set(root, bucket);
  }

  const events: EvidenceEvent[] = await Promise.all(
    [...components.values()].map(async (members) => {
      const rows = members.map((index) => ordered[index]);
      const memberIds = rows
        .map((row) => row.obsId)
        .toSorted((a, b) => a.localeCompare(b));
      // Anchor by collection time: a later-collected backfill with an older
      // publication date cannot re-key an event that was already observed.
      const anchor = rows.toSorted((a, b) => {
        const ta = Date.parse(a.observation.collectedAt);
        const tb = Date.parse(b.observation.collectedAt);
        const safeA = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
        const safeB = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
        if (safeA !== safeB) return safeA - safeB;
        return a.obsId.localeCompare(b.obsId);
      })[0];
      const sourceClasses = uniqueSorted(
        rows.map((row) => row.observation.sourceClass),
      );
      const sourceConnectionIds = uniqueSorted(
        rows.map((row) => row.observation.sourceConnectionId),
      );
      const geographies = uniqueSorted(
        rows
          .map((row) => row.observation.geography)
          .filter((value): value is string => Boolean(value && value.trim())),
      );
      const dates = rows.map((row) => row.observation.publishedAt);
      return {
        eventId: await digestId("evt", [
          normalizeDemandText(anchor.observation.title),
          parseObservationDay(anchor.observation.publishedAt),
          anchor.obsId,
        ]),
        canonicalObservationId: anchor.obsId,
        memberObservationIds: memberIds,
        sourceClasses,
        sourceConnectionIds,
        geographies,
        firstObservedAt: minObservedDate(dates),
        lastObservedAt: maxObservedDate(dates),
        rawObservationCount: rows.length,
        baselineOnly: rows.every((row) =>
          isBaselineObservation(row.observation),
        ),
        independentCount: 1 as const,
      };
    }),
  );

  const sortedEvents = events.toSorted((a, b) =>
    a.eventId.localeCompare(b.eventId),
  );
  const sortedEdges = edges.toSorted((a, b) =>
    a.leftObservationId === b.leftObservationId
      ? a.rightObservationId.localeCompare(b.rightObservationId)
      : a.leftObservationId.localeCompare(b.leftObservationId),
  );

  return { events: sortedEvents, edges: sortedEdges };
}

/**
 * Resolve all evidence for one prompt family from its raw observations.
 * independentEventCount is the corroboration count scoring must use;
 * rawObservationCount is preserved separately for audit and retention.
 */
export async function buildFamilyEvidence(
  familyId: string,
  observations: readonly DemandObservationCandidate[],
): Promise<FamilyEvidence> {
  const { events, edges } = await groupEvidenceEvents(observations);
  const sourceClasses = uniqueSorted(
    events.flatMap((event) => event.sourceClasses),
  );
  const rawObservationCount = events.reduce(
    (sum, event) => sum + event.rawObservationCount,
    0,
  );
  const boundaryDates = events
    .flatMap((event) => [event.firstObservedAt, event.lastObservedAt])
    .filter(Boolean);

  return {
    evidenceVersion: DEMAND_PULSE_EVIDENCE_VERSION,
    familyId,
    events,
    independentEventCount: events.length,
    rawObservationCount,
    sourceClasses,
    duplicateEdges: edges,
    firstObservedAt: boundaryDates.length ? minObservedDate(boundaryDates) : "",
    lastObservedAt: boundaryDates.length ? maxObservedDate(boundaryDates) : "",
    hasFirstPartyEvidence: sourceClasses.includes("first_party_observed"),
    hasPrimaryAuthoritativeEvidence: sourceClasses.includes(
      "primary_authoritative",
    ),
    hasSearchEvidence: sourceClasses.includes("search_observed"),
    hasCommunityEvidence: sourceClasses.includes("community_observed"),
    hasAiSurfaceEvidence: sourceClasses.includes("ai_surface_observed"),
    hasGeneratedOnlyEvidence:
      sourceClasses.length > 0 &&
      sourceClasses.every((value) => value === "generated_candidate"),
    baselineOnly:
      events.length > 0 && events.every((event) => event.baselineOnly),
    hasPromotableObservedEvidence: observations.some(
      (observation) =>
        observation.sourceClass !== "generated_candidate" &&
        !isBaselineObservation(observation),
    ),
  };
}
