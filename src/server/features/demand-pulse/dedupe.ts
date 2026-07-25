import type { DemandObservationCandidate } from "./types";

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

function tokens(value: string): Set<string> {
  return new Set(normalizeDemandText(value).split(" ").filter((token) => token.length > 1));
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

export function stableDemandFingerprint(value: string): string {
  const input = normalizeDemandText(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hoursBetween(left: string, right: string): number {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 3_600_000;
}

export interface DuplicateDecision {
  isDuplicate: boolean;
  isCrossPost: boolean;
  reason: string;
  titleSimilarity: number;
}

export function compareDemandObservations(
  left: DemandObservationCandidate,
  right: DemandObservationCandidate,
): DuplicateDecision {
  if (
    left.sourcePlatform === right.sourcePlatform &&
    left.externalId === right.externalId
  ) {
    return {
      isDuplicate: true,
      isCrossPost: false,
      reason: "same_source_external_id",
      titleSimilarity: 1,
    };
  }

  if (canonicalizeDemandUrl(left.canonicalUrl) === canonicalizeDemandUrl(right.canonicalUrl)) {
    return {
      isDuplicate: true,
      isCrossPost: left.sourcePlatform !== right.sourcePlatform,
      reason: "same_canonical_url",
      titleSimilarity: 1,
    };
  }

  const titleSimilarity = jaccardSimilarity(left.title, right.title);
  const nearInTime = hoursBetween(left.publishedAt, right.publishedAt) <= 72;
  const crossPostWindow = hoursBetween(left.publishedAt, right.publishedAt) <= 24 * 14;

  if (titleSimilarity >= 0.86 && nearInTime) {
    return {
      isDuplicate: true,
      isCrossPost: left.sourcePlatform !== right.sourcePlatform,
      reason: "near_identical_title_and_time",
      titleSimilarity,
    };
  }

  if (
    left.sourcePlatform !== right.sourcePlatform &&
    titleSimilarity >= 0.78 &&
    crossPostWindow
  ) {
    return {
      isDuplicate: false,
      isCrossPost: true,
      reason: "likely_cross_post",
      titleSimilarity,
    };
  }

  return {
    isDuplicate: false,
    isCrossPost: false,
    reason: "distinct",
    titleSimilarity,
  };
}
