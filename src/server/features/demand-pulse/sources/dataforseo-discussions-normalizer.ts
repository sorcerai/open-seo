import type { DemandObservationCandidate } from "../types";

/**
 * Keep this module independent from the DataForSEO transport. OpenSEO already
 * owns authentication, billing, cache, and error envelopes. The integration
 * layer should pass only the normalized SERP element fields below.
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

export function normalizeDataForSeoDiscussions(
  projectId: string,
  sourceConnectionId: string,
  collectedAt: string,
  items: readonly DataForSeoDiscussionItem[],
): DemandObservationCandidate[] {
  const seen = new Set<string>();
  const output: DemandObservationCandidate[] = [];

  for (const item of items) {
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
      sourceDomain: item.domain ?? null,
      externalId: `dfs-discussion:${item.serpTaskId ?? "unknown"}:${item.rankAbsolute ?? output.length}:${url}`,
      canonicalUrl: url,
      title,
      excerpt: item.description?.trim().slice(0, 1_000) || null,
      publishedAt,
      collectedAt,
      engagement: {},
      metadata: {
        discoveryQuery: item.query,
        rankGroup: item.rankGroup ?? null,
        rankAbsolute: item.rankAbsolute ?? null,
        serpTaskId: item.serpTaskId ?? null,
      },
      retentionProfile: "search-observed-v1",
    });
  }

  return output;
}
