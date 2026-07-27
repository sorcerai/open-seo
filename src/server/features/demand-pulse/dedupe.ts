import {
  DEMAND_PULSE_EVIDENCE_VERSION,
  type DemandObservationCandidate,
  type DuplicateRelationKind,
} from "./types";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export function normalizeDemandText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeDemandUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    // Snapshot the keys first — deleting during live iteration skips entries.
    const trackingKeys = [...url.searchParams.keys()].filter((key) =>
      TRACKING_PARAMS.has(key.toLowerCase()),
    );
    for (const key of trackingKeys) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const sorted = [...url.searchParams.entries()].toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    url.search = "";
    for (const [key, val] of sorted) url.searchParams.append(key, val);
    return url.toString();
  } catch {
    return value.trim();
  }
}

/** A valid, non-empty http(s) URL that canonicalizeDemandUrl can compare safely. */
function isValidDemandUrl(value: string): boolean {
  if (!value || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeDemandText(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Legacy 32-bit FNV-1a fingerprint. Retained for non-persisted, non-identity
 * uses only. Persisted observation/event/feed identifiers use {@link digestId}
 * (domain-separated, length-delimited SHA-256) instead, because a 32-bit digest
 * is not collision-resistant enough to key stored records.
 */
export function stableDemandFingerprint(value: string): string {
  const input = normalizeDemandText(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Worker-compatible SHA-256 (WebCrypto). 256-bit, collision-resistant. The
// canary's official-page monitor already uses this pattern; reusing it keeps a
// single hashing primitive across the feature.
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Length-delimited encoding of a canonical tuple. Each part is prefixed with its
 * length so `("a","bc")` and `("ab","c")` never collide, and no field is
 * text-normalized before hashing (the URL component is preserved verbatim). The
 * domain tag is mixed in as the first part so observation/event/feed ids cannot
 * collide across domains even for identical payloads.
 */
function lengthDelimited(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

export async function digestId(
  domain: string,
  parts: readonly string[],
): Promise<string> {
  return `${domain}_${await sha256Hex(lengthDelimited([domain, DEMAND_PULSE_EVIDENCE_VERSION, ...parts]))}`;
}

function hoursBetween(left: string | null, right: string | null): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 3_600_000;
}

export interface DuplicateDecision {
  isDuplicate: boolean;
  isCrossPost: boolean;
  reason: string;
  titleSimilarity: number;
  /**
   * Classified duplicate relation. null only when the two observations are
   * distinct. Confident cross-posts are classified as `syndicated` so copied
   * community evidence collapses into one independent event.
   */
  relation: DuplicateRelationKind | null;
}

export function compareDemandObservations(
  left: DemandObservationCandidate,
  right: DemandObservationCandidate,
): DuplicateDecision {
  const samePlatform = left.sourcePlatform === right.sourcePlatform;
  const sameConnection = left.sourceConnectionId === right.sourceConnectionId;

  // Scoped record identity (covers the URL-less first-party record-id path):
  // two records from the same connection with the same external id are the same
  // observation.
  if (sameConnection && left.externalId === right.externalId) {
    return {
      isDuplicate: true,
      isCrossPost: false,
      reason: "same_source_record_id",
      titleSimilarity: 1,
      relation: "exact",
    };
  }

  // Canonical URL equality only when BOTH sides carry a valid non-empty URL, so
  // URL-less observations can never collapse on an empty-string match.
  if (
    isValidDemandUrl(left.canonicalUrl) &&
    isValidDemandUrl(right.canonicalUrl) &&
    canonicalizeDemandUrl(left.canonicalUrl) ===
      canonicalizeDemandUrl(right.canonicalUrl)
  ) {
    return {
      isDuplicate: true,
      isCrossPost: !samePlatform,
      reason: "same_canonical_url",
      titleSimilarity: 1,
      relation: "canonical",
    };
  }

  const titleSimilarity = jaccardSimilarity(left.title, right.title);
  const nearInTime = hoursBetween(left.publishedAt, right.publishedAt) <= 72;
  const crossPostWindow =
    hoursBetween(left.publishedAt, right.publishedAt) <= 24 * 14;

  // Confident cross-posts: the same discussion republicated across platforms.
  // These are syndicated duplicates (one independent event), not independent
  // evidence, so copied community discussion cannot inflate corroboration.
  if (!samePlatform && titleSimilarity >= 0.78 && crossPostWindow) {
    return {
      isDuplicate: true,
      isCrossPost: true,
      reason: "syndicated_cross_post",
      titleSimilarity,
      relation: "syndicated",
    };
  }

  if (samePlatform && titleSimilarity >= 0.86 && nearInTime) {
    return {
      isDuplicate: true,
      isCrossPost: false,
      reason: "near_identical_title_and_time",
      titleSimilarity,
      relation: "exact",
    };
  }

  // Same-platform semantic near-duplicates: the same source repackaging the
  // same question with different wording.
  if (
    samePlatform &&
    titleSimilarity >= 0.7 &&
    titleSimilarity < 0.86 &&
    nearInTime
  ) {
    return {
      isDuplicate: true,
      isCrossPost: false,
      reason: "semantic_near_duplicate",
      titleSimilarity,
      relation: "semantic",
    };
  }

  return {
    isDuplicate: false,
    isCrossPost: false,
    reason: "distinct",
    titleSimilarity,
    relation: null,
  };
}

/**
 * Stable id for a single observation, derived from platform + source connection
 * + external id + canonical url via a domain-separated, length-delimited
 * SHA-256 digest. No text normalization is applied (the canonical url is hashed
 * verbatim), so the documented canonical-url component is part of the identity.
 */
export async function observationEvidenceId(
  observation: Pick<
    DemandObservationCandidate,
    "sourcePlatform" | "sourceConnectionId" | "externalId" | "canonicalUrl"
  >,
): Promise<string> {
  return digestId("obs", [
    observation.sourcePlatform,
    observation.sourceConnectionId,
    observation.externalId,
    observation.canonicalUrl,
  ]);
}

// Day bucket for event identity. Missing/invalid dates contribute "" so they
// never fabricate a time anchor (baseline/unknown dates create no freshness).
function parseObservationDay(value: string | null): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : "";
}

/**
 * Canonical content key for the event an observation belongs to: normalized
 * title + publication day. This is host/url-agnostic so exact, canonical, and
 * syndicated duplicates of the same discussion share one event key, and it is
 * stable regardless of which sources surface the event. The event id is this
 * key of the event's first-observed anchor (see groupEvidenceEvents), not the
 * minimum member hash, so discovering a later duplicate never rekeys the event.
 */
export async function canonicalEvidenceId(
  observation: Pick<DemandObservationCandidate, "title" | "publishedAt">,
): Promise<string> {
  return digestId("evt", [
    normalizeDemandText(observation.title),
    parseObservationDay(observation.publishedAt),
  ]);
}
