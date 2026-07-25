import type { DemandObservationCandidate } from "../types";
import {
  mapWithConcurrency,
  type DemandSourceAdapter,
  type DemandSourceRunContext,
  type DemandSourceRunResult,
} from "./adapter";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

type HackerNewsFeed = "ask" | "show" | "new" | "top";

export interface HackerNewsSourceConfig {
  feeds: HackerNewsFeed[];
  maxItemsPerFeed: number;
  minimumScore: number;
  includeOutboundStories: boolean;
}

interface HackerNewsItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  score?: number;
  descendants?: number;
  deleted?: boolean;
  dead?: boolean;
}

const FEED_ENDPOINTS: Record<HackerNewsFeed, string> = {
  ask: "askstories",
  show: "showstories",
  new: "newstories",
  top: "topstories",
};

function stripHtml(value: string): string {
  return value
    .replace(/<p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function validateConfig(config: unknown): HackerNewsSourceConfig {
  const raw = (config ?? {}) as Partial<HackerNewsSourceConfig>;
  const feeds = raw.feeds?.filter((feed): feed is HackerNewsFeed =>
    Object.hasOwn(FEED_ENDPOINTS, feed),
  ) ?? ["ask", "show", "new"];

  return {
    feeds: [...new Set(feeds)],
    maxItemsPerFeed: Math.min(200, Math.max(1, raw.maxItemsPerFeed ?? 50)),
    minimumScore: Math.max(0, raw.minimumScore ?? 2),
    includeOutboundStories: raw.includeOutboundStories ?? true,
  };
}

async function fetchJson<T>(
  context: DemandSourceRunContext,
  url: string,
): Promise<T> {
  const response = await context.fetch(url, {
    headers: { Accept: "application/json" },
    signal: context.signal,
  });
  if (!response.ok) {
    throw new Error(`Hacker News API ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

async function discover(
  context: DemandSourceRunContext,
  config: HackerNewsSourceConfig,
): Promise<DemandSourceRunResult> {
  let sourceRequestCount = 0;
  const warnings: string[] = [];
  const ids = new Set<number>();

  for (const feed of config.feeds) {
    const endpoint = FEED_ENDPOINTS[feed];
    const feedIds = await fetchJson<number[]>(
      context,
      `${HN_API_BASE}/${endpoint}.json`,
    );
    sourceRequestCount += 1;
    for (const id of feedIds.slice(0, config.maxItemsPerFeed)) ids.add(id);
  }

  const items = await mapWithConcurrency([...ids], 8, async (id) => {
    try {
      const item = await fetchJson<HackerNewsItem>(
        context,
        `${HN_API_BASE}/item/${id}.json`,
      );
      sourceRequestCount += 1;
      return item;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  });

  const sinceTime = context.since ? Date.parse(context.since) : null;
  const observations: DemandObservationCandidate[] = [];

  for (const item of items) {
    if (!item || item.deleted || item.dead || item.type !== "story") continue;
    if (!item.title || !item.time) continue;
    if ((item.score ?? 0) < config.minimumScore) continue;
    if (!config.includeOutboundStories && item.url) continue;

    const publishedAt = new Date(item.time * 1000).toISOString();
    if (sinceTime !== null && Date.parse(publishedAt) < sinceTime) continue;

    observations.push({
      projectId: context.projectId,
      sourceConnectionId: context.sourceConnectionId,
      sourceClass: "community_observed",
      sourcePlatform: "hacker_news",
      sourceDomain: "news.ycombinator.com",
      externalId: `hn:${item.id}`,
      canonicalUrl: `https://news.ycombinator.com/item?id=${item.id}`,
      outboundUrl: item.url ?? null,
      title: item.title,
      excerpt: item.text ? stripHtml(item.text).slice(0, 1_000) : null,
      publishedAt,
      collectedAt: context.collectedAt,
      locale: "en",
      engagement: {
        score: item.score ?? null,
        comments: item.descendants ?? null,
      },
      metadata: {
        hnType: item.type,
        feedCandidates: config.feeds,
      },
      retentionProfile: "community-minimal-v1",
    });
  }

  context.log?.("demand_pulse.source_complete", {
    source: "hacker_news",
    observations: observations.length,
    sourceRequestCount,
    warnings: warnings.length,
  });

  return {
    observations,
    sourceRequestCount,
    warnings,
    nextCursor: context.collectedAt,
  };
}

export const hackerNewsDemandSource: DemandSourceAdapter<HackerNewsSourceConfig> =
  {
    capabilities: {
      sourcePlatform: "hacker_news",
      supportsBackfill: true,
      supportsIncrementalCursor: true,
      supportsDeletionSync: false,
      supportsEngagementSnapshots: true,
      supportsFullText: true,
      requiresAuthentication: false,
      requiresCommercialApproval: false,
      defaultRawRetentionDays: 30,
      notes: [
        "Poll story IDs and rehydrate current item state; do not treat HN as representative of every market.",
        "Author identity is intentionally not persisted by this adapter.",
      ],
    },
    validateConfig,
    discover,
  };
