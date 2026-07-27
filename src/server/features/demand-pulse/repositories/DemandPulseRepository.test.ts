import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  demandPulseProfiles,
  demandPulseRuns,
  demandPulseSources,
  demandPulseSourceRuns,
} from "@/db/schema";
import {
  collectSqlObjects,
  collectSqlParams,
  collectSqlText,
  demandPulseDbMocks as mocks,
} from "./DemandPulseRepository.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: mocks.db }));

const { DemandPulseRepository } = await import("./DemandPulseRepository");

const pendingSource = {
  profileId: "profile-1",
  adapter: "manual",
  identityKey: "source-key",
  sourceClass: "first_party_observed" as const,
  canonicalUrl: "https://example.com/questions",
  recordKey: "record-1",
  discoveryProvenance: "operator",
};
const approvedSource = {
  id: "source-1",
  ...pendingSource,
  policyState: "allowed",
  approvalState: "approved" as const,
  enabled: true,
  version: 7,
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-07-27T12:00:00.000Z",
  createdAt: "2026-07-27 11:00:00",
  updatedAt: "2026-07-27 12:00:00",
};
const rejectedSource = {
  ...approvedSource,
  approvalState: "rejected" as const,
  policyState: "blocked",
  enabled: false,
};
const profile = { id: "profile-1", projectId: "project-1" };
const failedSourceRun = {
  id: "source-run-1",
  profileId: "profile-1",
  runId: "run-1",
  sourceId: "source-1",
  health: "failed" as const,
  policyState: "blocked",
  costMicros: 500,
  errorMessage: "timeout",
};
const healthySourceRun = {
  ...failedSourceRun,
  health: "healthy" as const,
  policyState: "allowed",
  costMicros: 0,
  errorMessage: null,
};
const run = {
  id: "run-1",
  profileId: "profile-1",
  localDate: "2026-07-27",
  status: "completed",
  scoringVersion: "v1",
};
const dailyInput = {
  profileId: "profile-1",
  localDate: "2026-07-27",
  scoringVersion: "v1",
};

describe("DemandPulseRepository", () => {
  beforeEach(() => mocks.reset());

  it("returns a profile through its project id", async () => {
    mocks.state.selectRows = [profile];
    await expect(
      DemandPulseRepository.getProfileByProjectId("project-1"),
    ).resolves.toEqual(profile);

    expect(collectSqlObjects(mocks.state.selectWheres[0])).toContain(
      demandPulseProfiles.projectId,
    );
    expect(collectSqlParams(mocks.state.selectWheres[0])).toContain(
      "project-1",
    );
  });

  it("preserves approved and rejected decisions when a source is discovered again", async () => {
    mocks.state.insertRows = [[approvedSource], [rejectedSource]];

    await expect(
      DemandPulseRepository.upsertPendingSource(pendingSource),
    ).resolves.toEqual(approvedSource);
    await expect(
      DemandPulseRepository.upsertPendingSource(pendingSource),
    ).resolves.toEqual(rejectedSource);
    for (const values of mocks.state.insertValues) {
      expect(values).toMatchObject({
        policyState: "unknown",
        approvalState: "pending",
        enabled: false,
        version: 1,
      });
    }

    expect(mocks.state.insertConflicts).toHaveLength(2);
    for (const conflict of mocks.state.insertConflicts) {
      expect(conflict.target).toEqual([
        demandPulseSources.profileId,
        demandPulseSources.adapter,
        demandPulseSources.identityKey,
      ]);
      expect(conflict.set).not.toHaveProperty("approvalState");
      expect(conflict.set).not.toHaveProperty("enabled");
      expect(conflict.set).not.toHaveProperty("policyState");
      expect(conflict.set).not.toHaveProperty("version");
      expect(conflict.set).not.toHaveProperty("reviewedBy");
      expect(conflict.set).not.toHaveProperty("reviewedAt");
    }
  });

  it("claims new daily runs and reuses the exact row on conflict", async () => {
    mocks.state.insertRows = [[run]];
    await expect(
      DemandPulseRepository.claimDailyRun(dailyInput),
    ).resolves.toEqual({ run, claimed: true });
    expect(mocks.state.insertConflicts[0].target).toEqual([
      demandPulseRuns.profileId,
      demandPulseRuns.localDate,
    ]);

    mocks.reset();
    mocks.state.insertRows = [[]];
    mocks.state.selectRows = [run];
    await expect(
      DemandPulseRepository.claimDailyRun(dailyInput),
    ).resolves.toEqual({ run, claimed: false });
    expect(collectSqlObjects(mocks.state.selectWheres[0])).toEqual(
      expect.arrayContaining([
        demandPulseRuns.profileId,
        demandPulseRuns.localDate,
      ]),
    );
    expect(collectSqlParams(mocks.state.selectWheres[0])).toEqual(
      expect.arrayContaining(["profile-1", "2026-07-27"]),
    );

    mocks.reset();
    mocks.state.insertRows = [[]];
    await expect(
      DemandPulseRepository.claimDailyRun(dailyInput),
    ).rejects.toThrow("conflict row missing");
  });

  it("preserves source-run health and clears an old error on healthy retry", async () => {
    mocks.state.insertRows = [[failedSourceRun], [healthySourceRun]];
    const failedInput = {
      profileId: "profile-1",
      runId: "run-1",
      sourceId: "source-1",
      health: "failed" as const,
      policyState: "blocked",
      requestCount: 2,
      costMicros: 500,
      errorMessage: "timeout",
    };
    const healthyInput = {
      ...failedInput,
      health: "healthy" as const,
      policyState: "allowed",
      requestCount: 1,
      costMicros: 0,
      errorMessage: null,
    };

    await expect(
      DemandPulseRepository.recordSourceRun(failedInput),
    ).resolves.toEqual(failedSourceRun);
    await expect(
      DemandPulseRepository.recordSourceRun(healthyInput),
    ).resolves.toEqual(healthySourceRun);

    const where = mocks.state.selectWheres[0];
    expect(collectSqlObjects(where)).toEqual(
      expect.arrayContaining([
        demandPulseSourceRuns.runId,
        demandPulseSourceRuns.sourceId,
      ]),
    );
    expect(collectSqlParams(where)).toEqual(
      expect.arrayContaining(["run-1", "source-1"]),
    );
    const conflict = mocks.state.insertConflicts[0];
    expect(conflict).toMatchObject({
      kind: "update",
      target: [demandPulseSourceRuns.runId, demandPulseSourceRuns.sourceId],
    });
    expect(collectSqlObjects(conflict.setWhere)).toContain(
      demandPulseSourceRuns.profileId,
    );
    expect(collectSqlParams(conflict.setWhere)).toContain("profile-1");
    expect(conflict.set).toMatchObject({
      health: "failed",
      policyState: "blocked",
      costMicros: 500,
      errorMessage: "timeout",
    });
    expect(mocks.state.insertConflicts[1].set).toMatchObject({
      health: "healthy",
      policyState: "allowed",
      costMicros: 0,
      errorMessage: null,
    });
  });

  it("rejects a source-run conflict owned by another profile before writing", async () => {
    mocks.state.selectRows = [{ profileId: "profile-2" }];
    await expect(
      DemandPulseRepository.recordSourceRun({
        profileId: "profile-1",
        runId: "run-1",
        sourceId: "source-1",
        health: "failed",
        policyState: "blocked",
        requestCount: 1,
        costMicros: 10,
        errorMessage: "wrong profile",
      }),
    ).rejects.toThrow("profile mismatch");
    expect(mocks.state.insertCalls).toBe(0);

    mocks.reset();
    mocks.state.insertRows = [[]];
    await expect(
      DemandPulseRepository.recordSourceRun({
        profileId: "profile-1",
        runId: "run-1",
        sourceId: "source-1",
        health: "failed",
        policyState: "blocked",
        requestCount: 1,
        costMicros: 10,
        errorMessage: "empty return",
      }),
    ).rejects.toThrow("profile mismatch");
  });

  it("reviews only the expected source version and enables approved sources with allowed policy", async () => {
    mocks.state.selectRows = [{ profileId: "profile-1" }];
    mocks.state.updateRows = [[{ ...approvedSource, version: 5 }]];
    await expect(
      DemandPulseRepository.reviewSource({
        sourceId: "source-1",
        projectId: "project-1",
        expectedVersion: 4,
        approvalState: "approved",
        reviewedBy: "reviewer-2",
        reviewedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toMatchObject({ version: 5 });

    expect(collectSqlObjects(mocks.state.selectWheres[0])).toEqual(
      expect.arrayContaining([
        demandPulseSources.id,
        demandPulseProfiles.projectId,
      ]),
    );
    expect(collectSqlParams(mocks.state.selectWheres[0])).toEqual(
      expect.arrayContaining(["source-1", "project-1"]),
    );
    expect(mocks.state.selectJoins[0].table).toBe(demandPulseProfiles);
    expect(collectSqlObjects(mocks.state.selectJoins[0].on)).toEqual(
      expect.arrayContaining([
        demandPulseSources.profileId,
        demandPulseProfiles.id,
      ]),
    );
    expect(mocks.state.updateSets[0]).toMatchObject({
      approvalState: "approved",
      enabled: true,
      policyState: "allowed",
      reviewedBy: "reviewer-2",
      reviewedAt: "2026-07-27T13:00:00.000Z",
    });
    expect(collectSqlObjects(mocks.state.updateSets[0].version)).toContain(
      demandPulseSources.version,
    );
    expect(collectSqlText(mocks.state.updateSets[0].version)).toContain("+ 1");
    expect(collectSqlObjects(mocks.state.updateWheres[0])).toEqual(
      expect.arrayContaining([
        demandPulseSources.id,
        demandPulseSources.profileId,
        demandPulseSources.version,
      ]),
    );
    expect(collectSqlParams(mocks.state.updateWheres[0])).toEqual(
      expect.arrayContaining(["source-1", "profile-1", 4]),
    );
  });

  it("transitions rejected sources to blocked and disabled", async () => {
    mocks.state.selectRows = [{ profileId: "profile-1" }];
    mocks.state.updateRows = [
      [
        {
          ...approvedSource,
          approvalState: "rejected",
          enabled: false,
          policyState: "blocked",
          version: 5,
        },
      ],
    ];

    await expect(
      DemandPulseRepository.reviewSource({
        sourceId: "source-1",
        projectId: "project-1",
        expectedVersion: 4,
        approvalState: "rejected",
        reviewedBy: "reviewer-2",
        reviewedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      approvalState: "rejected",
      enabled: false,
      policyState: "blocked",
      version: 5,
    });

    expect(mocks.state.updateSets[0]).toMatchObject({
      approvalState: "rejected",
      enabled: false,
      policyState: "blocked",
    });
  });

  it("returns null when a source review loses its optimistic-version race", async () => {
    mocks.state.selectRows = [{ profileId: "profile-1" }];
    mocks.state.updateRows = [[]];
    await expect(
      DemandPulseRepository.reviewSource({
        sourceId: "source-1",
        projectId: "project-1",
        expectedVersion: 4,
        approvalState: "rejected",
        reviewedBy: "reviewer-2",
        reviewedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });
});
