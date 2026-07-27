import { z } from "zod";
import type { DemandObservationCandidate } from "../types";
import {
  buildRunHealth,
  demandHttpsUrl,
  emptyFailureResult,
  evaluateSourceGate,
  type DemandSourceAdapter,
  type DemandSourceRunContext,
  type DemandSourceRunResult,
} from "./adapter";

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

// ---------------------------------------------------------------------------
// Strict redacted first-party input.
//
// Operator-submitted first-party demand must carry an accountable owner, a
// retention basis, a retention class, a positive PII-redaction attestation
// (piiRedacted === true), and an explicit representation (verbatim|summary).
// Both schemas are STRICT: unknown fields are rejected (not silently stripped)
// so potentially identifying fields can never sneak through. Anything failing
// this schema is rejected before any observation is produced.
// ---------------------------------------------------------------------------

export const MANUAL_FIRST_PARTY_RETENTION_CLASSES = [
  "first-party-controlled-v1",
] as const;
export type ManualFirstPartyRetentionClass =
  (typeof MANUAL_FIRST_PARTY_RETENTION_CLASSES)[number];

export const MANUAL_FIRST_PARTY_REPRESENTATIONS = [
  "verbatim",
  "summary",
] as const;
export type ManualFirstPartyRepresentation =
  (typeof MANUAL_FIRST_PARTY_REPRESENTATIONS)[number];

const firstPartyRowSchema = z.strictObject({
  externalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().max(2_000).optional(),
  occurredAt: z
    .string()
    .refine(
      (v) => Number.isFinite(Date.parse(v)),
      "occurredAt must be ISO-8601",
    ),
  canonicalUrl: demandHttpsUrl().optional(),
  sourcePlatform: z.string().trim().min(1).max(100).optional(),
  locale: z.string().trim().min(1).max(20).optional(),
  geography: z.string().trim().min(1).max(100).optional(),
});

export const manualFirstPartyInputSchema = z.strictObject({
  owner: z.string().trim().min(1).max(200),
  basis: z.string().trim().min(1).max(200),
  retentionClass: z.enum(MANUAL_FIRST_PARTY_RETENTION_CLASSES),
  piiRedacted: z.literal(true),
  representation: z.enum(MANUAL_FIRST_PARTY_REPRESENTATIONS),
  rows: z.array(firstPartyRowSchema).max(500),
});

export type ManualFirstPartyInput = z.infer<typeof manualFirstPartyInputSchema>;

/** Validate strict redacted first-party input; throws ZodError on rejection. */
export function validateManualFirstPartyInput(
  input: unknown,
): ManualFirstPartyInput {
  return manualFirstPartyInputSchema.parse(input);
}

/**
 * Normalize validated first-party input into observations, stamping the owner,
 * basis, and representation onto every observation's metadata so the chain of
 * custody is auditable. Rows are deduplicated through the shared normalizer.
 */
export function normalizeValidatedFirstPartyInput(
  projectId: string,
  sourceConnectionId: string,
  collectedAt: string,
  input: ManualFirstPartyInput,
): DemandObservationCandidate[] {
  const rows: FirstPartyImportRow[] = input.rows.map((row) => ({
    externalId: row.externalId,
    title: row.title,
    excerpt: row.excerpt ?? null,
    occurredAt: row.occurredAt,
    canonicalUrl: row.canonicalUrl ?? null,
    sourcePlatform: row.sourcePlatform,
    locale: row.locale ?? null,
    geography: row.geography ?? null,
  }));

  const observations = normalizeFirstPartyImport(
    projectId,
    sourceConnectionId,
    collectedAt,
    rows,
  );

  for (const observation of observations) {
    observation.metadata = {
      owner: input.owner,
      basis: input.basis,
      representation: input.representation,
      piiRedactedAttested: true,
    };
    observation.retentionProfile = input.retentionClass;
  }

  return observations;
}

export interface ManualFirstPartySourceConfig {
  /** Unvalidated operator payload; validated inside discover via Zod. */
  input: unknown;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Coerce an unvalidated stored config into the adapter's config shape. The
 * payload itself is validated by Zod inside discover. */
function readManualFirstPartyConfig(
  config: unknown,
): ManualFirstPartySourceConfig {
  if (config !== null && typeof config === "object" && "input" in config) {
    return { input: config.input };
  }
  return { input: config };
}

async function discover(
  context: DemandSourceRunContext,
  config: ManualFirstPartySourceConfig,
): Promise<DemandSourceRunResult> {
  // Uniform approval gate. The defining gate for first-party data is the strict
  // redaction/ownership validation below, but an unapproved source connection
  // still fails before any observation is emitted.
  const gate = evaluateSourceGate(context.source);
  const policyState = gate.policyState;
  if (!gate.allowed) {
    return emptyFailureResult(
      buildRunHealth({
        status: "blocked",
        policyState,
        requestCount: 0,
        error: gate.reason,
      }),
    );
  }

  const parsed = manualFirstPartyInputSchema.safeParse(config.input);
  if (!parsed.success) {
    // Invalid, unredacted, or unknown-bearing input is rejected explicitly —
    // never normalized into empty success.
    const error = `manual first-party input rejected: ${formatZodError(parsed.error)}`;
    return emptyFailureResult(
      buildRunHealth({
        status: "failed",
        policyState,
        requestCount: 0,
        error,
      }),
    );
  }

  const observations = normalizeValidatedFirstPartyInput(
    context.projectId,
    context.sourceConnectionId,
    context.collectedAt,
    parsed.data,
  );

  context.log?.("demand_pulse.source_complete", {
    source: "manual_first_party",
    observations: observations.length,
    sourceRequestCount: 0,
    warnings: 0,
  });

  return {
    observations,
    sourceRequestCount: 0,
    warnings: [],
    nextCursor: context.collectedAt,
    health: buildRunHealth({
      status: "healthy",
      policyState,
      requestCount: 0,
      costMicros: 0,
      cursor: context.collectedAt,
      metrics: {
        rows: parsed.data.rows.length,
        owner: parsed.data.owner,
        representation: parsed.data.representation,
      },
    }),
  };
}

export const manualFirstPartyDemandSource: DemandSourceAdapter<ManualFirstPartySourceConfig> =
  {
    capabilities: {
      sourcePlatform: "manual_first_party",
      supportsBackfill: false,
      supportsIncrementalCursor: false,
      supportsDeletionSync: false,
      supportsEngagementSnapshots: false,
      supportsFullText: true,
      requiresAuthentication: false,
      requiresCommercialApproval: false,
      defaultRawRetentionDays: 30,
      notes: [
        "Operator-submitted first-party demand. Input is strict-Zod-validated and requires owner, basis, retention class, piiRedacted=true, and verbatim|summary representation.",
        "Unknown fields are rejected (not stripped). Unredacted or unattributed input is rejected before any observation is produced.",
        "No network fetch; costMicros is always 0. Manual is a free adapter and ignores the paid reservation seam.",
      ],
    },
    validateConfig: readManualFirstPartyConfig,
    discover,
  };
