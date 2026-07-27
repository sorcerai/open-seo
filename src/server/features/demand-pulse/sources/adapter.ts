import { z } from "zod";
import type {
  DemandObservationCandidate,
  SourceCapabilityDescriptor,
} from "../types";

// ---------------------------------------------------------------------------
// Fetch policy + approval gate.
//
// policyState is a CLOSED set. Only the explicitly fetchable state "allowed"
// permits a network fetch. The gate is table-driven so every failure mode
// (missing / unapproved / disabled / policy-blocked) has its own explicit
// reason; a human approval can never make a policy-blocked source fetchable.
// ---------------------------------------------------------------------------

/** Closed set of fetch-policy states. Only "allowed" permits a fetch. */
export type DemandSourcePolicyState =
  | "unknown"
  | "pending"
  | "allowed"
  | "blocked";

export interface DemandSourceApprovalGate {
  approvalState: "pending" | "approved" | "rejected";
  enabled: boolean;
  policyState: DemandSourcePolicyState;
}

/** A single table-driven fetch-gate rule. First match wins; order is load-bearing. */
export interface DemandSourceGateRule {
  readonly id: "missing" | "unapproved" | "disabled" | "policy_blocked";
  readonly blocked: (gate: DemandSourceApprovalGate | undefined) => boolean;
  readonly reason: (gate: DemandSourceApprovalGate | undefined) => string;
}

export const SOURCE_GATE_RULES: readonly DemandSourceGateRule[] = [
  {
    id: "missing",
    blocked: (gate) => gate === undefined,
    reason: () => "source gate missing",
  },
  {
    id: "unapproved",
    blocked: (gate) => gate !== undefined && gate.approvalState !== "approved",
    reason: (gate) => `approvalState=${gate!.approvalState}`,
  },
  {
    id: "disabled",
    blocked: (gate) => gate !== undefined && !gate.enabled,
    reason: () => "enabled=false",
  },
  {
    id: "policy_blocked",
    blocked: (gate) => gate !== undefined && gate.policyState !== "allowed",
    reason: (gate) => `policyState=${gate!.policyState}`,
  },
];

export type DemandSourceGateOutcome =
  | { allowed: true; policyState: DemandSourcePolicyState }
  | {
      allowed: false;
      rule: DemandSourceGateRule["id"];
      policyState: DemandSourcePolicyState;
      reason: string;
    };

/** Evaluate the fetch gate. Only approved + enabled + policyState=allowed may fetch. */
export function evaluateSourceGate(
  gate: DemandSourceApprovalGate | undefined,
): DemandSourceGateOutcome {
  for (const rule of SOURCE_GATE_RULES) {
    if (rule.blocked(gate)) {
      return {
        allowed: false,
        rule: rule.id,
        policyState: gate?.policyState ?? "unknown",
        reason: `source is not fetchable: ${rule.reason(gate)}`,
      };
    }
  }
  return { allowed: true, policyState: gate!.policyState };
}

// ---------------------------------------------------------------------------
// Atomic paid-acquisition reservation.
//
// reserve() holds a known worst-case amount BEFORE the paid call so a single
// over-budget call can never occur; settle() records the actual spend and
// releases the remainder. Reservations must be settled on every classified paid
// outcome; an unsettled reservation expires (the seam implementation owns
// expiry/rollback). This replaces post-call subtraction, which cannot enforce a
// hard ceiling.
// ---------------------------------------------------------------------------

export interface DemandSourceReservationSeam {
  reserve(input: {
    maxCostMicros: number;
    operationKey: string;
  }): Promise<DemandSourceReservationResult>;
  settle(input: {
    reservationId: string;
    actualCostMicros: number;
  }): Promise<void>;
}

export type DemandSourceReservationResult =
  | { reserved: true; reservationId: string; maxCostMicros: number }
  | { reserved: false; reason: string };

// ---------------------------------------------------------------------------
// Run context, result, and health.
// ---------------------------------------------------------------------------

export interface DemandSourceRunContext {
  projectId: string;
  sourceConnectionId: string;
  collectedAt: string;
  since?: string;
  cursor?: string | null;
  signal?: AbortSignal;
  fetch: typeof fetch;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** Resolved approval + policy gate, supplied by the runner. */
  source?: DemandSourceApprovalGate;
  /** Atomic paid-acquisition reservation seam. Paid adapters (DataForSEO) bound
   *  spend with reserve/settle; free adapters (GSC, local-news, manual) ignore
   *  it and run even when paid budget is exhausted. */
  reservation?: DemandSourceReservationSeam;
}

/** Mirrors demand_pulse_source_runs.health. Missing/blocked/error is never
 *  represented as empty success — the status carries it explicitly. */
export type DemandSourceHealthStatus =
  | "healthy"
  | "failed"
  | "blocked"
  | "unknown"
  | "skipped";

export interface DemandSourceRunHealth {
  status: DemandSourceHealthStatus;
  policyState: DemandSourcePolicyState;
  requestCount: number;
  costMicros: number;
  cursor: string | null;
  error: string | null;
  /** Adapter-specific telemetry (cacheHit, budgetAvailableMicros, ...). */
  metrics?: Record<string, number | string | boolean | null>;
}

export interface DemandSourceRunResult {
  observations: DemandObservationCandidate[];
  nextCursor?: string | null;
  sourceRequestCount: number;
  warnings: string[];
  rawArtifactPointers?: string[];
  /** Structured health the runner projects into the source-run row. */
  health?: DemandSourceRunHealth;
}

export interface DemandSourceAdapter<TConfig = unknown> {
  readonly capabilities: SourceCapabilityDescriptor;
  validateConfig(config: unknown): TConfig;
  discover(
    context: DemandSourceRunContext,
    config: TConfig,
  ): Promise<DemandSourceRunResult>;
}

// ---------------------------------------------------------------------------
// Shared validation helpers.
// ---------------------------------------------------------------------------

/** Reject non-finite, negative, or fractional micro-USD. */
export function isValidCostMicros(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/** Build a deterministic health projection, centralizing the schema mapping. */
export function buildRunHealth(input: {
  status: DemandSourceHealthStatus;
  policyState: DemandSourcePolicyState;
  requestCount: number;
  costMicros?: number;
  cursor?: string | null;
  error?: string | null;
  metrics?: Record<string, number | string | boolean | null>;
}): DemandSourceRunHealth {
  return {
    status: input.status,
    policyState: input.policyState,
    requestCount: Math.max(0, Math.floor(input.requestCount)),
    costMicros: Math.max(0, Math.floor(input.costMicros ?? 0)),
    cursor: input.cursor ?? null,
    error: input.error ?? null,
    metrics: input.metrics,
  };
}

/** Terminal result carrying blocked/failed/skipped health and no observations. */
export function emptyFailureResult(
  health: DemandSourceRunHealth,
): DemandSourceRunResult {
  return {
    observations: [],
    sourceRequestCount: health.requestCount,
    warnings: health.error ? [health.error] : [],
    health,
  };
}

/** Absolute http(s) URL string with a bounded length. */
export function demandHttpsUrl() {
  return z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, "must be an absolute http(s) URL");
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
