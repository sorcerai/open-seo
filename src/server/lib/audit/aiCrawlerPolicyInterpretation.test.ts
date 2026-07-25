import { describe, expect, it } from "vitest";
import { interpretAiCrawlerPolicy } from "./aiCrawlerPolicyInterpretation";

describe("interpretAiCrawlerPolicy", () => {
  it("returns an unavailable policy when robots.txt is missing", () => {
    const policy = interpretAiCrawlerPolicy(null);
    expect(policy.provenance.state).toBe("unavailable");
    expect(policy.citationBlocked).toBe(false);
    expect(policy.trainingBlocked).toBe(false);
    expect(policy.contentSignals.search.state).toBe("unavailable");
    expect(policy.aipref.state).toBe("unavailable");
  });

  it("propagates a training-bot block to trainingBlocked (not citationBlocked)", () => {
    const policy = interpretAiCrawlerPolicy("User-agent: GPTBot\nDisallow: /");
    // GPTBot is training-purpose — blocking it affects training, not citation.
    expect(policy.citationBlocked).toBe(false);
    expect(policy.trainingBlocked).toBe(true);
  });

  it("propagates a search-purpose bot block to citationBlocked", () => {
    const policy = interpretAiCrawlerPolicy(
      "User-agent: OAI-SearchBot\nDisallow: /",
    );
    expect(policy.citationBlocked).toBe(true);
    expect(policy.interpretation.search.citationBlocked).toBe(true);
  });

  it("attaches the Google-Extended caveat only to the training purpose", () => {
    const policy = interpretAiCrawlerPolicy("User-agent: *\nAllow: /");
    expect(policy.interpretation.training.googleExtendedCaveat).toContain(
      "Google AI Overviews",
    );
    expect(policy.interpretation.search.googleExtendedCaveat).toBeUndefined();
  });

  it("flags degraded provenance when a Content-Signal conflicts", () => {
    const policy = interpretAiCrawlerPolicy(
      "Content-Signal: search=yes\nContent-Signal: search=no",
    );
    expect(policy.degraded).toBe(true);
    expect(policy.provenance.state).toBe("degraded");
  });

  it("marks measured provenance for a clean, directive-light robots.txt", () => {
    const policy = interpretAiCrawlerPolicy("User-agent: *\nAllow: /");
    expect(policy.degraded).toBe(false);
    expect(policy.provenance.state).toBe("measured");
  });

  it("includes ai-input interpretation derived from Content-Signal", () => {
    const policy = interpretAiCrawlerPolicy("Content-Signal: ai-input=no");
    expect(policy.interpretation["ai-input"]?.state).toBe("blocked");
    expect(policy.interpretation["ai-input"]?.impact).toContain("grounding");
  });

  it("attaches per-purpose impact text", () => {
    const policy = interpretAiCrawlerPolicy("User-agent: *\nAllow: /");
    expect(policy.interpretation.search.impact).toContain(
      "citation visibility",
    );
    expect(policy.interpretation.training.impact).toContain("training-use");
  });

  it("marks ai-input as unavailable when robots.txt is missing", () => {
    const policy = interpretAiCrawlerPolicy(null);
    expect(policy.interpretation["ai-input"]?.state).toBe("unavailable");
  });

  it("marks aiprefState unavailable for every purpose when robots.txt is missing", () => {
    const policy = interpretAiCrawlerPolicy(null);
    expect(policy.interpretation.search.aiprefState).toBe("unavailable");
    expect(policy.interpretation.training.aiprefState).toBe("unavailable");
  });

  it("surfaces truncated=true and degraded provenance when input exceeds the size cap", () => {
    const oversized =
      "User-agent: GPTBot\nDisallow: /\n" + "#".repeat(500 * 1024);
    const policy = interpretAiCrawlerPolicy(oversized);
    expect(policy.provenance.truncated).toBe(true);
    expect(policy.provenance.state).toBe("degraded");
    expect(policy.trainingBlocked).toBe(true);
  });

  it("truncates by UTF-8 bytes, not UTF-16 code units (multibyte content)", () => {
    // é is 2 UTF-8 bytes but 1 UTF-16 code unit. 300K é chars = 600 KiB
    // UTF-8 but only 300K code units — a code-unit cap would miss this.
    const multibyte = "User-agent: *\nAllow: /\n" + "é".repeat(300 * 1024);
    const policy = interpretAiCrawlerPolicy(multibyte);
    expect(policy.provenance.truncated).toBe(true);
    expect(policy.degraded).toBe(true);
  });

  it("does not synthesize a root block when truncation cuts mid-line", () => {
    // A Disallow: /private rule whose line is split by the cap must NOT
    // become Disallow: / (which would be a blanket block).
    const header = "User-agent: *\nAllow: /\n";
    const padding = "#".repeat(500 * 1024);
    const tail = "\nDisallow: /private\n";
    const policy = interpretAiCrawlerPolicy(header + padding + tail);
    // The tail is beyond the cap and dropped; no bot should be blocked.
    expect(policy.provenance.truncated).toBe(true);
    expect(policy.citationBlocked).toBe(false);
    expect(policy.trainingBlocked).toBe(false);
  });
});
