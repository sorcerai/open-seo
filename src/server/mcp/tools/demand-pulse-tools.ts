import { z } from "zod";
import {
  getFeedItemDetail,
  getLatestFeed,
} from "@/server/features/demand-pulse/services/DemandPulseService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const FEED_MAX_ITEMS = 5;

const feedInputSchema = {
  projectId: projectIdSchema,
} as const;

type FeedArgs = z.infer<z.ZodObject<typeof feedInputSchema>>;

const detailInputSchema = {
  projectId: projectIdSchema,
  runId: z
    .string()
    .min(1)
    .describe("Exact run ID that produced the feed item."),
  evidenceVersion: z
    .string()
    .min(1)
    .describe("Exact evidence version used for the feed item."),
  selectionVersion: z
    .string()
    .min(1)
    .describe("Exact feed selection version for the item."),
  feedItemId: z.string().min(1).describe("Exact feed item ID to inspect."),
} as const;

type DetailArgs = z.infer<z.ZodObject<typeof detailInputSchema>>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function firstDefined(record: RecordValue, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function formatValue(value: unknown, fallback = "unavailable"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function feedItemText(item: unknown, index: number): string {
  const row = asRecord(item);
  const title = firstDefined(row, ["title", "canonicalQuestion", "id"]);
  const provenance = firstDefined(row, ["provenance"]);
  const score = firstDefined(row, ["score", "priorityScore", "scoreId"]);
  const coverage = firstDefined(row, [
    "coverage",
    "coverageCheck",
    "coverageCheckId",
  ]);
  const sourceHealth = firstDefined(row, ["sourceHealth", "health"]);
  const sourceFailure = firstDefined(row, [
    "sourceFailure",
    "failure",
    "errorMessage",
  ]);
  const source =
    sourceHealth === undefined && sourceFailure === undefined
      ? undefined
      : `source health: ${formatValue(sourceHealth)}; failure: ${formatValue(sourceFailure, "none reported")}`;

  return [
    `${index + 1}. ${formatValue(title)}`,
    `provenance: ${formatValue(provenance)}`,
    `score: ${formatValue(score)}`,
    `coverage: ${formatValue(coverage)}`,
    source,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" | ");
}

function feedText(profile: unknown, items: readonly unknown[]): string {
  const profileRow = asRecord(profile);
  const profileId = firstDefined(profileRow, ["id", "projectId"]);
  const header = `Demand Pulse feed (${items.length}/${FEED_MAX_ITEMS}) for ${formatValue(profileId)}`;
  return [header, ...items.map(feedItemText)].join("\n");
}

function detailText(detail: RecordValue): string {
  const feedItem = asRecord(detail.feedItem);
  const score = asRecord(detail.score);
  const coverage = asRecord(detail.coverageCheck);
  const evidence = Array.isArray(detail.familyEvidence)
    ? detail.familyEvidence
    : [];
  const scoreSummary =
    detail.score == null
      ? "unavailable"
      : [
          `priority ${formatValue(firstDefined(score, ["priorityScore"]))}`,
          `confidence ${formatValue(firstDefined(score, ["confidence"]))}`,
          `version ${formatValue(firstDefined(score, ["scoringVersion"]))}`,
        ].join(", ");
  const coverageSummary =
    detail.coverageCheck == null
      ? "unavailable"
      : [
          formatValue(firstDefined(coverage, ["status"])),
          formatValue(firstDefined(coverage, ["reason"]), "no reason"),
        ].join(" — ");
  const sourceHealth = firstDefined(detail, ["sourceHealth", "health"]);
  const sourceFailure = firstDefined(detail, [
    "sourceFailure",
    "sourceFailures",
    "failure",
    "errorMessage",
  ]);
  const sourceSummary =
    sourceHealth === undefined && sourceFailure === undefined
      ? undefined
      : `Source health: ${formatValue(sourceHealth)}; failure: ${formatValue(sourceFailure, "none reported")}`;

  return [
    `Feed item: ${formatValue(firstDefined(feedItem, ["title", "id"]))}`,
    `Provenance: ${formatValue(firstDefined(feedItem, ["provenance"]))}`,
    `Score: ${scoreSummary}`,
    `Coverage: ${coverageSummary}`,
    `Evidence: ${evidence.length}`,
    sourceSummary,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

const feedOutputSchema = z
  .object({
    profile: looseObjectOutputSchema,
    items: z.array(looseObjectOutputSchema),
  })
  .passthrough();

const detailOutputSchema = z.object({}).passthrough();

export const getDemandPulseFeedTool = {
  name: "get_demand_pulse_feed",
  config: {
    title: "Get Demand Pulse feed",
    description:
      "Returns the latest bounded Demand Pulse review feed for an authorized project. Read-only and dry-run safe; no publication is possible.",
    inputSchema: feedInputSchema,
    outputSchema: feedOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: FeedArgs, context) => {
    const result = await getLatestFeed(args.projectId);
    const items = result.items.slice(0, FEED_MAX_ITEMS);

    return mcpResponse({
      text: feedText(result.profile, items),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/demand-pulse`,
      ),
      structuredContent: {
        profile: result.profile,
        items,
      },
    });
  }),
};

export const getDemandPulseFeedItemTool = {
  name: "get_demand_pulse_feed_item",
  config: {
    title: "Get Demand Pulse feed item",
    description:
      "Returns one Demand Pulse candidate with its exact run, evidence, selection, provenance, score, and coverage lineage. Read-only and dry-run safe.",
    inputSchema: detailInputSchema,
    outputSchema: detailOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: DetailArgs, context) => {
    const { projectId: _projectId, ...lineage } = args;
    const detail = await getFeedItemDetail(args.projectId, lineage);
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/demand-pulse/${args.feedItemId}`,
    );

    if (!detail) {
      return mcpResponse({
        text: `Demand Pulse feed item ${args.feedItemId} was not found for the requested lineage.`,
        meta,
        structuredContent: {
          detail: null,
          lineage,
        },
      });
    }

    const detailRecord = asRecord(detail);
    const feedItem = asRecord(detail.feedItem);
    const sourceHealth = firstDefined(detailRecord, ["sourceHealth", "health"]);
    const sourceFailure = firstDefined(detailRecord, [
      "sourceFailure",
      "sourceFailures",
      "failure",
      "errorMessage",
    ]);
    const structuredContent: RecordValue = {
      ...detailRecord,
      provenance: feedItem.provenance,
      score: detail.score,
      coverage: detail.coverageCheck,
      evidence: detail.familyEvidence,
      lineage,
    };
    if (sourceHealth !== undefined)
      structuredContent.sourceHealth = sourceHealth;
    if (sourceFailure !== undefined)
      structuredContent.sourceFailure = sourceFailure;

    return mcpResponse({
      text: detailText(detailRecord),
      meta,
      structuredContent,
    });
  }),
};
