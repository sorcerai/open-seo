import { canonicalizeDemandUrl } from "../dedupe";
import {
  DemandPulseRepository,
  type DemandPulseProfile,
  type DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import { ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS } from "../canaries/onfarmcompost-official-sources";

/**
 * Deterministic, network-free source-discovery for the OnFarmCompost demand
 * pulse canary. Given the same inputs this module always proposes the same
 * candidate identities in the same order, and persists every one of them as a
 * pending + disabled source through {@link DemandPulseRepository.upsertPendingSource}.
 *
 * Nothing here auto-approves or enables a source, and nothing here performs a
 * network call. The repository's conflict semantics are what keep an existing
 * approved/rejected row from being reset when a candidate is rediscovered; this
 * service never supplies `approvalState` or `enabled` so it cannot override a
 * human review decision either.
 */

const OFFICIAL_PAGE_ADAPTER = "official-page-monitor";
const GSC_SITE_ADAPTER = "gsc-site";
const DATAFORSEO_DISCUSSIONS_ADAPTER = "dataforseo-discussions";
const MANUAL_FIRST_PARTY_ADAPTER = "manual-first-party";
const LOCAL_NEWS_ADAPTER = "local-news";

const OFFICIAL_SEED_PROVENANCE = "canary:onfarmcompost:official-seed";
const GSC_SITE_PROVENANCE = "canary:onfarmcompost:gsc-site";
const DATAFORSEO_PROVENANCE = "canary:onfarmcompost:dataforseo-discussions";
const MANUAL_FIRST_PARTY_PROVENANCE = "canary:onfarmcompost:manual-first-party";
const LOCAL_NEWS_PROVENANCE = "canary:onfarmcompost:local-news";

/** Freshly discovered candidates have not been policy-evaluated yet. */
const DISCOVERED_POLICY_STATE = "unknown";

/**
 * Pinned OnFarmCompost canary policy contract. A profile must match ALL of
 * these before discovery seeds or upserts a single source — discovery fails
 * closed against any other project, even one with a valid demand-pulse profile.
 * Mirror of docs/demand-pulse/canaries/onfarmcompost.bridge.json.
 */
const ONFARMCOMPOST_CANARY_POLICY_REPOSITORY = "sorcerai/onfarmcompost";
const ONFARMCOMPOST_CANARY_POLICY_COMMIT =
  "4d436f12ab2853410e1f4930f4cb0ee3b82cad93";
const ONFARMCOMPOST_CANARY_POLICY_PATH = "docs/CONTENT_INTELLIGENCE_OS.md";

export type OnFarmCompostSourceClass = DemandPulseSource["sourceClass"];

/** Typed inputs for OnFarmCompost source discovery. `projectId` is required. */
export interface OnFarmCompostSourceDiscoveryInput {
  /** Project UUID; resolves the demand-pulse profile. Required. */
  projectId: string;
  /** Project domain (e.g. onfarmcompost.com). Drives adapter-level candidates. */
  domain?: string;
  /** Market/problem-family query seeds. Validated only; never fetched. */
  querySeeds?: string[];
  /** Operator-declared official URLs; must reconcile with the canary seed set. */
  knownOfficialUrls?: string[];
  /** Optional Google Search Console site URL (sc-domain: or https:// form). */
  gscSiteUrl?: string;
}

/** A deterministic source candidate, before profile scoping and persistence. */
export interface DiscoveredSourceCandidate {
  readonly adapter: string;
  readonly identityKey: string;
  readonly sourceClass: OnFarmCompostSourceClass;
  readonly canonicalUrl: string | null;
  readonly recordKey: string;
  readonly policyState: string;
  readonly discoveryProvenance: string;
}

export interface OnFarmCompostSourceDiscoveryResult {
  readonly projectId: string;
  readonly profileId: string;
  readonly candidateCount: number;
  readonly candidates: readonly DiscoveredSourceCandidate[];
  readonly sources: readonly DemandPulseSource[];
}

export interface ReviewSourceProposalInput {
  projectId: string;
  sourceId: string;
  expectedVersion: number;
  approvalState: "approved" | "rejected";
  reviewedBy: string;
  reviewedAt?: string;
}

function requireNonEmpty(
  value: string | undefined | null,
  label: string,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

/**
 * A single DNS label: 1-63 chars, alphanumeric and hyphens, not starting or
 * ending with a hyphen.
 */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Strict hostname check. The WHATWG URL parser is lenient about hostspaces in
 * some runtimes (it percent-encodes them instead of rejecting), so discovery
 * validates the host explicitly: no whitespace (raw or percent-encoded), valid
 * DNS labels, at least one dot, total length within the DNS limit.
 */
function isValidDomainHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (/\s/.test(host) || /%[0-9a-f]{2}/i.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!DNS_LABEL.test(label)) return false;
  }
  return true;
}

/**
 * Normalize a project domain supplied as a bare domain, a host with scheme, or
 * a full URL, to a stable registrable host. Strips an optional scheme and any
 * path/query/hash, drops a leading `www.`, and rejects anything that is not a
 * strict DNS hostname — so malformed input fails instead of silently producing
 * a candidate with a percent-encoded garbage host.
 */
function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("domain is required when provided");
  }
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const authority = withoutScheme.split(/[/?#]/, 1)[0];
  const host = authority.replace(/\.$/, "").replace(/^www\./, "");
  if (!isValidDomainHost(host)) {
    throw new Error(`Invalid domain: ${value}`);
  }
  return host;
}

/**
 * Normalize a GSC site property to a stable, full-property identity. Only the
 * two real GSC property forms are accepted — `sc-domain:<host>` and an
 * `http(s)://` URL-prefix — and each keeps its own identity: an sc-domain
 * property never collapses into an HTTPS URL-prefix (or vice versa) because
 * they are distinct GSC resources. Other schemes (bare host, ftp:, ...) are
 * rejected. When `expectedDomain` is supplied the property host must belong to
 * that project domain (www is treated as equivalent).
 */
function normalizeGscSiteUrl(
  value: string,
  expectedDomain?: string,
): { identity: string; canonicalUrl: string | null } {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("gscSiteUrl is required when provided");
  }

  let identity: string;
  let canonicalUrl: string | null;
  let host: string;

  if (/^sc-domain:/i.test(trimmed)) {
    const rawHost = trimmed.slice("sc-domain:".length).trim().toLowerCase();
    if (!isValidDomainHost(rawHost)) {
      throw new Error(`Invalid GSC sc-domain host: ${value}`);
    }
    host = rawHost;
    identity = `sc-domain:${host}`;
    canonicalUrl = null;
  } else if (/^https?:\/\//i.test(trimmed)) {
    canonicalUrl = canonicalizeDemandUrl(trimmed);
    let parsed: URL;
    try {
      parsed = new URL(canonicalUrl);
    } catch {
      throw new Error(`Invalid GSC url-prefix: ${value}`);
    }
    host = parsed.hostname.toLowerCase();
    if (!isValidDomainHost(host)) {
      throw new Error(`Invalid GSC url-prefix host: ${value}`);
    }
    identity = canonicalUrl;
  } else {
    throw new Error(
      `Unsupported GSC site url scheme (use sc-domain: or https://): ${value}`,
    );
  }

  if (expectedDomain) {
    const registrable = host.replace(/^www\./, "");
    if (registrable !== expectedDomain) {
      throw new Error(
        `gscSiteUrl host ${host} does not match configured domain ${expectedDomain}`,
      );
    }
  }

  return { identity, canonicalUrl };
}

/**
 * Pure, deterministic candidate builder. No I/O, no network. Throws on any
 * invalid or out-of-scope input so malformed discovery never silently produces
 * a positive (empty or partial) result.
 */
export function buildOnFarmCompostSourceCandidates(
  input: OnFarmCompostSourceDiscoveryInput,
): DiscoveredSourceCandidate[] {
  const candidates: DiscoveredSourceCandidate[] = [];

  // 1. The closed set of OnFarmCompost official authoritative sources (PR #5).
  const officialSeedUrls = new Map<string, string>();
  for (const seed of ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS) {
    const canonicalUrl = canonicalizeDemandUrl(seed.url);
    officialSeedUrls.set(canonicalUrl, seed.id);
    candidates.push({
      adapter: OFFICIAL_PAGE_ADAPTER,
      identityKey: `official-page:${seed.id}`,
      sourceClass: "primary_authoritative",
      canonicalUrl,
      recordKey: seed.id,
      policyState: DISCOVERED_POLICY_STATE,
      discoveryProvenance: OFFICIAL_SEED_PROVENANCE,
    });
  }

  // 2. knownOfficialUrls must equal the registered official surface exactly —
  //    bidirectionally. No duplicates, no missing, no extra entries. The
  //    operator's declaration cannot expand or shrink the closed seed set.
  if (input.knownOfficialUrls) {
    const provided = input.knownOfficialUrls.map((raw) =>
      canonicalizeDemandUrl(requireNonEmpty(raw, "knownOfficialUrls entry")),
    );
    const seenProvided = new Set<string>();
    for (const canonical of provided) {
      if (seenProvided.has(canonical)) {
        throw new Error(`Duplicate knownOfficialUrls entry: ${canonical}`);
      }
      seenProvided.add(canonical);
    }
    for (const canonical of provided) {
      if (!officialSeedUrls.has(canonical)) {
        throw new Error(
          `knownOfficialUrls entry is not a registered OnFarmCompost official source: ${canonical}`,
        );
      }
    }
    if (provided.length !== officialSeedUrls.size) {
      throw new Error(
        `knownOfficialUrls must list all ${officialSeedUrls.size} registered official sources`,
      );
    }
  }

  // 3. querySeeds are validated but never fetched; each must be non-empty.
  if (input.querySeeds) {
    for (const raw of input.querySeeds) {
      requireNonEmpty(raw, "querySeeds entry");
    }
  }

  // Normalize the project domain once; it feeds both the GSC domain-mismatch
  // check and the domain-derived candidate identities.
  const normalizedDomain =
    input.domain !== undefined ? normalizeDomain(input.domain) : undefined;

  // 4. Optional GSC site property candidate. The full property is preserved as
  //    the deterministic identity/recordKey, and (when a domain is configured)
  //    the property host must belong to that domain.
  if (input.gscSiteUrl !== undefined) {
    const { identity, canonicalUrl } = normalizeGscSiteUrl(
      input.gscSiteUrl,
      normalizedDomain,
    );
    candidates.push({
      adapter: GSC_SITE_ADAPTER,
      identityKey: `gsc-site:${identity}`,
      sourceClass: "search_observed",
      canonicalUrl,
      recordKey: identity,
      policyState: DISCOVERED_POLICY_STATE,
      discoveryProvenance: GSC_SITE_PROVENANCE,
    });
  }

  // 5. Domain-derived adapter-level candidate identities.
  if (normalizedDomain !== undefined) {
    candidates.push(
      {
        adapter: DATAFORSEO_DISCUSSIONS_ADAPTER,
        identityKey: `dataforseo-discussions:${normalizedDomain}`,
        sourceClass: "search_observed",
        canonicalUrl: null,
        recordKey: normalizedDomain,
        policyState: DISCOVERED_POLICY_STATE,
        discoveryProvenance: DATAFORSEO_PROVENANCE,
      },
      {
        adapter: MANUAL_FIRST_PARTY_ADAPTER,
        identityKey: `manual-first-party:${normalizedDomain}`,
        sourceClass: "first_party_observed",
        canonicalUrl: null,
        recordKey: normalizedDomain,
        policyState: DISCOVERED_POLICY_STATE,
        discoveryProvenance: MANUAL_FIRST_PARTY_PROVENANCE,
      },
      {
        adapter: LOCAL_NEWS_ADAPTER,
        identityKey: `local-news:${normalizedDomain}`,
        sourceClass: "community_observed",
        canonicalUrl: null,
        recordKey: normalizedDomain,
        policyState: DISCOVERED_POLICY_STATE,
        discoveryProvenance: LOCAL_NEWS_PROVENANCE,
      },
    );
  }

  // Safety net: deterministic identities must never collide within an adapter.
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.adapter}:${candidate.identityKey}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate source candidate identity: ${key}`);
    }
    seen.add(key);
  }

  return candidates;
}

/**
 * Fail closed unless `profile` is exactly the registered OnFarmCompost canary:
 * the pinned policy contract (repository / commit / path) plus the safe-mode
 * flags (enabled, dry-run, publication-disabled). Any mismatch throws.
 */
function assertOnFarmCompostCanaryProfile(profile: DemandPulseProfile): void {
  const mismatched: string[] = [];
  if (profile.policyRepository !== ONFARMCOMPOST_CANARY_POLICY_REPOSITORY) {
    mismatched.push("policyRepository");
  }
  if (profile.policyCommit !== ONFARMCOMPOST_CANARY_POLICY_COMMIT) {
    mismatched.push("policyCommit");
  }
  if (profile.policyPath !== ONFARMCOMPOST_CANARY_POLICY_PATH) {
    mismatched.push("policyPath");
  }
  if (!profile.enabled) mismatched.push("enabled");
  if (!profile.dryRun) mismatched.push("dryRun");
  if (!profile.publicationDisabled) mismatched.push("publicationDisabled");
  if (mismatched.length > 0) {
    throw new Error(
      `Profile ${profile.id} is not the registered OnFarmCompost canary (mismatched: ${mismatched.join(", ")})`,
    );
  }
}

/**
 * Resolve the OnFarmCompost demand-pulse profile for `projectId` and persist
 * every deterministic candidate as a pending + disabled source. Project UUID
 * is required and must map to a registered profile; otherwise this throws and
 * persists nothing.
 */
export async function discoverOnFarmCompostSources(
  input: OnFarmCompostSourceDiscoveryInput,
): Promise<OnFarmCompostSourceDiscoveryResult> {
  const projectId = requireNonEmpty(input.projectId, "projectId");

  const profile = await DemandPulseRepository.getProfileByProjectId(projectId);
  if (!profile) {
    throw new Error(
      `No demand pulse profile is registered for project ${projectId}`,
    );
  }

  assertOnFarmCompostCanaryProfile(profile);

  const candidates = buildOnFarmCompostSourceCandidates(input);
  const sources: DemandPulseSource[] = [];
  for (const candidate of candidates) {
    const source = await DemandPulseRepository.upsertPendingSource({
      profileId: profile.id,
      adapter: candidate.adapter,
      identityKey: candidate.identityKey,
      sourceClass: candidate.sourceClass,
      canonicalUrl: candidate.canonicalUrl,
      recordKey: candidate.recordKey,
      discoveryProvenance: candidate.discoveryProvenance,
    });
    sources.push(source);
  }

  return {
    projectId,
    profileId: profile.id,
    candidateCount: candidates.length,
    candidates,
    sources,
  };
}

/** List source proposals for a project, scoped through its profile. */
export async function listSourceProposals(
  projectId: string,
): Promise<DemandPulseSource[]> {
  const scoped = requireNonEmpty(projectId, "projectId");
  return DemandPulseRepository.listSourcesByProject(scoped);
}

/**
 * Apply a human review decision to a single source proposal. Delegates the
 * project-scoped optimistic-concurrency check to the repository, which returns
 * null if the project/scope or expected version no longer matches.
 */
export async function reviewSourceProposal(
  input: ReviewSourceProposalInput,
): Promise<DemandPulseSource | null> {
  const projectId = requireNonEmpty(input.projectId, "projectId");
  const sourceId = requireNonEmpty(input.sourceId, "sourceId");
  const reviewedBy = requireNonEmpty(input.reviewedBy, "reviewedBy");

  if (
    input.approvalState !== "approved" &&
    input.approvalState !== "rejected"
  ) {
    throw new Error(
      `approvalState must be "approved" or "rejected": ${String(input.approvalState)}`,
    );
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error(
      `expectedVersion must be a positive integer: ${String(input.expectedVersion)}`,
    );
  }

  const reviewedAt =
    input.reviewedAt && input.reviewedAt.trim().length > 0
      ? input.reviewedAt
      : new Date().toISOString();
  if (Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error(`reviewedAt is not a parseable timestamp: ${reviewedAt}`);
  }

  return DemandPulseRepository.reviewSource({
    sourceId,
    projectId,
    expectedVersion: input.expectedVersion,
    approvalState: input.approvalState,
    reviewedBy,
    reviewedAt,
  });
}
