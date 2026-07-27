import { describe, expect, it, vi } from "vitest";
vi.mock("../repositories/DemandPulseRepository", () => ({
  DemandPulseRepository: {},
}));
import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "../canaries/onfarmcompost-official-sources";
import { canonicalizeDemandUrl } from "../dedupe";
import { buildOnFarmCompostSourceCandidates } from "./sourceDiscovery";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function identityOf(candidate: {
  adapter: string;
  identityKey: string;
}): string {
  return `${candidate.adapter}:${candidate.identityKey}`;
}

describe("buildOnFarmCompostSourceCandidates", () => {
  it("seeds the OnFarmCompost official authoritative sources in a stable order", () => {
    const candidates = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
    });

    expect(candidates).toHaveLength(ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length);
    for (const candidate of candidates) {
      expect(candidate.sourceClass).toBe("primary_authoritative");
      expect(candidate.adapter).toBe("official-page-monitor");
      expect(candidate.policyState).toBe("unknown");
      expect(candidate.discoveryProvenance).toBe(
        "canary:onfarmcompost:official-seed",
      );
    }
    const seedIds = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((seed) => seed.id);
    expect(candidates.map((c) => c.recordKey)).toEqual(seedIds);
    expect(candidates.map((c) => c.identityKey)).toEqual(
      seedIds.map((id) => `official-page:${id}`),
    );
  });

  it("canonicalizes each official seed url with the shared helper", () => {
    const candidates = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
    });
    const expected = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((seed) =>
      canonicalizeDemandUrl(seed.url),
    );
    expect(candidates.map((c) => c.canonicalUrl)).toEqual(expected);
  });

  it("is deterministic: identical inputs produce identical candidate plans", () => {
    const input = {
      projectId: PROJECT_ID,
      domain: "www.OnFarmCompost.com",
      gscSiteUrl: "sc-domain:onfarmcompost.com",
      querySeeds: ["compost permit texas", "food waste composting houston"],
    };
    const first = buildOnFarmCompostSourceCandidates(input);
    const second = buildOnFarmCompostSourceCandidates(input);
    expect(second).toEqual(first);
  });

  it("derives gsc-site, dataforseo, manual-first-party, and local-news candidates", () => {
    const candidates = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      domain: "onfarmcompost.com",
      gscSiteUrl: "https://www.onfarmcompost.com/",
    });

    const byAdapter = new Map(candidates.map((c) => [c.adapter, c] as const));

    const gsc = byAdapter.get("gsc-site");
    expect(gsc).toMatchObject({
      sourceClass: "search_observed",
      identityKey: "gsc-site:https://www.onfarmcompost.com/",
      canonicalUrl: canonicalizeDemandUrl("https://www.onfarmcompost.com/"),
      recordKey: "https://www.onfarmcompost.com/",
    });

    expect(byAdapter.get("dataforseo-discussions")).toMatchObject({
      sourceClass: "search_observed",
      identityKey: "dataforseo-discussions:onfarmcompost.com",
      canonicalUrl: null,
    });
    expect(byAdapter.get("manual-first-party")).toMatchObject({
      sourceClass: "first_party_observed",
      identityKey: "manual-first-party:onfarmcompost.com",
      canonicalUrl: null,
    });
    expect(byAdapter.get("local-news")).toMatchObject({
      sourceClass: "community_observed",
      identityKey: "local-news:onfarmcompost.com",
      canonicalUrl: null,
    });
  });

  it("normalizes domain casing and a leading www into a stable identity", () => {
    const a = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      domain: "WWW.OnFarmCompost.COM",
    });
    const b = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      domain: "onfarmcompost.com",
    });
    expect(a.map(identityOf)).toEqual(b.map(identityOf));
  });

  it("preserves the full sc-domain property as the GSC identity", () => {
    const candidates = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      gscSiteUrl: "sc-domain:onfarmcompost.com",
    });
    const gsc = candidates.find((c) => c.adapter === "gsc-site");
    expect(gsc).toMatchObject({
      identityKey: "gsc-site:sc-domain:onfarmcompost.com",
      recordKey: "sc-domain:onfarmcompost.com",
      canonicalUrl: null,
    });
  });

  it("keeps sc-domain and https url-prefix GSC properties distinct", () => {
    const sc = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      gscSiteUrl: "sc-domain:onfarmcompost.com",
    }).find((c) => c.adapter === "gsc-site");
    const url = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      gscSiteUrl: "https://onfarmcompost.com/",
    }).find((c) => c.adapter === "gsc-site");
    expect(sc?.identityKey).toBe("gsc-site:sc-domain:onfarmcompost.com");
    expect(url?.identityKey).toBe("gsc-site:https://onfarmcompost.com/");
    expect(sc?.identityKey).not.toBe(url?.identityKey);
  });

  it("rejects an unsupported GSC site url scheme", () => {
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        gscSiteUrl: "ftp://onfarmcompost.com/",
      }),
    ).toThrow(/Unsupported GSC site url scheme/);
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        gscSiteUrl: "onfarmcompost.com",
      }),
    ).toThrow(/Unsupported GSC site url scheme/);
  });

  it("rejects a GSC property whose host mismatches the configured domain", () => {
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        domain: "onfarmcompost.com",
        gscSiteUrl: "sc-domain:other.com",
      }),
    ).toThrow(/does not match configured domain/);
  });

  it("accepts knownOfficialUrls equal to the full registered seed set", () => {
    const known = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((seed) => seed.url);
    const candidates = buildOnFarmCompostSourceCandidates({
      projectId: PROJECT_ID,
      knownOfficialUrls: known,
    });
    // The declaration matches the closed official surface exactly; no new
    // candidates are added.
    expect(candidates).toHaveLength(ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length);
  });

  it("rejects a knownOfficialUrls entry outside the registered official surface", () => {
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        knownOfficialUrls: ["https://example.com/not-official"],
      }),
    ).toThrow(/not a registered OnFarmCompost official source/);
  });

  it("rejects a knownOfficialUrls subset missing registered sources", () => {
    const known = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((seed) => seed.url);
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        knownOfficialUrls: [known[0], known[2]],
      }),
    ).toThrow(/must list all/);
  });

  it("rejects duplicate knownOfficialUrls entries", () => {
    const known = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.map((seed) => seed.url);
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        knownOfficialUrls: [...known, known[0]],
      }),
    ).toThrow(/Duplicate knownOfficialUrls entry/);
  });

  it("rejects an empty knownOfficialUrls entry", () => {
    const known = ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS[0].url;
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        knownOfficialUrls: [known, "   "],
      }),
    ).toThrow(/knownOfficialUrls entry is required/);
  });

  it("rejects an empty querySeeds entry", () => {
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        querySeeds: ["compost permit", ""],
      }),
    ).toThrow(/querySeeds entry is required/);
  });

  it("throws on an invalid domain across strict-hostname boundaries", () => {
    // The WHATWG URL parser percent-encodes hostspaces in some runtimes
    // instead of rejecting them, so discovery validates DNS hosts itself.
    const invalid = [
      "not a domain with spaces",
      "onfarmcompost%20com",
      "localhost",
      "foo",
      "-leading.com",
      "trailing-.com",
      "under_score.com",
      "domain..double",
      `${"a".repeat(64)}.com`,
    ];
    for (const domain of invalid) {
      expect(() =>
        buildOnFarmCompostSourceCandidates({ projectId: PROJECT_ID, domain }),
      ).toThrow(/Invalid domain/);
    }
  });

  it("throws on an empty gscSiteUrl", () => {
    expect(() =>
      buildOnFarmCompostSourceCandidates({
        projectId: PROJECT_ID,
        gscSiteUrl: "   ",
      }),
    ).toThrow(/gscSiteUrl is required/);
  });
});
