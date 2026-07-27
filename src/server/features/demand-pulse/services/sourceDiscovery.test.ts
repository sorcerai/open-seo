import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DemandPulseRepository,
  type DemandPulseProfile,
  type DemandPulseSource,
  type PendingSourceInput,
} from "../repositories/DemandPulseRepository";
import {
  evaluateSourceGate,
  type DemandSourceApprovalGate,
  type DemandSourcePolicyState,
} from "../sources/adapter";
import {
  discoverOnFarmCompostSources,
  listSourceProposals,
  reviewSourceProposal,
} from "./sourceDiscovery";

vi.mock("../repositories/DemandPulseRepository", () => ({
  DemandPulseRepository: {
    getProfileByProjectId: vi.fn(),
    upsertPendingSource: vi.fn(),
    listSourcesByProject: vi.fn(),
    reviewSource: vi.fn(),
  },
}));

// vi.mock replaces the module before these static imports resolve, so the
// imported DemandPulseRepository is the mock at runtime. vi.mocked widens each
// method to its MockedFunction type so .mock / mockResolvedValue /
// mockImplementation type-check against the real call and return signatures.
const repo = {
  getProfileByProjectId: vi.mocked(DemandPulseRepository.getProfileByProjectId),
  upsertPendingSource: vi.mocked(DemandPulseRepository.upsertPendingSource),
  listSourcesByProject: vi.mocked(DemandPulseRepository.listSourcesByProject),
  reviewSource: vi.mocked(DemandPulseRepository.reviewSource),
};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "demand-pulse-profile-onfarmcompost";

const profile: DemandPulseProfile = {
  id: PROFILE_ID,
  projectId: PROJECT_ID,
  policyRepository: "sorcerai/onfarmcompost",
  policyCommit: "4d436f12ab2853410e1f4930f4cb0ee3b82cad93",
  policyPath: "docs/CONTENT_INTELLIGENCE_OS.md",
  enabled: true,
  dryRun: true,
  publicationDisabled: true,
  timezone: "America/Chicago",
  dailyBudgetMicros: 1_000_000,
  scoringVersion: "v1",
  createdAt: "2026-07-27T11:00:00.000Z",
  updatedAt: "2026-07-27T11:00:00.000Z",
};

function pendingSourceRow(input: PendingSourceInput): DemandPulseSource {
  return {
    id: `src:${input.adapter}:${input.identityKey}`,
    profileId: input.profileId,
    adapter: input.adapter,
    identityKey: input.identityKey,
    sourceClass: input.sourceClass,
    canonicalUrl: input.canonicalUrl,
    recordKey: input.recordKey,
    approvalState: "pending",
    policyState: "unknown",
    enabled: false,
    discoveryProvenance: input.discoveryProvenance,
    version: 1,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
  } as DemandPulseSource;
}

function isDemandSourcePolicyState(
  value: string,
): value is DemandSourcePolicyState {
  return (
    value === "unknown" ||
    value === "pending" ||
    value === "allowed" ||
    value === "blocked"
  );
}

function sourceGate(source: DemandPulseSource): DemandSourceApprovalGate {
  if (!isDemandSourcePolicyState(source.policyState)) {
    throw new Error(`Unexpected source policy state: ${source.policyState}`);
  }
  return {
    approvalState: source.approvalState,
    enabled: source.enabled,
    policyState: source.policyState,
  };
}

function identityOf(candidate: {
  adapter: string;
  identityKey: string;
}): string {
  return `${candidate.adapter}:${candidate.identityKey}`;
}

beforeEach(() => {
  repo.getProfileByProjectId.mockReset();
  repo.upsertPendingSource.mockReset();
  repo.listSourcesByProject.mockReset();
  repo.reviewSource.mockReset();
  repo.getProfileByProjectId.mockResolvedValue(profile);
  repo.upsertPendingSource.mockImplementation(async (input) =>
    pendingSourceRow(input),
  );
});

describe("discoverOnFarmCompostSources", () => {
  it("requires a non-empty projectId and never reaches the repository", async () => {
    await expect(
      discoverOnFarmCompostSources({ projectId: "   " }),
    ).rejects.toThrow(/projectId is required/);
    expect(repo.getProfileByProjectId).not.toHaveBeenCalled();
    expect(repo.upsertPendingSource).not.toHaveBeenCalled();
  });

  it("fails when no demand-pulse profile is registered for the project", async () => {
    vi.mocked(repo.getProfileByProjectId).mockResolvedValue(null);
    await expect(
      discoverOnFarmCompostSources({ projectId: PROJECT_ID }),
    ).rejects.toThrow(/No demand pulse profile is registered/);
    expect(repo.upsertPendingSource).not.toHaveBeenCalled();
  });

  it("fails closed when the resolved profile is not the registered canary", async () => {
    vi.mocked(repo.getProfileByProjectId).mockResolvedValue({
      ...profile,
      policyRepository: "other/repo",
      policyCommit: "deadbeef",
      policyPath: "other.md",
    });
    await expect(
      discoverOnFarmCompostSources({ projectId: PROJECT_ID }),
    ).rejects.toThrow(/is not the registered OnFarmCompost canary/);
    expect(repo.upsertPendingSource).not.toHaveBeenCalled();
  });

  it("fails closed when the canary profile is not in safe mode", async () => {
    vi.mocked(repo.getProfileByProjectId).mockResolvedValue({
      ...profile,
      publicationDisabled: false,
    });
    await expect(
      discoverOnFarmCompostSources({ projectId: PROJECT_ID }),
    ).rejects.toThrow(/is not the registered OnFarmCompost canary/);
    expect(repo.upsertPendingSource).not.toHaveBeenCalled();
  });

  it("persists every candidate as pending and disabled through repository semantics", async () => {
    const result = await discoverOnFarmCompostSources({
      projectId: PROJECT_ID,
      domain: "onfarmcompost.com",
    });

    expect(result.candidateCount).toBe(result.sources.length);
    expect(result.profileId).toBe(PROFILE_ID);
    expect(result.projectId).toBe(PROJECT_ID);

    for (const source of result.sources) {
      expect(source.approvalState).toBe("pending");
      expect(source.enabled).toBe(false);
      expect(source.profileId).toBe(PROFILE_ID);
    }

    for (const [input] of repo.upsertPendingSource.mock.calls) {
      // The service must never carry approval/enabled/version/policy state;
      // the repository owns those, so a rediscovery can never reset a decision.
      expect(input).not.toHaveProperty("approvalState");
      expect(input).not.toHaveProperty("enabled");
      expect(input).not.toHaveProperty("version");
      expect(input).not.toHaveProperty("policyState");
      expect(input.profileId).toBe(PROFILE_ID);
    }
  });

  it("applies the repository review transition before evaluating the canonical fetch gate", async () => {
    const persisted = new Map<string, DemandPulseSource>();
    repo.upsertPendingSource.mockImplementation(async (input) => {
      const existing = [...persisted.values()].find(
        (source) =>
          source.profileId === input.profileId &&
          source.adapter === input.adapter &&
          source.identityKey === input.identityKey,
      );
      if (existing) return existing;

      const source = pendingSourceRow(input);
      persisted.set(source.id, source);
      return source;
    });
    repo.reviewSource.mockImplementation(async (input) => {
      const current = persisted.get(input.sourceId);
      if (
        !current ||
        current.profileId !== PROFILE_ID ||
        current.version !== input.expectedVersion
      ) {
        return null;
      }

      const reviewed: DemandPulseSource = {
        ...current,
        approvalState: input.approvalState,
        policyState: input.approvalState === "approved" ? "allowed" : "blocked",
        enabled: input.approvalState === "approved",
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        version: current.version + 1,
        updatedAt: input.reviewedAt,
      };
      persisted.set(reviewed.id, reviewed);
      return reviewed;
    });

    const discovered = await discoverOnFarmCompostSources({
      projectId: PROJECT_ID,
    });
    const pendingApproved = discovered.sources[0];
    const pendingRejected = discovered.sources[1];
    expect(pendingApproved).toMatchObject({
      approvalState: "pending",
      enabled: false,
      policyState: "unknown",
    });

    const approved = await reviewSourceProposal({
      projectId: PROJECT_ID,
      sourceId: pendingApproved.id,
      expectedVersion: pendingApproved.version,
      approvalState: "approved",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-07-27T13:00:00.000Z",
    });
    expect(approved).toMatchObject({
      approvalState: "approved",
      enabled: true,
      policyState: "allowed",
    });
    expect(evaluateSourceGate(sourceGate(approved!))).toEqual({
      allowed: true,
      policyState: "allowed",
    });

    const rejected = await reviewSourceProposal({
      projectId: PROJECT_ID,
      sourceId: pendingRejected.id,
      expectedVersion: pendingRejected.version,
      approvalState: "rejected",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-07-27T13:00:00.000Z",
    });
    expect(rejected).toMatchObject({
      approvalState: "rejected",
      enabled: false,
      policyState: "blocked",
    });
    expect(evaluateSourceGate(sourceGate(rejected!))).toMatchObject({
      allowed: false,
      policyState: "blocked",
    });
  });

  it("is idempotent: identical inputs drive identical upsert calls in the same order", async () => {
    const input = {
      projectId: PROJECT_ID,
      domain: "onfarmcompost.com",
      gscSiteUrl: "sc-domain:onfarmcompost.com",
    };
    const first = await discoverOnFarmCompostSources(input);
    const second = await discoverOnFarmCompostSources(input);

    const firstKeys = first.candidates.map(identityOf);
    expect(second.candidates.map(identityOf)).toEqual(firstKeys);

    const firstCalls = repo.upsertPendingSource.mock.calls
      .slice(0, firstKeys.length)
      .map(([c]) => `${c.adapter}:${c.identityKey}`);
    const secondCalls = repo.upsertPendingSource.mock.calls
      .slice(firstKeys.length)
      .map(([c]) => `${c.adapter}:${c.identityKey}`);
    expect(secondCalls).toEqual(firstCalls);
  });
});

describe("listSourceProposals", () => {
  it("requires a non-empty projectId", async () => {
    await expect(listSourceProposals("")).rejects.toThrow(
      /projectId is required/,
    );
    expect(repo.listSourcesByProject).not.toHaveBeenCalled();
  });

  it("delegates project-scoped listing to the repository", async () => {
    const rows = [
      pendingSourceRow({
        profileId: PROFILE_ID,
        adapter: "official-page-monitor",
        identityKey: "official-page:tceq-composting-and-mulching",
        sourceClass: "primary_authoritative",
        canonicalUrl: "https://example.com/",
        recordKey: "tceq-composting-and-mulching",
        discoveryProvenance: "canary:onfarmcompost:official-seed",
      }),
    ];
    vi.mocked(repo.listSourcesByProject).mockResolvedValue(rows);

    await expect(listSourceProposals(PROJECT_ID)).resolves.toEqual(rows);
    expect(repo.listSourcesByProject).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("reviewSourceProposal", () => {
  const baseReview = {
    projectId: PROJECT_ID,
    sourceId: "src-1",
    expectedVersion: 3,
    approvalState: "approved" as const,
    reviewedBy: "reviewer-1",
    reviewedAt: "2026-07-27T13:00:00.000Z",
  };

  it("requires projectId, sourceId, and reviewedBy", async () => {
    await expect(
      reviewSourceProposal({ ...baseReview, projectId: "  " }),
    ).rejects.toThrow(/projectId is required/);
    await expect(
      reviewSourceProposal({ ...baseReview, sourceId: "" }),
    ).rejects.toThrow(/sourceId is required/);
    await expect(
      reviewSourceProposal({ ...baseReview, reviewedBy: "   " }),
    ).rejects.toThrow(/reviewedBy is required/);
    expect(repo.reviewSource).not.toHaveBeenCalled();
  });

  it("requires a positive integer expectedVersion", async () => {
    await expect(
      reviewSourceProposal({ ...baseReview, expectedVersion: 0 }),
    ).rejects.toThrow(/expectedVersion must be a positive integer/);
    await expect(
      reviewSourceProposal({ ...baseReview, expectedVersion: 2.5 }),
    ).rejects.toThrow(/expectedVersion must be a positive integer/);
  });

  it("rejects an unparseable reviewedAt", async () => {
    await expect(
      reviewSourceProposal({ ...baseReview, reviewedAt: "not-a-date" }),
    ).rejects.toThrow(/reviewedAt is not a parseable timestamp/);
  });

  it("delegates project-scoped optimistic review to the repository", async () => {
    const reviewed = pendingSourceRow({
      profileId: PROFILE_ID,
      adapter: "official-page-monitor",
      identityKey: "official-page:tceq-composting-and-mulching",
      sourceClass: "primary_authoritative",
      canonicalUrl: "https://example.com/",
      recordKey: "tceq-composting-and-mulching",
      discoveryProvenance: "canary:onfarmcompost:official-seed",
    });
    vi.mocked(repo.reviewSource).mockResolvedValue(reviewed);

    await expect(reviewSourceProposal(baseReview)).resolves.toEqual(reviewed);
    expect(repo.reviewSource).toHaveBeenCalledWith({
      sourceId: "src-1",
      projectId: PROJECT_ID,
      expectedVersion: 3,
      approvalState: "approved",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-07-27T13:00:00.000Z",
    });
  });

  it("returns null when the optimistic-version race is lost", async () => {
    vi.mocked(repo.reviewSource).mockResolvedValue(null);
    await expect(
      reviewSourceProposal({ ...baseReview, approvalState: "rejected" }),
    ).resolves.toBeNull();
  });
});
