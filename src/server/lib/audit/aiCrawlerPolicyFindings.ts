/**
 * AI crawler findings — the report/worklist layer over `interpretAiCrawlerPolicy`.
 *
 * The site-audit service layer maps these to `audit_issues` rows; this module
 * owns the severity policy so there is one source of truth for what makes a
 * P0 (critical) vs P1 (warning) AI-crawler finding.
 */

import { CONTENT_SIGNAL_KEYS, type BotPurpose } from "./aiCrawlerPolicy";
import type { AiCrawlerPolicy } from "./aiCrawlerPolicyInterpretation";
import type { AuditIssueType } from "@/shared/audit-issues";
import type { DetectedIssue } from "./issues/page-reporters";

type FindingSeverity = "critical" | "warning" | "info";

interface AiCrawlerFinding {
  /** Specific finding identifier (e.g. ai_crawler/oai-searchbot_blocked).
   *  Carried in `details.findingId` and `dedupeKey`; the registered
   *  `issue_type` is derived via `toDetectedIssues`. */
  id: string;
  severity: FindingSeverity;
  /** Bot the finding concerns, when applicable. */
  bot?: string;
  purpose?: BotPurpose;
  issue: string;
  recommendation: string;
}

const GOOGLE_EXTENDED_NOTE =
  " (Google-Extended does not affect Google AI Overviews.)";

/**
 * Turn an interpreted policy into a prioritized list of findings. Adapted
 * from the P0/P1 issue generation in Constellation's `audit()`, mapped onto
 * the `audit_issues` severity enum (`critical` / `warning` / `info`).
 *
 * Severity policy (DELIBERATE product divergence from Constellation — see
 * note below):
 * - Explicit search-bot block → `critical` (zero citation visibility).
 * - Wildcard block hitting search bots → `critical`.
 * - All search bots blocked → `critical` (blanket).
 * - Training/user/ads blocks → `warning`.
 * - Missing robots.txt → `warning` (can't interpret policy).
 * - Not-mentioned (cited by default) → `info`.
 *
 * Constellation emits P0 for every explicit block and P1 for every wildcard
 * block, purpose-independent. OpenSEO weights by product impact instead:
 * search-purpose blocks dominate because they gate AI-search citation
 * visibility (OpenSEO's AI-search citation surface), while training/user/ads
 * blocks are a deliberate IP/privacy choice with lower product impact. The
 * finding fires on all-search-bots-blocked (zero citation) rather than
 * Constellation's all-taxonomy-bots condition, for the same reason.
 */
export function generateAiCrawlerFindings(
  policy: AiCrawlerPolicy,
): AiCrawlerFinding[] {
  const findings: AiCrawlerFinding[] = [];
  const { purposeStatus } = policy;

  // No robots.txt: one umbrella finding, can't say more.
  const searchStatuses = purposeStatus.search;
  const noRobots = Object.values(searchStatuses).every(
    (s) => s === "no_robots_txt",
  );
  if (noRobots) {
    findings.push({
      id: "ai_crawler/no_robots_txt",
      severity: "warning",
      issue:
        "robots.txt not found or unreachable — AI crawler policy cannot be determined.",
      recommendation:
        "Add a robots.txt at the site origin and verify it is reachable before interpreting bot policy.",
    });
    return findings;
  }

  const searchBots = Object.entries(searchStatuses);
  const searchUseDenied =
    policy.contentSignals.search.state === "blocked" ||
    policy.aipref.preferences.search === "disallowed";

  // Blanket: every search bot blocked (explicit or wildcard).
  if (
    searchBots.length > 0 &&
    searchBots.every(([, s]) => s === "blocked" || s === "blocked_by_wildcard")
  ) {
    findings.push({
      id: "ai_crawler/all_search_blocked",
      severity: "critical",
      purpose: "search",
      issue: `All ${searchBots.length} modeled AI search crawlers are blocked from the site root.`,
      recommendation:
        "Review root Disallow rules for OAI-SearchBot, Claude-SearchBot, and PerplexityBot if those vendors should crawl the site.",
    });
  }

  for (const [bot, status] of searchBots) {
    if (status === "blocked") {
      findings.push({
        id: `ai_crawler/${bot.toLowerCase()}_blocked`,
        severity: "critical",
        bot,
        purpose: "search",
        issue: `${bot} is explicitly blocked in robots.txt.`,
        recommendation: `Remove the Disallow rule for ${bot} to restore AI search citation.`,
      });
    } else if (status === "blocked_by_wildcard") {
      findings.push({
        id: `ai_crawler/${bot.toLowerCase()}_wildcard`,
        severity: "critical",
        bot,
        purpose: "search",
        issue: `${bot} is blocked by a wildcard User-agent: * Disallow rule.`,
        recommendation: `Add an explicit Allow for ${bot}, or narrow the wildcard Disallow.`,
      });
    } else if (
      status === "not_mentioned" &&
      !policy.interpretation.search.blocked &&
      !searchUseDenied
    ) {
      findings.push({
        id: `ai_crawler/${bot.toLowerCase()}_default`,
        severity: "info",
        bot,
        purpose: "search",
        issue: `No robots.txt rule blocks ${bot} at the site root; crawl access is allowed by default.`,
        recommendation: `Optionally add an explicit Allow for ${bot} to document crawl intent.`,
      });
    }
  }

  // Non-search purposes: training/user/ads blocks are warnings, not critical.
  for (const purpose of ["training", "user", "ads"] as const) {
    const entries = Object.entries(purposeStatus[purpose]);
    for (const [bot, status] of entries) {
      const isGoogleExtended = bot === "Google-Extended";
      if (status === "blocked" || status === "blocked_by_wildcard") {
        const kind =
          status === "blocked" ? "explicitly blocked" : "blocked by wildcard";
        findings.push({
          id: `ai_crawler/${bot.toLowerCase()}_${purpose}_blocked`,
          severity: "warning",
          bot,
          purpose,
          issue: `${bot} (${purpose}) is ${kind} in robots.txt.${
            isGoogleExtended ? GOOGLE_EXTENDED_NOTE : ""
          }`,
          recommendation: isGoogleExtended
            ? "Allow Google-Extended if you want Google generative-AI training eligibility; Google AI Overviews are unaffected."
            : `Review whether blocking ${bot} (${purpose}) is intended.`,
        });
      }
    }
  }

  // Content-Signal / AIPREF conflicts and invalid values degrade trust.
  for (const key of CONTENT_SIGNAL_KEYS) {
    const signal = policy.contentSignals[key];
    const safeKey = key.replace(/-/g, "_");
    if (signal.state === "conflict") {
      findings.push({
        id: `ai_crawler/content_signal_${safeKey}_conflict`,
        severity: "warning",
        issue: `Content-Signal for "${key}" has conflicting yes/no values.`,
        recommendation: `Resolve the Content-Signal conflict for "${key}" so the policy is interpretable.`,
      });
    } else if (signal.state === "blocked") {
      findings.push({
        id: `ai_crawler/content_signal_${safeKey}_blocked`,
        severity: "warning",
        issue: `Content-Signal sets "${key}" to no.`,
        recommendation: `Review whether denying Content-Signal "${key}" is intended.`,
      });
    } else if (signal.state === "invalid") {
      findings.push({
        id: `ai_crawler/content_signal_${safeKey}_invalid`,
        severity: "info",
        issue: `Content-Signal for "${key}" has an unrecognized value.`,
        recommendation: `Use only yes/no for Content-Signal "${key}".`,
      });
    }
  }

  for (const key of ["search", "train-ai"] as const) {
    if (policy.aipref.preferences[key] === "disallowed") {
      findings.push({
        id: `ai_crawler/aipref_${key.replace("-", "_")}_blocked`,
        severity: "warning",
        issue: `AIPREF / Content-Usage sets "${key}" to n.`,
        recommendation: `Review whether denying AIPREF "${key}" is intended.`,
      });
    }
  }

  if (policy.aipref.state === "invalid") {
    findings.push({
      id: "ai_crawler/aipref_invalid",
      severity: "info",
      issue: "AIPREF / Content-Usage directive is malformed.",
      recommendation:
        "Format AIPREF statements as `key=value` pairs (y/n for train-ai and search).",
    });
  }

  return findings;
}

/**
 * Map a finding to its registered AuditIssueType. The finding's specific ID
 * is preserved in details.findingId + dedupeKey; the registered type drives
 * severity, title, and descriptor lookup for client/CSV/MCP consumers.
 */
export function findingToRegisteredType(
  finding: AiCrawlerFinding,
): AuditIssueType {
  const { id, purpose } = finding;
  if (id === "ai_crawler/no_robots_txt") return "ai-crawler-no-robots-txt";
  if (id === "ai_crawler/all_search_blocked")
    return "ai-crawler-all-search-blocked";
  if (id.startsWith("ai_crawler/aipref_") && id.endsWith("_blocked")) {
    return "ai-crawler-aipref-blocked";
  }
  if (id === "ai_crawler/aipref_invalid") return "ai-crawler-aipref-invalid";
  if (id.startsWith("ai_crawler/content_signal_")) {
    if (id.endsWith("_conflict")) return "ai-crawler-content-signal-conflict";
    if (id.endsWith("_blocked")) return "ai-crawler-content-signal-blocked";
    return "ai-crawler-content-signal-invalid";
  }
  // Bot-specific findings: ID suffix + purpose determine the family.
  if (id.endsWith("_default")) return "ai-crawler-search-bot-default";
  if (id.endsWith("_wildcard")) return "ai-crawler-search-bot-wildcard";
  if (purpose === "search") return "ai-crawler-search-bot-blocked";
  if (purpose === "training") return "ai-crawler-training-bot-blocked";
  if (purpose === "user") return "ai-crawler-user-bot-blocked";
  if (purpose === "ads") return "ai-crawler-ads-bot-blocked";
  throw new Error(
    `Unmapped AI-crawler finding: ${finding.id} (purpose=${String(purpose)})`,
  );
}

/**
 * Convert AI-crawler findings into DetectedIssue rows for the site-audit
 * issue pipeline. Each finding maps to a registered AuditIssueType; the
 * specific finding ID, bot, purpose, issue text, and recommendation are
 * preserved in `details` for UI rendering.
 *
 * `robotsTxtUrl` is used as the pageUrl — AI-crawler findings are site-wide,
 * not tied to a specific crawled page, so robots.txt is the closest anchor.
 */
export function toDetectedIssues(
  findings: AiCrawlerFinding[],
  robotsTxtUrl: string,
): DetectedIssue[] {
  return findings.map((finding) => ({
    issueType: findingToRegisteredType(finding),
    pageId: null,
    pageUrl: robotsTxtUrl,
    dedupeKey: finding.id,
    details: {
      findingId: finding.id,
      bot: finding.bot ?? null,
      purpose: finding.purpose ?? null,
      issue: finding.issue,
      recommendation: finding.recommendation,
    },
  }));
}
