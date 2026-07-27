import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Clock3, Info, ShieldCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getDemandPulseFeed,
  getDemandPulseFeedItem,
  recordDemandPulseDecision,
} from "@/serverFunctions/demand-pulse";
import {
  DemandPulseFeedItem,
  type DemandPulseFeedItemDetail,
  type DemandPulseFeedItemRecord,
  type DemandPulseReviewKind,
  type DemandPulseReviewState,
} from "./DemandPulseFeedItem";

type DemandPulseProfile = {
  id: string;
  enabled: boolean;
  dryRun: boolean;
  publicationDisabled: boolean;
};

export function DemandPulsePage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [reviewStates, setReviewStates] = useState<
    Record<string, DemandPulseReviewState>
  >({});
  const [draftReasons, setDraftReasons] = useState<Record<string, string>>({});

  const feedQuery = useQuery({
    queryKey: ["demand-pulse-feed", projectId],
    queryFn: () => getDemandPulseFeed({ data: { projectId } }),
  });
  const items = useMemo(
    () =>
      ((feedQuery.data?.items ?? []) as DemandPulseFeedItemRecord[])
        .toSorted(
          (left, right) =>
            left.rank - right.rank || left.id.localeCompare(right.id),
        )
        .slice(0, 5),
    [feedQuery.data?.items],
  );
  const profile = feedQuery.data?.profile as
    | DemandPulseProfile
    | null
    | undefined;
  const expandedItem = items.find((item) => item.id === expandedItemId);

  const detailQuery = useQuery({
    queryKey: [
      "demand-pulse-feed-item",
      projectId,
      expandedItem?.id,
      expandedItem?.runId,
      expandedItem?.evidenceVersion,
      expandedItem?.selectionVersion,
    ],
    queryFn: () => {
      if (!expandedItem)
        throw new Error("Demand Pulse item is no longer available.");
      return getDemandPulseFeedItem({
        data: {
          projectId,
          runId: expandedItem.runId,
          evidenceVersion: expandedItem.evidenceVersion,
          selectionVersion: expandedItem.selectionVersion,
          feedItemId: expandedItem.id,
        },
      });
    },
    enabled: expandedItem !== undefined,
  });
  const detail = detailQuery.data as
    | DemandPulseFeedItemDetail
    | null
    | undefined;

  const decisionMutation = useMutation({
    mutationFn: async (input: {
      item: DemandPulseFeedItemRecord;
      kind: DemandPulseReviewKind;
      reason: string;
    }) => {
      const lineage = {
        projectId,
        runId: input.item.runId,
        evidenceVersion: input.item.evidenceVersion,
        selectionVersion: input.item.selectionVersion,
        feedItemId: input.item.id,
        reason: input.reason,
      };
      if (input.kind === "accept") {
        return recordDemandPulseDecision({
          data: {
            ...lineage,
            kind: "accept",
            action: input.item.recommendedAction,
          },
        });
      }
      return recordDemandPulseDecision({
        data: {
          ...lineage,
          kind: "reject",
          action: null,
        },
      });
    },
    onSuccess: (_decision, variables) => {
      setReviewStates((current) => ({
        ...current,
        [variables.item.id]: {
          kind: variables.kind,
          reason: variables.reason,
          decidedAt: new Date().toISOString(),
        },
      }));
      setDraftReasons((current) => ({ ...current, [variables.item.id]: "" }));
      toast.success(
        variables.kind === "accept"
          ? "Acceptance review recorded"
          : "Rejection review recorded",
      );
      void queryClient.invalidateQueries({
        queryKey: ["demand-pulse-feed-item", projectId, variables.item.id],
      });
    },
  });

  const toggleItem = (itemId: string) => {
    setExpandedItemId((current) => (current === itemId ? null : itemId));
    decisionMutation.reset();
  };
  const submitDecision = (
    item: DemandPulseFeedItemRecord,
    kind: DemandPulseReviewKind,
  ) => {
    const reason = draftReasons[item.id]?.trim() ?? "";
    if (!reason || decisionMutation.isPending) return;
    decisionMutation.mutate({ item, kind, reason });
  };

  return (
    <div className="h-full overflow-auto bg-base-200 px-4 py-4 pb-safe md:px-6 md:py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">
                <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                  Internal review
                </span>
                <span>Demand Pulse</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Review demand signals
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/70">
                A bounded, rank-ordered feed of evidence-backed opportunities
                for this project. Review records only: accepting or rejecting an
                item never publishes content.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs text-base-content/65">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              <span>Dry-run, publication disabled</span>
            </div>
          </div>
          <div className="alert alert-info text-sm" role="note">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Decisions are saved as review records for the project team. No
              decision on this page publishes, edits, or schedules content.
            </span>
          </div>
        </header>

        {feedQuery.isPending ? (
          <LoadingState />
        ) : feedQuery.isError ? (
          <StateCard
            icon={<AlertCircle className="size-5" aria-hidden="true" />}
            title="Demand Pulse is unavailable"
            message={getStandardErrorMessage(
              feedQuery.error,
              "The demand feed could not be loaded.",
            )}
            tone="error"
          />
        ) : !profile ? (
          <StateCard
            icon={<Info className="size-5" aria-hidden="true" />}
            title="Demand Pulse is not configured"
            message="This project does not have a Demand Pulse profile yet. There is nothing to review."
            tone="neutral"
          />
        ) : !profile.enabled ||
          !profile.dryRun ||
          !profile.publicationDisabled ? (
          <StateCard
            icon={<ShieldCheck className="size-5" aria-hidden="true" />}
            title="Demand Pulse is disabled for this project"
            message="The review feed stays unavailable until the project profile is enabled in dry-run mode with publication disabled."
            tone="warning"
          />
        ) : items.length === 0 ? (
          <StateCard
            icon={<Clock3 className="size-5" aria-hidden="true" />}
            title="No demand signals to review"
            message="The latest bounded run did not produce any review candidates. Check back after the next run."
            tone="neutral"
          />
        ) : (
          <section
            aria-labelledby="demand-pulse-feed-heading"
            className="space-y-3"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  id="demand-pulse-feed-heading"
                  className="text-lg font-semibold"
                >
                  Latest signals
                </h2>
                <p className="text-sm text-base-content/60">
                  Showing {items.length} of at most five ranked items. Open a
                  row to inspect provenance, source evidence, coverage, score
                  inputs, and review history.
                </p>
              </div>
              <span className="text-xs font-medium text-base-content/50">
                Profile {profile.id}
              </span>
            </div>
            <div className="space-y-3">
              {items.map((item) => {
                const expanded = expandedItemId === item.id;
                const isActiveDetail =
                  expanded && detailQuery.data !== undefined;
                const decisionError =
                  expanded && decisionMutation.isError
                    ? getStandardErrorMessage(
                        decisionMutation.error,
                        "The review record could not be saved.",
                      )
                    : undefined;
                return (
                  <DemandPulseFeedItem
                    key={item.id}
                    item={item}
                    expanded={expanded}
                    detail={isActiveDetail ? detail : undefined}
                    detailLoading={expanded && detailQuery.isPending}
                    detailError={
                      expanded && detailQuery.isError
                        ? getStandardErrorMessage(
                            detailQuery.error,
                            "The evidence detail request failed.",
                          )
                        : undefined
                    }
                    review={reviewStates[item.id]}
                    reason={draftReasons[item.id] ?? ""}
                    isSaving={decisionMutation.isPending}
                    decisionError={decisionError}
                    onToggle={toggleItem}
                    onReasonChange={(reason) =>
                      setDraftReasons((current) => ({
                        ...current,
                        [item.id]: reason,
                      }))
                    }
                    onDecision={(kind) => submitDecision(item, kind)}
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-label="Loading Demand Pulse feed"
    >
      <div className="h-20 animate-pulse rounded-xl border border-base-300 bg-base-100" />
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-xl border border-base-300 bg-base-100"
        />
      ))}
    </div>
  );
}

function StateCard({
  icon,
  title,
  message,
  tone,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  tone: "error" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "error"
      ? "border-error/50 bg-error/5"
      : tone === "warning"
        ? "border-warning/60 bg-warning/10"
        : "border-base-300 bg-base-100";
  return (
    <div className={`rounded-xl border p-6 sm:p-8 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-base-content/65">{icon}</span>
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 break-words text-sm leading-6 text-base-content/70">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
