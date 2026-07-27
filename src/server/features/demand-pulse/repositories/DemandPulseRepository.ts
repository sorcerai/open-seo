import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  demandPulseProfiles,
  demandPulseSources,
  demandPulseRuns,
  demandPulseSourceRuns,
} from "@/db/schema";

export type DemandPulseProfile = typeof demandPulseProfiles.$inferSelect;
export type DemandPulseSource = typeof demandPulseSources.$inferSelect;
export type DemandPulseRun = typeof demandPulseRuns.$inferSelect;
export type DemandPulseSourceRun = typeof demandPulseSourceRuns.$inferSelect;

export type PendingSourceInput = Pick<
  DemandPulseSource,
  | "profileId"
  | "adapter"
  | "identityKey"
  | "sourceClass"
  | "canonicalUrl"
  | "recordKey"
  | "discoveryProvenance"
>;

export type ReviewSourceInput = {
  sourceId: string;
  projectId: string;
  expectedVersion: number;
  approvalState: "approved" | "rejected";
  reviewedBy: string;
  reviewedAt: string;
};

export type DailyRunInput = {
  profileId: string;
  localDate: string;
  scoringVersion: string;
  status?: DemandPulseRun["status"];
};

export type RecordSourceRunInput = Pick<
  DemandPulseSourceRun,
  | "profileId"
  | "runId"
  | "sourceId"
  | "health"
  | "policyState"
  | "requestCount"
  | "costMicros"
  | "errorMessage"
> &
  Partial<
    Pick<
      DemandPulseSourceRun,
      "cursor" | "artifactPointer" | "startedAt" | "completedAt"
    >
  >;

export type CompleteRunInput = Omit<
  Pick<
    DemandPulseRun,
    | "profileId"
    | "status"
    | "sourceCount"
    | "healthySourceCount"
    | "failedSourceCount"
    | "blockedSourceCount"
    | "unknownSourceCount"
    | "skippedSourceCount"
    | "artifactKey"
    | "errorMessage"
    | "completedAt"
  >,
  never
> & { runId: string };

const sourceColumns = {
  id: demandPulseSources.id,
  profileId: demandPulseSources.profileId,
  adapter: demandPulseSources.adapter,
  identityKey: demandPulseSources.identityKey,
  sourceClass: demandPulseSources.sourceClass,
  canonicalUrl: demandPulseSources.canonicalUrl,
  recordKey: demandPulseSources.recordKey,
  approvalState: demandPulseSources.approvalState,
  policyState: demandPulseSources.policyState,
  enabled: demandPulseSources.enabled,
  discoveryProvenance: demandPulseSources.discoveryProvenance,
  version: demandPulseSources.version,
  reviewedBy: demandPulseSources.reviewedBy,
  reviewedAt: demandPulseSources.reviewedAt,
  createdAt: demandPulseSources.createdAt,
  updatedAt: demandPulseSources.updatedAt,
};

const runColumns = {
  id: demandPulseRuns.id,
  profileId: demandPulseRuns.profileId,
  localDate: demandPulseRuns.localDate,
  status: demandPulseRuns.status,
  costMicros: demandPulseRuns.costMicros,
  sourceCount: demandPulseRuns.sourceCount,
  healthySourceCount: demandPulseRuns.healthySourceCount,
  failedSourceCount: demandPulseRuns.failedSourceCount,
  blockedSourceCount: demandPulseRuns.blockedSourceCount,
  unknownSourceCount: demandPulseRuns.unknownSourceCount,
  skippedSourceCount: demandPulseRuns.skippedSourceCount,
  artifactKey: demandPulseRuns.artifactKey,
  scoringVersion: demandPulseRuns.scoringVersion,
  startedAt: demandPulseRuns.startedAt,
  completedAt: demandPulseRuns.completedAt,
  errorMessage: demandPulseRuns.errorMessage,
};

async function getProfileByProjectId(
  projectId: string,
): Promise<DemandPulseProfile | null> {
  const [row] = await db
    .select()
    .from(demandPulseProfiles)
    .where(eq(demandPulseProfiles.projectId, projectId))
    .limit(1);
  return row ?? null;
}

async function listSourcesByProject(
  projectId: string,
): Promise<DemandPulseSource[]> {
  const rows = await db
    .select(sourceColumns)
    .from(demandPulseSources)
    .innerJoin(
      demandPulseProfiles,
      eq(demandPulseSources.profileId, demandPulseProfiles.id),
    )
    .where(eq(demandPulseProfiles.projectId, projectId));
  return rows;
}

async function upsertPendingSource(
  input: PendingSourceInput,
): Promise<DemandPulseSource> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(demandPulseSources)
    .values({
      id: crypto.randomUUID(),
      ...input,
      policyState: "unknown",
      approvalState: "pending",
      enabled: false,
      version: 1,
    })
    .onConflictDoUpdate({
      target: [
        demandPulseSources.profileId,
        demandPulseSources.adapter,
        demandPulseSources.identityKey,
      ],
      set: {
        sourceClass: input.sourceClass,
        canonicalUrl: input.canonicalUrl,
        recordKey: input.recordKey,
        discoveryProvenance: input.discoveryProvenance,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to upsert demand pulse source");
  }
  return row;
}

async function reviewSource(
  input: ReviewSourceInput,
): Promise<DemandPulseSource | null> {
  const [scopedSource] = await db
    .select({ profileId: demandPulseSources.profileId })
    .from(demandPulseSources)
    .innerJoin(
      demandPulseProfiles,
      eq(demandPulseSources.profileId, demandPulseProfiles.id),
    )
    .where(
      and(
        eq(demandPulseSources.id, input.sourceId),
        eq(demandPulseProfiles.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!scopedSource) {
    return null;
  }

  const now = new Date().toISOString();
  const [row] = await db
    .update(demandPulseSources)
    .set({
      approvalState: input.approvalState,
      enabled: input.approvalState === "approved",
      policyState: input.approvalState === "approved" ? "allowed" : "blocked",
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      version: sql`${demandPulseSources.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(demandPulseSources.id, input.sourceId),
        eq(demandPulseSources.profileId, scopedSource.profileId),
        eq(demandPulseSources.version, input.expectedVersion),
      ),
    )
    .returning();

  return row ?? null;
}

async function claimDailyRun(
  input: DailyRunInput,
): Promise<{ run: DemandPulseRun; claimed: boolean }> {
  const [inserted] = await db
    .insert(demandPulseRuns)
    .values({
      id: crypto.randomUUID(),
      profileId: input.profileId,
      localDate: input.localDate,
      scoringVersion: input.scoringVersion,
      status: input.status ?? "pending",
    })
    .onConflictDoNothing({
      target: [demandPulseRuns.profileId, demandPulseRuns.localDate],
    })
    .returning();

  if (inserted) {
    return { run: inserted, claimed: true };
  }

  const [existing] = await db
    .select()
    .from(demandPulseRuns)
    .where(
      and(
        eq(demandPulseRuns.profileId, input.profileId),
        eq(demandPulseRuns.localDate, input.localDate),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("Demand pulse daily run conflict row missing");
  }
  return { run: existing, claimed: false };
}

async function recordSourceRun(
  input: RecordSourceRunInput,
): Promise<DemandPulseSourceRun> {
  const [existing] = await db
    .select({ profileId: demandPulseSourceRuns.profileId })
    .from(demandPulseSourceRuns)
    .where(
      and(
        eq(demandPulseSourceRuns.runId, input.runId),
        eq(demandPulseSourceRuns.sourceId, input.sourceId),
      ),
    )
    .limit(1);

  if (existing && existing.profileId !== input.profileId) {
    throw new Error("Demand pulse source run profile mismatch");
  }
  const now = new Date().toISOString();
  const values = {
    id: crypto.randomUUID(),
    profileId: input.profileId,
    runId: input.runId,
    sourceId: input.sourceId,
    health: input.health,
    policyState: input.policyState,
    requestCount: input.requestCount,
    costMicros: input.costMicros,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.artifactPointer !== undefined
      ? { artifactPointer: input.artifactPointer }
      : {}),
    errorMessage: input.errorMessage,
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt }
      : {}),
  };
  const update = {
    health: input.health,
    policyState: input.policyState,
    requestCount: input.requestCount,
    costMicros: input.costMicros,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.artifactPointer !== undefined
      ? { artifactPointer: input.artifactPointer }
      : {}),
    errorMessage: input.errorMessage,
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt }
      : {}),
    updatedAt: now,
  };

  const [row] = await db
    .insert(demandPulseSourceRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [demandPulseSourceRuns.runId, demandPulseSourceRuns.sourceId],
      set: update,
      setWhere: eq(demandPulseSourceRuns.profileId, input.profileId),
    })
    .returning();

  if (!row) {
    throw new Error("Demand pulse source run profile mismatch");
  }
  return row;
}

async function completeRun(
  input: CompleteRunInput,
): Promise<DemandPulseRun | null> {
  const [row] = await db
    .update(demandPulseRuns)
    .set({
      status: input.status,
      sourceCount: input.sourceCount,
      healthySourceCount: input.healthySourceCount,
      failedSourceCount: input.failedSourceCount,
      blockedSourceCount: input.blockedSourceCount,
      unknownSourceCount: input.unknownSourceCount,
      skippedSourceCount: input.skippedSourceCount,
      artifactKey: input.artifactKey,
      errorMessage: input.errorMessage,
      completedAt: input.completedAt,
    })
    .where(
      and(
        eq(demandPulseRuns.id, input.runId),
        eq(demandPulseRuns.profileId, input.profileId),
      ),
    )
    .returning();

  return row ?? null;
}

async function getRunByIdForProject(
  runId: string,
  projectId: string,
): Promise<DemandPulseRun | null> {
  const [row] = await db
    .select(runColumns)
    .from(demandPulseRuns)
    .innerJoin(
      demandPulseProfiles,
      eq(demandPulseRuns.profileId, demandPulseProfiles.id),
    )
    .where(
      and(
        eq(demandPulseRuns.id, runId),
        eq(demandPulseProfiles.projectId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const DemandPulseRepository = {
  getProfileByProjectId,
  listSourcesByProject,
  upsertPendingSource,
  reviewSource,
  claimDailyRun,
  recordSourceRun,
  completeRun,
  getRunByIdForProject,
} as const;
