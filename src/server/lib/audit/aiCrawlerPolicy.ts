/**
 * AI crawler policy — types, constants, and the three robots.txt-layer parsers.
 *
 * Determines whether a site's robots.txt — plus Cloudflare Content-Signal and
 * IETF AIPREF / Content-Usage directives — permits access by AI crawlers.
 * This module holds the acquisition + directive parsers; the purpose-aware
 * synthesis lives in `aiCrawlerPolicyInterpretation.ts` and the findings /
 * worklist layer in `aiCrawlerPolicyFindings.ts`.
 *
 * Design note: `robots-parser`'s `isAllowed()` collapses three distinct states
 * (explicit Allow, not-mentioned, wildcard-only block) into a single boolean.
 * The RFC 9309 group scan here keeps the four Constellation statuses distinct
 * — the difference between "you're cited because you explicitly allow GPTBot"
 * and "you're cited by default" is the whole point.
 */

// ---------------------------------------------------------------------------
// Bot taxonomy — the canonical IP. Vendors' semantics are intentionally
// explicit: a robots decision for one purpose (e.g. training) must NOT be
// generalized to another (e.g. search citation). Sourced from
// references/sro_research_constants.py + vendor docs in POLICY_SOURCES.
// ---------------------------------------------------------------------------

export type BotPurpose = "search" | "training" | "user" | "ads";

interface BotTaxonomyEntry {
  purpose: BotPurpose;
  vendor: string;
  /**
   * Present only for bots whose semantics diverge by surface. Google-Extended
   * controls generative-AI training eligibility but does NOT control Google AI
   * Overviews — conflating them is a common, costly misread.
   */
  aiOverviewsUnaffected?: boolean;
}

export const AI_BOT_TAXONOMY: Record<string, BotTaxonomyEntry> = {
  "OAI-SearchBot": { purpose: "search", vendor: "OpenAI" },
  "Claude-SearchBot": { purpose: "search", vendor: "Anthropic" },
  PerplexityBot: { purpose: "search", vendor: "Perplexity" },
  GPTBot: { purpose: "training", vendor: "OpenAI" },
  ClaudeBot: { purpose: "training", vendor: "Anthropic" },
  "Google-Extended": {
    purpose: "training",
    vendor: "Google",
    aiOverviewsUnaffected: true,
  },
  "ChatGPT-User": { purpose: "user", vendor: "OpenAI" },
  "Claude-User": { purpose: "user", vendor: "Anthropic" },
  "Perplexity-User": { purpose: "user", vendor: "Perplexity" },
  "OAI-AdsBot": { purpose: "ads", vendor: "OpenAI" },
};

export const AI_CRAWLER_BOTS: readonly string[] = Object.keys(AI_BOT_TAXONOMY);

/** Canonical vendor / standards-doc URLs — attached to every policy result
 *  as provenance so downstream UI can link to the authoritative source. */
export const POLICY_SOURCES: Readonly<Record<string, string>> = {
  openai_bots: "https://developers.openai.com/api/docs/bots",
  anthropic_bots:
    "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  perplexity_crawlers:
    "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
  cloudflare_content_signals:
    "https://blog.cloudflare.com/content-signals-policy/",
  ietf_aipref_vocabulary:
    "https://datatracker.ietf.org/doc/draft-ietf-aipref-vocab/",
  ietf_aipref_attachment:
    "https://datatracker.ietf.org/doc/draft-ietf-aipref-attach/",
};

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

/**
 * Per-bot acquisition status from robots.txt. RFC 9309 only governs
 * acquisition (crawling); it says nothing about post-access usage, which is
 * why Content-Signal and AIPREF exist as separate layers.
 */
export type BotAcquisitionStatus =
  | "allowed" // explicit Allow for this bot at "/"
  | "blocked" // explicit Disallow for this bot at "/"
  | "blocked_by_wildcard" // no explicit rule; wildcard Disallow: "/" applies
  | "not_mentioned" // no explicit rule and no blocking wildcard
  | "no_robots_txt"; // robots.txt missing or unreachable

export type SignalState =
  | "allowed"
  | "blocked"
  | "unspecified" // directive absent
  | "invalid" // directive present but value not in {yes, no}
  | "conflict" // both yes and no appear
  | "unavailable"; // robots.txt itself missing

export type AiprefState =
  | "measured" // at least one parseable statement
  | "unspecified" // no statement
  | "invalid" // statement present but malformed
  | "unavailable"; // robots.txt missing

export type ContentSignalKey = "search" | "ai-input" | "ai-train";

export const CONTENT_SIGNAL_KEYS: readonly ContentSignalKey[] = [
  "search",
  "ai-input",
  "ai-train",
];

export interface ContentSignalEntry {
  state: SignalState;
  values: string[]; // raw settings seen, in order
}

export type ContentSignalsResult = Record<ContentSignalKey, ContentSignalEntry>;

export interface AiprefResult {
  state: AiprefState;
  preferences: Partial<
    Record<
      "train-ai" | "search",
      "allowed" | "disallowed" | "unknown" | "conflict"
    >
  >;
  /** Non-standard keys we did not reject — preserved for forward-compat. */
  extensions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// robots.txt acquisition parser (RFC 9309 group scan)
// ---------------------------------------------------------------------------

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

/**
 * Scan robots.txt into User-agent groups, tracking only root rules ("/" and
 * the equivalent blanket "/*"). Faithful to RFC 9309 group semantics:
 *
 * - Blank lines and comment-only lines do NOT end a group.
 * - Non-REP directives (Sitemap, Crawl-delay, …) are group members that do
 *   not affect group structure.
 * - A User-agent line before any rule adds to the current group's agent list
 *   (multi-agent group); a User-agent line after a rule starts a new group.
 * - A group is kept even with no rules — per RFC 9309 it means "allow
 *   everything" for those agents, and it still suppresses the wildcard group.
 */
function scanRobotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let hasGroupMember = false;

  const finishGroup = (): void => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasGroupMember = false;
  };

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const label = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (label === "user-agent") {
      // User-agent records are consecutive at the start of a group. Once any
      // group member appears, a later User-agent begins the next group.
      if (hasGroupMember) finishGroup();
      if (value) agents.push(value.toLowerCase());
    } else if (agents.length) {
      hasGroupMember = true;
      if ((label === "allow" || label === "disallow") && value) {
        rules.push({ path: value, allow: label === "allow" });
      }
    }
  }
  finishGroup();
  return groups;
}

function robotsRuleMatchesPath(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const source = raw
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

function robotsRuleSpecificity(rule: RobotsRule): number {
  return rule.path.replaceAll("*", "").replace(/\$$/, "").length;
}

/**
 * Classify every AI bot's acquisition status from robots.txt text.
 *
 * RFC 9309 precedence: an explicit group for the bot wins; otherwise the
 * wildcard "*" group applies; otherwise the bot is "not_mentioned". A missing
 * robots.txt yields "no_robots_txt" for every bot.
 */
export function parseRobotsForAiBots(
  robotsText: string | null,
): Record<string, BotAcquisitionStatus> {
  const result: Record<string, BotAcquisitionStatus> = {};
  if (robotsText === null) {
    for (const bot of AI_CRAWLER_BOTS) result[bot] = "no_robots_txt";
    return result;
  }

  const groups = scanRobotsGroups(robotsText);
  for (const bot of AI_CRAWLER_BOTS) {
    const botKey = bot.toLowerCase();
    const explicit = groups.filter((g) => g.agents.includes(botKey));
    const applicable = explicit.length
      ? explicit
      : groups.filter((g) => g.agents.includes("*"));

    if (!applicable.length) {
      result[bot] = "not_mentioned";
      continue;
    }
    const matchingRules = applicable
      .flatMap((group) => group.rules)
      .filter((rule) => robotsRuleMatchesPath(rule.path, "/"));
    if (!matchingRules.length) {
      result[bot] = "not_mentioned";
      continue;
    }

    const maxSpecificity = Math.max(
      ...matchingRules.map(robotsRuleSpecificity),
    );
    const rootAllowed = matchingRules.some(
      (rule) => rule.allow && robotsRuleSpecificity(rule) === maxSpecificity,
    );
    result[bot] = rootAllowed
      ? "allowed"
      : explicit.length
        ? "blocked"
        : "blocked_by_wildcard";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Content-Signal parser (Cloudflare draft)
// ---------------------------------------------------------------------------

/** Classify the raw yes/no settings for one Content-Signal key. */
function classifyContentSignal(raw: string[]): ContentSignalEntry {
  const known = new Set(
    raw.filter((value) => value === "yes" || value === "no"),
  );
  const hasUnknown = raw.some((value) => value !== "yes" && value !== "no");
  let state: SignalState;
  if (raw.length === 0) state = "unspecified";
  else if (hasUnknown) state = "invalid";
  else if (known.size > 1) state = "conflict";
  else state = known.has("yes") ? "allowed" : "blocked";
  return { state, values: raw };
}

/**
 * Parse Cloudflare Content-Signal directives from robots.txt.
 *
 * Shape: `Content-Signal: search=yes, ai-train=no, ai-input=yes`. Missing
 * signals stay `unspecified` — never treated as permission or denial. Both
 * `yes` and `no` for the same key is a `conflict`; a value that is neither
 * is `invalid`.
 */
export function parseContentSignals(robotsText: string): ContentSignalsResult {
  const collected: Record<ContentSignalKey, string[]> = {
    search: [],
    "ai-input": [],
    "ai-train": [],
  };

  for (const rawLine of robotsText.split(/\r\n|\r|\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const label = line.slice(0, colonIdx).trim().toLowerCase();
    if (label !== "content-signal") continue;
    const value = line.slice(colonIdx + 1).trim();

    for (const item of value.split(",")) {
      const eqIdx = item.indexOf("=");
      if (eqIdx === -1) continue;
      const key = item.slice(0, eqIdx).trim().toLowerCase();
      const setting = item
        .slice(eqIdx + 1)
        .trim()
        .toLowerCase();
      if (key === "search" || key === "ai-input" || key === "ai-train") {
        collected[key].push(setting);
      }
    }
  }

  return {
    search: classifyContentSignal(collected.search),
    "ai-input": classifyContentSignal(collected["ai-input"]),
    "ai-train": classifyContentSignal(collected["ai-train"]),
  };
}

// ---------------------------------------------------------------------------
// AIPREF / Content-Usage parser (IETF draft)
// ---------------------------------------------------------------------------

const AIPREF_LABELS: Record<string, true> = {
  "content-usage": true,
  aipref: true,
  "ai-preference": true,
  "ai-preferences": true,
};

/**
 * Parse IETF AIPREF / Content-Usage directives without rejecting non-standard
 * extensions. Known keys are `train-ai` and `search` with values `y`/`n`;
 * anything else is captured in `extensions`.
 *
 * Statement shape: `Content-Usage: / train-ai=y, search=n` — an optional path
 * prefix precedes the key=value list.
 */
export function parseAipref(robotsText: string): AiprefResult {
  const statements: string[] = [];
  let agents: string[] = [];
  let inRules = false;

  for (const rawLine of robotsText.split(/\r\n|\r|\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const label = line
      .slice(0, colonIdx)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    const value = line.slice(colonIdx + 1).trim();
    if (label === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      if (value) agents.push(value.toLowerCase());
      continue;
    }
    if (label === "allow" || label === "disallow") {
      inRules = true;
      continue;
    }
    if (Object.hasOwn(AIPREF_LABELS, label) || label.startsWith("aipref-")) {
      inRules = true;
      if (agents.length === 0 || agents.includes("*")) statements.push(value);
    }
  }

  const preferences: AiprefResult["preferences"] = {};
  const extensions: Record<string, string> = {};
  let invalid = false;

  for (let statement of statements) {
    if (statement.startsWith("/")) {
      const wsIdx = statement.search(/\s/);
      const path = wsIdx === -1 ? statement : statement.slice(0, wsIdx);
      if (path !== "/") continue;
      statement = wsIdx === -1 ? "" : statement.slice(wsIdx + 1);
    }
    for (const item of statement.split(",")) {
      const trimmed = item.trim();
      if (!trimmed) {
        invalid = true;
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) {
        invalid = true;
        continue;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .split(";", 1)[0]
        .trim();
      if (!key) {
        invalid = true;
        continue;
      }
      if (key === "train-ai" || key === "search") {
        const resolved =
          value === "y" ? "allowed" : value === "n" ? "disallowed" : "unknown";
        const prior = preferences[key];
        // Contradictory repeats are a conflict, not a last-write-wins race —
        // otherwise reversing two lines flips the verdict. Sticky once set.
        preferences[key] =
          prior !== undefined && prior !== resolved ? "conflict" : resolved;
      } else if (
        key !== "__proto__" &&
        key !== "constructor" &&
        key !== "prototype"
      ) {
        extensions[key] = value;
      }
    }
  }

  const state: AiprefState = invalid
    ? "invalid"
    : statements.length
      ? "measured"
      : "unspecified";

  return { state, preferences, extensions };
}
