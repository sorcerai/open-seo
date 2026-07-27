import { vi } from "vitest";
import type { GscSearchAnalyticsRow } from "@/server/lib/gscClient";
import type {
  DemandSourceApprovalGate,
  DemandSourceReservationSeam,
  DemandSourceRunContext,
} from "../sources/adapter";
import type {
  DataForSeoCacheRead,
  DataForSeoPaidFetch,
} from "../sources/dataforseo-discussions-normalizer";
import type {
  LocalNewsAllowlistedFetch,
  LocalNewsSourceConfig,
} from "../sources/local-news";

export const COLLECTED_AT = "2026-07-27T10:00:00.000Z";

export const allowedGate: DemandSourceApprovalGate = {
  approvalState: "approved",
  enabled: true,
  policyState: "allowed",
};

export const gscRows: GscSearchAnalyticsRow[] = [
  {
    keys: ["compost bins", "https://onfarmcompost.com/bins"],
    clicks: 10,
    impressions: 100,
    ctr: 0.1,
    position: 1.5,
  },
  {
    keys: ["compost bins", "https://onfarmcompost.com/bins?utm_source=news"],
    clicks: 5,
    impressions: 50,
    ctr: 0.1,
    position: 2,
  },
  {
    keys: ["food waste drop-off", "https://onfarmcompost.com/food-waste"],
    clicks: 20,
    impressions: 200,
    ctr: 0.1,
    position: 1,
  },
];

export function buildContext(
  overrides: Partial<DemandSourceRunContext> = {},
): DemandSourceRunContext {
  return {
    projectId: "proj-onfarmcompost",
    sourceConnectionId: "src-conn-1",
    collectedAt: COLLECTED_AT,
    fetch: vi.fn(async () => new Response("ok")),
    ...overrides,
  };
}

export function buildGscResult(
  rows: GscSearchAnalyticsRow[],
  dimensions = ["query", "page"],
) {
  return {
    siteUrl: "sc-domain:onfarmcompost.com",
    connectedBy: "ops@onfarmcompost.com",
    request: {
      startDate: "2026-06-29",
      endDate: "2026-07-27",
      dimensions,
      rowLimit: 1000,
      type: "web",
      dataState: "all",
    },
    rows,
  };
}

export function buildReservationSeam(
  opts: { reserved?: false; reason?: string } = {},
) {
  let refuse = opts.reserved === false;
  const reserve = vi.fn<DemandSourceReservationSeam["reserve"]>(
    async ({ maxCostMicros }) =>
      refuse
        ? { reserved: false, reason: opts.reason ?? "exhausted" }
        : { reserved: true, reservationId: "res-1", maxCostMicros },
  );
  const settle = vi.fn<DemandSourceReservationSeam["settle"]>(async () => {});
  return {
    reserve,
    settle,
    reserveMock: reserve,
    settleMock: settle,
    setReserved: (value: boolean) => {
      refuse = !value;
    },
  } satisfies DemandSourceReservationSeam & {
    reserveMock: typeof reserve;
    settleMock: typeof settle;
    setReserved(value: boolean): void;
  };
}

export function createDataForSeoCacheRead(implementation: DataForSeoCacheRead) {
  return vi.fn<DataForSeoCacheRead>(implementation);
}

export function createDataForSeoPaidFetch(implementation: DataForSeoPaidFetch) {
  return vi.fn<DataForSeoPaidFetch>(implementation);
}

export function createLocalNewsResolver(
  implementation: LocalNewsAllowlistedFetch,
) {
  return vi.fn<LocalNewsAllowlistedFetch>(implementation);
}

export function buildMalformedFailedLocalNewsConfig(
  resolveOriginal: LocalNewsAllowlistedFetch,
): LocalNewsSourceConfig {
  const config: LocalNewsSourceConfig = {
    discovery: {
      status: "failed",
      provenance: "local-news-v1",
      error: "search api 503",
      hits: [],
    },
    allowlistedPublisherDomains: ["example-gazette.com"],
    resolveOriginal,
    maxResolutions: 5,
  };
  Object.defineProperty(config.discovery, "hits", {
    value: [{ query: "q", title: "t", url: "https://example-gazette.com/a" }],
    enumerable: true,
    writable: true,
  });
  return config;
}
