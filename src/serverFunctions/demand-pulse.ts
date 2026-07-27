import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { AppError } from "@/server/lib/errors";
import { getDemandPulseFeatureFlags } from "@/server/features/demand-pulse/feature-flags";
import {
  getFeedItemDetail,
  getLatestFeed,
  recordDecision,
} from "@/server/features/demand-pulse/services/DemandPulseService";
import {
  demandPulseDecisionInputSchema,
  demandPulseFeedItemRequestSchema,
  demandPulseFeedRequestSchema,
} from "@/types/schemas/demand-pulse";
import { requireProjectContext } from "./middleware";

function readStringBinding(key: string): string | undefined {
  const value: unknown = Reflect.get(env, key);
  return typeof value === "string" ? value : undefined;
}

function demandPulseFlagEnv() {
  return {
    DEMAND_PULSE_ENABLED: readStringBinding("DEMAND_PULSE_ENABLED"),
    DEMAND_PULSE_WRITE_ENABLED: readStringBinding("DEMAND_PULSE_WRITE_ENABLED"),
    DEMAND_PULSE_DRY_RUN: readStringBinding("DEMAND_PULSE_DRY_RUN"),
  };
}

function assertDemandPulseRuntimeFlags(): void {
  const flags = getDemandPulseFeatureFlags(demandPulseFlagEnv());
  if (!flags.enabled || !flags.dryRun || flags.writeEnabled) {
    throw new AppError(
      "FORBIDDEN",
      "Demand Pulse is disabled or unsafe for the canary review surface",
    );
  }
}

export const getDemandPulseFeed = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(demandPulseFeedRequestSchema)
  .handler(async ({ context }) => {
    assertDemandPulseRuntimeFlags();
    return getLatestFeed(context.projectId);
  });

export const getDemandPulseFeedItem = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(demandPulseFeedItemRequestSchema)
  .handler(async ({ data, context }) => {
    assertDemandPulseRuntimeFlags();
    return getFeedItemDetail(context.projectId, {
      runId: data.runId,
      evidenceVersion: data.evidenceVersion,
      selectionVersion: data.selectionVersion,
      feedItemId: data.feedItemId,
    });
  });

export const recordDemandPulseDecision = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(demandPulseDecisionInputSchema)
  .handler(async ({ data, context }) => {
    assertDemandPulseRuntimeFlags();
    const lineage = {
      runId: data.runId,
      evidenceVersion: data.evidenceVersion,
      selectionVersion: data.selectionVersion,
      feedItemId: data.feedItemId,
      reason: data.reason,
      reviewedBy: context.userId || context.userEmail,
    };
    return data.kind === "accept"
      ? recordDecision(context.projectId, {
          ...lineage,
          kind: "accept",
          action: data.action,
        })
      : recordDecision(context.projectId, {
          ...lineage,
          kind: "reject",
          action: null,
        });
  });
