import type { AdapterKey, DemandPulseCanaryAdapter } from "./dailyCanaryTypes";
import type {
  DemandPulseProfile,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import { defaultAdapters, errorText } from "./dailyCanaryAdapters";
import type {
  DemandSourceApprovalGate,
  DemandSourceReservationSeam,
  DemandSourceRunHealth,
  DemandSourceRunResult,
  DemandSourceAdapter,
} from "../sources/adapter";
import { buildRunHealth, evaluateSourceGate } from "../sources/adapter";
import type { SourceCapabilityDescriptor } from "../types";
import type { DemandObservationCandidate } from "../types";
import type { DemandPulseJsonBucket } from "../canaries/onfarmcompost-official-store";

export interface AdapterRunInput {
  adapterKey: AdapterKey;
  source: DemandPulseSource;
  config: unknown;
  projectId: string;
  collectedAt: string;
  cursor: string | null;
  fetchFn: typeof fetch;
  reservation: DemandSourceReservationSeam;
  customAdapter?: DemandPulseCanaryAdapter;
}

export interface AdapterAcquisitionResult {
  capabilities: SourceCapabilityDescriptor | null;
  observations: DemandObservationCandidate[];
  health: DemandSourceRunHealth;
  warnings: string[];
  rawArtifactPointers: string[];
}

export function emptyReservationSeam(
  profile: DemandPulseProfile,
): DemandSourceReservationSeam {
  let reservedMicros = 0;
  let spentMicros = 0;
  let sequence = 0;
  const reservations = new Map<string, number>();
  return {
    async reserve({ maxCostMicros }) {
      if (
        !Number.isInteger(maxCostMicros) ||
        maxCostMicros <= 0 ||
        spentMicros + reservedMicros + maxCostMicros > profile.dailyBudgetMicros
      ) {
        return {
          reserved: false,
          reason: "daily Demand Pulse budget exhausted",
        };
      }
      const reservationId = `demand-pulse-${++sequence}`;
      reservations.set(reservationId, maxCostMicros);
      reservedMicros += maxCostMicros;
      return { reserved: true, reservationId, maxCostMicros };
    },
    async settle({ reservationId, actualCostMicros }) {
      const maximum = reservations.get(reservationId);
      if (maximum === undefined)
        throw new Error("unknown Demand Pulse reservation");
      reservations.delete(reservationId);
      reservedMicros -= maximum;
      spentMicros += actualCostMicros;
    },
  };
}

export function sourceApprovalGate(
  source: DemandPulseSource,
): DemandSourceApprovalGate {
  const policyState = source.policyState;
  if (
    policyState !== "unknown" &&
    policyState !== "pending" &&
    policyState !== "allowed" &&
    policyState !== "blocked"
  ) {
    throw new Error(`Unexpected source policy state: ${policyState}`);
  }
  return {
    approvalState: source.approvalState,
    enabled: source.enabled,
    policyState,
  };
}

export function healthForBlocked(
  status: "blocked" | "failed" | "skipped" | "unknown",
  policyState: DemandSourceRunHealth["policyState"],
  error: string,
): DemandSourceRunHealth {
  return buildRunHealth({
    status,
    policyState,
    requestCount: 0,
    error,
  });
}

function fallbackHealth(
  gate: { policyState: DemandSourceRunHealth["policyState"] },
  result: DemandSourceRunResult,
): DemandSourceRunHealth {
  const status: DemandSourceRunHealth["status"] =
    result.observations.length > 0 ? "healthy" : "unknown";
  return buildRunHealth({
    status,
    policyState: gate.policyState,
    requestCount: result.sourceRequestCount,
    cursor: result.nextCursor,
    error:
      status === "unknown"
        ? "adapter returned no health or observations"
        : null,
  });
}

export function normalizePolicyState(
  value: string,
): DemandSourceRunHealth["policyState"] {
  switch (value) {
    case "unknown":
    case "pending":
    case "allowed":
    case "blocked":
      return value;
    default:
      return "unknown";
  }
}

async function acquireAdapterSource<TConfig>(input: {
  adapterKey: AdapterKey;
  adapter: DemandSourceAdapter<TConfig>;
  source: DemandPulseSource;
  config: unknown;
  projectId: string;
  collectedAt: string;
  cursor: string | null;
  fetchFn: typeof fetch;
  reservation: DemandSourceReservationSeam;
}): Promise<AdapterAcquisitionResult> {
  const sourceGate = sourceApprovalGate(input.source);
  const gate = evaluateSourceGate(sourceGate);
  if (!gate.allowed) {
    const status =
      gate.rule === "disabled" || gate.rule === "unapproved"
        ? "skipped"
        : "blocked";
    return {
      capabilities: input.adapter.capabilities,
      observations: [],
      health: healthForBlocked(status, gate.policyState, gate.reason),
      warnings: [gate.reason],
      rawArtifactPointers: [],
    };
  }
  try {
    const config = input.adapter.validateConfig(input.config);
    const result = await input.adapter.discover(
      {
        projectId: input.projectId,
        sourceConnectionId: input.source.id,
        collectedAt: input.collectedAt,
        cursor: input.cursor,
        fetch: input.fetchFn,
        source: sourceGate,
        reservation: input.reservation,
      },
      config,
    );
    const health = result.health ?? fallbackHealth(gate, result);
    const observations = result.observations.map((observation) => ({
      ...observation,
      projectId: input.projectId,
      sourceConnectionId: input.source.id,
      collectedAt: observation.collectedAt || input.collectedAt,
    }));
    return {
      capabilities: input.adapter.capabilities,
      observations,
      health,
      warnings: result.warnings,
      rawArtifactPointers: result.rawArtifactPointers ?? [],
    };
  } catch (error) {
    const message = `${input.adapterKey} acquisition failed: ${errorText(error)}`;
    return {
      capabilities: input.adapter.capabilities,
      observations: [],
      health: healthForBlocked("failed", gate.policyState, message),
      warnings: [message],
      rawArtifactPointers: [],
    };
  }
}

export async function acquireConfiguredAdapter(
  input: AdapterRunInput,
): Promise<AdapterAcquisitionResult> {
  const { customAdapter, ...base } = input;
  if (customAdapter) {
    return acquireAdapterSource({ ...base, adapter: customAdapter });
  }
  switch (input.adapterKey) {
    case "gsc-site":
      return acquireAdapterSource({
        ...base,
        adapter: defaultAdapters["gsc-site"],
      });
    case "dataforseo-discussions":
      return acquireAdapterSource({
        ...base,
        adapter: defaultAdapters["dataforseo-discussions"],
      });
    case "manual-first-party":
      return acquireAdapterSource({
        ...base,
        adapter: defaultAdapters["manual-first-party"],
      });
    case "local-news":
      return acquireAdapterSource({
        ...base,
        adapter: defaultAdapters["local-news"],
      });
    case "hacker-news":
      return acquireAdapterSource({
        ...base,
        adapter: defaultAdapters["hacker-news"],
      });
  }
}

export function sourceHealthFromRun(
  source: DemandPulseSource,
  capabilities: SourceCapabilityDescriptor | null,
  health: DemandSourceRunHealth,
  observationCount: number,
  warnings: readonly string[],
) {
  return {
    sourceId: source.id,
    adapter: source.adapter,
    sourcePlatform: capabilities?.sourcePlatform ?? null,
    health: health.status,
    policyState: health.policyState,
    requestCount: health.requestCount,
    costMicros: health.costMicros,
    cursor: health.cursor,
    error: health.error,
    observationCount,
    warnings,
  };
}

export async function readArtifactIdentity(
  bucket: DemandPulseJsonBucket,
  key: string,
): Promise<{ projectId: string; runId: string } | null> {
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    const value: unknown = JSON.parse(await object.text());
    if (typeof value !== "object" || value === null) return null;
    if (!("projectId" in value) || !("runId" in value)) return null;
    const projectId = value.projectId;
    const runId = value.runId;
    return typeof projectId === "string" && typeof runId === "string"
      ? { projectId, runId }
      : null;
  } catch {
    return null;
  }
}

export function localDateFor(now: Date): { date: string; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}
