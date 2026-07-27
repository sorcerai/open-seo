import { z } from "zod";
import type { GscPerformanceInput } from "@/server/features/gsc/searchAnalytics";
import { GSC_DATE_RANGES } from "@/server/features/gsc/searchAnalytics";
import type {
  GscSearchAnalyticsRequest,
  GscSearchAnalyticsRow,
} from "@/server/lib/gscClient";
import { canonicalizeDemandUrl } from "../dedupe";
import type { DemandObservationCandidate } from "../types";
import {
  buildRunHealth,
  emptyFailureResult,
  evaluateSourceGate,
  type DemandSourceAdapter,
  type DemandSourcePolicyState,
  type DemandSourceRunContext,
  type DemandSourceRunResult,
} from "./adapter";

/** The exact query→page tuple this adapter requires. Never configurable. */
export const GSC_REQUIRED_DIMENSIONS = ["query", "page"] as const;

/**
 * Structural equivalent of GscService.getPerformance's (private) result type.
 * Kept here so the injected seam is assignable from `GscService.getPerformance`
 * without importing the service singleton. The adapter consumes only `rows`.
 */
export type GscPerformanceResult = {
  siteUrl: string;
  connectedBy: string | null;
  request: GscSearchAnalyticsRequest;
  rows: GscSearchAnalyticsRow[];
};

/**
 * Narrow fetch seam compatible with `GscService.getPerformance`. The adapter
 * never calls the GSC REST API, resolves a connection, or handles OAuth — it
 * delegates all of that to this injected function.
 */
export type GscPerformanceFetch = (
  input: GscPerformanceInput,
) => Promise<GscPerformanceResult>;

const gscRowSchema = z.strictObject({
  keys: z.tuple([z.string(), z.string()]),
  clicks: z.number().finite().min(0),
  impressions: z.number().finite().min(0),
  ctr: z.number().finite().min(0),
  position: z.number().finite().min(0),
});

const gscSourceConfigSchema = z.strictObject({
  getPerformance: z.custom<GscPerformanceFetch>(
    (value) => typeof value === "function",
    "getPerformance must be a function",
  ),
  startDate: z.string().trim().min(1).max(20).optional(),
  endDate: z.string().trim().min(1).max(20).optional(),
  dateRange: z.enum(GSC_DATE_RANGES).optional(),
  maxRows: z.number().int().min(1).max(1000).optional(),
});

export type GscSourceConfig = z.infer<typeof gscSourceConfigSchema>;

function numberMetadata(
  observation: DemandObservationCandidate,
  key: string,
): number {
  const value = observation.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareGscRows(
  a: DemandObservationCandidate,
  b: DemandObservationCandidate,
): number {
  const clicksA = numberMetadata(a, "clicks");
  const clicksB = numberMetadata(b, "clicks");
  if (clicksB !== clicksA) return clicksB - clicksA;
  const impA = numberMetadata(a, "impressions");
  const impB = numberMetadata(b, "impressions");
  if (impB !== impA) return impB - impA;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.canonicalUrl.localeCompare(b.canonicalUrl);
}

function failedResult(
  policyState: DemandSourcePolicyState,
  error: string,
): DemandSourceRunResult {
  return emptyFailureResult(
    buildRunHealth({
      status: "failed",
      policyState,
      requestCount: 0,
      error,
    }),
  );
}

async function discover(
  context: DemandSourceRunContext,
  config: GscSourceConfig,
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

  // Validate the response strictly INSIDE the health boundary: a connection,
  // token, or API error — and any malformed rows or wrong dimensions — become a
  // `failed` health row, never an empty success with zero observations.
  let result: GscPerformanceResult;
  try {
    result = await config.getPerformance({
      projectId: context.projectId,
      dimensions: [...GSC_REQUIRED_DIMENSIONS],
      dateRange: config.dateRange,
      startDate: config.startDate,
      endDate: config.endDate,
      rowLimit: config.maxRows,
    });
  } catch (error) {
    return failedResult(
      gate.policyState,
      `GSC getPerformance failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      }`,
    );
  }

  const dimensions = result.request?.dimensions;
  if (
    !Array.isArray(dimensions) ||
    dimensions.length !== 2 ||
    dimensions[0] !== GSC_REQUIRED_DIMENSIONS[0] ||
    dimensions[1] !== GSC_REQUIRED_DIMENSIONS[1]
  ) {
    return failedResult(
      gate.policyState,
      `GSC response dimensions must be [query,page], got ${JSON.stringify(
        dimensions,
      )}`,
    );
  }

  const rowsParse = z.array(gscRowSchema).safeParse(result.rows);
  if (!rowsParse.success) {
    return failedResult(
      gate.policyState,
      `GSC rows failed validation: ${rowsParse.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const observations: DemandObservationCandidate[] = [];
  const seen = new Set<string>();

  for (const row of rowsParse.data) {
    const query = row.keys[0].trim();
    const page = row.keys[1].trim();
    if (!query || !page) continue;

    const canonicalUrl = canonicalizeDemandUrl(page);
    const externalId = `gsc:${query}:${canonicalUrl}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    observations.push({
      projectId: context.projectId,
      sourceConnectionId: context.sourceConnectionId,
      sourceClass: "search_observed",
      sourcePlatform: "gsc",
      externalId,
      canonicalUrl,
      title: query,
      excerpt: null,
      publishedAt: context.collectedAt,
      collectedAt: context.collectedAt,
      engagement: {
        views: row.impressions,
      },
      metadata: {
        query,
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      },
      retentionProfile: "search-observed-v1",
    });
  }

  const sortedObservations = observations.toSorted(compareGscRows);

  const cursor = config.endDate ?? context.collectedAt;
  context.log?.("demand_pulse.source_complete", {
    source: "gsc",
    observations: sortedObservations.length,
    sourceRequestCount: 1,
    warnings: 0,
  });

  return {
    observations: sortedObservations,
    sourceRequestCount: 1,
    warnings: [],
    nextCursor: cursor,
    health: buildRunHealth({
      status: "healthy",
      policyState: gate.policyState,
      requestCount: 1,
      costMicros: 0,
      cursor,
      metrics: {
        gscRows: rowsParse.data.length,
        observations: sortedObservations.length,
      },
    }),
  };
}

export const gscDemandSource: DemandSourceAdapter<GscSourceConfig> = {
  capabilities: {
    sourcePlatform: "gsc",
    supportsBackfill: true,
    supportsIncrementalCursor: true,
    supportsDeletionSync: false,
    supportsEngagementSnapshots: true,
    supportsFullText: false,
    requiresAuthentication: true,
    requiresCommercialApproval: false,
    defaultRawRetentionDays: 30,
    notes: [
      "Query-to-page rows come from an injected seam compatible with GscService.getPerformance; the adapter never calls the GSC API directly.",
      "Dimensions are fixed at [query,page]; the response is strictly validated inside the health boundary.",
      "GSC is a free Google surface; costMicros is always 0 and the reservation seam does not gate it.",
    ],
  },
  validateConfig: (config) => gscSourceConfigSchema.parse(config),
  discover,
};
