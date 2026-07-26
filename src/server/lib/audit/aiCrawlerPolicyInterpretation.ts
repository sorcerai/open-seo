/**
 * AI crawler policy interpretation — purpose-aware synthesis over the three
 * robots.txt-layer parsers in `aiCrawlerPolicy.ts`.
 *
 * Composes robots acquisition + Content-Signal + AIPREF into per-purpose
 * state plus top-level `citationBlocked` / `trainingBlocked` / `degraded`
 * flags and provenance. This is the evidence layer consumed by the findings
 * generator (`aiCrawlerPolicyFindings.ts`) and, eventually, the site-audit
 * UI.
 */

import {
  AI_BOT_TAXONOMY,
  CONTENT_SIGNAL_KEYS,
  POLICY_SOURCES,
  parseAipref,
  parseContentSignals,
  parseRobotsForAiBots,
  type AiprefResult,
  type BotAcquisitionStatus,
  type BotPurpose,
  type ContentSignalsResult,
  type SignalState,
} from "./aiCrawlerPolicy";

type PurposeState =
  | "unavailable"
  | "blocked"
  | "mixed"
  | "allowed_or_unspecified";

export interface PurposeInterpretation {
  state: PurposeState;
  bots?: Record<string, BotAcquisitionStatus>;
  blocked: boolean;
  impact: string;
  /** search only. */
  citationBlocked?: boolean;
  /** training only. */
  trainingBlocked?: boolean;
  /** search + training: derived Content-Signal state. */
  signalState?: SignalState;
  /** search + training: derived AIPREF state. */
  aiprefState?: "allowed" | "blocked" | "unknown" | "unavailable";
  /** training only: the Google-Extended ≠ AI Overviews caveat. */
  googleExtendedCaveat?: string;
}

export interface AiInputInterpretation {
  state: SignalState;
  impact: string;
}

export interface AiCrawlerPolicy {
  purposeStatus: Record<BotPurpose, Record<string, BotAcquisitionStatus>>;
  contentSignals: ContentSignalsResult;
  aipref: AiprefResult;
  interpretation: Record<BotPurpose, PurposeInterpretation> & {
    "ai-input"?: AiInputInterpretation;
  };
  citationBlocked: boolean;
  trainingBlocked: boolean;
  degraded: boolean;
  provenance: {
    source: string;
    parser: string;
    state: "measured" | "degraded" | "unavailable";
    /** True when the input exceeded MAX_ROBOTS_TXT_CHARS and was truncated.
     *  Always present so consumers can distinguish a complete read from a
     *  capped one — silent truncation would misclassify without evidence. */
    truncated: boolean;
    sources: Readonly<Record<string, string>>;
  };
}

const PURPOSE_IMPACT: Record<BotPurpose, string> = {
  search:
    "Search bot access controls citation visibility; it does not decide model training or content licensing.",
  training:
    "Training bot access is an IP/training-use choice; blocking it does not by itself remove search citations.",
  user: "User-initiated fetch access is separate from automatic search indexing and may be governed differently by each vendor.",
  ads: "Ads bot access supports ad landing-page safety and relevance checks; it is not a training permission.",
};

const AI_INPUT_IMPACT =
  "ai-input governs retrieval/grounding use in generated answers; a no signal can reduce citation eligibility without blocking ordinary search indexing.";

const GOOGLE_EXTENDED_CAVEAT =
  "Google-Extended controls eligible generative-AI training use; it does not control Google AI Overviews.";

/** RFC 9309 §2.5 recommends parsers enforce a size limit (≥500 KiB) for
 *  system protection. This is defense-in-depth: the fetch layer (Phase C)
 *  must enforce the real byte limit on the HTTP response. Truncation is
 *  surfaced as `provenance.truncated` and forces `degraded` so it is never
 *  silent. */
const MAX_ROBOTS_TXT_BYTES = 500 * 1024;

/** Truncate text to fit within a UTF-8 byte budget. Scans code points
 *  (handling surrogate pairs) without allocating a full byte buffer, and
 *  early-terminates at the limit. After capping, drops the final partial
 *  line — a mid-line cutoff can synthesize a fake root rule (e.g.
 *  "Disallow: /private" → "Disallow: /"). */
function truncateToUtf8ByteLimit(
  text: string,
  byteLimit: number,
): { text: string; truncated: boolean } {
  let byteLen = 0;
  for (let i = 0; i < text.length; i++) {
    // Capture the start index before any surrogate-pair increment so the
    // overflow slice excludes the full pair (not just the high half).
    const charStart = i;
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLen += 4;
        i++;
      } else {
        byteLen += 3;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      byteLen += 3;
    } else {
      byteLen += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    if (byteLen > byteLimit) {
      const slice = text.slice(0, charStart);
      const lastBoundary = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf("\r"),
      );
      return {
        text: lastBoundary > 0 ? slice.slice(0, lastBoundary) : "",
        truncated: true,
      };
    }
  }
  return { text, truncated: false };
}

function purposeState(
  statuses: Record<string, BotAcquisitionStatus>,
): PurposeState {
  const values = Object.values(statuses);
  // every() on an empty array returns true → empty also resolves to unavailable.
  if (values.every((s) => s === "no_robots_txt")) return "unavailable";
  const blockedCount = values.filter((s) => s.includes("blocked")).length;
  if (blockedCount === values.length) return "blocked";
  if (blockedCount > 0) return "mixed";
  return "allowed_or_unspecified";
}

function aiprefToState(
  value: "allowed" | "disallowed" | "unknown" | "conflict" | undefined,
): "allowed" | "blocked" | "unknown" {
  if (value === "allowed") return "allowed";
  if (value === "disallowed") return "blocked";
  // "conflict" included: contradictory directives mean we cannot tell, which is
  // not the same as permission. Never resolve an unknown into "allowed".
  return "unknown";
}

/** Derive the per-purpose AIPREF state, preserving "unavailable" when the
 *  AIPREF layer itself was unavailable (missing robots.txt). */
function deriveAiprefState(
  aipref: AiprefResult,
  key: "search" | "train-ai",
): "allowed" | "blocked" | "unknown" | "unavailable" {
  if (aipref.state === "unavailable") return "unavailable";
  return aiprefToState(aipref.preferences[key]);
}

function buildPurposeStatus(
  botStatus: Record<string, BotAcquisitionStatus>,
): Record<BotPurpose, Record<string, BotAcquisitionStatus>> {
  const out: Record<BotPurpose, Record<string, BotAcquisitionStatus>> = {
    search: {},
    training: {},
    user: {},
    ads: {},
  };
  for (const [bot, status] of Object.entries(botStatus)) {
    const entry = AI_BOT_TAXONOMY[bot];
    if (!entry) continue;
    out[entry.purpose][bot] = status;
  }
  return out;
}

function buildPurposeEntry(
  purpose: BotPurpose,
  statuses: Record<string, BotAcquisitionStatus>,
  contentSignals: ContentSignalsResult,
  aipref: AiprefResult,
): PurposeInterpretation {
  const blocked = Object.values(statuses).some((s) => s.includes("blocked"));
  const entry: PurposeInterpretation = {
    state: purposeState(statuses),
    bots: statuses,
    blocked,
    impact: PURPOSE_IMPACT[purpose],
  };
  if (purpose === "search") {
    entry.citationBlocked = blocked;
    entry.signalState = contentSignals.search.state;
    entry.aiprefState = deriveAiprefState(aipref, "search");
  } else if (purpose === "training") {
    entry.trainingBlocked = blocked;
    entry.signalState = contentSignals["ai-train"].state;
    entry.aiprefState = deriveAiprefState(aipref, "train-ai");
    entry.googleExtendedCaveat = GOOGLE_EXTENDED_CAVEAT;
  }
  return entry;
}

/**
 * Build the full purpose-aware policy interpretation from robots.txt text.
 *
 * Composes the three parsers (robots acquisition, Content-Signal, AIPREF) and
 * synthesizes per-purpose state plus top-level `citationBlocked` /
 * `trainingBlocked` / `degraded` flags. Pass `null` to express a missing or
 * unreachable robots.txt — every layer degrades to `unavailable`.
 */
export function interpretAiCrawlerPolicy(
  robotsText: string | null,
): AiCrawlerPolicy {
  if (robotsText === null) {
    // Fresh objects per invocation — the exported interfaces are mutable, so
    // sharing singletons would let one consumer corrupt another audit's
    // unavailable policy.
    const unavailableSignals: ContentSignalsResult = {
      search: { state: "unavailable", values: [] },
      "ai-input": { state: "unavailable", values: [] },
      "ai-train": { state: "unavailable", values: [] },
    };
    const unavailableAipref: AiprefResult = {
      state: "unavailable",
      preferences: {},
      extensions: {},
    };
    return {
      purposeStatus: { search: {}, training: {}, user: {}, ads: {} },
      contentSignals: unavailableSignals,
      aipref: unavailableAipref,
      interpretation: {
        search: buildPurposeEntry(
          "search",
          {},
          unavailableSignals,
          unavailableAipref,
        ),
        training: buildPurposeEntry(
          "training",
          {},
          unavailableSignals,
          unavailableAipref,
        ),
        user: buildPurposeEntry(
          "user",
          {},
          unavailableSignals,
          unavailableAipref,
        ),
        ads: buildPurposeEntry(
          "ads",
          {},
          unavailableSignals,
          unavailableAipref,
        ),
        "ai-input": { state: "unavailable", impact: AI_INPUT_IMPACT },
      },
      citationBlocked: false,
      trainingBlocked: false,
      degraded: false,
      provenance: {
        source: "robots.txt",
        parser: "interpretAiCrawlerPolicy",
        state: "unavailable",
        truncated: false,
        sources: POLICY_SOURCES,
      },
    };
  }

  const { text, truncated } = truncateToUtf8ByteLimit(
    robotsText,
    MAX_ROBOTS_TXT_BYTES,
  );
  const botStatus = parseRobotsForAiBots(text);
  const purposeStatus = buildPurposeStatus(botStatus);
  const contentSignals = parseContentSignals(text);
  const aipref = parseAipref(text);

  const interpretation: AiCrawlerPolicy["interpretation"] = {
    search: buildPurposeEntry(
      "search",
      purposeStatus.search,
      contentSignals,
      aipref,
    ),
    training: buildPurposeEntry(
      "training",
      purposeStatus.training,
      contentSignals,
      aipref,
    ),
    user: buildPurposeEntry("user", purposeStatus.user, contentSignals, aipref),
    ads: buildPurposeEntry("ads", purposeStatus.ads, contentSignals, aipref),
    "ai-input": {
      state: contentSignals["ai-input"].state,
      impact: AI_INPUT_IMPACT,
    },
  };

  const degraded =
    truncated ||
    CONTENT_SIGNAL_KEYS.some((k) => {
      const s = contentSignals[k].state;
      return s === "conflict" || s === "invalid";
    }) ||
    aipref.state === "invalid";

  return {
    purposeStatus,
    contentSignals,
    aipref,
    interpretation,
    citationBlocked: interpretation.search.blocked,
    trainingBlocked: interpretation.training.blocked,
    degraded,
    provenance: {
      source: "robots.txt",
      parser: "interpretAiCrawlerPolicy",
      state: degraded ? "degraded" : "measured",
      truncated,
      sources: POLICY_SOURCES,
    },
  };
}
