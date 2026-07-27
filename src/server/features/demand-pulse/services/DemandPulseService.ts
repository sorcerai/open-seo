import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  DemandPulseRepository,
  type DemandPulseProfile,
} from "../repositories/DemandPulseRepository";
import {
  DemandPulseFeedRepository,
  type DemandPulseDecisionRowInput,
  type DemandPulseFeedItemDetail,
  type DemandPulseRecordDecisionInput,
} from "../repositories/DemandPulseFeedRepository";
import {
  demandPulseDecisionPayloadSchema,
  demandPulseFeedItemPayloadSchema,
  type DemandPulseDecisionPayload,
  type DemandPulseFeedItemPayload,
} from "@/types/schemas/demand-pulse";

const projectContextIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0, "must not be blank");
const reviewerSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0, "must not be blank");

type DemandPulseDecisionServiceInput = DemandPulseDecisionPayload & {
  /** Trusted reviewer identity supplied by the authenticated server context. */
  reviewedBy?: string;
};

function assertFeedLineage(
  profile: DemandPulseProfile,
  projectId: string,
  input: DemandPulseFeedItemPayload,
  detail: DemandPulseFeedItemDetail,
): void {
  const feedItem = detail.feedItem;
  if (
    feedItem.id !== input.feedItemId ||
    feedItem.profileId !== profile.id ||
    feedItem.projectId !== projectId ||
    feedItem.runId !== input.runId ||
    feedItem.evidenceVersion !== input.evidenceVersion ||
    feedItem.selectionVersion !== input.selectionVersion
  ) {
    throw new AppError(
      "CONFLICT",
      "Demand Pulse feed item lineage does not match the requested scope",
    );
  }
}

async function resolveSafeProfile(
  projectId: string,
): Promise<DemandPulseProfile> {
  const parsedProjectId = projectContextIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Demand Pulse project context is invalid",
    );
  }

  const profile = await DemandPulseRepository.getProfileByProjectId(
    parsedProjectId.data,
  );
  if (!profile) {
    throw new AppError(
      "NOT_FOUND",
      "Demand Pulse profile is not configured for this project",
    );
  }
  if (!profile.enabled) {
    throw new AppError("FORBIDDEN", "Demand Pulse profile is disabled");
  }
  if (!profile.dryRun || !profile.publicationDisabled) {
    throw new AppError(
      "FORBIDDEN",
      "Demand Pulse profile is unsafe for the canary review surface",
    );
  }
  if (profile.projectId !== parsedProjectId.data) {
    throw new AppError(
      "FORBIDDEN",
      "Demand Pulse profile does not belong to the requested project",
    );
  }
  return profile;
}

export async function getLatestFeed(projectId: string) {
  const profile = await resolveSafeProfile(projectId);
  const items = await DemandPulseFeedRepository.listLatestFeed({
    profileId: profile.id,
    projectId,
  });
  return { profile, items };
}

export async function getFeedItemDetail(
  projectId: string,
  input: DemandPulseFeedItemPayload,
) {
  const profile = await resolveSafeProfile(projectId);
  const lineage = demandPulseFeedItemPayloadSchema.parse(input);
  return DemandPulseFeedRepository.getFeedItemDetail({
    profileId: profile.id,
    projectId,
    ...lineage,
  });
}

export async function recordDecision(
  projectId: string,
  input: DemandPulseDecisionServiceInput,
) {
  const profile = await resolveSafeProfile(projectId);
  const { reviewedBy, ...untrustedInput } = input;
  const decision = demandPulseDecisionPayloadSchema.parse(untrustedInput);
  const lineage = demandPulseFeedItemPayloadSchema.parse({
    feedItemId: decision.feedItemId,
    runId: decision.runId,
    evidenceVersion: decision.evidenceVersion,
    selectionVersion: decision.selectionVersion,
  });
  const detail = await DemandPulseFeedRepository.getFeedItemDetail({
    profileId: profile.id,
    projectId,
    ...lineage,
  });
  if (!detail) {
    throw new AppError("NOT_FOUND", "Demand Pulse feed item was not found");
  }
  assertFeedLineage(profile, projectId, lineage, detail);

  const reviewer = reviewerSchema.safeParse(reviewedBy);
  if (!reviewer.success) {
    throw new AppError("VALIDATION_ERROR", "Demand Pulse reviewer is invalid");
  }

  const feedItem = detail.feedItem;
  const row: DemandPulseDecisionRowInput = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    projectId,
    runId: decision.runId,
    feedItemId: decision.feedItemId,
    familyId: feedItem.familyId,
    kind: decision.kind,
    action: decision.kind === "accept" ? decision.action : null,
    reason: decision.reason,
    reviewedBy: reviewer.data,
    publicationTriggered: false,
  };
  const repositoryInput: DemandPulseRecordDecisionInput = {
    profileId: profile.id,
    projectId,
    runId: decision.runId,
    evidenceVersion: decision.evidenceVersion,
    selectionVersion: decision.selectionVersion,
    feedItemId: decision.feedItemId,
    row,
    expectedFeed: {
      familyId: feedItem.familyId,
      scoreId: feedItem.scoreId,
      coverageCheckId: feedItem.coverageCheckId,
      evidenceVersion: feedItem.evidenceVersion,
      selectionVersion: feedItem.selectionVersion,
    },
  };
  return DemandPulseFeedRepository.recordDecision(repositoryInput);
}

export type { DemandPulseDecisionServiceInput };
