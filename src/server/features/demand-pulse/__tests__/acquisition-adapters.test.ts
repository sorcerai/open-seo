import { describe, expect, it, vi } from "vitest";
import type { DemandSourceApprovalGate } from "../sources/adapter";
import { gscDemandSource } from "../sources/gsc";
import { dataforseoDiscussionsDemandSource } from "../sources/dataforseo-discussions-normalizer";
import { manualFirstPartyDemandSource } from "../sources/manual-first-party";
import { localNewsDemandSource } from "../sources/local-news";
import {
  allowedGate,
  buildContext,
  buildGscResult,
  buildReservationSeam,
  createDataForSeoCacheRead,
  createDataForSeoPaidFetch,
  createLocalNewsResolver,
  gscRows,
} from "./acquisition-adapters.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(async () => false),
}));

const blockedGateCases: ReadonlyArray<{
  name: string;
  rule: string;
  gate: DemandSourceApprovalGate | undefined;
}> = [
  { name: "missing", rule: "missing", gate: undefined },
  {
    name: "rejected+enabled",
    rule: "unapproved",
    gate: { approvalState: "rejected", enabled: true, policyState: "allowed" },
  },
  {
    name: "approved+disabled",
    rule: "disabled",
    gate: { approvalState: "approved", enabled: false, policyState: "allowed" },
  },
  {
    name: "approved+policy-blocked",
    rule: "policy_blocked",
    gate: { approvalState: "approved", enabled: true, policyState: "blocked" },
  },
  {
    name: "approved+policy-unknown",
    rule: "policy_blocked",
    gate: { approvalState: "approved", enabled: true, policyState: "unknown" },
  },
];

describe("source gate is table-driven across all adapters", () => {
  function buildAdapterCases() {
    const gscSpy = vi.fn(async () => buildGscResult(gscRows));
    const dfsReadCache = createDataForSeoCacheRead(async () => null);
    const dfsFetchPaid = createDataForSeoPaidFetch(async () => ({
      kind: "paid_success" as const,
      items: [],
      costMicros: 0,
      vendorRequestCount: 1,
    }));
    const dfsReservation = buildReservationSeam();
    const lnResolve = createLocalNewsResolver(async () => null);

    return [
      {
        name: "gsc",
        run: (gate: DemandSourceApprovalGate | undefined) =>
          gscDemandSource.discover(buildContext({ source: gate }), {
            getPerformance: gscSpy,
          }),
        spy: gscSpy,
      },
      {
        name: "dataforseo",
        run: (gate: DemandSourceApprovalGate | undefined) =>
          dataforseoDiscussionsDemandSource.discover(
            buildContext({ source: gate, reservation: dfsReservation }),
            {
              readCache: dfsReadCache,
              fetchPaid: dfsFetchPaid,
              queries: ["q"],
              operationKey: "dfs",
            },
          ),
        spy: dfsFetchPaid,
      },
      {
        name: "local-news",
        run: (gate: DemandSourceApprovalGate | undefined) =>
          localNewsDemandSource.discover(buildContext({ source: gate }), {
            discovery: {
              status: "ok",
              provenance: "p",
              hits: [
                {
                  query: "q",
                  title: "t",
                  url: "https://example-gazette.com/a",
                },
              ],
            },
            allowlistedPublisherDomains: ["example-gazette.com"],
            resolveOriginal: lnResolve,
            maxResolutions: 5,
          }),
        spy: lnResolve,
      },
      {
        name: "manual",
        run: (gate: DemandSourceApprovalGate | undefined) =>
          manualFirstPartyDemandSource.discover(
            buildContext({ source: gate }),
            {
              input: {
                owner: "o",
                basis: "b",
                retentionClass: "first-party-controlled-v1",
                piiRedacted: true,
                representation: "verbatim",
                rows: [
                  {
                    externalId: "x",
                    title: "t",
                    occurredAt: "2026-07-25T00:00:00.000Z",
                  },
                ],
              },
            },
          ),
        spy: undefined,
      },
    ];
  }

  for (const adapterCase of buildAdapterCases()) {
    for (const gateCase of blockedGateCases) {
      it(`${adapterCase.name}: ${gateCase.name} gate blocks before any fetch`, async () => {
        const result = await adapterCase.run(gateCase.gate);
        expect(result.health?.status).toBe("blocked");
        expect(result.observations).toEqual([]);
        if (adapterCase.spy) {
          expect(adapterCase.spy).not.toHaveBeenCalled();
        }
      });
    }
  }
});

describe("gscDemandSource", () => {
  it("reports GSC failure explicitly, never as zero-observation success", async () => {
    const getPerformance = vi.fn(async () => {
      const error = new Error(
        "Search Console is not connected for this project",
      );
      error.name = "GscNotConnectedError";
      throw error;
    });
    const result = await gscDemandSource.discover(
      buildContext({ source: allowedGate }),
      { getPerformance },
    );
    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/GscNotConnectedError/);
  });

  it("rejects a response whose dimensions are not exactly [query,page]", async () => {
    const getPerformance = vi.fn(async () =>
      buildGscResult(gscRows, ["query"]),
    );
    const result = await gscDemandSource.discover(
      buildContext({ source: allowedGate }),
      { getPerformance },
    );
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/dimensions must be \[query,page\]/);
    expect(result.observations).toEqual([]);
  });

  it("rejects malformed rows as failed health", async () => {
    const getPerformance = vi.fn(async () =>
      buildGscResult([
        {
          keys: ["only-query"],
          clicks: 1,
          impressions: 1,
          ctr: 0,
          position: 1,
        },
      ]),
    );
    const result = await gscDemandSource.discover(
      buildContext({ source: allowedGate }),
      { getPerformance },
    );
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/rows failed validation/);
    expect(result.observations).toEqual([]);
  });

  it("produces deterministic, deduped observations sorted by engagement", async () => {
    const getPerformance = vi.fn(async () => buildGscResult(gscRows));
    const config = { getPerformance };
    const first = await gscDemandSource.discover(
      buildContext({ source: allowedGate }),
      config,
    );
    const second = await gscDemandSource.discover(
      buildContext({ source: allowedGate }),
      config,
    );
    expect(second).toEqual(first);
    expect(first.observations).toHaveLength(2);
    expect(first.sourceRequestCount).toBe(1);
    expect(first.health?.costMicros).toBe(0);
    expect(first.observations[0].title).toBe("food waste drop-off");
    expect(first.observations[1].title).toBe("compost bins");
    for (const observation of first.observations) {
      expect(observation.sourceClass).toBe("search_observed");
      expect(observation.sourcePlatform).toBe("gsc");
      expect(observation.externalId).toMatch(/^gsc:/);
    }
  });

  it("always requests the fixed [query,page] dimensions", async () => {
    const getPerformance = vi.fn(async () => buildGscResult(gscRows));
    await gscDemandSource.discover(buildContext({ source: allowedGate }), {
      getPerformance,
    });
    expect(getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: ["query", "page"] }),
    );
  });
});
