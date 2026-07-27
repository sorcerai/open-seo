import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  demandPulseProfiles,
  demandPulseRuns,
  demandPulseSources,
} from "@/db/schema";
import {
  collectSqlObjects,
  collectSqlParams,
  demandPulseDbMocks as mocks,
} from "./DemandPulseRepository.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: mocks.db }));

const { DemandPulseRepository } = await import("./DemandPulseRepository");

const approvedSource = {
  id: "source-1",
  profileId: "profile-1",
  adapter: "manual",
  identityKey: "source-key",
  sourceClass: "first_party_observed" as const,
  canonicalUrl: "https://example.com/questions",
  recordKey: "record-1",
  discoveryProvenance: "operator",
  policyState: "allowed",
  approvalState: "approved" as const,
  enabled: true,
  version: 7,
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-07-27T12:00:00.000Z",
  createdAt: "2026-07-27 11:00:00",
  updatedAt: "2026-07-27 12:00:00",
};
const run = {
  id: "run-1",
  profileId: "profile-1",
  localDate: "2026-07-27",
  status: "running" as const,
  startedAt: "2026-07-27 12:00:00",
  completedAt: null,
  sourceCount: 0,
  healthySourceCount: 0,
  failedSourceCount: 0,
  blockedSourceCount: 0,
  unknownSourceCount: 0,
  skippedSourceCount: 0,
  artifactKey: null,
  errorMessage: null,
};

describe("DemandPulseRepository scoped reads and completion", () => {
  beforeEach(() => mocks.reset());

  it("scopes source and run reads through the project profile", async () => {
    mocks.state.selectRows = [approvedSource];
    await expect(
      DemandPulseRepository.listSourcesByProject("project-1"),
    ).resolves.toEqual([approvedSource]);
    expect(collectSqlObjects(mocks.state.selectWheres[0])).toContain(
      demandPulseProfiles.projectId,
    );
    expect(collectSqlParams(mocks.state.selectWheres[0])).toContain(
      "project-1",
    );
    expect(mocks.state.selectJoins[0].table).toBe(demandPulseProfiles);
    expect(collectSqlObjects(mocks.state.selectJoins[0].on)).toEqual(
      expect.arrayContaining([
        demandPulseSources.profileId,
        demandPulseProfiles.id,
      ]),
    );

    mocks.state.selectRows = [run];
    await expect(
      DemandPulseRepository.getRunByIdForProject("run-1", "project-1"),
    ).resolves.toEqual(run);
    expect(collectSqlObjects(mocks.state.selectWheres[1])).toEqual(
      expect.arrayContaining([
        demandPulseRuns.id,
        demandPulseProfiles.projectId,
      ]),
    );
    expect(collectSqlParams(mocks.state.selectWheres[1])).toEqual(
      expect.arrayContaining(["run-1", "project-1"]),
    );
    expect(mocks.state.selectJoins[1].table).toBe(demandPulseProfiles);
    expect(collectSqlObjects(mocks.state.selectJoins[1].on)).toEqual(
      expect.arrayContaining([
        demandPulseRuns.profileId,
        demandPulseProfiles.id,
      ]),
    );
  });

  it("completes only the requested run and profile", async () => {
    mocks.state.updateRows = [[run]];
    await expect(
      DemandPulseRepository.completeRun({
        runId: "run-1",
        profileId: "profile-1",
        status: "completed",
        sourceCount: 1,
        healthySourceCount: 1,
        failedSourceCount: 0,
        blockedSourceCount: 0,
        unknownSourceCount: 0,
        skippedSourceCount: 0,
        artifactKey: "artifact-1",
        errorMessage: null,
        completedAt: "2026-07-27 12:01:00",
      }),
    ).resolves.toEqual(run);

    const keys = Object.keys(mocks.state.updateSets[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "artifactKey",
        "blockedSourceCount",
        "completedAt",
        "errorMessage",
        "failedSourceCount",
        "healthySourceCount",
        "skippedSourceCount",
        "sourceCount",
        "status",
        "unknownSourceCount",
      ]),
    );
    expect(keys).toHaveLength(10);
    expect(collectSqlObjects(mocks.state.updateWheres[0])).toEqual(
      expect.arrayContaining([demandPulseRuns.id, demandPulseRuns.profileId]),
    );
    expect(collectSqlParams(mocks.state.updateWheres[0])).toEqual(
      expect.arrayContaining(["run-1", "profile-1"]),
    );
  });
});
