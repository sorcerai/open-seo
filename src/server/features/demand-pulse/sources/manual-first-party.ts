import type { DemandObservationCandidate } from "../types";

export interface FirstPartyImportRow {
  externalId: string;
  title: string;
  excerpt?: string | null;
  occurredAt: string;
  sourcePlatform?: string;
  canonicalUrl?: string | null;
  locale?: string | null;
  geography?: string | null;
  metadata?: Record<string, unknown>;
}

export function normalizeFirstPartyImport(
  projectId: string,
  sourceConnectionId: string,
  collectedAt: string,
  rows: readonly FirstPartyImportRow[],
): DemandObservationCandidate[] {
  const seen = new Set<string>();
  const observations: DemandObservationCandidate[] = [];

  for (const row of rows) {
    const externalId = row.externalId.trim();
    const title = row.title.trim();
    if (!externalId || !title || seen.has(externalId)) continue;
    if (!Number.isFinite(Date.parse(row.occurredAt))) continue;
    seen.add(externalId);

    observations.push({
      projectId,
      sourceConnectionId,
      sourceClass: "first_party_observed",
      sourcePlatform: row.sourcePlatform?.trim() || "manual_first_party",
      externalId,
      canonicalUrl:
        row.canonicalUrl?.trim() || `urn:openseo:first-party:${externalId}`,
      title,
      excerpt: row.excerpt?.trim().slice(0, 2_000) || null,
      publishedAt: new Date(row.occurredAt).toISOString(),
      collectedAt,
      locale: row.locale ?? null,
      geography: row.geography ?? null,
      metadata: row.metadata,
      retentionProfile: "first-party-controlled-v1",
    });
  }

  return observations;
}
