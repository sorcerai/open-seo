import { afterEach, describe, expect, it, vi } from "vitest";

const { validateUrlMock } = vi.hoisted(() => ({
  validateUrlMock: vi.fn(async (url: string) => url),
}));

vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: validateUrlMock,
}));
import {
  BOT_USER_AGENTS,
  liveCheckAiCrawlers,
  toLiveDetectedIssues,
  type LiveCheckResult,
} from "./aiCrawlerPolicyLive";

const BASELINE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function mockResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

/** Mock fetch that dispatches to a handler keyed on the User-Agent header. */
function stubFetch(handler: (ua: string) => Response): void {
  const fn = vi.fn<typeof fetch>(async (_input, init) => {
    const ua = new Headers(init?.headers).get("User-Agent") ?? "";
    return handler(ua);
  });
  vi.stubGlobal("fetch", fn);
}

afterEach(() => {
  validateUrlMock.mockClear();
  vi.unstubAllGlobals();
});

describe("BOT_USER_AGENTS", () => {
  it("provides UA strings for taxonomy bots", () => {
    expect(Object.keys(BOT_USER_AGENTS).length).toBeGreaterThanOrEqual(8);
    for (const ua of Object.values(BOT_USER_AGENTS)) {
      expect(ua).toBeTruthy();
    }
    expect(BOT_USER_AGENTS).not.toHaveProperty("Google-Extended");
  });
});

function makeResult(
  bot: Partial<LiveCheckResult["bots"][number]>,
): LiveCheckResult {
  const base = {
    botName: "baseline",
    purpose: "baseline",
    vendor: "browser",
    statusCode: 200,
    accessible: true,
    blocked: false,
    challengeDetected: false,
    contentMismatch: false,
    contentLength: 1_000,
    responseTimeMs: 10,
    redirectChain: [],
    error: null,
    bodyTruncated: false,
  };
  return {
    baseline: base,
    bots: [
      {
        ...base,
        botName: "OAI-SearchBot",
        purpose: "search",
        vendor: "OpenAI",
        ...bot,
      },
    ],
    summary: "",
  };
}

describe("toLiveDetectedIssues", () => {
  it("emits a distinct critical runtime issue for a blocked search crawler", () => {
    const issues = toLiveDetectedIssues(
      makeResult({ blocked: true, statusCode: 403 }),
      "https://example.com",
    );

    expect(issues).toMatchObject([
      {
        issueType: "ai-crawler-live-search-blocked",
        pageUrl: "https://example.com",
        dedupeKey: "OAI-SearchBot",
      },
    ]);
  });

  it("does not misreport a blocked response as a content mismatch", () => {
    const issues = toLiveDetectedIssues(
      makeResult({ blocked: true, contentMismatch: true, statusCode: 403 }),
      "https://example.com",
    );

    expect(issues.map((issue) => issue.issueType)).toEqual([
      "ai-crawler-live-search-blocked",
    ]);
  });

  it("emits a content mismatch only for an otherwise successful probe", () => {
    const issues = toLiveDetectedIssues(
      makeResult({ contentMismatch: true }),
      "https://example.com",
    );

    expect(issues[0]?.issueType).toBe("ai-crawler-live-content-mismatch");
  });

  it("records probe errors without claiming the crawler was blocked", () => {
    const issues = toLiveDetectedIssues(
      makeResult({ accessible: false, error: "network unavailable" }),
      "https://example.com",
    );

    expect(issues[0]?.issueType).toBe("ai-crawler-live-probe-error");
  });
});

describe("liveCheckAiCrawlers", () => {
  it("reports no blocks when all bots get normal 200 responses", async () => {
    stubFetch(() => mockResponse(200, "<html>normal page content</html>"));
    const result = await liveCheckAiCrawlers("https://example.com/");
    expect(result.bots.every((b) => !b.blocked)).toBe(true);
    expect(result.summary).toContain("crawler-UA probes received 2xx");
  });

  it("detects a 403 block", async () => {
    stubFetch((ua) =>
      ua.includes("GPTBot")
        ? mockResponse(403, "Forbidden")
        : mockResponse(200, "<html>normal page content</html>"),
    );
    const result = await liveCheckAiCrawlers("https://example.com/");
    const gpt = result.bots.find((b) => b.botName === "GPTBot");
    expect(gpt?.blocked).toBe(true);
    expect(gpt?.statusCode).toBe(403);
  });

  it("detects a Cloudflare challenge page", async () => {
    stubFetch((ua) =>
      ua.includes("PerplexityBot")
        ? mockResponse(200, "Just a moment...")
        : mockResponse(200, "<html>normal page content</html>"),
    );
    const result = await liveCheckAiCrawlers("https://example.com/");
    const perp = result.bots.find((b) => b.botName === "PerplexityBot");
    expect(perp?.challengeDetected).toBe(true);
    expect(perp?.blocked).toBe(true);
  });

  it("detects content mismatch when bot gets a much shorter response", async () => {
    const normalBody = "x".repeat(10000);
    stubFetch((ua) =>
      ua === BASELINE_UA
        ? mockResponse(200, normalBody)
        : ua.includes("ClaudeBot")
          ? mockResponse(200, "x".repeat(100))
          : mockResponse(200, normalBody),
    );
    const result = await liveCheckAiCrawlers("https://example.com/");
    const claude = result.bots.find((b) => b.botName === "ClaudeBot");
    expect(claude?.contentMismatch).toBe(true);
  });

  it("includes blocked bot names in the summary", async () => {
    stubFetch((ua) =>
      ua.includes("GPTBot") || ua.includes("ClaudeBot")
        ? mockResponse(403, "Forbidden")
        : mockResponse(200, "<html>normal page content</html>"),
    );
    const result = await liveCheckAiCrawlers("https://example.com/");
    expect(result.summary).toContain("GPTBot");
    expect(result.summary).toContain("ClaudeBot");
  });
  it("bounds response reads and disables unreliable size comparison", async () => {
    const oversizedBody = "x".repeat(600 * 1024);
    stubFetch(() => mockResponse(200, oversizedBody));

    const result = await liveCheckAiCrawlers("https://example.com/");

    expect(result.baseline.bodyTruncated).toBe(true);
    expect(result.bots.every((bot) => bot.bodyTruncated)).toBe(true);
    expect(result.bots.every((bot) => !bot.contentMismatch)).toBe(true);
  });

  it("emits one inconclusive issue when the baseline is unhealthy", async () => {
    stubFetch(() => mockResponse(404, "Not found"));
    const result = await liveCheckAiCrawlers("https://example.com/");
    const issues = toLiveDetectedIssues(result, "https://example.com/");

    expect(result.bots.every((bot) => !bot.blocked)).toBe(true);
    expect(issues).toMatchObject([
      {
        issueType: "ai-crawler-live-probe-error",
        dedupeKey: "baseline",
      },
    ]);
  });

  it("manually follows only revalidated redirects", async () => {
    const cancelRedirectBody = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async (input, _init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "https://example.com/") {
        return new Response(
          new ReadableStream({ cancel: cancelRedirectBody }),
          {
            status: 302,
            headers: { location: "https://public.example/final" },
          },
        );
      }
      return mockResponse(200, "<html>normal page content</html>");
    });
    vi.stubGlobal("fetch", fetchMock);

    await liveCheckAiCrawlers("https://example.com/");
    expect(cancelRedirectBody).toHaveBeenCalledTimes(
      Object.keys(BOT_USER_AGENTS).length + 1,
    );

    expect(validateUrlMock).toHaveBeenCalledWith(
      "https://public.example/final",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
