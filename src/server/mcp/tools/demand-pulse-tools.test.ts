import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExtra } from "@/server/mcp/context";
import { MCP_AUTH_CONTEXT_PROP } from "@/server/mcp/context";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getLatestFeed: vi.fn(),
  getFeedItemDetail: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

vi.mock("@/server/features/demand-pulse/services/DemandPulseService", () => ({
  getLatestFeed: mocks.getLatestFeed,
  getFeedItemDetail: mocks.getFeedItemDetail,
}));

const authContext = {
  userId: "user_123",
  userEmail: "alice@example.com",
  organizationId: "org_123",
  clientId: "client_123",
  scopes: ["mcp"],
  audience: "https://open-seo.test/mcp",
  subject: "user_123",
  baseUrl: "https://open-seo.test",
};

const toolExtra: ToolExtra = {
  signal: new AbortController().signal,
  requestId: 1,
  sendNotification: vi.fn(),
  sendRequest: vi.fn(),
  authInfo: {
    token: "token",
    clientId: "client_123",
    scopes: ["mcp"],
    resource: new URL("https://open-seo.test/mcp"),
    extra: { [MCP_AUTH_CONTEXT_PROP]: authContext },
  } satisfies AuthInfo,
};

const project = {
  id: "project_1",
  locationCode: 2840,
  languageCode: "en",
};

function text(result: { content?: Array<{ type: string; text?: string }> }) {
  const first = result.content?.[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("Demand Pulse MCP read tools", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getProjectForOrganization.mockReset();
    mocks.getLatestFeed.mockReset();
    mocks.getFeedItemDetail.mockReset();
    mocks.getProjectForOrganization.mockResolvedValue(project);
  });

  it("passes the authorized project to the service and represents the bounded feed", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `feed_${index + 1}`,
      rank: index + 1,
      title: `Candidate ${index + 1}`,
      provenance: "observed",
      reason: "Observed demand",
    }));
    const profile = { id: "profile_1", projectId: project.id };
    mocks.getLatestFeed.mockResolvedValue({ profile, items });
    const { getDemandPulseFeedTool } = await import("./demand-pulse-tools");

    const result = await getDemandPulseFeedTool.handler(
      { projectId: project.id },
      toolExtra,
    );

    expect(mocks.getProjectForOrganization).toHaveBeenCalledWith(
      "org_123",
      project.id,
    );
    expect(mocks.getLatestFeed).toHaveBeenCalledWith(project.id);
    expect(result.structuredContent).toMatchObject({ profile, items });
    expect(result.structuredContent?.items).toHaveLength(5);
    expect(text(result)).toContain("provenance: observed");
  });

  it("rejects an unauthorized project before calling the service", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);
    const { getDemandPulseFeedTool } = await import("./demand-pulse-tools");

    await expect(
      getDemandPulseFeedTool.handler({ projectId: "other_project" }, toolExtra),
    ).rejects.toThrow();
    expect(mocks.getLatestFeed).not.toHaveBeenCalled();
  });

  it("passes exact detail lineage and returns provenance, score, coverage, and evidence", async () => {
    const lineage = {
      runId: "run_1",
      evidenceVersion: "evidence_v1",
      selectionVersion: "selection_v1",
      feedItemId: "feed_1",
    };
    const detail = {
      feedItem: {
        id: lineage.feedItemId,
        projectId: project.id,
        runId: lineage.runId,
        evidenceVersion: lineage.evidenceVersion,
        selectionVersion: lineage.selectionVersion,
        provenance: "observed",
        title: "Candidate",
      },
      score: { priorityScore: 92, confidence: 0.82 },
      coverageCheck: { status: "gap", reason: "No matching page" },
      family: { id: "family_1", canonicalQuestion: "How?" },
      familyEvidence: [{ id: "evidence_1", eventId: "event_1" }],
      decisions: [],
    };
    mocks.getFeedItemDetail.mockResolvedValue(detail);
    const { getDemandPulseFeedItemTool } = await import("./demand-pulse-tools");

    const result = await getDemandPulseFeedItemTool.handler(
      { projectId: project.id, ...lineage },
      toolExtra,
    );

    expect(mocks.getFeedItemDetail).toHaveBeenCalledWith(project.id, lineage);
    expect(result.structuredContent).toMatchObject(detail);
    expect(result.structuredContent?.provenance).toBe("observed");
    expect(result.structuredContent?.evidence).toEqual(detail.familyEvidence);
    expect(text(result)).toContain("Provenance: observed");
    expect(text(result)).toContain("Evidence: 1");
  });

  it("exports exactly the two Demand Pulse read tools, with no mutation tool", async () => {
    const tools = await import("./demand-pulse-tools");

    expect(Object.keys(tools).toSorted()).toEqual([
      "getDemandPulseFeedItemTool",
      "getDemandPulseFeedTool",
    ]);
    expect(Object.keys(tools)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/decision|publish/i)]),
    );
  });
});
