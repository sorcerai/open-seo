import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  demandPulseFeedItems,
  demandPulseProfiles,
  demandPulseRuns,
} from "@/db/schema";
import {
  collectSqlObjects,
  collectSqlParams,
} from "./DemandPulseRepository.test-utils";
import type {
  DemandPulseDecisionRowInput,
  DemandPulseFeedItemInput,
} from "./DemandPulseFeedRepository";

const { db, state } = vi.hoisted(() => {
  type SelectCapture = {
    table?: unknown;
    joins: Array<{ table: unknown; on: unknown }>;
    where?: unknown;
    orderBy: unknown[];
    limit?: number;
  };
  type SelectChain = Promise<unknown[]> & {
    innerJoin: (table: unknown, on: unknown) => SelectChain;
    where: (where: unknown) => SelectChain;
    orderBy: (...orderBy: unknown[]) => SelectChain;
    limit: (limit: number) => Promise<unknown[]>;
  };
  const nextRows: unknown[][] = [];
  const mockState = {
    selectRows: nextRows,
    selects: [] as SelectCapture[],
    insertCalls: 0,
    insertValues: [] as unknown[],
    insertConflicts: [] as unknown[],
    insertRows: [] as unknown[][],
    updateCalls: 0,
    reset() {
      nextRows.length = 0;
      mockState.selects.length = 0;
      mockState.insertCalls = 0;
      mockState.insertValues.length = 0;
      mockState.insertConflicts.length = 0;
      mockState.insertRows.length = 0;
      mockState.updateCalls = 0;
    },
  };

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      const rows = mockState.selectRows.shift() ?? [];
      const capture: SelectCapture = {
        table,
        joins: [],
        orderBy: [],
      };
      mockState.selects.push(capture);
      const chain: SelectChain = Object.assign(Promise.resolve(rows), {
        innerJoin: vi.fn((joinTable: unknown, on: unknown) => {
          capture.joins.push({ table: joinTable, on });
          return chain;
        }),
        where: vi.fn((where: unknown) => {
          capture.where = where;
          return chain;
        }),
        orderBy: vi.fn((...orderBy: unknown[]) => {
          capture.orderBy = orderBy;
          return chain;
        }),
        limit: vi.fn((limit: number) => {
          capture.limit = limit;
          return Promise.resolve(rows.slice(0, limit));
        }),
      });
      return chain;
    }),
  }));

  const insert = vi.fn((table: unknown) => {
    mockState.insertCalls += 1;
    return {
      values: vi.fn((values: unknown) => {
        mockState.insertValues.push({ table, values });
        const operation = {
          onConflictDoNothing: vi.fn((config: unknown) => {
            mockState.insertConflicts.push(config);
            return operation;
          }),
          returning: vi.fn(() =>
            Promise.resolve(mockState.insertRows.shift() ?? []),
          ),
        };
        return operation;
      }),
    };
  });

  const update = vi.fn(() => {
    mockState.updateCalls += 1;
    throw new Error("updates are not allowed");
  });

  return { db: { select, insert, update }, state: mockState };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db }));

const { DemandPulseFeedRepository } =
  await import("./DemandPulseFeedRepository");

const scope = {
  profileId: "profile-1",
  projectId: "project-1",
  runId: "run-1",
  evidenceVersion: "evidence-1",
};
const selectionScope = { ...scope, selectionVersion: "selection-1" };

const makeFeedInput = (
  overrides: Partial<DemandPulseFeedItemInput> = {},
): DemandPulseFeedItemInput => ({
  id: "feed-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  familyId: "family-1",
  coverageCheckId: "coverage-1",
  scoreId: "score-1",
  selectionVersion: selectionScope.selectionVersion,
  evidenceVersion: scope.evidenceVersion,
  rank: 1,
  title: "Question",
  recommendedAction: "add_faq",
  provenance: "observed",
  reason: "Observed demand",
  ...overrides,
});

const makeDecision = (
  overrides: Partial<DemandPulseDecisionRowInput> = {},
): DemandPulseDecisionRowInput => ({
  id: "decision-1",
  projectId: scope.projectId,
  profileId: scope.profileId,
  runId: scope.runId,
  feedItemId: "feed-1",
  familyId: "family-1",
  kind: "accept",
  action: "add_faq",
  reason: "Useful and supported",
  reviewedBy: "reviewer-1",
  ...overrides,
});

const asStoredFeed = (input: DemandPulseFeedItemInput) => ({
  ...input,
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
});

describe("DemandPulseFeedRepository", () => {
  beforeEach(() => state.reset());

  it("rejects more than five feed rows and duplicate ranks before any DB call", async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      makeFeedInput({ id: `feed-${index}`, rank: index === 5 ? 1 : index + 1 }),
    );

    await expect(
      DemandPulseFeedRepository.persistFeedItems({ scope, rows }),
    ).rejects.toThrow("at most five");
    expect(state.selects).toHaveLength(0);
    expect(state.insertCalls).toBe(0);

    await expect(
      DemandPulseFeedRepository.persistFeedItems({
        scope,
        rows: [
          makeFeedInput(),
          makeFeedInput({ id: "feed-2", familyId: "family-2" }),
        ],
      }),
    ).rejects.toThrow("rank");
    expect(state.selects).toHaveLength(0);
    expect(state.insertCalls).toBe(0);
  });

  it("rejects mixed project/profile/run/evidence scopes before writing", async () => {
    await expect(
      DemandPulseFeedRepository.persistFeedItems({
        scope,
        rows: [
          makeFeedInput(),
          makeFeedInput({ id: "feed-2", projectId: "project-2" }),
        ],
      }),
    ).rejects.toThrow("scope mismatch");

    expect(state.selects).toHaveLength(0);
    expect(state.insertCalls).toBe(0);
  });
  it("keeps an exact-run read isolated from another project", async () => {
    state.selectRows.push([]);
    await expect(
      DemandPulseFeedRepository.listFeedForRun({
        ...selectionScope,
        projectId: "project-2",
      }),
    ).resolves.toEqual([]);
    expect(collectSqlParams(state.selects[0].where)).toContain("project-2");
  });

  it("replays an immutable selection without inserting or updating it", async () => {
    const stored = asStoredFeed(makeFeedInput());
    state.selectRows.push([stored]);

    await expect(
      DemandPulseFeedRepository.persistFeedItems({
        scope,
        rows: [makeFeedInput()],
      }),
    ).resolves.toEqual([stored]);
    expect(state.insertCalls).toBe(0);
    expect(state.updateCalls).toBe(0);
  });

  it("returns latest project/profile feed in deterministic rank/id order and bounds it", async () => {
    const rankTwo = asStoredFeed(makeFeedInput({ id: "feed-2", rank: 2 }));
    const rankOne = asStoredFeed(makeFeedInput({ id: "feed-1", rank: 1 }));
    state.selectRows.push([rankTwo], [rankTwo, rankOne]);

    await expect(
      DemandPulseFeedRepository.listLatestFeed({
        profileId: scope.profileId,
        projectId: scope.projectId,
      }),
    ).resolves.toEqual([rankOne, rankTwo]);

    const latestQuery = state.selects[0];
    expect(latestQuery.limit).toBe(1);
    expect(collectSqlObjects(latestQuery.where)).toEqual(
      expect.arrayContaining([
        demandPulseFeedItems.profileId,
        demandPulseFeedItems.projectId,
        demandPulseRuns.profileId,
        demandPulseProfiles.projectId,
      ]),
    );
    expect(collectSqlParams(latestQuery.where)).toEqual(
      expect.arrayContaining([scope.profileId, scope.projectId]),
    );
    const feedQuery = state.selects[1];
    expect(feedQuery.limit).toBe(5);
    expect(
      collectSqlObjects(feedQuery.orderBy[feedQuery.orderBy.length - 2]),
    ).toContain(demandPulseFeedItems.rank);
    expect(
      collectSqlObjects(feedQuery.orderBy[feedQuery.orderBy.length - 1]),
    ).toContain(demandPulseFeedItems.id);
  });

  it("lists one exact run and carries every feed lineage key in the filter", async () => {
    const rankTwo = asStoredFeed(makeFeedInput({ id: "feed-2", rank: 2 }));
    const rankOne = asStoredFeed(makeFeedInput({ id: "feed-1", rank: 1 }));
    state.selectRows.push([rankTwo, rankOne]);

    await expect(
      DemandPulseFeedRepository.listFeedForRun(selectionScope),
    ).resolves.toEqual([rankOne, rankTwo]);

    const where = state.selects[0].where;
    expect(collectSqlObjects(where)).toEqual(
      expect.arrayContaining([
        demandPulseFeedItems.profileId,
        demandPulseFeedItems.projectId,
        demandPulseFeedItems.runId,
        demandPulseFeedItems.evidenceVersion,
        demandPulseFeedItems.selectionVersion,
      ]),
    );
    expect(collectSqlParams(where)).toEqual(
      expect.arrayContaining([
        scope.profileId,
        scope.projectId,
        scope.runId,
        scope.evidenceVersion,
        selectionScope.selectionVersion,
      ]),
    );
  });

  it("validates expected feed lineage before appending a human decision", async () => {
    const stored = asStoredFeed(makeFeedInput());
    state.selectRows.push([stored]);
    const decision = {
      ...makeDecision(),
      decidedAt: "2026-07-27T13:00:00.000Z",
    };
    state.insertRows.push([{ ...decision, publicationTriggered: false }]);

    await expect(
      DemandPulseFeedRepository.recordDecision({
        ...selectionScope,
        feedItemId: stored.id,
        row: decision,
        expectedFeed: {
          familyId: stored.familyId,
          scoreId: stored.scoreId,
          coverageCheckId: stored.coverageCheckId,
          evidenceVersion: stored.evidenceVersion,
          selectionVersion: stored.selectionVersion,
        },
      }),
    ).resolves.toMatchObject({ id: decision.id, publicationTriggered: false });

    expect(state.updateCalls).toBe(0);
    expect(state.insertCalls).toBe(1);
    expect(state.insertValues[0]).toMatchObject({
      values: { publicationTriggered: false },
    });
    const secondDecision = makeDecision({
      id: "decision-2",
      kind: "defer",
      action: null,
    });
    state.selectRows.push([stored]);
    state.insertRows.push([{ ...secondDecision, publicationTriggered: false }]);
    await expect(
      DemandPulseFeedRepository.recordDecision({
        ...selectionScope,
        feedItemId: stored.id,
        row: secondDecision,
      }),
    ).resolves.toMatchObject({ id: "decision-2", publicationTriggered: false });
    expect(state.insertCalls).toBe(2);

    state.reset();
    state.selectRows.push([stored]);
    await expect(
      DemandPulseFeedRepository.recordDecision({
        ...selectionScope,
        feedItemId: stored.id,
        row: makeDecision({ familyId: "family-other" }),
      }),
    ).rejects.toThrow("lineage mismatch");
    expect(state.insertCalls).toBe(0);
  });

  it("returns score, coverage, family evidence, and append-only decisions for detail", async () => {
    const feed = asStoredFeed(makeFeedInput());
    const score = {
      id: "score-1",
      familyId: "family-1",
      evidenceVersion: scope.evidenceVersion,
    };
    const coverage = {
      id: "coverage-1",
      familyId: "family-1",
      runId: scope.runId,
    };
    const family = { id: "family-1", projectId: scope.projectId };
    const familyEvidence = [{ id: "family-evidence-1", familyId: "family-1" }];
    const decisions = [{ id: "decision-1", feedItemId: feed.id }];
    state.selectRows.push(
      [feed],
      [score],
      [coverage],
      [family],
      familyEvidence,
      decisions,
    );

    await expect(
      DemandPulseFeedRepository.getFeedItemDetail({
        ...selectionScope,
        feedItemId: feed.id,
      }),
    ).resolves.toEqual({
      feedItem: feed,
      score,
      coverageCheck: coverage,
      family,
      familyEvidence,
      decisions,
    });

    expect(state.selects).toHaveLength(6);
    for (const query of state.selects) {
      expect(collectSqlParams(query.where)).toEqual(
        expect.arrayContaining([scope.profileId, scope.projectId]),
      );
    }
    expect(collectSqlParams(state.selects[0].where)).toEqual(
      expect.arrayContaining([
        scope.runId,
        scope.evidenceVersion,
        selectionScope.selectionVersion,
        feed.id,
      ]),
    );
  });
});
