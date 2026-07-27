import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  extractOfficialPageText,
  isAllowedOfficialRedirect,
  type OfficialPageFetch,
} from "../canaries/onfarmcompost-official-sources";
import {
  getChicagoDateTime,
  isPastDailyRunTime,
  runScheduledOnFarmCompostOfficialMonitor,
  type OnFarmCompostOfficialMonitorEnv,
} from "../canaries/onfarmcompost-official-monitor";
import type {
  DemandPulseJsonBody,
  DemandPulseJsonBucket,
} from "../canaries/onfarmcompost-official-store";
import { getDemandPulseFeatureFlags } from "../feature-flags";

class MemoryR2 implements DemandPulseJsonBucket {
  readonly objects = new Map<string, string>();
  readonly putOrder: string[] = [];

  async head(key: string): Promise<unknown | null> {
    return this.objects.has(key) ? { key } : null;
  }

  async get(key: string): Promise<DemandPulseJsonBody | null> {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      text: async () => value,
    };
  }

  async put(key: string, value: string): Promise<unknown> {
    this.objects.set(key, value);
    this.putOrder.push(key);
    return { key };
  }
}

function enabledEnv(
  bucket: DemandPulseJsonBucket,
): OnFarmCompostOfficialMonitorEnv {
  return {
    R2: bucket,
    DEMAND_PULSE_ENABLED: "true",
    DEMAND_PULSE_WRITE_ENABLED: "false",
    DEMAND_PULSE_DRY_RUN: "true",
    DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "true",
    DEMAND_PULSE_CANARY_ONFARMCOMPOST: "true",
  };
}

function healthyOfficialFetch() {
  const body = `<html><head><title>Official compost guidance</title></head><body>
    <nav>Frequently changing navigation</nav>
    <main>${"Verified public composting guidance and program information. ".repeat(20)}</main>
    <script>window.secret = "do not retain";</script>
  </body></html>`;
  const implementation: OfficialPageFetch = async () =>
    new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "last-modified": "Sun, 26 Jul 2026 12:00:00 GMT",
        etag: '"official-v1"',
      },
    });

  return vi.fn(implementation);
}

const artifactTestSchema = z.object({
  publicationAllowed: z.literal(false),
  observations: z.array(z.object({ excerpt: z.string() })),
  candidateCards: z.array(z.unknown()),
  summary: z.object({
    successfulSources: z.number(),
    changedSources: z.number(),
  }),
  nextStage: z.literal("coverage_clustering_scoring_and_review_not_wired"),
});

describe("Demand Pulse feature flags", () => {
  it("keeps the canary and every source disabled by default", () => {
    expect(getDemandPulseFeatureFlags({})).toEqual({
      enabled: false,
      writeEnabled: false,
      dryRun: true,
      sourceDataForSeoDiscussions: false,
      sourceHackerNews: false,
      sourceFirstPartyImport: false,
      sourceOfficialPages: false,
      sourceReddit: false,
      canaryOnFarmCompost: false,
    });
  });

  it("parses the official-source canary flags explicitly", () => {
    const flags = getDemandPulseFeatureFlags({
      DEMAND_PULSE_ENABLED: "true",
      DEMAND_PULSE_DRY_RUN: "yes",
      DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "1",
      DEMAND_PULSE_CANARY_ONFARMCOMPOST: "on",
    });

    expect(flags.enabled).toBe(true);
    expect(flags.dryRun).toBe(true);
    expect(flags.sourceOfficialPages).toBe(true);
    expect(flags.canaryOnFarmCompost).toBe(true);
    expect(flags.writeEnabled).toBe(false);
    expect(flags.sourceReddit).toBe(false);
  });
});

describe("OnFarmCompost official-source schedule", () => {
  it("uses America/Chicago across daylight and standard time", () => {
    expect(getChicagoDateTime(new Date("2026-07-26T10:05:00.000Z"))).toEqual({
      date: "2026-07-26",
      hour: 5,
      minute: 5,
    });
    expect(getChicagoDateTime(new Date("2026-01-15T11:05:00.000Z"))).toEqual({
      date: "2026-01-15",
      hour: 5,
      minute: 5,
    });
  });

  it("waits until 05:00 local time and then allows catch-up retries", () => {
    expect(
      isPastDailyRunTime({ date: "2026-07-26", hour: 4, minute: 59 }),
    ).toBe(false);
    expect(isPastDailyRunTime({ date: "2026-07-26", hour: 5, minute: 0 })).toBe(
      true,
    );
    expect(
      isPastDailyRunTime({ date: "2026-07-26", hour: 17, minute: 30 }),
    ).toBe(true);
  });
});

describe("official page safety helpers", () => {
  it("fingerprints primary content without scripts, styles, or navigation", () => {
    const extracted = extractOfficialPageText(`
      <html>
        <head><title> Compost Rules </title><style>.hidden{}</style></head>
        <body>
          <nav>Changing navigation</nav>
          <main>Texas compost guidance</main>
          <script>steal()</script>
        </body>
      </html>
    `);

    expect(extracted.title).toBe("Compost Rules");
    expect(extracted.text).toBe("Texas compost guidance");
    expect(extracted.excerpt).not.toContain("steal");
    expect(extracted.excerpt).not.toContain("Changing navigation");
  });

  it("allows only the requested or explicitly approved official hosts", () => {
    const allowedHosts = ["www.tceq.texas.gov", "tceq.texas.gov"];
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://www.tceq.texas.gov/final",
        allowedHosts,
      ),
    ).toBe(true);
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://tceq.texas.gov/final",
        allowedHosts,
      ),
    ).toBe(true);
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://texas.gov/final",
        allowedHosts,
      ),
    ).toBe(false);
  });
});

describe("runScheduledOnFarmCompostOfficialMonitor", () => {
  it("writes the evidence artifact before advancing source state", async () => {
    const bucket = new MemoryR2();
    const fetchFn = healthyOfficialFetch();
    const result = await runScheduledOnFarmCompostOfficialMonitor(
      enabledEnv(bucket),
      new Date("2026-07-26T10:05:00.000Z"),
      fetchFn,
    );

    expect(result).toMatchObject({
      status: "completed",
      successfulSources: 6,
      changedSources: 6,
    });
    expect(fetchFn).toHaveBeenCalledTimes(6);

    const artifactKey = "demand-pulse/onfarmcompost/runs/2026-07-26.json";
    const stateKey = "demand-pulse/onfarmcompost/state/official-pages.json";
    expect(bucket.putOrder).toEqual([artifactKey, stateKey]);

    const artifactText = bucket.objects.get(artifactKey);
    expect(artifactText).toBeDefined();
    const parsed: unknown = JSON.parse(artifactText ?? "{}");
    const artifact = artifactTestSchema.parse(parsed);

    expect(artifact.publicationAllowed).toBe(false);
    expect(artifact.candidateCards).toEqual([]);
    expect(artifact.summary).toEqual({
      successfulSources: 6,
      changedSources: 6,
    });
    expect(artifact.observations).toHaveLength(6);
    expect(artifact.observations[0]?.excerpt).not.toContain("do not retain");
    expect(artifact.nextStage).toBe(
      "coverage_clustering_scoring_and_review_not_wired",
    );
    expect(bucket.objects.has(stateKey)).toBe(true);
  });

  it("does not run twice for the same Chicago calendar date", async () => {
    const bucket = new MemoryR2();
    const env = enabledEnv(bucket);
    const fetchFn = healthyOfficialFetch();

    await runScheduledOnFarmCompostOfficialMonitor(
      env,
      new Date("2026-07-26T10:05:00.000Z"),
      fetchFn,
    );
    const second = await runScheduledOnFarmCompostOfficialMonitor(
      env,
      new Date("2026-07-26T18:00:00.000Z"),
      fetchFn,
    );

    expect(second).toEqual({
      status: "already_completed",
      artifactKey: "demand-pulse/onfarmcompost/runs/2026-07-26.json",
    });
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it("fails closed when write mode is enabled", async () => {
    const bucket = new MemoryR2();
    const env: OnFarmCompostOfficialMonitorEnv = {
      ...enabledEnv(bucket),
      DEMAND_PULSE_WRITE_ENABLED: "true",
    };

    const result = await runScheduledOnFarmCompostOfficialMonitor(
      env,
      new Date("2026-07-26T10:05:00.000Z"),
      healthyOfficialFetch(),
    );

    expect(result).toEqual({ status: "unsafe_configuration" });
    expect(bucket.objects.size).toBe(0);
  });
});
