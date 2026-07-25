import { z } from "zod";

const projectId = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const discoverLiveQuestionsInputSchema = z.object({
  projectId,
  seedTopics: z.array(z.string().min(1)).min(1).max(20),
  sourcePlatforms: z.array(z.string().min(1)).max(20).optional(),
  since: isoDate.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  dryRun: z.boolean().default(true),
});

export const getDemandPulseInputSchema = z.object({
  projectId,
  window: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
  status: z
    .enum([
      "discovered",
      "normalized",
      "clustered",
      "corroborated",
      "promoted",
      "actioned",
      "measured",
      "decayed",
      "rejected",
    ])
    .optional(),
  minimumPriority: z.number().min(0).max(100).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

export const getPromptFamilyInputSchema = z.object({
  projectId,
  familyId: z.string().min(1),
  includeObservations: z.boolean().default(true),
  includeRawExcerpts: z.boolean().default(false),
});

export const getDemandGapsInputSchema = z.object({
  projectId,
  window: z.enum(["7d", "30d", "90d", "365d"]).default("90d"),
  actionTypes: z.array(z.string().min(1)).optional(),
  minimumConfidence: z.number().min(0).max(1).default(0.45),
  limit: z.number().int().min(1).max(200).default(50),
});

export const promotePromptFamilyInputSchema = z.object({
  projectId,
  familyId: z.string().min(1),
  actionType: z.enum([
    "update_existing_page",
    "create_supporting_page",
    "add_faq",
    "create_comparison",
    "create_tool",
    "create_troubleshooter",
    "update_product_or_offer",
    "create_sales_enablement",
    "create_support_article",
    "monitor_only",
  ]),
  targetUrl: z.string().url().optional(),
  rationale: z.string().min(10).max(5_000),
  expectedScoringVersion: z.string().min(1),
  confirm: z.literal(true),
});

export const dismissDemandCandidateInputSchema = z.object({
  projectId,
  familyId: z.string().min(1),
  reasonCode: z.enum([
    "off_topic",
    "spam_or_manipulation",
    "duplicate",
    "insufficient_evidence",
    "low_business_value",
    "legal_or_retention_risk",
    "already_covered",
    "other",
  ]),
  note: z.string().max(2_000).optional(),
  confirm: z.literal(true),
});
