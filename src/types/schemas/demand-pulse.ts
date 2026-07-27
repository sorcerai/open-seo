import { z } from "zod";
import { DEMAND_CANARY_ALLOWED_ACTIONS } from "@/server/features/demand-pulse/types";

const projectIdSchema = z.uuid();
const lineageIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0, "must not be blank");
const reasonSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value.trim().length > 0, "must not be blank");
const actionSchema = z.enum(DEMAND_CANARY_ALLOWED_ACTIONS);

const feedLineageFields = {
  runId: lineageIdSchema,
  evidenceVersion: lineageIdSchema,
  selectionVersion: lineageIdSchema,
  feedItemId: lineageIdSchema,
} as const;

export const demandPulseFeedRequestSchema = z
  .object({ projectId: projectIdSchema })
  .strict();

export const demandPulseFeedItemPayloadSchema = z
  .object(feedLineageFields)
  .strict();

export const demandPulseFeedItemRequestSchema = z
  .object({ projectId: projectIdSchema, ...feedLineageFields })
  .strict();

const decisionLineageFields = {
  ...feedLineageFields,
  reason: reasonSchema,
} as const;

export const demandPulseDecisionPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...decisionLineageFields,
      kind: z.literal("accept"),
      action: actionSchema,
    })
    .strict(),
  z
    .object({
      ...decisionLineageFields,
      kind: z.literal("reject"),
      action: z.null().optional(),
    })
    .strict(),
]);

export const demandPulseDecisionInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      projectId: projectIdSchema,
      ...decisionLineageFields,
      kind: z.literal("accept"),
      action: actionSchema,
    })
    .strict(),
  z
    .object({
      projectId: projectIdSchema,
      ...decisionLineageFields,
      kind: z.literal("reject"),
      action: z.null().optional(),
    })
    .strict(),
]);

export type DemandPulseFeedItemPayload = z.infer<
  typeof demandPulseFeedItemPayloadSchema
>;
export type DemandPulseDecisionPayload = z.infer<
  typeof demandPulseDecisionPayloadSchema
>;
