import { describe, expect, it } from "vitest";
import {
  AI_BOT_TAXONOMY,
  AI_CRAWLER_BOTS,
  parseAipref,
  parseContentSignals,
  parseRobotsForAiBots,
  POLICY_SOURCES,
} from "./aiCrawlerPolicy";

describe("AI_BOT_TAXONOMY", () => {
  it("covers the 10 Constellation AI bots across all four purposes", () => {
    expect(AI_CRAWLER_BOTS).toEqual([
      "OAI-SearchBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "ChatGPT-User",
      "Claude-User",
      "Perplexity-User",
      "OAI-AdsBot",
    ]);
    const purposes = new Set(
      Object.values(AI_BOT_TAXONOMY).map((b) => b.purpose),
    );
    expect(purposes).toEqual(new Set(["search", "training", "user", "ads"]));
  });

  it("flags Google-Extended as not affecting AI Overviews", () => {
    expect(AI_BOT_TAXONOMY["Google-Extended"].aiOverviewsUnaffected).toBe(true);
    // No other bot carries the caveat.
    for (const [bot, entry] of Object.entries(AI_BOT_TAXONOMY)) {
      if (bot === "Google-Extended") continue;
      expect(entry.aiOverviewsUnaffected).toBeUndefined();
    }
  });
});

describe("POLICY_SOURCES", () => {
  it("references authoritative vendor and standards docs", () => {
    expect(POLICY_SOURCES.openai_bots).toMatch(
      /^https:\/\/developers\.openai\.com/,
    );
    expect(POLICY_SOURCES.anthropic_bots).toMatch(
      /^https:\/\/support\.anthropic\.com/,
    );
    expect(POLICY_SOURCES.perplexity_crawlers).toMatch(
      /^https:\/\/docs\.perplexity\.ai/,
    );
    expect(POLICY_SOURCES.cloudflare_content_signals).toMatch(
      /^https:\/\/blog\.cloudflare\.com/,
    );
  });
  it("uses the correct datatracker.ietf.org host (not datetracker)", () => {
    expect(POLICY_SOURCES.ietf_aipref_attachment).toContain(
      "datatracker.ietf.org",
    );
    expect(POLICY_SOURCES.ietf_aipref_attachment).not.toContain("datetracker");
  });
});

describe("parseRobotsForAiBots", () => {
  it("returns no_robots_txt for every bot when text is null", () => {
    const result = parseRobotsForAiBots(null);
    for (const bot of AI_CRAWLER_BOTS) {
      expect(result[bot]).toBe("no_robots_txt");
    }
  });

  it("treats an empty robots.txt as not_mentioned for every bot (nothing blocked)", () => {
    const result = parseRobotsForAiBots("");
    for (const bot of AI_CRAWLER_BOTS) {
      expect(result[bot]).toBe("not_mentioned");
    }
  });

  it("classifies an explicit Allow for one bot and leaves the rest not_mentioned", () => {
    const result = parseRobotsForAiBots("User-agent: GPTBot\nAllow: /");
    expect(result.GPTBot).toBe("allowed");
    expect(result["ClaudeBot"]).toBe("not_mentioned");
    expect(result["OAI-SearchBot"]).toBe("not_mentioned");
  });

  it("classifies an explicit Disallow as blocked", () => {
    const result = parseRobotsForAiBots("User-agent: GPTBot\nDisallow: /");
    expect(result.GPTBot).toBe("blocked");
  });

  it("classifies a wildcard Disallow with no explicit rule as blocked_by_wildcard", () => {
    const result = parseRobotsForAiBots("User-agent: *\nDisallow: /");
    expect(result.GPTBot).toBe("blocked_by_wildcard");
    expect(result["OAI-SearchBot"]).toBe("blocked_by_wildcard");
    expect(result["ClaudeBot"]).toBe("blocked_by_wildcard");
  });

  it("lets an explicit Allow win over a wildcard Disallow", () => {
    const result = parseRobotsForAiBots(
      "User-agent: *\nDisallow: /\nUser-agent: GPTBot\nAllow: /",
    );
    expect(result.GPTBot).toBe("allowed");
    // Untouched bots still fall through to the wildcard.
    expect(result["ClaudeBot"]).toBe("blocked_by_wildcard");
  });

  it("treats an explicit bot group with no root rule as not_mentioned (suppresses wildcard)", () => {
    // RFC 9309: an explicit group for the bot takes precedence over the
    // wildcard group even when the explicit group has no matching rule.
    // GPTBot has only /private, so at root it is not_mentioned — NOT
    // blocked_by_wildcard. ClaudeBot has no explicit group, so it falls
    // through to the wildcard Disallow: /.
    const result = parseRobotsForAiBots(
      "User-agent: GPTBot\nDisallow: /private\nUser-agent: *\nDisallow: /",
    );
    expect(result.GPTBot).toBe("not_mentioned");
    expect(result["ClaudeBot"]).toBe("blocked_by_wildcard");
  });

  it("supports a multi-agent group sharing one Disallow", () => {
    const result = parseRobotsForAiBots(
      "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /",
    );
    expect(result.GPTBot).toBe("blocked");
    expect(result["ClaudeBot"]).toBe("blocked");
  });

  it("strips comments and ignores case in User-agent values", () => {
    const result = parseRobotsForAiBots(
      "# header comment\nUser-agent: gptbot  # inline\nAllow: /",
    );
    expect(result.GPTBot).toBe("allowed");
  });
  it("does not break a group on a blank line between User-agent and rules", () => {
    const result = parseRobotsForAiBots("User-agent: GPTBot\n\nDisallow: /");
    expect(result.GPTBot).toBe("blocked");
  });

  it("does not let a Sitemap directive split a multi-agent group", () => {
    const result = parseRobotsForAiBots(
      "User-agent: GPTBot\nUser-agent: ClaudeBot\nSitemap: https://x.com/s.xml\nDisallow: /",
    );
    expect(result.GPTBot).toBe("blocked");
    expect(result["ClaudeBot"]).toBe("blocked");
  });

  it.each([
    "Crawl-delay: 10",
    "Sitemap: https://x.com/s.xml",
    "Content-Signal: search=yes",
    "Content-Usage: / train-ai=y",
  ])("starts a new group after the %s group member", (groupMemberDirective) => {
    const result = parseRobotsForAiBots(
      `User-agent: *\n${groupMemberDirective}\nUser-agent: GPTBot\nDisallow: /`,
    );
    expect(result.GPTBot).toBe("blocked");
    expect(result["OAI-SearchBot"]).toBe("not_mentioned");
  });

  it("recognizes Disallow: /* as a blanket block equivalent to /", () => {
    const result = parseRobotsForAiBots("User-agent: *\nDisallow: /*");
    expect(result.GPTBot).toBe("blocked_by_wildcard");
  });

  it("handles CRLF line endings", () => {
    const result = parseRobotsForAiBots("User-agent: GPTBot\r\nDisallow: /");
    expect(result.GPTBot).toBe("blocked");
  });
});

describe("parseContentSignals", () => {
  it("returns unspecified for every key when no Content-Signal directive is present", () => {
    const result = parseContentSignals("User-agent: *\nAllow: /");
    expect(result.search.state).toBe("unspecified");
    expect(result["ai-input"].state).toBe("unspecified");
    expect(result["ai-train"].state).toBe("unspecified");
  });

  it("parses a single yes as allowed", () => {
    const result = parseContentSignals("Content-Signal: search=yes");
    expect(result.search).toEqual({ state: "allowed", values: ["yes"] });
  });

  it("parses a single no as blocked", () => {
    const result = parseContentSignals("Content-Signal: search=no");
    expect(result.search.state).toBe("blocked");
  });

  it("flags both yes and no for the same key as conflict", () => {
    const result = parseContentSignals(
      "Content-Signal: search=yes\nContent-Signal: search=no",
    );
    expect(result.search.state).toBe("conflict");
    expect(result.search.values).toEqual(["yes", "no"]);
  });

  it("flags an unrecognized value as invalid", () => {
    const result = parseContentSignals("Content-Signal: search=maybe");
    expect(result.search.state).toBe("invalid");
  });

  it("treats mixed valid and unknown values as invalid", () => {
    const result = parseContentSignals(
      "Content-Signal: search=yes\nContent-Signal: search=maybe",
    );
    expect(result.search.state).toBe("invalid");
  });

  it("parses multiple keys in one directive", () => {
    const result = parseContentSignals(
      "Content-Signal: search=yes, ai-train=no, ai-input=yes",
    );
    expect(result.search.state).toBe("allowed");
    expect(result["ai-train"].state).toBe("blocked");
    expect(result["ai-input"].state).toBe("allowed");
  });
});

describe("parseAipref", () => {
  it("returns unspecified when no directive is present", () => {
    const result = parseAipref("User-agent: *\nAllow: /");
    expect(result.state).toBe("unspecified");
    expect(result.preferences).toEqual({});
    expect(result.extensions).toEqual({});
  });

  it("parses train-ai=y as allowed", () => {
    const result = parseAipref("Content-Usage: train-ai=y");
    expect(result.preferences["train-ai"]).toBe("allowed");
    expect(result.state).toBe("measured");
  });

  it("parses train-ai=n as disallowed", () => {
    const result = parseAipref("Content-Usage: train-ai=n");
    expect(result.preferences["train-ai"]).toBe("disallowed");
  });

  it("parses an unrecognized value as unknown without invalidating the statement", () => {
    const result = parseAipref("Content-Usage: train-ai=maybe");
    expect(result.preferences["train-ai"]).toBe("unknown");
    expect(result.state).toBe("measured");
  });

  it("strips a leading path prefix and parses multiple keys", () => {
    const result = parseAipref("Content-Usage: / train-ai=y, search=n");
    expect(result.preferences["train-ai"]).toBe("allowed");
    expect(result.preferences.search).toBe("disallowed");
  });

  it("does not globalize path- or bot-scoped AIPREF directives", () => {
    const pathScoped = parseAipref(
      "User-agent: *\nContent-Usage: /private train-ai=n",
    );
    expect(pathScoped.state).toBe("measured");
    expect(pathScoped.preferences).toEqual({});

    const botScoped = parseAipref(
      "User-agent: GPTBot\nContent-Usage: / train-ai=n",
    );
    expect(botScoped.state).toBe("unspecified");
    expect(botScoped.preferences).toEqual({});
  });

  it("captures non-standard keys as extensions", () => {
    const result = parseAipref("Content-Usage: custom-key=value");
    expect(result.extensions["custom-key"]).toBe("value");
  });

  it("flags a malformed statement (no =) as invalid", () => {
    const result = parseAipref("Content-Usage: train-ai");
    expect(result.state).toBe("invalid");
  });

  it("accepts AI-Pref and AIPREF label variants", () => {
    const hyphen = parseAipref("AI-Preference: train-ai=y");
    const underscore = parseAipref("AI_Preference: search=n");
    expect(hyphen.preferences["train-ai"]).toBe("allowed");
    expect(underscore.preferences.search).toBe("disallowed");
  });
  it("flags an empty item (trailing comma) as invalid", () => {
    const result = parseAipref("Content-Usage: train-ai=y,");
    expect(result.state).toBe("invalid");
  });

  it("ignores prototype-chain label names like Constructor", () => {
    const result = parseAipref("Constructor: train-ai=n");
    expect(result.state).toBe("unspecified");
    expect(result.preferences["train-ai"]).toBeUndefined();
  });
});
