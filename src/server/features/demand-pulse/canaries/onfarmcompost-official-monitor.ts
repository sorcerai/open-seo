import { load } from "cheerio";
import { getDemandPulseFeatureFlags } from "../feature-flags";
import { mapWithConcurrency } from "../sources/adapter";
import type { DemandObservationCandidate } from "../types";

const PROJECT_ID = "onfarmcompost";
const TIME_ZONE = "America/Chicago";
const DAILY_RUN_HOUR = 5;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const EXCERPT_LENGTH = 1_000;
const ARTIFACT_PREFIX = "demand-pulse/onfarmcompost";
const STATE_KEY = `${ARTIFACT_PREFIX}/state/official-pages.json`;
const MINIMUM_SUCCESSFUL_SOURCES = 3;

export interface OfficialPageSeed {
  id: string;
  name: string;
  url: string;
  geography: string;
  topics: string[];
}

export const ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS: readonly OfficialPageSeed[] = [
  {
    id: "tceq-composting-and-mulching",
    name: "TCEQ Composting and Mulching: Am I Regulated?",
    url: "https://www.tceq.texas.gov/permitting/waste_permits/msw_permits/compmulch",
    geography: "Texas",
    topics: [
      "compost notification",
      "compost registration",
      "compost permit",
      "agricultural material exemption",
      "meat dairy oils grease",
    ],
  },
  {
    id: "texas-ag-food-waste-composting",
    name: "Texas Attorney General Food Waste Composting Complaint",
    url: "https://www.texasattorneygeneral.gov/divisions/administrative-law/food-waste-composting-complaint",
    geography: "Texas",
    topics: [
      "Texas Health and Safety Code 364.020",
      "commercial food waste composting ordinance",
      "agricultural operation exception",
    ],
  },
  {
    id: "houston-composting-companies",
    name: "City of Houston Composting Resources",
    url: "https://www.houstontx.gov/council/5/composting.html",
    geography: "Houston, Texas",
    topics: [
      "Houston composting companies",
      "Houston food waste program",
      "Houston pumpkin composting",
      "local provider listing",
    ],
  },
  {
    id: "epa-sustainable-management-food",
    name: "EPA Sustainable Management of Food",
    url: "https://www.epa.gov/sustainable-management-food",
    geography: "United States",
    topics: [
      "wasted food",
      "food waste measurement",
      "landfill methane",
      "food recovery hierarchy",
    ],
  },
  {
    id: "nrcs-texas",
    name: "USDA NRCS Texas",
    url: "https://www.nrcs.usda.gov/conservation-basics/conservation-by-state/texas",
    geography: "Texas",
    topics: [
      "Texas soil health",
      "conservation practices",
      "farm programs",
      "organic matter",
    ],
  },
  {
    id: "texas-agrilife-extension",
    name: "Texas A&M AgriLife Extension",
    url: "https://agrilifeextension.tamu.edu/",
    geography: "Texas",
    topics: [
      "compost",
      "soil health",
      "manure",
      "farm management",
      "Gulf Coast agriculture",
    ],
  },
] as const;

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

export interface OfficialPageSnapshot {
  sourceId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  excerpt: string;
  fingerprint: string;
  fetchedAt: string;
  lastModified: string | null;
  etag: string | null;
  contentBytes: number;
  httpStatus: number;
}

interface OfficialPageStateEntry {
  fingerprint: string;
  finalUrl: string;
  title: string;
  lastFetchedAt: string;
  lastChangedAt: string;
  lastModified: string | null;
  etag: string | null;
}

interface OfficialPageState {
  schemaVersion: "1";
  projectId: typeof PROJECT_ID;
  updatedAt: string;
  sources: Record<string, OfficialPageStateEntry>;
}

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

interface OnFarmCompostOfficialMonitorArtifact {
  schemaVersion: "1";
  artifactType: "demand_pulse_official_page_dry_run";
  projectId: typeof PROJECT_ID;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractOfficialPageText(html: string): {
  title: string;
  text: string;
  excerpt: string;
} {
  const $ = load(html);
  $("script, style, noscript, template, svg").remove();

  const title = normalizeWhitespace($("title").first().text());
  const bodyText = $("body").length > 0 ? $("body").text() : $.root().text();
  const text = normalizeWhitespace(bodyText);

  return {
    title,
    text,
    excerpt: text.slice(0, EXCERPT_LENGTH),
  };
}

export function isAllowedOfficialRedirect(
  requestedUrl: string,
  finalUrl: string,
): boolean {
  const requestedHost = new URL(requestedUrl).hostname.toLowerCase();
  const finalHost = new URL(finalUrl).hostname.toLowerCase();
  return (
    finalHost === requestedHost ||
    finalHost.endsWith(`.${requestedHost}`) ||
    requestedHost.endsWith(`.${finalHost}`)
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }

  if (!response.body) return { text: "", bytes: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("Response byte limit exceeded");
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    reader.releaseLock();
  }
}

function normalizeHttpDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function fetchOfficialPageSnapshot(
  seed: OfficialPageSeed,
  fetchFn: typeof fetch,
  fetchedAt: string,
): Promise<OfficialPageSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchFn(seed.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "user-agent":
          "OpenSEO-DemandPulse/0.1 (+https://github.com/sorcerai/open-seo)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const finalUrl = response.url || seed.url;
    if (!isAllowedOfficialRedirect(seed.url, finalUrl)) {
      throw new Error(`Redirected outside allowed official host: ${finalUrl}`);
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const body = await readResponseTextBounded(response, MAX_RESPONSE_BYTES);
    const extracted = extractOfficialPageText(body.text);
    if (extracted.text.length < 100) {
      throw new Error("Official page returned insufficient readable text");
    }

    return {
      sourceId: seed.id,
      requestedUrl: seed.url,
      finalUrl,
      title: extracted.title || seed.name,
      excerpt: extracted.excerpt,
      fingerprint: await sha256Hex(extracted.text),
      fetchedAt,
      lastModified: normalizeHttpDate(response.headers.get("last-modified")),
      etag: response.headers.get("etag"),
      contentBytes: body.bytes,
      httpStatus: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonObject<T>(
  bucket: R2Bucket,
  key: string,
): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return object.json<T>();
}

function createObservation(
  seed: OfficialPageSeed,
  snapshot: OfficialPageSnapshot,
  previousFingerprint: string | null,
): DemandObservationCandidate {
  const publishedAt = snapshot.lastModified ?? snapshot.fetchedAt;

  return {
    projectId: PROJECT_ID,
    sourceConnectionId: `official-page:${seed.id}`,
    sourceClass: "market_event_observed",
    sourcePlatform: "official_page_monitor",
    sourceDomain: new URL(snapshot.finalUrl).hostname,
    externalId: `${seed.id}:${snapshot.fingerprint.slice(0, 20)}`,
    canonicalUrl: snapshot.finalUrl,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    publishedAt,
    collectedAt: snapshot.fetchedAt,
    locale: "en-US",
    geography: seed.geography,
    metadata: {
      authorityClass: "primary_authoritative",
      sourceId: seed.id,
      topics: seed.topics,
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

export async function runScheduledOnFarmCompostOfficialMonitor(
  env: Env,
  now = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<OnFarmCompostOfficialMonitorResult> {
  const flags = getDemandPulseFeatureFlags(
    env as unknown as Record<string, string | undefined>,
  );

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

  const artifactKey = `${ARTIFACT_PREFIX}/runs/${local.date}.json`;
  if (await env.R2.head(artifactKey)) {
    return { status: "already_completed", artifactKey };
  }

  const generatedAt = now.toISOString();
  const previousState = await readJsonObject<OfficialPageState>(
    env.R2,
    STATE_KEY,
  );
  const nextSources: Record<string, OfficialPageStateEntry> = {
    ...(previousState?.sources ?? {}),
  };

  const results = await mapWithConcurrency(
    ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
    3,
    async (seed) => {
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
    },
  );

  const successful = results.filter(
    (
      result,
    ): result is (typeof results)[number] & {
      snapshot: OfficialPageSnapshot;
      error: null;
    } => result.snapshot !== null,
  );

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

  const observations = successful
    .filter((result) => result.changed)
    .map((result) =>
      createObservation(
        result.seed,
        result.snapshot,
        result.previousFingerprint,
      ),
    );

  const sourceHealth: SourceHealthEntry[] = results.map((result) => ({
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

  const artifact: OnFarmCompostOfficialMonitorArtifact = {
    schemaVersion: "1",
    artifactType: "demand_pulse_official_page_dry_run",
    projectId: PROJECT_ID,
    mode: "dry_run",
    publicationAllowed: false,
    generatedAt,
    localDate: local.date,
    timezone: TIME_ZONE,
    sourceHealth,
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

  const nextState: OfficialPageState = {
    schemaVersion: "1",
    projectId: PROJECT_ID,
    updatedAt: generatedAt,
    sources: nextSources,
  };

  await env.R2.put(STATE_KEY, JSON.stringify(nextState), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      projectId: PROJECT_ID,
      artifactType: "official-page-state",
    },
  });
  await env.R2.put(artifactKey, JSON.stringify(artifact), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      projectId: PROJECT_ID,
      artifactType: artifact.artifactType,
      localDate: local.date,
    },
  });

  console.log(
    `[demand-pulse] OnFarmCompost dry run wrote ${artifactKey}: ${observations.length} changed, ${successful.length}/${results.length} healthy`,
  );

  return {
    status: "completed",
    artifactKey,
    successfulSources: successful.length,
    changedSources: observations.length,
  };
}
