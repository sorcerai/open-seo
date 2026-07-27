import { z } from "zod";
import {
  dataForSeoDiscussionItemSchema as dataForSeoItemSchema,
  normalizeDataForSeoDiscussions,
  type DataForSeoDiscussionItem,
} from "./dataforseo-discussions-normalize";
import {
  buildRunHealth,
  emptyFailureResult,
  evaluateSourceGate,
  isValidCostMicros,
  type DemandSourceAdapter,
  type DemandSourcePolicyState,
  type DemandSourceRunContext,
  type DemandSourceRunResult,
  type DemandSourceReservationResult,
  type DemandSourceReservationSeam,
} from "./adapter";

export type { DataForSeoDiscussionItem };
// ---------------------------------------------------------------------------
// Paid acquisition adapter.
//
// The adapter NEVER touches the DataForSEO SDK, credentials, or the billing
// path directly. It reads cache through one seam and consumes an injected
// already-metered paid outcome, then bounds spend through an atomic
// reserve/settle seam. No silent catch: a provider-billed failure surfaces
// its billed cost and request count as explicit failed health.
// ---------------------------------------------------------------------------

/** Discriminated fetch outcome. Cache hits are free; paid results carry
 * validated cost/request; a charged failure carries the billed cost even
 * though it produced no usable data. */
export type DataForSeoFetchOutcome =
  | { kind: "cache_hit"; items: unknown; cacheKey: string; taskIds?: string[] }
  | {
      kind: "paid_success";
      items: unknown;
      costMicros: number;
      vendorRequestCount: number;
      taskIds?: string[];
    }
  | {
      kind: "charged_failure";
      error: string;
      costMicros: number;
      vendorRequestCount: number;
      taskIds?: string[];
    };

export type DataForSeoFetchInput = {
  queries: string[];
  cursor?: string | null;
  reservedMaxCostMicros: number;
};

export type DataForSeoCacheReadInput = Omit<
  DataForSeoFetchInput,
  "reservedMaxCostMicros"
>;

export type DataForSeoCacheRead = (
  input: DataForSeoCacheReadInput,
) => Promise<Extract<DataForSeoFetchOutcome, { kind: "cache_hit" }> | null>;

export type DataForSeoPaidFetch = (
  input: DataForSeoFetchInput,
) => Promise<Exclude<DataForSeoFetchOutcome, { kind: "cache_hit" }>>;

const MAX_QUERIES_PER_CALL = 20;
const MAX_ITEMS_PER_CALL = 500;
export const DATAFORSEO_DISCUSSIONS_MAX_COST_PER_QUERY_MICROS = 200_000;

const dataForSeoSourceConfigSchema = z.strictObject({
  readCache: z.custom<DataForSeoCacheRead>(
    (value) => typeof value === "function",
    "readCache must be a function",
  ),
  fetchPaid: z.custom<DataForSeoPaidFetch>(
    (value) => typeof value === "function",
    "fetchPaid must be a function",
  ),
  queries: z.array(z.string().trim().min(1).max(200)).max(MAX_QUERIES_PER_CALL),
  operationKey: z.string().trim().min(1).max(100),
});

export type DataForSeoSourceConfig = z.infer<
  typeof dataForSeoSourceConfigSchema
>;

function prepareQueries(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of raw) {
    const trimmed = query.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_QUERIES_PER_CALL) break;
  }
  return out;
}

function failedResult(
  policyState: DemandSourcePolicyState,
  error: string,
  costMicros = 0,
  requestCount = 0,
  metrics?: Record<string, number | string | boolean | null>,
): DemandSourceRunResult {
  return emptyFailureResult(
    buildRunHealth({
      status: "failed",
      policyState,
      requestCount,
      costMicros,
      error,
      metrics,
    }),
  );
}

function skippedResult(
  policyState: DemandSourcePolicyState,
  error: string,
  metrics?: Record<string, number | string | boolean | null>,
): DemandSourceRunResult {
  return emptyFailureResult(
    buildRunHealth({
      status: "skipped",
      policyState,
      requestCount: 0,
      error,
      metrics,
    }),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withSettlementError(message: string, settlementError: string | null) {
  return settlementError ? `${message}; ${settlementError}` : message;
}

async function settleReservation(
  reservation: DemandSourceReservationSeam,
  reservationId: string,
  actualCostMicros: number,
): Promise<string | null> {
  try {
    await reservation.settle({ reservationId, actualCostMicros });
    return null;
  } catch (error) {
    return `reservation settle failed: ${errorText(error)}`;
  }
}

async function discover(
  context: DemandSourceRunContext,
  config: DataForSeoSourceConfig,
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

  const queries = prepareQueries(config.queries);
  if (queries.length === 0) {
    return skippedResult(
      gate.policyState,
      "DataForSEO paid call skipped: no valid queries",
    );
  }

  let cacheHit: Extract<DataForSeoFetchOutcome, { kind: "cache_hit" }> | null;
  try {
    cacheHit = await config.readCache({ queries, cursor: context.cursor });
  } catch (error) {
    return failedResult(
      gate.policyState,
      `DataForSEO cache read failed: ${errorText(error)}`,
    );
  }

  let outcome: DataForSeoFetchOutcome;
  let reservedMaxCostMicros: number | undefined;
  let settlement:
    | ((actualCostMicros: number) => Promise<string | null>)
    | undefined;

  if (cacheHit !== null) {
    if (
      !cacheHit ||
      cacheHit.kind !== "cache_hit" ||
      typeof cacheHit.cacheKey !== "string" ||
      !cacheHit.cacheKey.trim()
    ) {
      return failedResult(
        gate.policyState,
        "DataForSEO cache read returned an invalid cache hit",
      );
    }
    outcome = cacheHit;
  } else {
    const maxCostMicros =
      queries.length * DATAFORSEO_DISCUSSIONS_MAX_COST_PER_QUERY_MICROS;
    if (!isValidCostMicros(maxCostMicros) || maxCostMicros <= 0) {
      return failedResult(
        gate.policyState,
        `DataForSEO invalid reserved cost: ${maxCostMicros}`,
      );
    }

    const reservation = context.reservation;
    if (!reservation) {
      return skippedResult(
        gate.policyState,
        "DataForSEO paid call skipped: reservation seam unavailable",
      );
    }

    let reserved: DemandSourceReservationResult;
    try {
      reserved = await reservation.reserve({
        maxCostMicros,
        operationKey: config.operationKey,
      });
    } catch (error) {
      return skippedResult(
        gate.policyState,
        `DataForSEO paid call skipped: reservation failed: ${errorText(error)}`,
      );
    }
    if (!reserved.reserved) {
      return skippedResult(
        gate.policyState,
        `DataForSEO paid call skipped: ${reserved.reason}`,
        { reservedMaxCostMicros: maxCostMicros },
      );
    }

    reservedMaxCostMicros = reserved.maxCostMicros;
    const reservationId = reserved.reservationId;
    const settleReserved = (actualCostMicros: number) =>
      settleReservation(reservation, reservationId, actualCostMicros);
    settlement = settleReserved;

    if (
      !isValidCostMicros(reserved.maxCostMicros) ||
      reserved.maxCostMicros < maxCostMicros
    ) {
      const settleError = await settleReserved(0);
      return failedResult(
        gate.policyState,
        withSettlementError(
          `DataForSEO reservation returned an invalid hold: ${reserved.maxCostMicros}`,
          settleError,
        ),
      );
    }

    try {
      outcome = await config.fetchPaid({
        queries,
        cursor: context.cursor,
        reservedMaxCostMicros: reserved.maxCostMicros,
      });
    } catch (error) {
      const settleError = await settleReserved(0);
      return failedResult(
        gate.policyState,
        withSettlementError(
          `DataForSEO paid fetch failed: ${errorText(error)}`,
          settleError,
        ),
      );
    }
  }

  let costMicros = 0;
  let vendorRequestCount = 0;
  const cacheHitResult = outcome.kind === "cache_hit";

  if (outcome.kind !== "cache_hit") {
    if (!settlement) {
      return failedResult(
        gate.policyState,
        "DataForSEO reservation settle seam unavailable",
      );
    }
    if (!isValidCostMicros(outcome.costMicros)) {
      const settleError = await settlement(0);
      return failedResult(
        gate.policyState,
        withSettlementError(
          `DataForSEO paid result reported invalid cost: ${String(outcome.costMicros)}`,
          settleError,
        ),
      );
    }
    if (
      !Number.isInteger(outcome.vendorRequestCount) ||
      outcome.vendorRequestCount < 0
    ) {
      const settleError = await settlement(0);
      return failedResult(
        gate.policyState,
        withSettlementError(
          `DataForSEO paid result reported invalid request count: ${outcome.vendorRequestCount}`,
          settleError,
        ),
        outcome.costMicros,
      );
    }

    costMicros = outcome.costMicros;
    vendorRequestCount = outcome.vendorRequestCount;
    if (
      reservedMaxCostMicros === undefined ||
      costMicros > reservedMaxCostMicros
    ) {
      const settleError = await settlement(0);
      return failedResult(
        gate.policyState,
        withSettlementError(
          `DataForSEO actual cost ${costMicros} exceeds reserved hold`,
          settleError,
        ),
        costMicros,
        vendorRequestCount,
      );
    }

    const settleError = await settlement(costMicros);
    if (settleError) {
      return failedResult(
        gate.policyState,
        settleError,
        costMicros,
        vendorRequestCount,
      );
    }
    if (outcome.kind === "charged_failure") {
      return emptyFailureResult(
        buildRunHealth({
          status: "failed",
          policyState: gate.policyState,
          requestCount: vendorRequestCount,
          costMicros,
          error: `DataForSEO charged failure: ${outcome.error}`,
          metrics: {
            billed: true,
            taskIds: (outcome.taskIds ?? []).join(",") || null,
          },
        }),
      );
    }
  }

  const itemsParse = z
    .array(dataForSeoItemSchema)
    .max(MAX_ITEMS_PER_CALL)
    .safeParse(outcome.items);
  if (!itemsParse.success) {
    return failedResult(
      gate.policyState,
      `DataForSEO items failed validation: ${itemsParse.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      costMicros,
      vendorRequestCount,
      {
        cacheHit: cacheHitResult,
        cacheKey: outcome.kind === "cache_hit" ? outcome.cacheKey : null,
        taskIds: (outcome.taskIds ?? []).join(",") || null,
      },
    );
  }

  const observations = normalizeDataForSeoDiscussions(
    context.projectId,
    context.sourceConnectionId,
    context.collectedAt,
    itemsParse.data,
  );
  context.log?.("demand_pulse.source_complete", {
    source: "dataforseo_discussions_and_forums",
    observations: observations.length,
    sourceRequestCount: vendorRequestCount,
    costMicros,
    cacheHit: cacheHitResult,
  });

  return {
    observations,
    sourceRequestCount: vendorRequestCount,
    warnings: [],
    nextCursor: context.collectedAt,
    health: buildRunHealth({
      status: "healthy",
      policyState: gate.policyState,
      requestCount: vendorRequestCount,
      costMicros,
      cursor: context.collectedAt,
      metrics: {
        cacheHit: cacheHitResult,
        cacheKey: outcome.kind === "cache_hit" ? outcome.cacheKey : null,
        vendorRequestCount,
        queries: queries.length,
        taskIds: (outcome.taskIds ?? []).join(",") || null,
      },
    }),
  };
}

export const dataforseoDiscussionsDemandSource: DemandSourceAdapter<DataForSeoSourceConfig> =
  {
    capabilities: {
      sourcePlatform: "dataforseo_discussions_and_forums",
      supportsBackfill: false,
      supportsIncrementalCursor: true,
      supportsDeletionSync: false,
      supportsEngagementSnapshots: false,
      supportsFullText: false,
      requiresAuthentication: true,
      requiresCommercialApproval: true,
      defaultRawRetentionDays: 30,
      notes: [
        "Discovery/corroboration runs through explicit cache-read and paid-fetch seams; the adapter never calls the DataForSEO SDK or billing path directly.",
        "Cache hits return before reservation. Paid calls reserve a fixed positive code-owned maximum per query, then settle actual spend or release the hold on rejection.",
        "cache_hit => cost 0 / request 0; paid_success => validated cost/request; charged_failure => failed health carrying the billed cost. Settlement failures are failed health, never healthy.",
      ],
    },
    validateConfig: (config) => dataForSeoSourceConfigSchema.parse(config),
    discover,
  };
