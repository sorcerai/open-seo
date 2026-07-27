import { describe, expect, it, vi } from "vitest";
import { gscDemandSource } from "../sources/gsc";
import { localNewsDemandSource } from "../sources/local-news";
import { manualFirstPartyDemandSource } from "../sources/manual-first-party";
import {
  allowedGate,
  buildContext,
  buildGscResult,
  buildReservationSeam,
  createLocalNewsResolver,
  gscRows,
} from "./acquisition-adapters.test-utils";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(async () => false),
}));

const exhausted = buildReservationSeam({
  reserved: false,
  reason: "daily budget exhausted",
});

describe("free adapters ignore an exhausted paid reservation", () => {
  it("gsc still succeeds when paid budget is exhausted", async () => {
    const getPerformance = vi.fn(async () => buildGscResult(gscRows));
    const result = await gscDemandSource.discover(
      buildContext({ source: allowedGate, reservation: exhausted }),
      { getPerformance },
    );
    expect(exhausted.reserveMock).not.toHaveBeenCalled();
    expect(result.health?.status).toBe("healthy");
    expect(result.observations).toHaveLength(2);
  });

  it("local-news still succeeds when paid budget is exhausted", async () => {
    const resolveOriginal = createLocalNewsResolver(async () => null);
    const result = await localNewsDemandSource.discover(
      buildContext({ source: allowedGate, reservation: exhausted }),
      {
        discovery: {
          status: "ok",
          provenance: "p",
          hits: [
            { query: "q", title: "t", url: "https://example-gazette.com/a" },
          ],
        },
        allowlistedPublisherDomains: ["example-gazette.com"],
        resolveOriginal,
        maxResolutions: 1,
      },
    );
    expect(exhausted.reserveMock).not.toHaveBeenCalled();
    expect(result.observations.length).toBeGreaterThanOrEqual(1);
  });

  it("manual still succeeds when paid budget is exhausted", async () => {
    const result = await manualFirstPartyDemandSource.discover(
      buildContext({ source: allowedGate, reservation: exhausted }),
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
    );
    expect(exhausted.reserveMock).not.toHaveBeenCalled();
    expect(result.health?.status).toBe("healthy");
  });
});

describe("manualFirstPartyDemandSource", () => {
  const validInput = {
    owner: "ops@onfarmcompost.com",
    basis: "operator first-party consent v1",
    retentionClass: "first-party-controlled-v1",
    piiRedacted: true,
    representation: "verbatim" as const,
    rows: [
      {
        externalId: "ticket-42",
        title: "Customer asked about commercial compost pickup",
        excerpt: "Do you offer weekly commercial pickup in the Heights?",
        occurredAt: "2026-07-25T12:00:00.000Z",
      },
    ],
  };

  it("rejects unknown fields (strict), not silent strip", async () => {
    const result = await manualFirstPartyDemandSource.discover(
      buildContext({ source: allowedGate }),
      { input: { ...validInput, surpriseField: "leak" } },
    );
    expect(result.observations).toEqual([]);
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/rejected/);
  });

  it("rejects input missing owner/basis", async () => {
    const result = await manualFirstPartyDemandSource.discover(
      buildContext({ source: allowedGate }),
      { input: { ...validInput, owner: " ", basis: "" } },
    );
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/owner/);
    expect(result.health?.error).toMatch(/basis/);
  });

  it("rejects unredacted input (piiRedacted !== true)", async () => {
    const result = await manualFirstPartyDemandSource.discover(
      buildContext({ source: allowedGate }),
      { input: { ...validInput, piiRedacted: false } },
    );
    expect(result.health?.status).toBe("failed");
    expect(result.health?.error).toMatch(/piiRedacted/);
  });

  it("stamps owner, basis, and representation on valid redacted observations", async () => {
    const result = await manualFirstPartyDemandSource.discover(
      buildContext({ source: allowedGate }),
      { input: validInput },
    );
    expect(result.health?.status).toBe("healthy");
    expect(result.health?.costMicros).toBe(0);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].sourceClass).toBe("first_party_observed");
    expect(result.observations[0].metadata).toMatchObject({
      owner: "ops@onfarmcompost.com",
      basis: "operator first-party consent v1",
      representation: "verbatim",
      piiRedactedAttested: true,
    });
    expect(result.observations[0].retentionProfile).toBe(
      "first-party-controlled-v1",
    );
  });
});
