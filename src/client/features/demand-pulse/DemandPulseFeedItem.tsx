import {
  AlertCircle,
  Check,
  ChevronDown,
  Info,
  Loader2,
  X,
} from "lucide-react";
import {
  DetailGrid,
  DetailState,
  MetaField,
  ReviewBadge,
} from "./DemandPulseFeedItemDetails";
import { formatLabel, reviewStateFromDecision } from "./demandPulseDisplay";
export type DemandPulseReviewKind = "accept" | "reject";
export type DemandPulseCanaryAction =
  | "update_existing_page"
  | "create_supporting_page"
  | "add_faq"
  | "create_comparison"
  | "create_tool"
  | "create_troubleshooter"
  | "update_product_or_offer"
  | "create_sales_enablement"
  | "create_support_article"
  | "monitor_only";
export type DemandPulseFeedItemRecord = {
  id: string;
  projectId: string;
  profileId?: string;
  runId: string;
  familyId: string;
  coverageCheckId: string;
  scoreId: string;
  selectionVersion: string;
  evidenceVersion: string;
  rank: number;
  title: string;
  recommendedAction: DemandPulseCanaryAction;
  provenance: string;
  reason: string;
  createdAt?: string;
};
export type DemandPulseReviewState = {
  kind: DemandPulseReviewKind;
  reason: string;
  decidedAt?: string;
};
export type DemandPulseFeedItemDetail = {
  feedItem: DemandPulseFeedItemRecord;
  score: unknown;
  coverageCheck: unknown;
  family: unknown;
  familyEvidence: readonly unknown[];
  decisions: readonly unknown[];
};
type DemandPulseFeedItemProps = {
  item: DemandPulseFeedItemRecord;
  expanded: boolean;
  detail?: DemandPulseFeedItemDetail | null;
  detailLoading: boolean;
  detailError?: string;
  review?: DemandPulseReviewState;
  reason: string;
  isSaving: boolean;
  decisionError?: string;
  onToggle: (itemId: string) => void;
  onReasonChange: (reason: string) => void;
  onDecision: (kind: DemandPulseReviewKind) => void;
};

export function DemandPulseFeedItem({
  item,
  expanded,
  detail,
  detailLoading,
  detailError,
  review: localReview,
  reason,
  isSaving,
  decisionError,
  onToggle,
  onReasonChange,
  onDecision,
}: DemandPulseFeedItemProps) {
  const persistedDecision = detail?.decisions.at(-1);
  const review = localReview ?? reviewStateFromDecision(persistedDecision);

  return (
    <article className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {item.rank}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words text-base font-semibold leading-6 sm:text-lg">
                  {item.title}
                </h3>
                <p className="mt-1 max-h-24 overflow-y-auto break-words whitespace-pre-wrap text-sm leading-6 text-base-content/70">
                  {item.reason}
                </p>
              </div>
              <span className="badge badge-outline shrink-0 self-start text-xs">
                {formatLabel(item.recommendedAction)}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <MetaField
                label="Provenance"
                value={formatLabel(item.provenance)}
              />
              <MetaField label="Source evidence" value="Open details" />
              <MetaField label="Coverage / score" value="Open details" />
              <MetaField label="Lineage" value={item.scoreId} mono />
            </dl>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                <span>Family {item.familyId}</span>
                <span aria-hidden="true">·</span>
                <span>Evidence {item.evidenceVersion}</span>
                {review ? <ReviewBadge kind={review.kind} /> : null}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline w-full gap-2 sm:w-auto"
                aria-expanded={expanded}
                aria-controls={`demand-pulse-detail-${item.id}`}
                onClick={() => onToggle(item.id)}
              >
                {expanded ? "Hide details" : "Review item"}
                <ChevronDown
                  className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div
          id={`demand-pulse-detail-${item.id}`}
          className="border-t border-base-300 bg-base-200/50 p-4 sm:p-5"
        >
          {detailLoading ? (
            <div
              className="flex items-center gap-2 py-6 text-sm text-base-content/65"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading evidence and score details…
            </div>
          ) : detailError ? (
            <DetailState
              icon={<AlertCircle className="size-5" aria-hidden="true" />}
              title="Details could not be loaded"
              message={detailError}
              tone="error"
            />
          ) : !detail ? (
            <DetailState
              icon={<Info className="size-5" aria-hidden="true" />}
              title="Feed item not found"
              message="This item is no longer available in the selected feed run. No review was recorded."
              tone="neutral"
            />
          ) : (
            <div className="space-y-5">
              <DetailGrid detail={detail} item={item} />
              <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                <div className="mb-3">
                  <h4 className="font-semibold">Record a review</h4>
                  <p className="mt-1 text-sm text-base-content/65">
                    Choose accept or reject and leave a reason. This creates a
                    review record only and never publishes content.
                  </p>
                </div>
                <form
                  className="space-y-3"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <label className="form-control w-full">
                    <span className="label pb-1 text-xs font-semibold uppercase tracking-wide text-base-content/60">
                      Reason <span aria-hidden="true">*</span>
                    </span>
                    <textarea
                      className="textarea textarea-bordered min-h-24 w-full resize-y break-words"
                      value={reason}
                      maxLength={2000}
                      placeholder="Capture the evidence or decision context for the team…"
                      onChange={(event) => onReasonChange(event.target.value)}
                      disabled={isSaving}
                      required
                    />
                    <span className="label pt-1 text-xs text-base-content/50">
                      {reason.length}/2000
                    </span>
                  </label>
                  {decisionError ? (
                    <div className="alert alert-error text-sm" role="alert">
                      <AlertCircle
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{decisionError}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      className="btn btn-error btn-outline w-full gap-2 sm:w-auto"
                      disabled={isSaving || !reason.trim()}
                      onClick={() => onDecision("reject")}
                    >
                      {isSaving ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <X className="size-4" aria-hidden="true" />
                      )}
                      Reject review
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary w-full gap-2 sm:w-auto"
                      disabled={isSaving || !reason.trim()}
                      onClick={() => onDecision("accept")}
                    >
                      {isSaving ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Check className="size-4" aria-hidden="true" />
                      )}
                      Accept review
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
