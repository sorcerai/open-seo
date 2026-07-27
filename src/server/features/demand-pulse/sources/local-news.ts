import { z } from "zod";
import { canonicalizeDemandUrl } from "../dedupe";
import type { DemandObservationCandidate } from "../types";
import {
  buildRunHealth,
  demandHttpsUrl,
  emptyFailureResult,
  evaluateSourceGate,
  type DemandSourceAdapter,
  type DemandSourceHealthStatus,
  type DemandSourceRunContext,
  type DemandSourceRunResult,
} from "./adapter";

/** A search-surface hit (discovery). Injected deterministically by the runner;
 *  the adapter performs no live search call. */
export interface LocalNewsSearchHit {
  query: string;
  title: string;
  url: string;
  publisherDomain?: string | null;
  publishedAt?: string | null;
  excerpt?: string | null;
}

/** The original publisher article resolved through the allowlisted fetch seam. */
export interface LocalNewsPublisherArticle {
  url: string;
  title: string;
  excerpt?: string | null;
  publishedAt: string;
  publisherDomain: string;
}

/**
 * Allowlisted, bounded fetch seam. The adapter resolves original publisher
 * evidence ONLY for URLs whose host is in `allowlistedPublisherDomains` and
 * matches the claimed publisher, and ONLY through this injected function. The
 * concrete resolver must enforce redirect-by-redirect host allowlisting.
 */
export type LocalNewsAllowlistedFetch = (input: {
  url: string;
  publisherDomain: string;
}) => Promise<unknown>;
const localNewsSearchHitSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  url: demandHttpsUrl(),
  publisherDomain: z.string().trim().min(1).max(253).optional(),
  publishedAt: z.string().trim().min(1).max(40).optional(),
  excerpt: z.string().trim().max(2_000).optional(),
});

const localNewsDiscoverySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    provenance: z.string().trim().min(1).max(200),
    hits: z.array(localNewsSearchHitSchema).min(1).max(50),
  }),
  z.strictObject({
    status: z.literal("empty"),
    provenance: z.string().trim().min(1).max(200),
    hits: z.tuple([]),
  }),
  z.strictObject({
    status: z.literal("failed"),
    provenance: z.string().trim().min(1).max(200),
    error: z.string().trim().min(1).max(500),
    hits: z.tuple([]),
  }),
]);

const localNewsPublisherDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine(
    (value) => hostFromUrl(`https://${value}`) === value,
    "publisherDomain must be a hostname",
  );

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

const localNewsPublisherArticleSchema = z.strictObject({
  url: demandHttpsUrl(),
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().max(2_000).nullable().optional(),
  publishedAt: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .pipe(z.iso.datetime({ offset: true })),
  publisherDomain: localNewsPublisherDomainSchema,
});

const localNewsSourceConfigSchema = z.strictObject({
  discovery: localNewsDiscoverySchema,
  allowlistedPublisherDomains: z
    .array(z.string().trim().min(1).max(253))
    .max(50),
  resolveOriginal: z.custom<LocalNewsAllowlistedFetch>(
    (value) => typeof value === "function",
    "resolveOriginal must be a function",
  ),
  maxResolutions: z.number().int().min(0).max(50),
});

export type LocalNewsSourceConfig = z.infer<typeof localNewsSourceConfigSchema>;

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function compareLocalNews(
  a: DemandObservationCandidate,
  b: DemandObservationCandidate,
): number {
  const evidenceKindA = a.metadata?.evidenceKind;
  const evidenceKindB = b.metadata?.evidenceKind;
  const keyA = `${typeof evidenceKindA === "string" ? evidenceKindA : ""}:${a.sourceClass}:${a.canonicalUrl}`;
  const keyB = `${typeof evidenceKindB === "string" ? evidenceKindB : ""}:${b.sourceClass}:${b.canonicalUrl}`;
  return keyA.localeCompare(keyB);
}

async function discover(
  context: DemandSourceRunContext,
  config: LocalNewsSourceConfig,
): Promise<DemandSourceRunResult> {
  const gate = evaluateSourceGate(context.source);
  if (!gate.allowed) {
    return emptyFailureResult(
      buildRunHealth({
        status: "blocked",
        policyState: gate.policyState,
        requestCount: 0,
        error: gate.reason,
      }),
    );
  }

  const allowlist = new Set(
    config.allowlistedPublisherDomains.map((domain) => domain.toLowerCase()),
  );
  const maxResolutions = config.maxResolutions;
  const warnings: string[] = [];
  const observations: DemandObservationCandidate[] = [];
  let sourceRequestCount = 0;
  let resolutionFailures = 0;

  const discovery = config.discovery;
  if (discovery.status === "failed") {
    const error = `local-news discovery failed: ${discovery.error}`;
    return emptyFailureResult(
      buildRunHealth({
        status: "failed",
        policyState: gate.policyState,
        requestCount: 0,
        error,
        metrics: {
          discoveryStatus: "failed",
          searchHits: 0,
          originalResolutions: 0,
          resolutionFailures: 0,
          allowlistedPublishers: allowlist.size,
        },
      }),
    );
  }

  const hits = discovery.status === "ok" ? discovery.hits : [];

  // 1. Search observations — emitted for every hit and kept DISTINCT from
  //    original publisher evidence. These are search-surface signals
  //    (search_observed), preserved even when original resolution fails.
  for (const hit of hits) {
    const canonicalUrl = canonicalizeDemandUrl(hit.url);
    const host = hostFromUrl(hit.url);
    observations.push({
      projectId: context.projectId,
      sourceConnectionId: context.sourceConnectionId,
      sourceClass: "search_observed",
      sourcePlatform: "local_news",
      sourceDomain: host,
      externalId: `local-news:search:${canonicalUrl}`,
      canonicalUrl,
      title: hit.title,
      excerpt: hit.excerpt?.trim().slice(0, 1_000) || null,
      publishedAt: hit.publishedAt ?? context.collectedAt,
      collectedAt: context.collectedAt,
      metadata: {
        evidenceKind: "search_hit",
        query: hit.query,
        publisherDomain: host,
        discoveryProvenance: discovery.provenance,
      },
      retentionProfile: "search-observed-v1",
    });
  }

  // 2. Original publisher evidence — market_event_observed. Resolved ONLY when
  //    the URL host equals the claimed publisher AND is allowlisted. The
  //    returned final URL/publisher is revalidated before any evidence is kept.
  let resolutions = 0;
  for (const hit of hits) {
    if (resolutions >= maxResolutions) {
      warnings.push(
        `original-source resolution capped at ${maxResolutions} per run`,
      );
      break;
    }

    const urlHost = hostFromUrl(hit.url);
    if (!urlHost) {
      warnings.push(`original-source skipped: unparseable url ${hit.url}`);
      continue;
    }

    if (hit.publisherDomain && hit.publisherDomain.toLowerCase() !== urlHost) {
      warnings.push(
        `original-source policy-blocked: claimed publisher ${hit.publisherDomain} does not match url host ${urlHost}`,
      );
      continue;
    }

    if (!allowlist.has(urlHost)) {
      warnings.push(
        `original-source policy-blocked for non-allowlisted publisher: ${urlHost}`,
      );
      continue;
    }

    resolutions += 1;
    sourceRequestCount += 1;

    let article: unknown = null;
    try {
      article = await config.resolveOriginal({
        url: hit.url,
        publisherDomain: urlHost,
      });
    } catch (error) {
      resolutionFailures += 1;
      warnings.push(
        `local-news original resolution failed for ${hit.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (!article) {
      resolutionFailures += 1;
      continue;
    }

    let parsedArticle: LocalNewsPublisherArticle;
    try {
      const parsed = localNewsPublisherArticleSchema.safeParse(article);
      if (!parsed.success) {
        resolutionFailures += 1;
        warnings.push(
          `local-news original rejected: ${formatZodError(parsed.error)}`,
        );
        continue;
      }
      parsedArticle = parsed.data;
    } catch (error) {
      resolutionFailures += 1;
      warnings.push(
        `local-news original validation failed for ${hit.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    // Revalidate the returned final URL/publisher against the allowlist so a
    // cross-domain redirect can never persist non-allowlisted evidence.
    const finalHost = hostFromUrl(parsedArticle.url);
    const finalPublisher = parsedArticle.publisherDomain;
    const finalOk =
      !!finalHost && finalHost === finalPublisher && allowlist.has(finalHost);
    if (!finalOk) {
      resolutionFailures += 1;
      warnings.push(
        `local-news original dropped: final host ${finalHost} / publisher ${finalPublisher} not allowlisted`,
      );
      continue;
    }

    const canonicalUrl = canonicalizeDemandUrl(parsedArticle.url);
    observations.push({
      projectId: context.projectId,
      sourceConnectionId: context.sourceConnectionId,
      sourceClass: "market_event_observed",
      sourcePlatform: "local_news",
      sourceDomain: finalHost,
      externalId: `local-news:original:${canonicalUrl}`,
      canonicalUrl,
      title: parsedArticle.title,
      excerpt: parsedArticle.excerpt?.trim().slice(0, 1_000) || null,
      publishedAt: parsedArticle.publishedAt,
      collectedAt: context.collectedAt,
      metadata: {
        evidenceKind: "original_publisher",
        publisherDomain: finalHost,
        resolvedFromQuery: hit.query,
      },
      retentionProfile: "market-event-observed-v1",
    });
  }

  const sortedObservations = observations.toSorted(compareLocalNews);

  const originalCount = sortedObservations.filter(
    (observation) =>
      observation.metadata?.evidenceKind === "original_publisher",
  ).length;

  // Discovery health is explicit: a failed discovery is failed health; partial
  // original-resolution failure degrades to unknown while preserving search
  // observations. Search observations are always retained.
  let status: DemandSourceHealthStatus = "healthy";
  let error: string | null = null;
  if (resolutionFailures > 0) {
    status =
      resolutionFailures > 0 && originalCount === 0 ? "failed" : "unknown";
    error = `local-news degraded: ${resolutionFailures} original resolution(s) failed`;
  }

  context.log?.("demand_pulse.source_complete", {
    source: "local_news",
    observations: sortedObservations.length,
    sourceRequestCount,
    warnings: warnings.length,
  });

  return {
    observations: sortedObservations,
    sourceRequestCount,
    warnings,
    nextCursor: context.collectedAt,
    health: buildRunHealth({
      status,
      policyState: gate.policyState,
      requestCount: sourceRequestCount,
      costMicros: 0,
      cursor: context.collectedAt,
      error,
      metrics: {
        discoveryStatus: discovery.status,
        searchHits: hits.length,
        originalResolutions: originalCount,
        resolutionFailures,
        allowlistedPublishers: allowlist.size,
      },
    }),
  };
}

export const localNewsDemandSource: DemandSourceAdapter<LocalNewsSourceConfig> =
  {
    capabilities: {
      sourcePlatform: "local_news",
      supportsBackfill: false,
      supportsIncrementalCursor: true,
      supportsDeletionSync: false,
      supportsEngagementSnapshots: false,
      supportsFullText: true,
      requiresAuthentication: false,
      requiresCommercialApproval: false,
      defaultRawRetentionDays: 30,
      notes: [
        "Search observations (search_observed) are kept distinct from resolved publisher evidence (market_event_observed); both carry different evidenceKind metadata and externalId prefixes.",
        "Original-source resolution requires the URL host to equal the claimed publisher AND be allowlisted; the returned final URL/publisher is revalidated before evidence is kept.",
        "Resolver throw/null degrades health (unknown/failed) while preserving search observations. Local-news is a free adapter and ignores the paid reservation seam.",
      ],
    },
    validateConfig: (config) => localNewsSourceConfigSchema.parse(config),
    discover,
  };
