import type {
  DemandObservationCandidate,
  SourceCapabilityDescriptor,
} from "../types";

export interface DemandSourceRunContext {
  projectId: string;
  sourceConnectionId: string;
  collectedAt: string;
  since?: string;
  cursor?: string | null;
  signal?: AbortSignal;
  fetch: typeof fetch;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface DemandSourceRunResult {
  observations: DemandObservationCandidate[];
  nextCursor?: string | null;
  sourceRequestCount: number;
  warnings: string[];
  rawArtifactPointers?: string[];
}

export interface DemandSourceAdapter<TConfig = unknown> {
  readonly capabilities: SourceCapabilityDescriptor;
  validateConfig(config: unknown): TConfig;
  discover(
    context: DemandSourceRunContext,
    config: TConfig,
  ): Promise<DemandSourceRunResult>;
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
