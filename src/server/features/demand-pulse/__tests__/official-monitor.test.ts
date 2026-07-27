import { describe, expect, it, vi } from "vitest";
import { getDemandPulseFeatureFlags } from "../feature-flags";
import {
  extractOfficialPageText,
  getChicagoDateTime,
  isAllowedOfficialRedirect,
  isPastDailyRunTime,
  runScheduledOnFarmCompostOfficialMonitor,
} from "../canaries/onfarmcompost-official-monitor";

class MemoryR2 {
  readonly objects = new Map<string, string>();

  async head(key: string) {
    return this.objects.has(key) ? ({ key } as R2Object) : null;
  }

  async get(key: string) {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      key,
      async json<T>() {
        return JSON.parse(value) as T;
      },
    } as R2ObjectBody;
  }

  async put(key: string, value: unknown) {
    if (typeof value !== "string") {
      throw new Error("MemoryR2 test double only accepts string values");
    }
    this.objects.set(key, value);
    return { key } as R2Object;
  }
}

function enabledEnv(bucket: MemoryR2): Env {
  return {
    R2: bucket as unknown as R2Bucket,
    DEMAND_PULSE_ENABLED: "true",
    DEMAND_PULSE_WRITE_ENABLED: "false",
    DEMAND_PULSE_DRY_RUN: "true",
    DEMAND_PULSE_SOURCE_OFFICIAL_PAGES: "true",
    DEMAND_PULSE_CANARY_ONFARMCOMPOST: "true",
  } as unknown as Env;
}

function healthyOfficialFetch(): typeof fetch {
  const body = `<html><head><title>Official compost guidance</title></head><body>
    <main>${"Verified public composting guidance and program information. ".repeat(20)}</main>
    <script>window.secret = "do not retain";</script>
  </body></html>`;

  return vi.fn(async () =>
    Promise.resolve(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "last-modified": "Sun, 26 Jul 2026 12:00:00 GMT",
          etag: '"official-v1"',
        },
      }),
    ),
  ) as unknown as typeof fetch;
}

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
    expect(
      isPastDailyRunTime({ date: "2026-07-26", hour: 5, minute: 0 }),
    ).toBe(true);
    expect(
      isPastDailyRunTime({ date: "2026-07-26", hour: 17, minute: 30 }),
    ).toBe(true);
  });
});

describe("official page safety helpers", () => {
  it("removes executable and decorative content before fingerprinting", () => {
    const extracted = extractOfficialPageText(`
      <html>
        <head><title> Compost Rules </title><style>.hidden{}</style></head>
        <body><main>Texas compost guidance</main><script>steal()</script></body>
      </html>
    `);

    expect(extracted.title).toBe("Compost Rules");
    expect(extracted.text).toBe("Texas compost guidance");
    expect(extracted.excerpt).not.toContain("steal");
  });

  it("allows same-host and parent-host redirects but blocks unrelated hosts", () => {
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://www.tceq.texas.gov/final",
      ),
    ).toBe(true);
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://tceq.texas.gov/final",
      ),
    ).toBe(true);
    expect(
      isAllowedOfficialRedirect(
        "https://www.tceq.texas.gov/source",
        "https://example.com/final",
      ),
    ).toBe(false);
  });
});

describe("runScheduledOnFarmCompostOfficialMonitor", () => {
  it("writes one bounded dry-run artifact and state after the daily gate", async () => {
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

    const artifactText = bucket.objects.get(
      "demand-pulse/onfarmcompost/runs/2026-07-26.json",
    );
    expect(artifactText).toBeDefined();
    const artifact = JSON.parse(artifactText ?? "{}") as {
      publicationAllowed: boolean;
      observations: Array<{ excerpt: string }>;
      candidateCards: unknown[];
      summary: { successfulSources: number; changedSources: number };
      nextStage: string;
    };

    expect(artifact.publicationAllowed).toBe(false);
    expect(artifact.candidateCards).toEqual([]);
    expect(artifact.summary).toEqual(
      expect.objectContaining({ successfulSources: 6, changedSources: 6 }),
    );
    expect(artifact.observations).toHaveLength(6);
    expect(artifact.observations[0]?.excerpt).not.toContain("do not retain");
    expect(artifact.nextStage).toBe(
      "coverage_clustering_scoring_and_review_not_wired",
    );
    expect(
      bucket.objects.has(
        "demand-pulse/onfarmcompost/state/official-pages.json",
      ),
    ).toBe(true);
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

  it("fails closed when write mode or non-dry-run mode is enabled", async () => {
    const bucket = new MemoryR2();
    const env = {
      ...enabledEnv(bucket),
      DEMAND_PULSE_WRITE_ENABLED: "true",
    } as unknown as Env;

    const result = await runScheduledOnFarmCompostOfficialMonitor(
      env,
      new Date("2026-07-26T10:05:00.000Z"),
      healthyOfficialFetch(),
    );

    expect(result).toEqual({ status: "unsafe_configuration" });
    expect(bucket.objects.size).toBe(0);
  });
});
