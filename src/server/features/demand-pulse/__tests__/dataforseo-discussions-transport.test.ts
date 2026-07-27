import { describe, expect, it, vi } from "vitest";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { createDataForSeoDiscussionsPaidFetch } from "../sources/dataforseo-discussions-transport";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(async () => false),
}));

const { fetchLiveSerpMock } = vi.hoisted(() => ({
  fetchLiveSerpMock: vi.fn(),
}));

vi.mock("@/server/lib/dataforseo/sections", () => ({
  fetchLiveSerp: fetchLiveSerpMock,
}));

describe("createDataForSeoDiscussionsPaidFetch", () => {
  it("maps organic SERPs and aggregates charged billing", async () => {
    const paidFetch = createDataForSeoDiscussionsPaidFetch({
      customer: {
        organizationId: "org-1",
        userId: "user-1",
        userEmail: "ops@example.com",
      },
      locationCode: 2840,
      languageCode: "en",
    });
    const successResponse = {
      data: [
        {
          type: "organic",
          title: "Compost permit discussion",
          url: "https://forum.example.com/t/permit",
          domain: "forum.example.com",
          description: "A question about permits.",
          rank_group: 2,
          rank_absolute: 3,
        },
        {
          type: "people_also_ask",
          title: "Not a discussion",
          url: "https://example.com/paa",
        },
      ],
      billing: {
        costUsd: 0.1,
        path: ["v3", "serp", "google", "organic", "live"],
      },
    };
    fetchLiveSerpMock.mockResolvedValueOnce(successResponse);

    const success = await paidFetch({
      queries: ["q1"],
      reservedMaxCostMicros: 200_000,
    });

    expect(success).toEqual({
      kind: "paid_success",
      items: [
        {
          query: "q1",
          title: "Compost permit discussion",
          url: "https://forum.example.com/t/permit",
          domain: "forum.example.com",
          description: "A question about permits.",
          rankGroup: 2,
          rankAbsolute: 3,
        },
      ],
      costMicros: 100_000,
      vendorRequestCount: 1,
    });

    const charged = new DataforseoChargedTaskError("charged task failed", {
      costUsd: 0.05,
      path: ["v3", "serp", "google", "organic", "live"],
    });
    fetchLiveSerpMock
      .mockReset()
      .mockResolvedValueOnce(successResponse)
      .mockRejectedValueOnce(charged);

    const chargedOutcome = await paidFetch({
      queries: ["q1", "q2"],
      reservedMaxCostMicros: 400_000,
    });

    expect(chargedOutcome).toMatchObject({
      kind: "charged_failure",
      error: "charged task failed",
      costMicros: 150_000,
      vendorRequestCount: 2,
    });
    expect(fetchLiveSerpMock).toHaveBeenCalledTimes(2);

    const unbilled = new DataforseoChargedTaskError("unbilled task failed", {
      costUsd: 0,
      path: ["v3", "serp", "google", "organic", "live"],
    });
    fetchLiveSerpMock.mockReset().mockRejectedValueOnce(unbilled);
    await expect(
      paidFetch({
        queries: ["q1"],
        reservedMaxCostMicros: 200_000,
      }),
    ).rejects.toBe(unbilled);
  });
});
