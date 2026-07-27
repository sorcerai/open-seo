import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  SEO_DATA_COST_MARKUP,
} from "@/shared/billing";

interface TrackCallArg {
  customerId: string;
  featureId: string;
  value: number;
  properties?: { balanceFeatureId: string };
}

const { checkMock, trackMock, getOrCreateMock, isHostedServerAuthModeMock } =
  vi.hoisted(() => ({
    checkMock: vi.fn(),
    trackMock: vi.fn<(arg: TrackCallArg) => void>(),
    getOrCreateMock: vi.fn(),
    isHostedServerAuthModeMock: vi.fn(),
  }));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@/server/billing/autumn", () => ({
  autumn: {
    check: checkMock,
    track: trackMock,
  },
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

// Keep the real subscription module (its assertUsageCreditsAvailable calls the
// mocked autumn.check) and only stub the customer lookup, so the balance-assert
// logic stays exercised through these tests after it moved out of client.ts.
vi.mock("@/server/billing/subscription", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOrCreateOrganizationCustomer: getOrCreateMock,
  };
});

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: isHostedServerAuthModeMock,
}));

vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: vi.fn(),
}));

// Mock every section module the client wraps so meterDataforseoCall's
// `execute()` resolves to a controllable fixture.
vi.mock("@/server/lib/dataforseo/labs", () => ({
  fetchRelatedKeywords: vi.fn(),
  fetchKeywordSuggestions: vi.fn(),
  fetchKeywordIdeas: vi.fn(),
  fetchDomainRankOverview: vi.fn(),
  fetchRankedKeywords: vi.fn(),
  fetchRelevantPages: vi.fn(),
  fetchKeywordOverview: vi.fn(),
  fetchSerpCompetitors: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/serp", () => ({
  fetchLiveSerp: vi.fn(),
  fetchRankCheckSerp: vi.fn(),
  postRankCheckTasks: vi.fn(),
  fetchLocalSerp: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/business", () => ({
  fetchBusinessListingsSearch: vi.fn(),
  fetchQuestionsAnswers: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/backlinks", () => ({
  fetchBacklinksSummary: vi.fn(),
  fetchBacklinksRows: vi.fn(),
  fetchReferringDomains: vi.fn(),
  fetchDomainPagesSummary: vi.fn(),
  fetchBacklinksHistory: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/lighthouse", () => ({
  fetchLighthouseResult: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/ai", () => ({
  fetchLlmMentionsSearch: vi.fn(),
  fetchLlmAggregatedMetrics: vi.fn(),
  fetchLlmTopPages: vi.fn(),
  fetchLlmCrossAggregatedMetrics: vi.fn(),
  fetchLlmResponse: vi.fn(),
}));

import {
  meterDataforseoCallWithEnvelope,
  createDataforseoClient,
} from "@/server/lib/dataforseo/client";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { fetchBacklinksSummary } from "@/server/lib/dataforseo/backlinks";

const billingCustomer = {
  organizationId: "org_123",
  userId: "user_123",
  userEmail: "alice@example.com",
};

const backlinksInput = {
  target: "example.com",
};

function setupHostedMode() {
  isHostedServerAuthModeMock.mockResolvedValue(true);
  getOrCreateMock.mockResolvedValue({ id: "org_123" });
}

function mockBalances(monthly: number, topup: number) {
  checkMock.mockImplementation(async (args: { featureId: string }) => {
    if (args.featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID) {
      return { allowed: true, balance: { remaining: monthly } };
    }
    if (args.featureId === AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID) {
      return { allowed: true, balance: { remaining: topup } };
    }
    return { allowed: false, balance: null };
  });
}

function mockDataforseoResult(costUsd: number) {
  vi.mocked(fetchBacklinksSummary).mockResolvedValue({
    data: { rank: 42 },
    billing: { costUsd, path: ["backlinks", "summary"] },
  });
}

describe("meterDataforseoCall with split balances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the complete envelope from the exported metered call", async () => {
    isHostedServerAuthModeMock.mockResolvedValue(false);
    const envelope = {
      data: { rank: 42 },
      billing: { costUsd: 0.05, path: ["backlinks", "summary"] },
    };

    await expect(
      meterDataforseoCallWithEnvelope(billingCustomer, async () => envelope),
    ).resolves.toEqual(envelope);
    expect(checkMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("meters and rethrows a charged failure from the exported metered call", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    const error = new DataforseoChargedTaskError("task failed", {
      costUsd: 0.05,
      path: ["v3", "backlinks", "summary", "live"],
    });

    await expect(
      meterDataforseoCallWithEnvelope(billingCustomer, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: Math.ceil(
          0.05 * SEO_DATA_COST_MARKUP * AUTUMN_SEO_DATA_CREDITS_PER_USD,
        ),
      }),
      expect.anything(),
    );
  });

  it("skips billing in non-hosted mode", async () => {
    isHostedServerAuthModeMock.mockResolvedValue(false);
    mockDataforseoResult(0.05);

    const client = createDataforseoClient(billingCustomer);
    const result = await client.backlinks.summary(backlinksInput);

    expect(result).toEqual({ rank: 42 });
    expect(checkMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("checks both monthly and topup balances in parallel", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    mockDataforseoResult(0.05);

    const client = createDataforseoClient(billingCustomer);
    await client.backlinks.summary(backlinksInput);

    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(checkMock).toHaveBeenCalledWith({
      customerId: "org_123",
      featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    });
    expect(checkMock).toHaveBeenCalledWith({
      customerId: "org_123",
      featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    });
  });

  const RAW_COST = 0.05;
  const EXPECTED_CREDITS = Math.ceil(
    RAW_COST * SEO_DATA_COST_MARKUP * AUTUMN_SEO_DATA_CREDITS_PER_USD,
  );

  it("deducts entirely from monthly when monthly has enough", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    mockDataforseoResult(RAW_COST);

    const client = createDataforseoClient(billingCustomer);
    await client.backlinks.summary(backlinksInput);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: EXPECTED_CREDITS,
      }),
      expect.anything(),
    );
  });

  it("deducts entirely from topup when monthly is empty", async () => {
    setupHostedMode();
    mockBalances(0, 5000);
    mockDataforseoResult(RAW_COST);

    const client = createDataforseoClient(billingCustomer);
    await client.backlinks.summary(backlinksInput);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
        value: EXPECTED_CREDITS,
      }),
      expect.anything(),
    );
  });

  it("splits deduction across monthly and topup when monthly is partially sufficient", async () => {
    setupHostedMode();
    const monthlyAvailable = 30;
    mockBalances(monthlyAvailable, 5000);
    mockDataforseoResult(RAW_COST);

    const client = createDataforseoClient(billingCustomer);
    await client.backlinks.summary(backlinksInput);

    expect(trackMock).toHaveBeenCalledTimes(2);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: monthlyAvailable,
      }),
      expect.anything(),
    );
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
        value: EXPECTED_CREDITS - monthlyAvailable,
      }),
      expect.anything(),
    );
  });

  it("throws INSUFFICIENT_CREDITS when both balances are exactly zero", async () => {
    setupHostedMode();
    mockBalances(0, 0);
    mockDataforseoResult(0.05);

    const client = createDataforseoClient(billingCustomer);
    await expect(
      client.backlinks.summary(backlinksInput),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("meters charged DataForSEO task errors before rethrowing", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new DataforseoChargedTaskError("DataForSEO task failed", {
        costUsd: RAW_COST,
        path: ["v3", "backlinks", "summary", "live"],
      }),
    );

    const client = createDataforseoClient(billingCustomer);
    await expect(client.backlinks.summary(backlinksInput)).rejects.toThrow(
      "DataForSEO task failed",
    );

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: EXPECTED_CREDITS,
      }),
      expect.anything(),
    );
  });

  it("skips the charge for an unbilled invalid-field failure and rethrows VALIDATION_ERROR", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new DataforseoChargedTaskError(
        "Invalid Field: 'target'.",
        { costUsd: 0, path: ["v3", "backlinks", "summary", "live"] },
        true,
      ),
    );

    const client = createDataforseoClient(billingCustomer);
    await expect(
      client.backlinks.summary(backlinksInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("still meters an invalid-field failure that DataForSEO actually billed", async () => {
    setupHostedMode();
    mockBalances(5000, 3000);
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new DataforseoChargedTaskError(
        "Invalid Field: 'target'.",
        { costUsd: RAW_COST, path: ["v3", "backlinks", "summary", "live"] },
        true,
      ),
    );

    const client = createDataforseoClient(billingCustomer);
    await expect(client.backlinks.summary(backlinksInput)).rejects.toThrow(
      "Invalid Field: 'target'.",
    );

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "org_123",
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: EXPECTED_CREDITS,
      }),
      expect.anything(),
    );
  });

  it("includes balanceFeatureId in track properties", async () => {
    setupHostedMode();
    mockBalances(30, 5000);
    mockDataforseoResult(0.05);

    const client = createDataforseoClient(billingCustomer);
    await client.backlinks.summary(backlinksInput);

    const monthlyCall = trackMock.mock.calls.find(
      ([arg]) => arg.featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    );
    const topupCall = trackMock.mock.calls.find(
      ([arg]) => arg.featureId === AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    );

    expect(monthlyCall![0].properties?.balanceFeatureId).toBe(
      AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    );
    expect(topupCall![0].properties?.balanceFeatureId).toBe(
      AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    );
  });
});
