import { z } from "zod";
import type { DemandObservationCandidate } from "../types";
import { demandHttpsUrl } from "./adapter";

/**
 * Normalize DataForSEO discussion fields without importing its SDK into the
 * adapter path. The production transport bridge lives in the sibling module.
 */
export interface DataForSeoDiscussionItem {
  query: string;
  title: string;
  url: string;
  domain?: string | null;
  description?: string | null;
  timestamp?: string | null;
  rankGroup?: number | null;
  rankAbsolute?: number | null;
  serpTaskId?: string | null;
}

export const dataForSeoDiscussionItemSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  url: demandHttpsUrl(),
  domain: z.string().trim().min(1).max(253).nullable().optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  timestamp: z.string().trim().min(1).max(40).nullable().optional(),
  rankGroup: z.number().int().nullable().optional(),
  rankAbsolute: z.number().int().nullable().optional(),
  serpTaskId: z.string().trim().min(1).max(200).nullable().optional(),
});

export function normalizeDataForSeoDiscussions(
  projectId: string,
  sourceConnectionId: string,
  collectedAt: string,
  items: readonly DataForSeoDiscussionItem[],
): DemandObservationCandidate[] {
  const seen = new Set<string>();
  const output: DemandObservationCandidate[] = [];
  const sortedItems = items.toSorted((left, right) => {
    const leftKey = [
      left.url.trim(),
      left.title.trim(),
      left.query.trim(),
      left.description?.trim() ?? "",
      left.timestamp?.trim() ?? "",
      left.domain?.trim() ?? "",
      left.rankGroup ?? "",
      left.rankAbsolute ?? "",
      left.serpTaskId?.trim() ?? "",
    ].join("\u0000");
    const rightKey = [
      right.url.trim(),
      right.title.trim(),
      right.query.trim(),
      right.description?.trim() ?? "",
      right.timestamp?.trim() ?? "",
      right.domain?.trim() ?? "",
      right.rankGroup ?? "",
      right.rankAbsolute ?? "",
      right.serpTaskId?.trim() ?? "",
    ].join("\u0000");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  for (const item of sortedItems) {
    const url = item.url.trim();
    const title = item.title.trim();
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);

    const parsedTimestamp = item.timestamp ? Date.parse(item.timestamp) : NaN;
    const publishedAt = Number.isFinite(parsedTimestamp)
      ? new Date(parsedTimestamp).toISOString()
      : collectedAt;

    output.push({
      projectId,
      sourceConnectionId,
      sourceClass: "search_observed",
      sourcePlatform: "dataforseo_discussions_and_forums",
      sourceDomain: item.domain?.trim() || null,
      externalId: `dfs-discussion:${url}`,
      canonicalUrl: url,
      title,
      excerpt: item.description?.trim().slice(0, 1_000) || null,
      publishedAt,
      collectedAt,
      engagement: {},
      metadata: {
        discoveryQuery: item.query.trim(),
        rankGroup: item.rankGroup ?? null,
        rankAbsolute: item.rankAbsolute ?? null,
        serpTaskId: item.serpTaskId?.trim() ?? null,
      },
      retentionProfile: "search-observed-v1",
    });
  }

  return output;
}
