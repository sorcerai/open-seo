import { describe, expect, it } from "vitest";
import {
  COVERAGE_INTENT_MATCH_THRESHOLD,
  buildCoverageCandidate,
  evaluateCoverage,
  findBestCoverageMatch,
  selectCoverageFeed,
} from "../coverage";
import { buildFamilyEvidence } from "../dedupe-evidence";
import { selectOnFarmFeed } from "../scoring";
import {
  NOW,
  RUN_DATE,
  asset,
  familyInput,
  gapFamily,
  obs,
} from "./coverage.test-utils";

describe("evaluateCoverage — unknown on missing inventory", () => {
  it("returns unknown when inventory is undefined", async () => {
    const { coverage, recommendedAction, match, inventoryUnavailable } =
      evaluateCoverage(await familyInput({ inventory: undefined }), NOW);
    expect(coverage.status).toBe("unknown");
    expect(coverage.existingCanonicalUrl).toBeNull();
    expect(coverage.prefersExistingUpdate).toBe(false);
    expect(coverage.reason).toMatch(/inventory unavailable/);
    expect(coverage.reason.length).toBeGreaterThan(0);
    expect(recommendedAction).toBe("monitor_only");
    expect(match).toBeNull();
    expect(inventoryUnavailable).toBe(true);
  });

  it("returns unknown when inventoryUnavailable is explicitly true", async () => {
    const { coverage, inventoryUnavailable } = evaluateCoverage(
      await familyInput({ inventoryUnavailable: true }),
      NOW,
    );
    expect(coverage.status).toBe("unknown");
    expect(inventoryUnavailable).toBe(true);
  });

  it("never reports a clean coverage status when inventory is missing", async () => {
    const clean = ["covered", "partial", "gap"] as const;
    const { coverage } = evaluateCoverage(
      await familyInput({ inventory: undefined }),
      NOW,
    );
    expect(clean).not.toContain(coverage.status);
  });
});

describe("evaluateCoverage — gap when inventory present but unmatched", () => {
  it("returns a gap when no asset matches the observed language", async () => {
    const {
      coverage,
      recommendedAction,
      match,
      coverageGap,
      cannibalizationRisk,
    } = evaluateCoverage(
      await familyInput({
        inventory: [
          asset({
            intent: "weather forecast for the gulf coast",
            canonicalUrl: "https://onfarmcompost.example/weather",
          }),
        ],
      }),
      NOW,
    );
    expect(coverage.status).toBe("gap");
    expect(coverage.existingCanonicalUrl).toBeNull();
    expect(coverage.prefersExistingUpdate).toBe(false);
    expect(recommendedAction).toBe("create_supporting_page");
    expect(match).toBeNull();
    expect(coverageGap).toBe(1);
    expect(cannibalizationRisk).toBe(0);
  });

  it("treats an empty confirmed inventory as a gap, not unknown", async () => {
    const { coverage, inventoryUnavailable } = evaluateCoverage(
      await familyInput({ inventory: [] }),
      NOW,
    );
    expect(coverage.status).toBe("gap");
    expect(inventoryUnavailable).toBe(false);
  });
});

describe("evaluateCoverage — update before new URL", () => {
  it("prefers updating the existing canonical page over creating a new URL", async () => {
    const { coverage, recommendedAction, match } = evaluateCoverage(
      await familyInput(),
      NOW,
    );
    expect(recommendedAction).toBe("update_existing_page");
    expect(coverage.existingCanonicalUrl).toBe(
      "https://onfarmcompost.example/guide",
    );
    expect(coverage.prefersExistingUpdate).toBe(true);
    expect(coverage.status).toBe("covered");
    expect(match?.asset.kind).toBe("page");
  });

  it.each([
    ["faq", "add_faq"],
    ["tool", "create_tool"],
    ["troubleshooter", "create_troubleshooter"],
    ["product_or_offer", "update_product_or_offer"],
    ["support_article", "create_support_article"],
    ["page", "update_existing_page"],
  ] as const)(
    "maps an existing %s asset to the right update/extend action",
    async (kind, action) => {
      const { recommendedAction, coverage } = evaluateCoverage(
        await familyInput({ inventory: [asset({ kind })] }),
        NOW,
      );
      expect(recommendedAction).toBe(action);
      expect(recommendedAction).not.toBe("create_supporting_page");
      expect(coverage.status).not.toBe("gap");
    },
  );
});

describe("evaluateCoverage — cannibalization blocks duplicate URL", () => {
  it("updates an existing supporting page instead of recommending a duplicate URL", async () => {
    const duplicateUrl = "https://onfarmcompost.example/compost-basics";
    const { coverage, recommendedAction, cannibalizationRisk, match } =
      evaluateCoverage(
        await familyInput({
          inventory: [
            asset({ kind: "supporting_page", canonicalUrl: duplicateUrl }),
          ],
        }),
        NOW,
      );
    // The duplicate URL recommendation is blocked: we update, never create new.
    expect(recommendedAction).toBe("update_existing_page");
    expect(recommendedAction).not.toBe("create_supporting_page");
    expect(coverage.existingCanonicalUrl).toBe(duplicateUrl);
    // A fresh, exact, fully-covered match surfaces maximum cannibalization risk.
    expect(cannibalizationRisk).toBe(1);
    expect(match?.asset.canonicalUrl).toBe(duplicateUrl);
  });

  it("chooses the most direct existing-page update when several assets match", async () => {
    const input = await familyInput({
      inventory: [
        asset({
          kind: "supporting_page",
          canonicalUrl: "https://onfarmcompost.example/basics",
        }),
        asset({
          kind: "page",
          canonicalUrl: "https://onfarmcompost.example/guide",
        }),
      ],
    });
    const match = findBestCoverageMatch(input);
    expect(match?.asset.kind).toBe("page");
    expect(match?.asset.canonicalUrl).toBe(
      "https://onfarmcompost.example/guide",
    );
  });
});

describe("evaluateCoverage — freshness and gap signals", () => {
  it("marks a fresh exact match as covered with a low coverage gap", async () => {
    const { coverage, coverageGap } = evaluateCoverage(
      await familyInput(),
      NOW,
    );
    expect(coverage.status).toBe("covered");
    expect(coverageGap).toBeCloseTo(0.1, 2);
  });

  it("marks a stale canonical match as partial and surfaces a freshness reason", async () => {
    const { coverage, coverageGap, cannibalizationRisk } = evaluateCoverage(
      await familyInput({
        inventory: [asset({ updatedAt: "2026-03-15T00:00:00.000Z" })],
      }),
      NOW,
    );
    expect(coverage.status).toBe("partial");
    expect(coverage.reason).toMatch(/stale/);
    expect(coverage.reason).toMatch(/freshness 0\.00/);
    // A stale page needs a refresh, not a new duplicate URL.
    expect(coverageGap).toBeCloseTo(0.5, 2);
    expect(cannibalizationRisk).toBe(0);
  });
});

describe("evaluateCoverage — exact language and provenance retained", () => {
  it("keeps the verbatim observed language and provenance in the reason", async () => {
    const evidence = await buildFamilyEvidence("fam-multi", [
      obs({
        externalId: "c1",
        canonicalUrl: "https://example.com/c1",
        sourcePlatform: "forum",
        sourceClass: "community_observed",
        title: "how to start composting in houston texas",
      }),
      obs({
        externalId: "s1",
        canonicalUrl: "https://example.com/s1",
        sourcePlatform: "search",
        sourceClass: "search_observed",
        title: "starting a backyard compost pile in the houston area",
      }),
    ]);
    const { coverage } = evaluateCoverage(
      {
        ...(await familyInput({ evidence })),
        observedLanguage: "how to start composting in houston texas",
      },
      NOW,
    );
    expect(coverage.reason).toContain(
      '"how to start composting in houston texas"',
    );
    expect(coverage.reason).toContain("community_observed");
    expect(coverage.reason).toContain("search_observed");
    expect(coverage.reason).toMatch(/2 independent/);
  });
});

describe("evaluateCoverage — determinism", () => {
  it("returns identical evaluations across repeated calls", async () => {
    const input = await familyInput({
      inventory: [
        asset({ kind: "faq", canonicalUrl: "https://x.example/a" }),
        asset({ kind: "page", canonicalUrl: "https://x.example/b" }),
      ],
    });
    const first = evaluateCoverage(input, NOW);
    const second = evaluateCoverage(input, NOW);
    expect(second).toStrictEqual(first);
  });

  it("uses a stable intent-match threshold", () => {
    expect(COVERAGE_INTENT_MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(COVERAGE_INTENT_MATCH_THRESHOLD).toBeLessThan(1);
  });
});

describe("buildCoverageCandidate — feeds selectOnFarmFeed", () => {
  it("produces a candidate that selectOnFarmFeed accepts as a feed item", async () => {
    // A genuine gap with strong evidence clears the score threshold and keeps
    // its recommended action (validate_next band, not monitor-only).
    const input = await familyInput({
      inventory: [
        asset({
          intent: "unrelated weather forecast",
          canonicalUrl: "https://x.example/weather",
        }),
      ],
    });
    const candidate = buildCoverageCandidate(input, NOW, {
      vector: { geography: 1, corroboration: 1 },
    });
    const { items, excluded } = await selectOnFarmFeed([candidate], {
      runDate: RUN_DATE,
    });
    expect(excluded).toHaveLength(0);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.itemId).toMatch(/^feed_/);
    expect(item.familyId).toBe("fam-start-compost-houston");
    expect(item.projectId).toBe("onfarmcompost");
    expect(item.recommendedAction).toBe("create_supporting_page");
    expect(item.promotionPermitted).toBe(true);
    expect(item.provenance).toBe("observed");
    expect(item.compliance.blocked).toBe(false);
    // Coverage reason carries the why-now, exact language, and provenance.
    expect(item.coverage.reason).toContain(
      '"how to start composting in houston texas"',
    );
    expect(item.coverage.reason).toMatch(/no existing canonical coverage/);
    expect(item.coverage.existingCanonicalUrl).toBeNull();
  });

  it("seeds coverage gap, freshness, and cannibalization from the evaluation", async () => {
    const gapCandidate = buildCoverageCandidate(
      await familyInput({
        inventory: [
          asset({
            intent: "unrelated weather forecast",
            canonicalUrl: "https://x.example/w",
          }),
        ],
      }),
      NOW,
    );
    expect(gapCandidate.vector.coverageGap).toBe(1);
    expect(gapCandidate.vector.freshness).toBe(1); // evidence is recent
    expect(gapCandidate.penalty.cannibalization).toBe(false);

    const coveredCandidate = buildCoverageCandidate(await familyInput(), NOW);
    expect(coveredCandidate.vector.coverageGap).toBeCloseTo(0.1, 2);
    expect(coveredCandidate.penalty.cannibalization).toBe(true);
    expect(coveredCandidate.coverage.status).toBe("covered");
  });

  it("lets the caller override the non-coverage score factors", async () => {
    const candidate = buildCoverageCandidate(await familyInput(), NOW, {
      vector: { geography: 0.9, citation: 0.5 },
      penalty: { vanity: true },
    });
    expect(candidate.vector.geography).toBe(0.9);
    expect(candidate.vector.citation).toBe(0.5);
    // Penalty flags are applicability booleans.
    expect(candidate.penalty.vanity).toBe(true);
    // Coverage-owned factors are still driven by the evaluation.
    expect(candidate.vector.coverageGap).toBeCloseTo(0.1, 2);
    expect(candidate.penalty.cannibalization).toBe(true);
  });
});

describe("selectCoverageFeed — shared feed contract", () => {
  it("emits at most five feed items", async () => {
    const families = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        gapFamily(`fam-${index + 1}`, 1 - index * 0.05),
      ),
    );
    const { items, excluded } = await selectCoverageFeed(families, {
      runDate: RUN_DATE,
      now: NOW,
    });
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.itemId.startsWith("feed_"))).toBe(true);
    // The two overflow families are reported with the feed_limit reason.
    expect(excluded.filter((e) => e.reason === "feed_limit")).toHaveLength(2);
  });

  it("excludes generated-only evidence through selectOnFarmFeed", async () => {
    const generated = await gapFamily("gen", 1, {
      evidence: await buildFamilyEvidence("gen", [
        obs({
          externalId: "gen",
          canonicalUrl: "https://example.com/gen",
          sourceClass: "generated_candidate",
        }),
      ]),
    });
    const real = await gapFamily("real", 1);
    const { items, excluded } = await selectCoverageFeed([generated, real], {
      runDate: RUN_DATE,
      now: NOW,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    const genExcluded = excluded.find((entry) => entry.familyId === "gen");
    expect(genExcluded?.reason).toBe("generated_only_evidence");
  });

  it("excludes baseline-fingerprint evidence through selectOnFarmFeed", async () => {
    const baseline = await gapFamily("base", 1, {
      evidence: await buildFamilyEvidence("base", [
        obs({
          externalId: "base",
          canonicalUrl: "https://example.com/base",
          publishedAt: null,
          baselineFingerprint: true,
        }),
      ]),
    });
    const real = await gapFamily("real", 1);
    const { items, excluded } = await selectCoverageFeed([baseline, real], {
      runDate: RUN_DATE,
      now: NOW,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    const baseExcluded = excluded.find((entry) => entry.familyId === "base");
    expect(baseExcluded?.reason).toBe("baseline_fingerprint_only");
  });

  it("preserves an explicit compliance block through coverage selection", async () => {
    const blocked = await gapFamily("blocked", 1, {
      complianceBlock: true,
    });
    const real = await gapFamily("real", 1);
    const { items, excluded } = await selectCoverageFeed([blocked, real], {
      runDate: RUN_DATE,
      now: NOW,
    });
    expect(items.map((item) => item.familyId)).toEqual(["real"]);
    const blockedEntry = excluded.find((entry) => entry.familyId === "blocked");
    expect(blockedEntry?.reason).toBe("compliance_blocked");
  });

  it("orders selected items deterministically with stable ids", async () => {
    const families = await Promise.all(
      ["a", "b", "c"].map((id) => gapFamily(id, 1)),
    );
    const first = await selectCoverageFeed(families, {
      runDate: RUN_DATE,
      now: NOW,
    });
    const second = await selectCoverageFeed(families.toReversed(), {
      runDate: RUN_DATE,
      now: NOW,
    });
    expect(second.items.map((item) => item.itemId)).toEqual(
      first.items.map((item) => item.itemId),
    );
    expect(second.items.map((item) => item.familyId)).toEqual(
      first.items.map((item) => item.familyId),
    );
  });
});
