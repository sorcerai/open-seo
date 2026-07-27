import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    DEMAND_PULSE_ENABLED: "true",
    DEMAND_PULSE_DRY_RUN: "true",
    DEMAND_PULSE_WRITE_ENABLED: "false",
  },
  getProfileByProjectId: vi.fn(),
  listLatestFeed: vi.fn(),
  getFeedItemDetail: vi.fn(),
  recordDecision: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/serverFunctions/middleware", () => ({ requireProjectContext: [] }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder: {
      inputSchema?: unknown;
      middleware: () => typeof builder;
      validator: (schema: unknown) => typeof builder;
      handler: (handler: (args: unknown) => unknown) => unknown;
    } = {
      middleware: () => builder,
      validator: (schema) => {
        builder.inputSchema = schema;
        return builder;
      },
      handler: (handler) => {
        const serverFunction = (args: unknown) => handler(args);
        Object.assign(serverFunction, { inputSchema: builder.inputSchema });
        return serverFunction;
      },
    };
    return builder;
  },
}));
vi.mock(
  "@/server/features/demand-pulse/repositories/DemandPulseRepository",
  () => ({
    DemandPulseRepository: {
      getProfileByProjectId: mocks.getProfileByProjectId,
    },
  }),
);
vi.mock(
  "@/server/features/demand-pulse/repositories/DemandPulseFeedRepository",
  () => ({
    DemandPulseFeedRepository: {
      listLatestFeed: mocks.listLatestFeed,
      getFeedItemDetail: mocks.getFeedItemDetail,
      recordDecision: mocks.recordDecision,
    },
  }),
);

const { getLatestFeed, getFeedItemDetail } =
  await import("./DemandPulseService");
const serverFunctions = await import("@/serverFunctions/demand-pulse");
const schemas = await import("@/types/schemas/demand-pulse");
type TestServerContext = {
  projectId: string;
  userId: string;
  userEmail: string;
};
type TestServerInput = {
  data: Record<string, unknown>;
  context: TestServerContext;
};
type TestServerCall = (input: TestServerInput) => unknown;

function isTestServerCall(value: unknown): value is TestServerCall {
  return typeof value === "function";
}

function getTestServerCall(value: unknown): TestServerCall {
  if (!isTestServerCall(value)) {
    throw new TypeError("Expected a callable server function");
  }
  return value;
}

const callGetDemandPulseFeed = getTestServerCall(
  serverFunctions.getDemandPulseFeed,
);
const callRecordDemandPulseDecision = getTestServerCall(
  serverFunctions.recordDemandPulseDecision,
);

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const safeProfile = {
  id: "profile-a",
  projectId: PROJECT_A,
  enabled: true,
  dryRun: true,
  publicationDisabled: true,
};

const detailInput = {
  runId: "run-a",
  evidenceVersion: "evidence-a",
  selectionVersion: "selection-a",
  feedItemId: "feed-a",
};
const detailRequest = { projectId: PROJECT_A, ...detailInput };
const decisionInput = {
  ...detailInput,
  kind: "accept" as const,
  action: "add_faq" as const,
  reason: "The observed question needs a clearer answer.",
};
const decisionRequest = { projectId: PROJECT_A, ...decisionInput };

describe("DemandPulseService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.env, {
      DEMAND_PULSE_ENABLED: "true",
      DEMAND_PULSE_DRY_RUN: "true",
      DEMAND_PULSE_WRITE_ENABLED: "false",
    });
    mocks.getProfileByProjectId.mockResolvedValue(safeProfile);
    mocks.listLatestFeed.mockResolvedValue([]);
    mocks.getFeedItemDetail.mockResolvedValue(null);
    mocks.recordDecision.mockResolvedValue({
      id: "decision-a",
      ...decisionInput,
      projectId: PROJECT_A,
      profileId: "profile-a",
      familyId: "family-a",
      publicationTriggered: false,
    });
  });

  it("uses the authenticated project rather than request data for the latest feed", async () => {
    const feed = [{ id: "feed-a", projectId: PROJECT_A }];
    mocks.listLatestFeed.mockResolvedValue(feed);

    const result = await callGetDemandPulseFeed({
      data: { projectId: PROJECT_B },
      context: {
        projectId: PROJECT_A,
        userId: "user-a",
        userEmail: "a@example.com",
      },
    });

    expect(result).toEqual({ profile: safeProfile, items: feed });
    expect(mocks.getProfileByProjectId).toHaveBeenCalledWith(PROJECT_A);
    expect(mocks.listLatestFeed).toHaveBeenCalledWith({
      profileId: "profile-a",
      projectId: PROJECT_A,
    });
    expect(mocks.getProfileByProjectId).not.toHaveBeenCalledWith(PROJECT_B);
    expect(
      schemas.demandPulseFeedRequestSchema.safeParse({ projectId: PROJECT_B })
        .success,
    ).toBe(true);
  });

  it("fails closed for a missing, disabled, or unsafe profile", async () => {
    mocks.getProfileByProjectId.mockResolvedValue(null);
    await expect(getLatestFeed(PROJECT_A)).rejects.toThrow(
      /not configured|not found/i,
    );

    mocks.getProfileByProjectId.mockResolvedValue({
      ...safeProfile,
      enabled: false,
    });
    await expect(getLatestFeed(PROJECT_A)).rejects.toThrow(/disabled/i);

    mocks.getProfileByProjectId.mockResolvedValue({
      ...safeProfile,
      publicationDisabled: false,
    });
    await expect(getLatestFeed(PROJECT_A)).rejects.toThrow(/unsafe/i);
    expect(mocks.listLatestFeed).not.toHaveBeenCalled();
  });

  it("fails closed when runtime flags are disabled or unsafe", async () => {
    mocks.env.DEMAND_PULSE_ENABLED = "false";

    await expect(
      callGetDemandPulseFeed({
        data: { projectId: PROJECT_A },
        context: {
          projectId: PROJECT_A,
          userId: "user-a",
          userEmail: "a@example.com",
        },
      }),
    ).rejects.toThrow(/disabled|unsafe/i);
    expect(mocks.getProfileByProjectId).not.toHaveBeenCalled();

    mocks.env.DEMAND_PULSE_ENABLED = "true";
    mocks.env.DEMAND_PULSE_DRY_RUN = "false";
    await expect(
      callGetDemandPulseFeed({
        data: { projectId: PROJECT_A },
        context: {
          projectId: PROJECT_A,
          userId: "user-a",
          userEmail: "a@example.com",
        },
      }),
    ).rejects.toThrow(/disabled|unsafe/i);

    mocks.env.DEMAND_PULSE_DRY_RUN = "true";
    mocks.env.DEMAND_PULSE_WRITE_ENABLED = "true";
    await expect(
      callGetDemandPulseFeed({
        data: { projectId: PROJECT_A },
        context: {
          projectId: PROJECT_A,
          userId: "user-a",
          userEmail: "a@example.com",
        },
      }),
    ).rejects.toThrow(/disabled|unsafe/i);
  });

  it("preserves the exact profile and feed lineage for item detail", async () => {
    const detail = { feedItem: { id: "feed-a" }, decisions: [] };
    mocks.getFeedItemDetail.mockResolvedValue(detail);

    await expect(getFeedItemDetail(PROJECT_A, detailInput)).resolves.toBe(
      detail,
    );
    expect(mocks.getFeedItemDetail).toHaveBeenCalledWith({
      profileId: "profile-a",
      projectId: PROJECT_A,
      ...detailInput,
    });
    expect(
      schemas.demandPulseFeedItemRequestSchema.safeParse(detailRequest).success,
    ).toBe(true);
  });

  it("derives decision lineage from the authorized feed item and appends without publication", async () => {
    const feedItem = {
      id: "feed-a",
      projectId: PROJECT_A,
      profileId: "profile-a",
      runId: "run-a",
      familyId: "family-from-feed",
      coverageCheckId: "coverage-a",
      scoreId: "score-a",
      selectionVersion: "selection-a",
      evidenceVersion: "evidence-a",
    };
    mocks.getFeedItemDetail.mockResolvedValue({ feedItem, decisions: [] });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      callRecordDemandPulseDecision({
        data: {
          ...decisionRequest,
          familyId: "attacker-family",
          reviewedBy: "attacker",
        },
        context: {
          projectId: PROJECT_A,
          userId: "user-a",
          userEmail: "a@example.com",
        },
      }),
    ).resolves.toMatchObject({ id: "decision-a", publicationTriggered: false });

    expect(mocks.getFeedItemDetail).toHaveBeenCalledWith({
      profileId: "profile-a",
      projectId: PROJECT_A,
      ...detailInput,
    });
    expect(mocks.recordDecision).toHaveBeenCalledTimes(1);
    expect(mocks.recordDecision.mock.calls[0]?.[0]).toMatchObject({
      profileId: "profile-a",
      projectId: PROJECT_A,
      ...detailInput,
      expectedFeed: {
        familyId: "family-from-feed",
        scoreId: "score-a",
        coverageCheckId: "coverage-a",
        evidenceVersion: "evidence-a",
        selectionVersion: "selection-a",
      },
      row: {
        profileId: "profile-a",
        projectId: PROJECT_A,
        familyId: "family-from-feed",
        reviewedBy: "user-a",
        publicationTriggered: false,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("limits decisions to accept/reject and bounded canary inputs", () => {
    expect(
      schemas.demandPulseDecisionInputSchema.safeParse({
        ...decisionRequest,
        kind: "defer",
      }).success,
    ).toBe(false);
    expect(
      schemas.demandPulseDecisionInputSchema.safeParse({
        ...decisionRequest,
        action: "publish_page",
      }).success,
    ).toBe(false);
    expect(
      schemas.demandPulseDecisionInputSchema.safeParse({
        ...decisionRequest,
        reason: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      schemas.demandPulseDecisionInputSchema.safeParse({
        ...decisionRequest,
        reviewedBy: "attacker",
      }).success,
    ).toBe(false);
    expect(
      schemas.demandPulseDecisionInputSchema.safeParse({
        ...decisionRequest,
        familyId: "attacker-family",
      }).success,
    ).toBe(false);
  });
});
