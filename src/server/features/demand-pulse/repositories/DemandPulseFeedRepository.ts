import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { demandPulseDecisions, demandPulseFeedItems } from "@/db/schema";

type FeedItemSelect = typeof demandPulseFeedItems.$inferSelect;
export type DemandPulseFeedItem = FeedItemSelect;
type DecisionSelect = typeof demandPulseDecisions.$inferSelect;

import {
  getFeedItemDetail,
  listFeedForRun,
  listLatestFeed,
} from "./DemandPulseFeedRepository.read";
import type {
  DemandPulseDecisionRowInput,
  DemandPulseExpectedFeedLineage,
  DemandPulseFeedItemInput,
  DemandPulseFeedScope,
  DemandPulseFeedSelectionScope,
  DemandPulsePersistFeedItemsInput,
  DemandPulseRecordDecisionInput,
} from "./DemandPulseFeedRepository.types";
export type {
  DemandPulseDecisionRowInput,
  DemandPulseExpectedFeedLineage,
  DemandPulseFeedItemDetail,
  DemandPulseFeedItemDetailInput,
  DemandPulseFeedItemInput,
  DemandPulseFeedScope,
  DemandPulseFeedSelectionScope,
  DemandPulseLatestFeedInput,
  DemandPulsePersistFeedItemsInput,
  DemandPulseRecordDecisionInput,
} from "./DemandPulseFeedRepository.types";

const FEED_MAX_ITEMS = 5;
const feedPayloadFields = [
  "id",
  "projectId",
  "profileId",
  "runId",
  "familyId",
  "coverageCheckId",
  "scoreId",
  "selectionVersion",
  "evidenceVersion",
  "rank",
  "title",
  "recommendedAction",
  "provenance",
  "reason",
] as const satisfies readonly (keyof DemandPulseFeedItemInput)[];
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

function validateScope(scope: DemandPulseFeedScope): void {
  for (const key of scopeKeys) assertNonEmpty(scope[key], key);
}

function validateSelectionScope(scope: DemandPulseFeedSelectionScope): void {
  validateScope(scope);
  assertNonEmpty(scope.selectionVersion, "selectionVersion");
}

function validateRows(
  scope: DemandPulseFeedScope,
  rows: readonly DemandPulseFeedItemInput[],
): string | undefined {
  if (rows.length > FEED_MAX_ITEMS)
    throw new Error(
      "Demand pulse feed selection may contain at most five items",
    );
  const ranks = new Set<number>();
  const families = new Set<string>();
  let selectionVersion: string | undefined;
  for (const row of rows) {
    for (const key of ["id", "familyId", "coverageCheckId", "scoreId"] as const)
      assertNonEmpty(row[key], key);
    for (const key of scopeKeys) {
      assertNonEmpty(row[key], key);
      if (row[key] !== scope[key])
        throw new Error(`Demand pulse feed ${key} scope mismatch`);
    }
    assertNonEmpty(row.selectionVersion, "selectionVersion");
    if (selectionVersion === undefined) selectionVersion = row.selectionVersion;
    else if (selectionVersion !== row.selectionVersion)
      throw new Error("Demand pulse feed selectionVersion scope mismatch");
    if (
      !Number.isInteger(row.rank) ||
      row.rank < 1 ||
      row.rank > FEED_MAX_ITEMS
    )
      throw new Error(
        "Demand pulse feed rank must be an integer from 1 through 5",
      );
    if (ranks.has(row.rank))
      throw new Error("Demand pulse feed ranks must be unique");
    ranks.add(row.rank);
    if (families.has(row.familyId))
      throw new Error("Demand pulse feed family ids must be unique");
    families.add(row.familyId);
  }
  return selectionVersion;
}

function samePayload(
  stored: FeedItemSelect,
  input: DemandPulseFeedItemInput,
): boolean {
  return feedPayloadFields.every((field) => stored[field] === input[field]);
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

function validateExistingSelection(
  existing: readonly FeedItemSelect[],
  rows: readonly DemandPulseFeedItemInput[],
): void {
  if (existing.length > rows.length)
    throw new Error("Demand pulse feed selection payload conflict");
  const inputByFamily = new Map(rows.map((row) => [row.familyId, row]));
  for (const stored of existing) {
    const input = inputByFamily.get(stored.familyId);
    if (!input || !samePayload(stored, input))
      throw new Error("Demand pulse feed selection payload conflict");
  }
}

async function persistFeedItems(
  input: DemandPulsePersistFeedItemsInput,
): Promise<FeedItemSelect[]> {
  validateScope(input.scope);
  const selectionVersion = validateRows(input.scope, input.rows);
  if (input.rows.length === 0) return [];
  if (!selectionVersion)
    throw new Error("Demand pulse selectionVersion must be non-empty");
  const selectionScope = { ...input.scope, selectionVersion };
  const existing = await db
    .select()
    .from(demandPulseFeedItems)
    .where(feedSelectionWhere(selectionScope));
  validateExistingSelection(existing, input.rows);
  const existingByFamily = new Map(existing.map((row) => [row.familyId, row]));
  const pending = input.rows.filter(
    (row) => !existingByFamily.has(row.familyId),
  );
  if (pending.length === 0) return sortFeedRows(existing);

  const inserted = await db
    .insert(demandPulseFeedItems)
    .values(pending)
    .onConflictDoNothing({
      target: [
        demandPulseFeedItems.profileId,
        demandPulseFeedItems.runId,
        demandPulseFeedItems.familyId,
        demandPulseFeedItems.evidenceVersion,
        demandPulseFeedItems.selectionVersion,
      ],
    })
    .returning();
  const merged = [...existing, ...inserted];
  if (merged.length === input.rows.length) {
    const byFamily = new Map(merged.map((row) => [row.familyId, row]));
    if (
      input.rows.every(
        (row) =>
          byFamily.get(row.familyId) &&
          samePayload(byFamily.get(row.familyId)!, row),
      )
    )
      return sortFeedRows(merged);
  }
  const persisted = await db
    .select()
    .from(demandPulseFeedItems)
    .where(feedSelectionWhere(selectionScope));
  validateExistingSelection(persisted, input.rows);
  if (persisted.length !== input.rows.length)
    throw new Error("Demand pulse feed selection payload conflict");
  return sortFeedRows(persisted);
}

function validateDecisionInput(input: DemandPulseRecordDecisionInput): void {
  validateSelectionScope(input);
  assertNonEmpty(input.feedItemId, "feedItemId");
  for (const key of [
    "id",
    "profileId",
    "projectId",
    "runId",
    "feedItemId",
    "familyId",
    "reason",
    "reviewedBy",
  ] as const)
    assertNonEmpty(input.row[key], key);
  if (
    input.row.profileId !== input.profileId ||
    input.row.projectId !== input.projectId ||
    input.row.runId !== input.runId ||
    input.row.feedItemId !== input.feedItemId
  )
    throw new Error("Demand pulse decision scope mismatch");
  if (!input.expectedFeed) return;
  for (const key of [
    "familyId",
    "scoreId",
    "coverageCheckId",
    "evidenceVersion",
    "selectionVersion",
  ] as const)
    assertNonEmpty(input.expectedFeed[key], key);
  if (
    input.row.familyId !== input.expectedFeed.familyId ||
    input.expectedFeed.evidenceVersion !== input.evidenceVersion ||
    input.expectedFeed.selectionVersion !== input.selectionVersion
  )
    throw new Error("Demand pulse expected feed lineage mismatch");
}

async function recordDecision(
  input: DemandPulseRecordDecisionInput,
): Promise<DecisionSelect> {
  validateDecisionInput(input);
  const [feedItem] = await db
    .select({
      id: demandPulseFeedItems.id,
      familyId: demandPulseFeedItems.familyId,
      scoreId: demandPulseFeedItems.scoreId,
      coverageCheckId: demandPulseFeedItems.coverageCheckId,
      evidenceVersion: demandPulseFeedItems.evidenceVersion,
      selectionVersion: demandPulseFeedItems.selectionVersion,
    })
    .from(demandPulseFeedItems)
    .where(
      and(
        feedSelectionWhere(input),
        eq(demandPulseFeedItems.id, input.feedItemId),
      ),
    )
    .limit(1);
  if (!feedItem || feedItem.familyId !== input.row.familyId)
    throw new Error("Demand pulse feed decision lineage mismatch");
  if (
    input.expectedFeed &&
    (feedItem.familyId !== input.expectedFeed.familyId ||
      feedItem.scoreId !== input.expectedFeed.scoreId ||
      feedItem.coverageCheckId !== input.expectedFeed.coverageCheckId ||
      feedItem.evidenceVersion !== input.expectedFeed.evidenceVersion ||
      feedItem.selectionVersion !== input.expectedFeed.selectionVersion)
  )
    throw new Error("Demand pulse expected feed lineage mismatch");
  const [row] = await db
    .insert(demandPulseDecisions)
    .values({
      ...input.row,
      profileId: input.profileId,
      projectId: input.projectId,
      runId: input.runId,
      feedItemId: feedItem.id,
      familyId: feedItem.familyId,
      publicationTriggered: false,
    })
    .returning();
  if (!row) throw new Error("Failed to record demand pulse decision");
  return row;
}

export const DemandPulseFeedRepository = {
  persistFeedItems,
  listLatestFeed,
  listFeedForRun,
  getFeedItemDetail,
  recordDecision,
} as const;
