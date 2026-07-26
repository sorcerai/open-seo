/**
 * Live AI-crawler impersonation probes — ports Constellation's `live_check()`
 * + `_probe_url()` from `scoring/ai_crawler_audit.py`.
 *
 * Fetches the target page URL with each AI bot's User-Agent to detect
 * runtime blocks that robots.txt analysis alone cannot reveal: WAF/bot
 * challenges (Cloudflare, Akamai), HTTP 403/429/503, redirect chains, and
 * content-length differences vs a normal browser baseline.
 *
 * This is an OPT-IN feature — it makes real outbound HTTP requests to the
 * audited site for each configured bot. The caller (workflow) must gate it
 * behind an explicit flag; it is NOT enabled by default.
 */

import { AI_BOT_TAXONOMY } from "./aiCrawlerPolicy";
import type { DetectedIssue } from "./issues/page-reporters";
import { normalizeAndValidateStartUrl } from "./url-policy";

// ---------------------------------------------------------------------------
// Bot User-Agent strings for live impersonation.
// ---------------------------------------------------------------------------

/** Exact UA strings published by each vendor. Used for live probes only —
 *  the static policy analysis does not need them. */
export const BOT_USER_AGENTS: Readonly<Record<string, string>> = {
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  "OAI-AdsBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot",
  GPTBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  "ChatGPT-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "Claude-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://anthropic.com/claude-searchbot",
  ClaudeBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +https://www.anthropic.com/claude-bot",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0; +https://www.anthropic.com/claude-user",
  PerplexityBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user",
};

/** Normal browser UA used as the baseline for content comparison. */
const BASELINE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// If a bot response body is shorter than this fraction of the baseline,
// we flag it as a content mismatch (likely truncated or different content).
const CONTENT_MISMATCH_THRESHOLD = 0.5;

const MAX_PROBE_RESPONSE_BYTES = 512 * 1024;

async function readBoundedText(response: Response): Promise<{
  text: string;
  byteLength: number;
  truncated: boolean;
}> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", byteLength: 0, truncated: false };

  const decoder = new TextDecoder();
  let text = "";
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      return { text, byteLength, truncated: false };
    }

    const remaining = MAX_PROBE_RESPONSE_BYTES - byteLength;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, remaining));
      await reader.cancel();
      return {
        text,
        byteLength: MAX_PROBE_RESPONSE_BYTES,
        truncated: true,
      };
    }

    byteLength += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
}
const PROBE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 1;

async function fetchProbeResponse(
  url: string,
  userAgent: string,
): Promise<{ response: Response; redirectChain: string[] }> {
  let currentUrl = url;
  const redirectChain: string[] = [];

  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(currentUrl, {
      headers: { "User-Agent": userAgent },
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, redirectChain };
    }

    const location = response.headers.get("location");
    if (!location) return { response, redirectChain };
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    }

    currentUrl = await normalizeAndValidateStartUrl(
      new URL(location, currentUrl).toString(),
    );
    redirectChain.push(currentUrl);
  }
}

// Patterns that indicate a bot-challenge / WAF interstitial page.
const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /Attention Required!\s*\|\s*Cloudflare/i,
  /cf-browser-verification/i,
  /Just a moment\.\.\./i,
  /_cf_chl/i,
  /Checking your browser/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotProbeResult {
  botName: string;
  purpose: string;
  vendor: string;
  statusCode: number;
  accessible: boolean;
  blocked: boolean;
  challengeDetected: boolean;
  contentMismatch: boolean;
  contentLength: number;
  responseTimeMs: number;
  redirectChain: string[];
  bodyTruncated: boolean;
  error: string | null;
}

export interface LiveCheckResult {
  baseline: BotProbeResult;
  bots: BotProbeResult[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Challenge detection
// ---------------------------------------------------------------------------

function detectChallenge(body: string, statusCode: number): boolean {
  if (statusCode === 403 && /Access denied/i.test(body)) return true;
  return CHALLENGE_PATTERNS.some((pattern) => pattern.test(body));
}

// ---------------------------------------------------------------------------
// Single-URL probe
// ---------------------------------------------------------------------------

async function probeUrl(
  url: string,
  botName: string,
  userAgent: string,
  purpose: string,
  vendor: string,
): Promise<BotProbeResult> {
  const result: BotProbeResult = {
    botName,
    purpose,
    vendor,
    statusCode: 0,
    accessible: false,
    blocked: false,
    challengeDetected: false,
    contentMismatch: false,
    contentLength: 0,
    responseTimeMs: 0,
    redirectChain: [],
    bodyTruncated: false,
    error: null,
  };

  const start = Date.now();
  try {
    const { response, redirectChain } = await fetchProbeResponse(
      url,
      userAgent,
    );
    result.responseTimeMs = Date.now() - start;
    result.statusCode = response.status;
    result.redirectChain = redirectChain;
    const body = await readBoundedText(response);
    result.contentLength = body.byteLength;
    result.bodyTruncated = body.truncated;
    result.accessible = response.status >= 200 && response.status < 300;
    result.challengeDetected = detectChallenge(body.text, response.status);
    result.blocked = !result.accessible || result.challengeDetected;
  } catch (error) {
    result.responseTimeMs = Date.now() - start;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      result.error = "Request timed out (15s)";
      result.blocked = true;
    } else if (error instanceof Error) {
      result.error = error.message;
    } else {
      result.error = "Unknown fetch error";
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Live check orchestrator
// ---------------------------------------------------------------------------

/**
 * Probe the target page URL with a normal browser UA (baseline) and every
 * AI bot UA. Detects runtime blocks that robots.txt analysis alone cannot
 * reveal.
 *
 * Uses `Promise.all` for concurrent probes. Each probe is a real outbound HTTP
 * subrequest from OpenSEO, not the vendor's verified network, so results only
 * describe how the site responds to the crawler User-Agent from this origin.
 */
export async function liveCheckAiCrawlers(
  pageUrl: string,
): Promise<LiveCheckResult> {
  // Validate the initial target here, not only the redirect hops below. Callers
  // may pass an unvalidated URL, and this function issues real outbound
  // requests, so the SSRF guard belongs at this boundary too.
  const target = await normalizeAndValidateStartUrl(pageUrl);

  // 1. Baseline fetch with a normal browser UA.
  const baseline = await probeUrl(
    target,
    "baseline",
    BASELINE_USER_AGENT,
    "baseline",
    "browser",
  );

  // 2. Concurrent probes for every AI bot.
  const botEntries = Object.entries(BOT_USER_AGENTS).filter(([bot]) =>
    Object.hasOwn(AI_BOT_TAXONOMY, bot),
  );
  const botResults = await Promise.all(
    botEntries.map(([bot, ua]) => {
      const entry = AI_BOT_TAXONOMY[bot];
      return probeUrl(target, bot, ua, entry.purpose, entry.vendor);
    }),
  );

  const baselineComparable =
    baseline.accessible && !baseline.challengeDetected && !baseline.error;
  if (!baselineComparable) {
    for (const result of botResults) {
      result.blocked = false;
      result.contentMismatch = false;
    }
    return {
      baseline,
      bots: botResults,
      summary: "Baseline request was not healthy; crawler comparison skipped",
    };
  }

  const baselineLen = baseline.contentLength || 0;
  for (const result of botResults) {
    const botLen = result.contentLength || 0;
    result.contentMismatch =
      !baseline.bodyTruncated &&
      !result.bodyTruncated &&
      result.accessible &&
      baselineLen > 0 &&
      botLen < baselineLen * CONTENT_MISMATCH_THRESHOLD;
  }

  // 4. Human-readable summary.
  const blocked = botResults.filter((r) => r.blocked).map((r) => r.botName);
  const challenged = botResults
    .filter((r) => r.challengeDetected)
    .map((r) => r.botName);
  const mismatched = botResults
    .filter((r) => r.contentMismatch)
    .map((r) => r.botName);

  // Errored probes are neither blocked nor passing. Omitting them let a summary
  // claim every probe got a 2xx while one never completed.
  const errored = botResults
    .filter((r) => r.error && !r.blocked)
    .map((r) => r.botName);

  const parts: string[] = [];
  if (blocked.length) parts.push(`Blocked: ${blocked.join(", ")}`);
  if (challenged.length)
    parts.push(`Challenge pages: ${challenged.join(", ")}`);
  if (mismatched.length)
    parts.push(`Content mismatch: ${mismatched.join(", ")}`);
  if (errored.length) parts.push(`Probe errors: ${errored.join(", ")}`);
  if (parts.length === 0)
    parts.push("All crawler-UA probes received 2xx responses");

  return {
    baseline,
    bots: botResults,
    summary: parts.join("; "),
  };
}

/** Convert runtime probe evidence into issue rows distinct from robots policy. */
export function toLiveDetectedIssues(
  result: LiveCheckResult,
  pageUrl: string,
): DetectedIssue[] {
  if (
    !result.baseline.accessible ||
    result.baseline.challengeDetected ||
    result.baseline.error
  ) {
    return [
      {
        issueType: "ai-crawler-live-probe-error",
        pageId: null,
        pageUrl,
        dedupeKey: "baseline",
        details: {
          bot: "baseline",
          statusCode: result.baseline.statusCode,
          challengeDetected: result.baseline.challengeDetected,
          error: result.baseline.error,
          evidenceScope:
            "Baseline request was unhealthy; crawler comparison was skipped",
        },
      },
    ];
  }

  return result.bots.flatMap((bot): DetectedIssue[] => {
    const details = {
      bot: bot.botName,
      purpose: bot.purpose,
      vendor: bot.vendor,
      statusCode: bot.statusCode,
      challengeDetected: bot.challengeDetected,
      responseTimeMs: bot.responseTimeMs,
      error: bot.error,
      bodyTruncated: bot.bodyTruncated,
      evidenceScope:
        "OpenSEO request with crawler User-Agent; vendor source identity is not emulated",
    };

    if (bot.error) {
      return [
        {
          issueType: "ai-crawler-live-probe-error",
          pageId: null,
          pageUrl,
          dedupeKey: bot.botName,
          details,
        },
      ];
    }

    if (bot.blocked) {
      return [
        {
          issueType:
            bot.purpose === "search"
              ? "ai-crawler-live-search-blocked"
              : "ai-crawler-live-bot-blocked",
          pageId: null,
          pageUrl,
          dedupeKey: bot.botName,
          details,
        },
      ];
    }

    if (bot.contentMismatch) {
      return [
        {
          issueType: "ai-crawler-live-content-mismatch",
          pageId: null,
          pageUrl,
          dedupeKey: bot.botName,
          details: {
            ...details,
            baselineContentLength: result.baseline.contentLength,
            crawlerContentLength: bot.contentLength,
          },
        },
      ];
    }

    return [];
  });
}
