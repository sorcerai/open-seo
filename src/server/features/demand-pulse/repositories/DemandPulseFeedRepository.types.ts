import type {
  demandPulseCoverageChecks,
  demandPulseDecisions,
  demandPulseFamilies,
  demandPulseFamilyEvidence,
  demandPulseFeedItems,
  demandPulseScores,
} from "@/db/schema";

type FeedItemInsert = typeof demandPulseFeedItems.$inferInsert;
export type DemandPulseFeedItem = typeof demandPulseFeedItems.$inferSelect;
type DecisionInsert = typeof demandPulseDecisions.$inferInsert;
type DecisionSelect = typeof demandPulseDecisions.$inferSelect;
type ScoreSelect = typeof demandPulseScores.$inferSelect;
type CoverageSelect = typeof demandPulseCoverageChecks.$inferSelect;
type FamilySelect = typeof demandPulseFamilies.$inferSelect;
type FamilyEvidenceSelect = typeof demandPulseFamilyEvidence.$inferSelect;

export type DemandPulseFeedScope = Pick<
  FeedItemInsert,
  "profileId" | "projectId" | "runId" | "evidenceVersion"
>;
export type DemandPulseFeedSelectionScope = DemandPulseFeedScope &
  Pick<FeedItemInsert, "selectionVersion">;
export type DemandPulseFeedItemInput = Pick<
  FeedItemInsert,
  | "id"
  | "projectId"
  | "profileId"
  | "runId"
  | "familyId"
  | "coverageCheckId"
  | "scoreId"
  | "selectionVersion"
  | "evidenceVersion"
  | "rank"
  | "title"
  | "recommendedAction"
  | "provenance"
  | "reason"
>;
export type DemandPulseDecisionRowInput = Omit<
  Pick<
    DecisionInsert,
    | "id"
    | "projectId"
    | "profileId"
    | "runId"
    | "feedItemId"
    | "familyId"
    | "kind"
    | "action"
    | "reason"
    | "reviewedBy"
    | "decidedAt"
    | "publicationTriggered"
    | "createdAt"
  >,
  "publicationTriggered"
> & { publicationTriggered?: false };
export type DemandPulseExpectedFeedLineage = Pick<
  FeedItemInsert,
  | "familyId"
  | "scoreId"
  | "coverageCheckId"
  | "evidenceVersion"
  | "selectionVersion"
>;
export type DemandPulseRecordDecisionInput = DemandPulseFeedSelectionScope & {
  feedItemId: FeedItemInsert["id"];
  row: DemandPulseDecisionRowInput;
  expectedFeed?: DemandPulseExpectedFeedLineage;
};
export type DemandPulseFeedItemDetail = {
  feedItem: DemandPulseFeedItem;
  score: ScoreSelect | null;
  coverageCheck: CoverageSelect | null;
  family: FamilySelect | null;
  familyEvidence: FamilyEvidenceSelect[];
  decisions: DecisionSelect[];
};
export type DemandPulseFeedItemDetailInput = DemandPulseFeedSelectionScope & {
  feedItemId: FeedItemInsert["id"];
};
export type DemandPulsePersistFeedItemsInput = {
  scope: DemandPulseFeedScope;
  rows: readonly DemandPulseFeedItemInput[];
};
export type DemandPulseLatestFeedInput = Pick<
  FeedItemInsert,
  "profileId" | "projectId"
> & { limit?: number };
