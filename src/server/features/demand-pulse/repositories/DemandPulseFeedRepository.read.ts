import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import {
  demandPulseCoverageChecks,
  demandPulseDecisions,
  demandPulseFamilies,
  demandPulseFamilyEvidence,
  demandPulseFeedItems,
  demandPulseProfiles,
  demandPulseRuns,
  demandPulseScores,
} from "@/db/schema";
import type {
  DemandPulseFeedItemDetail,
  DemandPulseFeedItemDetailInput,
  DemandPulseFeedSelectionScope,
  DemandPulseLatestFeedInput,
} from "./DemandPulseFeedRepository.types";

type FeedItemSelect = typeof demandPulseFeedItems.$inferSelect;

const FEED_MAX_ITEMS = 5;
const feedColumns = getTableColumns(demandPulseFeedItems);
const scopeKeys = [
  "profileId",
  "projectId",
  "runId",
  "evidenceVersion",
] as const;

function assertNonEmpty(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Demand pulse ${label} must be non-empty`);
}

function validateScope(scope: DemandPulseFeedSelectionScope): void {
  for (const key of scopeKeys) assertNonEmpty(scope[key], key);
}

function validateSelectionScope(scope: DemandPulseFeedSelectionScope): void {
  validateScope(scope);
  assertNonEmpty(scope.selectionVersion, "selectionVersion");
}

function sortFeedRows(rows: readonly FeedItemSelect[]): FeedItemSelect[] {
  return rows.toSorted(
    (left, right) => left.rank - right.rank || left.id.localeCompare(right.id),
  );
}

function feedSelectionWhere(scope: DemandPulseFeedSelectionScope) {
  return and(
    eq(demandPulseFeedItems.profileId, scope.profileId),
    eq(demandPulseFeedItems.projectId, scope.projectId),
    eq(demandPulseFeedItems.runId, scope.runId),
    eq(demandPulseFeedItems.evidenceVersion, scope.evidenceVersion),
    eq(demandPulseFeedItems.selectionVersion, scope.selectionVersion),
  );
}

export async function listLatestFeed(
  input: DemandPulseLatestFeedInput,
): Promise<FeedItemSelect[]> {
  assertNonEmpty(input.profileId, "profileId");
  assertNonEmpty(input.projectId, "projectId");
  const limit =
    input.limit === undefined
      ? FEED_MAX_ITEMS
      : Math.min(FEED_MAX_ITEMS, Math.max(0, Math.floor(input.limit)));
  if (limit === 0) return [];
  const latestScope = and(
    eq(demandPulseFeedItems.profileId, input.profileId),
    eq(demandPulseFeedItems.projectId, input.projectId),
    eq(demandPulseRuns.profileId, input.profileId),
    eq(demandPulseProfiles.id, input.profileId),
    eq(demandPulseProfiles.projectId, input.projectId),
  );
  const [latest] = await db
    .select({
      runId: demandPulseFeedItems.runId,
      selectionVersion: demandPulseFeedItems.selectionVersion,
      evidenceVersion: demandPulseFeedItems.evidenceVersion,
    })
    .from(demandPulseFeedItems)
    .innerJoin(
      demandPulseRuns,
      and(
        eq(demandPulseFeedItems.runId, demandPulseRuns.id),
        eq(demandPulseFeedItems.profileId, demandPulseRuns.profileId),
      ),
    )
    .innerJoin(
      demandPulseProfiles,
      and(
        eq(demandPulseFeedItems.profileId, demandPulseProfiles.id),
        eq(demandPulseFeedItems.projectId, demandPulseProfiles.projectId),
      ),
    )
    .where(latestScope)
    .orderBy(
      desc(demandPulseRuns.localDate),
      desc(demandPulseRuns.startedAt),
      desc(demandPulseRuns.id),
      desc(demandPulseFeedItems.createdAt),
      desc(demandPulseFeedItems.selectionVersion),
      desc(demandPulseFeedItems.evidenceVersion),
      desc(demandPulseFeedItems.id),
    )
    .limit(1);
  if (!latest) return [];
  const rows = await db
    .select(feedColumns)
    .from(demandPulseFeedItems)
    .where(
      and(
        eq(demandPulseFeedItems.profileId, input.profileId),
        eq(demandPulseFeedItems.projectId, input.projectId),
        eq(demandPulseFeedItems.runId, latest.runId),
        eq(demandPulseFeedItems.evidenceVersion, latest.evidenceVersion),
        eq(demandPulseFeedItems.selectionVersion, latest.selectionVersion),
      ),
    )
    .orderBy(asc(demandPulseFeedItems.rank), asc(demandPulseFeedItems.id))
    .limit(limit);
  return sortFeedRows(rows);
}

export async function listFeedForRun(
  scope: DemandPulseFeedSelectionScope,
): Promise<FeedItemSelect[]> {
  validateSelectionScope(scope);
  const rows = await db
    .select()
    .from(demandPulseFeedItems)
    .where(feedSelectionWhere(scope))
    .orderBy(asc(demandPulseFeedItems.rank), asc(demandPulseFeedItems.id));
  return sortFeedRows(rows);
}

export async function getFeedItemDetail(
  input: DemandPulseFeedItemDetailInput,
): Promise<DemandPulseFeedItemDetail | null> {
  validateSelectionScope(input);
  assertNonEmpty(input.feedItemId, "feedItemId");
  const [feedItem] = await db
    .select()
    .from(demandPulseFeedItems)
    .where(
      and(
        feedSelectionWhere(input),
        eq(demandPulseFeedItems.id, input.feedItemId),
      ),
    )
    .limit(1);
  if (!feedItem) return null;
  const [score] = await db
    .select()
    .from(demandPulseScores)
    .where(
      and(
        eq(demandPulseScores.id, feedItem.scoreId),
        eq(demandPulseScores.profileId, input.profileId),
        eq(demandPulseScores.projectId, input.projectId),
        eq(demandPulseScores.runId, input.runId),
        eq(demandPulseScores.familyId, feedItem.familyId),
        eq(demandPulseScores.coverageCheckId, feedItem.coverageCheckId),
        eq(demandPulseScores.evidenceVersion, input.evidenceVersion),
      ),
    )
    .limit(1);
  const [coverageCheck] = await db
    .select()
    .from(demandPulseCoverageChecks)
    .where(
      and(
        eq(demandPulseCoverageChecks.id, feedItem.coverageCheckId),
        eq(demandPulseCoverageChecks.profileId, input.profileId),
        eq(demandPulseCoverageChecks.projectId, input.projectId),
        eq(demandPulseCoverageChecks.runId, input.runId),
        eq(demandPulseCoverageChecks.familyId, feedItem.familyId),
      ),
    )
    .limit(1);
  const [family] = await db
    .select()
    .from(demandPulseFamilies)
    .where(
      and(
        eq(demandPulseFamilies.id, feedItem.familyId),
        eq(demandPulseFamilies.profileId, input.profileId),
        eq(demandPulseFamilies.projectId, input.projectId),
      ),
    )
    .limit(1);
  const familyEvidence = await db
    .select()
    .from(demandPulseFamilyEvidence)
    .where(
      and(
        eq(demandPulseFamilyEvidence.profileId, input.profileId),
        eq(demandPulseFamilyEvidence.projectId, input.projectId),
        eq(demandPulseFamilyEvidence.runId, input.runId),
        eq(demandPulseFamilyEvidence.evidenceVersion, input.evidenceVersion),
        eq(demandPulseFamilyEvidence.familyId, feedItem.familyId),
      ),
    )
    .orderBy(asc(demandPulseFamilyEvidence.id));
  const decisions = await db
    .select()
    .from(demandPulseDecisions)
    .where(
      and(
        eq(demandPulseDecisions.feedItemId, feedItem.id),
        eq(demandPulseDecisions.profileId, input.profileId),
        eq(demandPulseDecisions.projectId, input.projectId),
        eq(demandPulseDecisions.runId, input.runId),
        eq(demandPulseDecisions.familyId, feedItem.familyId),
      ),
    )
    .orderBy(asc(demandPulseDecisions.createdAt), asc(demandPulseDecisions.id));
  return {
    feedItem,
    score: score ?? null,
    coverageCheck: coverageCheck ?? null,
    family: family ?? null,
    familyEvidence,
    decisions,
  };
}
