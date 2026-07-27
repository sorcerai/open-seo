import { describe, expect, it, vi } from "vitest";
import {
  dataforseoDiscussionsDemandSource,
  type DataForSeoCacheRead,
  type DataForSeoPaidFetch,
} from "../sources/dataforseo-discussions-normalizer";
import { type DemandSourceReservationSeam } from "../sources/adapter";
import {
  allowedGate,
  buildContext,
  buildReservationSeam,
  createDataForSeoCacheRead,
  createDataForSeoPaidFetch,
} from "./acquisition-adapters.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(async () => false),
}));

const baseItems = [
  {
    query: "compost permit texas",
    title: "Houston compost permit discussion",
    url: "https://forum.example.com/t/houston-compost-permit",
    domain: "forum.example.com",
    description: "How do I get a permit?",
    timestamp: "2026-07-20T00:00:00.000Z",
    rankAbsolute: 2,
    serpTaskId: "task-1",
  },
  {
    query: "compost permit texas",
    title: "Another Houston compost permit thread",
    url: "https://forum.example.com/t/another-compost-permit",
    domain: "forum.example.com",
    description: "A second discussion.",
    timestamp: "2026-07-21T00:00:00.000Z",
    rankAbsolute: 1,
    serpTaskId: "task-2",
  },
];

function buildConfig(
  fetchPaid: DataForSeoPaidFetch,
  options: {
    readCache?: DataForSeoCacheRead;
    queries?: string[];
    operationKey?: string;
  } = {},
) {
  return {
    readCache: options.readCache ?? createDataForSeoCacheRead(async () => null),
    fetchPaid,
    queries: options.queries ?? ["compost permit texas"],
    operationKey: options.operationKey ?? "dataforseo-discussions",
  };
}

describe("dataforseoDiscussionsDemandSource", () => {
  it("reads cache before reservation so exhausted budgets still serve hits", async () => {
    const readCache = createDataForSeoCacheRead(async () => ({
      kind: "cache_hit" as const,
      items: baseItems,
      cacheKey: "k1",
    }));
    const fetchPaid = createDataForSeoPaidFetch(async () => {
      throw new Error("paid fetch must not run");
    });
    const reservation = buildReservationSeam({
      reserved: false,
      reason: "daily budget exhausted",
    });

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid, { readCache }),
    );

    expect(readCache).toHaveBeenCalledWith({
      queries: ["compost permit texas"],
      cursor: undefined,
    });
    expect(reservation.reserveMock).not.toHaveBeenCalled();
    expect(reservation.settleMock).not.toHaveBeenCalled();
    expect(fetchPaid).not.toHaveBeenCalled();
    expect(result.health?.status).toBe("healthy");
    expect(result.health?.costMicros).toBe(0);
    expect(result.health?.requestCount).toBe(0);
    expect(result.health?.metrics?.cacheHit).toBe(true);
  });

  it("paid success uses fixed pricing and settles the validated cost", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: baseItems,
      costMicros: 150_000,
      vendorRequestCount: 1,
      taskIds: ["task-1"],
    }));
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(result.health?.status).toBe("healthy");
    expect(result.health?.costMicros).toBe(150_000);
    expect(result.health?.requestCount).toBe(1);
    expect(result.health?.metrics?.cacheHit).toBe(false);
    expect(reservation.reserveMock).toHaveBeenCalledWith({
      maxCostMicros: 200_000,
      operationKey: "dataforseo-discussions",
    });
    expect(reservation.settleMock).toHaveBeenCalledWith({
      reservationId: "res-1",
      actualCostMicros: 150_000,
    });
  });

  it("charged failure reports billed cost as failed health", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "charged_failure" as const,
      error: "task 40502 failed",
      costMicros: 50_000,
      vendorRequestCount: 1,
      taskIds: ["task-x"],
    }));
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.costMicros).toBe(50_000);
    expect(result.health?.requestCount).toBe(1);
    expect(result.health?.error).toMatch(/charged failure/);
    expect(reservation.settleMock).toHaveBeenCalledWith({
      reservationId: "res-1",
      actualCostMicros: 50_000,
    });
  });

  it("refused reservation skips the paid call", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: baseItems,
      costMicros: 1,
      vendorRequestCount: 1,
    }));
    const reservation = buildReservationSeam({
      reserved: false,
      reason: "daily budget exhausted",
    });

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(fetchPaid).not.toHaveBeenCalled();
    expect(result.health?.status).toBe("skipped");
    expect(result.health?.costMicros).toBe(0);
    expect(result.health?.error).toMatch(/daily budget exhausted/);
  });

  it("skips the paid call when the reservation seam is missing", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: baseItems,
      costMicros: 1,
      vendorRequestCount: 1,
    }));

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate }),
      buildConfig(fetchPaid),
    );

    expect(fetchPaid).not.toHaveBeenCalled();
    expect(result.health?.status).toBe("skipped");
    expect(result.health?.error).toMatch(/reservation seam unavailable/);
  });

  it("dedupes queries before reserving the fixed worst-case cost", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: [],
      costMicros: 0,
      vendorRequestCount: 1,
    }));
    const reservation = buildReservationSeam();

    await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid, {
        queries: ["q1", "q1", "q2"],
        operationKey: "dfs",
      }),
    );

    expect(reservation.reserveMock).toHaveBeenCalledWith({
      maxCostMicros: 400_000,
      operationKey: "dfs",
    });
    expect(fetchPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: ["q1", "q2"],
        reservedMaxCostMicros: 400_000,
      }),
    );
  });

  it("releases the reservation when the paid fetch rejects", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => {
      throw new Error("upstream timeout");
    });
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(reservation.settleMock).toHaveBeenCalledWith({
      reservationId: "res-1",
      actualCostMicros: 0,
    });
    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/upstream timeout/);
  });

  it("fails closed when the provider cost exceeds the reservation", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: baseItems,
      costMicros: 200_001,
      vendorRequestCount: 1,
    }));
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(reservation.settleMock).toHaveBeenCalledWith({
      reservationId: "res-1",
      actualCostMicros: 0,
    });
    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.costMicros).toBe(200_001);
    expect(result.health?.error).toMatch(/exceeds reserved/);
  });

  it("returns failed health when settlement fails", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: baseItems,
      costMicros: 100_000,
      vendorRequestCount: 1,
    }));
    const reservation: DemandSourceReservationSeam = {
      reserve: async () => ({
        reserved: true,
        reservationId: "res-1",
        maxCostMicros: 200_000,
      }),
      settle: async () => {
        throw new Error("ledger unavailable");
      },
    };

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/ledger unavailable/);
  });

  it("bounds the provider item array", async () => {
    const items = Array.from({ length: 501 }, (_, index) => ({
      query: "compost permit texas",
      title: `Discussion ${index}`,
      url: `https://forum.example.com/t/${index}`,
    }));
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items,
      costMicros: 1,
      vendorRequestCount: 1,
    }));
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/items failed validation/);
  });

  it("sorts and identifies observations deterministically from content", async () => {
    const run = (items: typeof baseItems) =>
      dataforseoDiscussionsDemandSource.discover(
        buildContext({
          source: allowedGate,
          reservation: buildReservationSeam(),
        }),
        buildConfig(
          createDataForSeoPaidFetch(async () => ({
            kind: "paid_success" as const,
            items,
            costMicros: 1,
            vendorRequestCount: 1,
          })),
        ),
      );

    const first = await run(baseItems);
    const second = await run(baseItems.toReversed());

    expect(second.observations).toEqual(first.observations);
    expect(first.observations.map((item) => item.canonicalUrl)).toEqual([
      "https://forum.example.com/t/another-compost-permit",
      "https://forum.example.com/t/houston-compost-permit",
    ]);
    expect(first.observations.map((item) => item.externalId)).toEqual([
      "dfs-discussion:https://forum.example.com/t/another-compost-permit",
      "dfs-discussion:https://forum.example.com/t/houston-compost-permit",
    ]);
  });

  it("reports malformed provider items as failed health", async () => {
    const fetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: [{ query: "q", title: "t" }],
      costMicros: 10_000,
      vendorRequestCount: 1,
    }));
    const reservation = buildReservationSeam();

    const result = await dataforseoDiscussionsDemandSource.discover(
      buildContext({ source: allowedGate, reservation }),
      buildConfig(fetchPaid),
    );

    expect(result.health?.status).toBe("failed");
    expect(result.health?.costMicros).toBe(10_000);
    expect(result.health?.error).toMatch(/items failed validation/);
  });

  it("advertises that discussion discovery does not provide full text", () => {
    expect(
      dataforseoDiscussionsDemandSource.capabilities.supportsFullText,
    ).toBe(false);
  });
});
