# PRD — OpenSEO Demand Pulse & Evidence Graph v1

**Status:** implementation-ready design, Phase 0 contracts packaged
**Date:** 2026-07-25
**Owners:** OpenSEO for collection/product surface; Constellation for evidence promotion and outcome measurement
**Default rollout:** disabled, dry-run, one canary project
**Working product name:** OpenSEO Demand Pulse

---

## 1. Executive decision

Build a demand-intelligence system, not a Reddit trend widget.

OpenSEO Demand Pulse will detect emerging customer problems, questions, objections,
comparison decisions, failures, and market events across first-party, search,
community, review, issue-tracker, social, and AI-answer surfaces. It will preserve
source provenance, normalize engagement against each community's baseline, cluster
observations into durable prompt/problem families, corroborate them across evidence
classes, compare them with existing site coverage, and recommend the correct action.

The action is **not automatically “publish a new article.”** The system may recommend
updating an existing page, adding an FAQ, creating a comparison, building a tool,
changing an offer, fixing support documentation, preparing sales enablement, monitoring,
or rejecting the signal.

The system boundary is deliberate:

- **OpenSEO owns:** source connections, ingestion, scheduling, raw/normalized evidence,
  D1/R2 storage, source health, cost controls, UI, and MCP access.
- **Constellation owns:** Prompt Demand Graph promotion, evidence quality, semantic
  clustering evaluation, site/page coverage, search and AI corroboration, action
  prioritization, citation/retrieval measurement, and business outcome tracking.

This avoids turning Constellation into a crawler zoo and prevents OpenSEO from
pretending a pile of comments is already a strategic decision.

---

## 2. Problem

Traditional keyword and SERP research is useful but lagging:

- Search-volume products aggregate historical behavior.
- Mature keyword databases reward already-established phrasing.
- New objections, failures, terminology, and decision criteria can appear in customer
  conversations before they become measurable keyword rows.
- Generated keyword expansion often creates plausible but ungrounded targets.
- Raw social engagement rewards entertainment, outrage, and audience size, not
  necessarily buyer intent.
- Content teams commonly convert every interesting question into another URL, creating
  cannibalization, thin coverage, and maintenance debt.

OpenSEO needs an observed-demand layer that answers:

1. What are real people newly asking, struggling with, comparing, or rejecting?
2. Is the signal repeated, independent, commercially relevant, and credible?
3. Is it new, seasonal, persistent, event-driven, or decaying?
4. Does the site already answer it adequately?
5. Which business action has the highest expected return?
6. Did the resulting action improve visibility, citations, traffic, leads, or revenue?

---

## 3. Product thesis

The moat is not collection. Collection can be copied. The moat is the evidence chain:

```text
raw conversation or first-party event
→ normalized observation
→ duplicate/cross-post resolution
→ prompt/problem family
→ evidence-class corroboration
→ temporal regime detection
→ page/product/support coverage
→ recommended action
→ implementation
→ search + AI + commercial outcome
```

Sonic-style systems appear to stop near “popular discussion → content idea.” Demand
Pulse continues through provenance, validation, action selection, and measurement.

---

## 4. Goals

### 4.1 Primary goals

- Detect demand shifts before conventional keyword datasets fully reflect them.
- Capture exact customer vocabulary without mistaking jargon for consumer language.
- Maintain explicit evidence classes and source provenance.
- Separate raw engagement from normalized demand evidence.
- Cluster many observations into one durable prompt/problem family.
- Recommend the right business action, not merely a new page.
- Integrate promoted families into Constellation's Prompt Demand Graph.
- Measure outcomes over time using versioned prompt sets and scoring versions.
- Remain safe to deploy on the current Cloudflare OpenSEO stack.

### 4.2 Secondary goals

- Give agents read-only MCP access to live demand intelligence.
- Create reusable source adapters with clear capability and retention contracts.
- Support multilingual/local-market demand without collapsing translations blindly.
- Discover new source domains instead of relying on a fixed list of popular platforms.
- Allow first-party imports before every external source integration is complete.

### 4.3 Non-goals for v1

- Universal social-media surveillance.
- Circumventing authentication, robots controls, rate limits, or platform restrictions.
- Indefinite warehousing of public user content.
- Training foundation models on collected community content.
- Auto-publishing pages.
- Treating search volume, upvotes, comments, or LLM judgment as ground truth alone.
- Replacing keyword research, GSC, or Constellation visibility measurement.
- Building a generalized social-listening SaaS before internal signal quality is proven.

---

## 5. Users and jobs

| User                 | Job                                         | Success condition                                                 |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Site operator        | Find emerging demand worth acting on        | Top recommendations are useful, not merely interesting            |
| SEO strategist       | Merge live language with search opportunity | Each promoted family has provenance, intent, coverage, and action |
| Content operator     | Know whether to update or create            | Existing-page update wins are surfaced before new URLs            |
| Product/support lead | Detect failures and objections              | Non-content actions appear alongside content actions              |
| Sales lead           | Capture repeated objections/comparisons     | Evidence can become enablement and offer changes                  |
| AI agent             | Retrieve demand evidence safely             | MCP returns structured, source-labeled, bounded results           |
| Constellation        | Receive promoted prompt families            | Stable IDs, versions, provenance, and measurement hooks exist     |

---

## 6. Product principles

1. **Observed before generated.** Generated variants are candidates only.
2. **Keep the vector.** Never store only one headline score.
3. **Independent evidence matters.** Cross-posts are not three independent votes.
4. **Normalize by source.** Ten comments in a tiny specialist forum may matter more than
   2,000 reactions in a giant entertainment community.
5. **One family, many expressions.** The unit is a problem/decision family, not a thread.
6. **Existing pages first.** Prefer improving a strong canonical page when appropriate.
7. **Actions exceed content.** Product, support, offer, sales, and monitoring are valid.
8. **Time is multidimensional.** Use 7/30/90/365-day windows and seasonal baselines.
9. **Provenance survives every transform.** A recommendation must trace back to evidence.
10. **Compliance is architecture.** Retention, deletion, licensing, and source terms are
    fields and workflows, not a paragraph nobody reads after launch.
11. **Feature flags by default.** Production earns exposure through evidence.
12. **Measure outcomes.** Shipping a page is an event, not success.

---

## 7. Evidence taxonomy

Evidence classes must remain distinct in storage, scoring, UI, MCP, and exports.

### 7.1 First-party observed

Highest-value language because it comes from actual prospects, customers, users, or
site behavior.

Examples:

- Google Search Console queries and landing-page impressions.
- Internal site search.
- Support tickets, chat, helpdesk, and escalation reasons.
- CRM notes, sales objections, lost-deal reasons, call transcripts.
- Form submissions and free-text survey/NPS responses.
- Email/newsletter replies.
- Product-search logs and feature-request systems.
- Customer Discord, Slack, or community spaces connected with permission.
- Reviews of the user's own business or products.

### 7.2 Search observed

Evidence that search systems expose or aggregate.

- Autocomplete/Suggest.
- People Also Ask and related searches.
- Google Trends or DataForSEO Trends.
- SERP `discussions_and_forums` elements.
- Search volume, CPC, difficulty, and SERP composition.
- GSC impressions, clicks, position, and query/page relationships.

### 7.3 Community observed

Public or permissioned conversations, questions, reviews, and issue discussions.

- Reddit, only through an approved and compliance-gated adapter.
- Discourse and specialist forums.
- Stack Exchange sites.
- Hacker News.
- GitHub Issues and Discussions.
- YouTube comments.
- Bluesky and Mastodon.
- Product Hunt comments.
- App-store reviews.
- Google, Trustpilot, Tripadvisor, and other reviews through approved providers.
- Public Q&A and niche professional communities.

### 7.4 Market-event observed

Events that can create new demand even before discussion volume grows.

- Product releases, changelogs, deprecations, outages, and incident reports.
- Security advisories, recalls, and safety notices.
- Laws, regulations, standards, and enforcement guidance.
- Competitor pricing/offer changes.
- Industry news, RSS feeds, and official announcements.
- Issue trackers showing sudden failure patterns.

### 7.5 AI-surface observed

- DataForSEO LLM mentions, prompt/fan-out datasets, and source observations.
- Repeated answers and citations from ChatGPT, Google AI, Gemini, Claude, Perplexity,
  and other tracked engines.
- Citation fidelity, attribution, stability, and source prominence.
- AI-referral landing paths and server logs where available.

### 7.6 Generated candidates

- LLM fan-outs and rewrites.
- Reverse prompting from pages or competitors.
- Synthetic personas and journey expansions.

Generated candidates may improve recall but **cannot promote themselves**. They require
observed corroboration.

---

## 8. Source strategy and rollout matrix

| Source                         | Signal                                     | Access pattern                   | Phase               | Main constraints                                   |
| ------------------------------ | ------------------------------------------ | -------------------------------- | ------------------- | -------------------------------------------------- |
| GSC                            | first-party search language                | existing OpenSEO integration     | 0                   | sampling, privacy, lag                             |
| Manual CSV/JSON                | support, sales, site search, calls         | upload/import                    | 0                   | schema quality, PII redaction                      |
| DataForSEO discussions/forums  | source-domain discovery + live threads     | existing DataForSEO SERP layer   | 0                   | cost, SERP coverage, query selection               |
| Hacker News                    | technology/business questions and launches | public Firebase API              | 0                   | audience bias, no universal market coverage        |
| DataForSEO Trends              | temporal corroboration                     | existing vendor                  | 1                   | relative values, query ambiguity                   |
| DataForSEO reviews             | product/local pain and praise              | existing vendor                  | 1                   | source coverage, licensing/retention               |
| Discourse                      | specialist forum topics/posts              | per-instance API/OpenAPI         | 1                   | capabilities and auth vary by site                 |
| Stack Exchange                 | expert questions and recurring problems    | official API                     | 1                   | quota, backoff, limited broad search               |
| GitHub Issues                  | software failures and feature requests     | REST API                         | 1                   | PRs mixed into issue listing; repo bias            |
| GitHub Discussions             | product/community decisions                | GraphQL API                      | 1                   | permissions, pagination, repository scope          |
| YouTube comments               | authentic objections, how-to failures      | official Data API                | 1                   | quota, moderation/deleted comments                 |
| Reddit                         | broad consumer/problem language            | approved Data API                | 2                   | commercial approval, deletion, retention, terms    |
| Bluesky                        | emerging public discourse                  | public API/firehose              | 2                   | firehose volume, moderation labels, deletion       |
| Mastodon                       | niche/federated communities                | per-instance APIs                | 2                   | no global recall, instance auth/search differences |
| Product Hunt                   | launch reactions                           | official/approved access         | 2                   | launch-heavy bias                                  |
| App stores                     | product failure/review language            | approved APIs/providers          | 2                   | store terms, review manipulation                   |
| RSS/changelogs/advisories      | event-driven demand                        | feeds and official pages         | 2                   | entity matching, false event relevance             |
| Owned Discord/Slack            | customer language                          | permissioned bot/export          | 2                   | privacy, consent, workspace policies               |
| TikTok/Instagram/Threads/X     | trend/comment language                     | official or licensed access only | later               | cost, restrictive APIs, high manipulation risk     |
| Facebook Groups/LinkedIn/Quora | potentially useful private/niche language  | no scraping in v1                | excluded by default | access, privacy, terms, brittleness                |

### 8.1 Why DataForSEO starts first

OpenSEO already owns DataForSEO authentication, billing, cache, and failure handling.
The Google SERP advanced result can expose `discussions_and_forums`, allowing Demand
Pulse to discover relevant forum domains and thread URLs without hardcoding every
community. This is both an ingestion source and an **unknown-source discovery engine**.

### 8.2 Why Reddit is not Phase 0

The user has an API key, which is useful, but a key is not the same as commercial and
retention clearance. The Reddit adapter remains disabled until its current terms,
commercial use, retention, deletion, and data-protection obligations are captured in a
source policy approved for this deployment. The code must support deletion propagation
and minimal storage before the adapter is enabled.

---

## 9. Unknown-source discovery

A fixed platform checklist guarantees blind spots. Demand Pulse therefore discovers
sources as a first-class workflow.

### 9.1 Source-domain emergence

For each seed family and market:

1. Run bounded SERP discovery for discussion/forum surfaces.
2. Extract domains, URLs, timestamps, and snippets.
3. Compare the domain with the project's known-source registry.
4. Track first seen, recurrence, query coverage, and source quality.
5. Suggest an adapter or crawl policy only after the domain repeatedly contributes.

### 9.2 Link-follow evidence graph

Threads often link to manuals, advisories, videos, studies, product pages, or other
threads. Store outbound links as evidence edges. Highly recurrent linked sources can
reveal authoritative documents and hidden communities.

### 9.3 Vocabulary drift detection

Track new n-grams, entities, model names, error codes, product versions, slang, and
question forms against the previous 90-day baseline. A low-volume term can be valuable
when it is new, repeated, and commercially close.

### 9.4 Negative-space detection

Flag families with repeated high-intent community or first-party evidence but weak or
zero conventional search volume. These are not automatically content targets; they are
candidates for support, sales, product, email, or “category creation” work.

### 9.5 Market-regime triggers

Detect launches, outages, policy changes, legal deadlines, recalls, seasonal events,
and pricing changes. Temporarily shorten collection windows and increase review cadence
when a trigger is active.

---

## 10. System architecture

```text
Source connections
  ├─ First-party imports / GSC
  ├─ DataForSEO search, forum, trends, reviews
  ├─ Public APIs (HN, Stack Exchange, GitHub, YouTube, Bluesky, Mastodon)
  ├─ Approved Reddit adapter
  └─ Event feeds / approved vendor connectors
          │
          ▼
OpenSEO source adapters
  - capability probe
  - auth and terms profile
  - cursor, backoff, cost budget
  - raw artifact pointer
          │
          ▼
Normalization pipeline
  - canonical URLs
  - timestamps/locales
  - minimal excerpts
  - author minimization
  - engagement snapshots
  - content/source hashes
          │
          ▼
Dedupe and cross-post resolver
  - exact duplicate collapse
  - syndicated/cross-post edges
  - independent-evidence preservation
          │
          ▼
Prompt/problem family clustering
  - semantic similarity
  - entity + decision overlap
  - multilingual sibling families
  - human split/merge audit log
          │
          ▼
Evidence and temporal scoring
  - 7/30/90/365 day vectors
  - source-normalized velocity
  - corroboration and persistence
  - spam/legal/cannibalization penalties
          │
          ├──────────────► OpenSEO UI + MCP
          │
          ▼
Constellation Prompt Demand Graph
  - page coverage
  - search/AI evidence
  - competitor/citation gaps
  - action recommendation
  - measurement contract
          │
          ▼
Outcome ledger
  - published/change event
  - GSC/search/AI visibility
  - lead/conversion/support/product outcomes
```

### 10.1 Cloudflare mapping

- **D1:** normalized records, families, evidence edges, scores, actions, source configs.
- **R2:** bounded raw artifacts and replay fixtures with lifecycle expiration.
- **KV:** short-lived capability/config cache only, not source of truth.
- **Durable Objects:** per-project/source locks, rate-budget state, idempotent cursors.
- **Workflows:** scheduled collection, retries, scoring, retention sweeps, deletion sync.
- **Worker/MCP:** authenticated UI/API and agent-facing structured tools.

---

## 11. Canonical domain model

### 11.1 Source connection

Captures:

- Project and platform.
- Source class.
- Authentication secret reference, never secret value.
- Capability snapshot.
- Terms/licensing profile and version/date reviewed.
- Retention profile.
- Rate/cost budget.
- Cursor and health state.
- Enabled/dry-run/compliance-approved flags.

### 11.2 Discovery run

Captures:

- Run ID, source, project, start/end.
- Window and seed set version.
- Cursor in/out.
- Requests, cost, rows found/accepted/rejected.
- Warnings/errors/retries.
- Code/config/scoring versions.
- Raw artifact pointers.

### 11.3 Observation

Minimum canonical fields:

- Project, source connection/class/platform/domain.
- External ID and canonical URL.
- Title and bounded excerpt.
- Published/updated/collected timestamps.
- Locale/geography.
- Raw engagement and normalized engagement snapshot.
- Content hash and canonical URL hash.
- Retention profile, expiry, deletion state.
- Structured extraction: question, problem, decision, entities, intent, funnel stage.
- Provenance to discovery run and raw artifact.
- No raw author identity unless explicitly justified and approved.

### 11.4 Prompt/problem family

- Stable family ID.
- Canonical question and problem statement.
- Decision being made.
- Entities and aliases.
- Locale and translation siblings.
- Lifecycle status and temporal regime.
- Member observations with relation type: independent, duplicate, cross-post, reply,
  translation, superseded.
- Evidence summaries by class and platform.
- Versioned score vectors.
- Page coverage and action recommendation.

### 11.5 Action and outcome

- Action type and target URL/product/support artifact.
- Owner, status, rationale, expected KPI.
- Evidence/scoring versions at decision time.
- Implementation event and deploy identifier.
- Outcome snapshots at 7/30/60/90 days.
- Learn/keep/revert decision.

---

## 12. Ingestion pipeline

### 12.1 Stage A — discover

- Use project seed families, entities, products, competitors, locations, and first-party
  language.
- Bound each source by request, cost, item, and time limits.
- Store the exact seed-set version.
- Support incremental cursors and deterministic replay.

### 12.2 Stage B — normalize

- Canonicalize URLs and remove known tracking parameters.
- Convert timestamps to UTC while preserving source timestamp when needed.
- Detect locale and geography without translating immediately.
- Strip unsafe HTML.
- Bound excerpts.
- Hash author identifiers if absolutely needed for repeat-author spam detection; default
  is no author persistence.
- Record source metadata separately from extracted meaning.

### 12.3 Stage C — reject obvious junk

Reject or quarantine:

- Missing identity/URL/timestamp.
- Exact duplicates.
- Deleted/dead records.
- Obvious ads, coupon spam, adult/off-topic content, and unsupported locale where the
  project has no market relevance.
- Source-policy violations.
- Items outside the configured window.

Do not reject simply because conventional search volume is zero.

### 12.4 Stage D — deduplicate without destroying corroboration

Relation types:

- `duplicate`: same external ID, canonical URL, or effectively identical content.
- `cross_post`: same story/question reproduced across platforms.
- `independent`: similar problem raised independently.
- `reply`: part of the same thread.
- `translation`: semantically equivalent across languages.
- `syndicated`: copied from a common original source.

Only true duplicates collapse. Cross-posts remain visible but count less than independent
sources.

### 12.5 Stage E — extract structure

For each observation:

- Core question.
- Problem and desired outcome.
- Decision/comparison being made.
- Product/service/entity/version/error code.
- Intent and funnel stage.
- Sentiment and urgency.
- Geography and audience.
- Candidate action types.

Use deterministic rules where possible and LLM extraction only with a versioned schema,
provider/model record, confidence, and fallback.

### 12.6 Stage F — cluster

Use a hybrid approach:

1. Lexical blocking by entities, nouns, and problem verbs.
2. Embedding nearest-neighbor candidate retrieval.
3. Reranking using question/problem/decision overlap.
4. Temporal and locale constraints.
5. Human split/merge support.

Do not cluster merely because two posts mention the same product. “How do I install X?”
and “Why did X catch fire?” are not one family, despite sharing a noun and humanity's
persistent ability to manufacture edge cases.

---

## 13. Demand signal vector

Every component is normalized to `[0, 1]` and stored with its derivation.

### 13.1 Positive dimensions

| Dimension                 | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| Cross-source diversity    | Independent source/platform/class support                   |
| Commercial proximity      | Distance to purchase, retention, lead, or costly problem    |
| First-party corroboration | Support/sales/GSC/customer evidence                         |
| Search corroboration      | Suggest/PAA/Trends/volume/SERP support                      |
| Normalized velocity       | Engagement or recurrence versus source baseline per time    |
| Recurrence                | Repeated independent observations                           |
| Coverage gap              | Current site/product/support answer is absent or inadequate |
| Source reliability        | Historical precision and moderation quality                 |
| ICP fit                   | Match to market, geography, product, and customer profile   |
| Persistence               | Survives beyond a one-day spike                             |
| AI-surface corroboration  | Appears in observed prompts, answers, or citations          |
| Decision clarity          | Clear problem, choice, or desired outcome                   |
| Trend acceleration        | Rate of increase versus prior window                        |

### 13.2 Penalties

| Penalty                | Meaning                                                    |
| ---------------------- | ---------------------------------------------------------- |
| Spam/manipulation risk | Bots, brigading, affiliate spam, coordinated promotion     |
| Legal/retention risk   | Source terms, personal data, deletion, licensing ambiguity |
| Cannibalization risk   | New page would overlap a stronger canonical page           |
| Staleness risk         | Issue already obsolete or resolved                         |
| Source concentration   | Most evidence comes from one community or one repost chain |
| Uncertainty            | Weak extraction, ambiguous identity, sparse evidence       |

### 13.3 Default formula

```text
Positive score =
  12% cross-source diversity
+ 12% commercial proximity
+ 11% first-party corroboration
+  9% search corroboration
+  9% normalized velocity
+  9% recurrence
+  8% coverage gap
+  7% source reliability
+  7% ICP fit
+  5% persistence
+  5% AI-surface corroboration
+  4% decision clarity
+  2% trend acceleration

Penalty severity =
  25% spam risk
+ 20% legal/retention risk
+ 15% cannibalization risk
+ 15% staleness risk
+ 10% source concentration risk
+ 15% uncertainty

Priority = clamp(0, 100, PositiveScore - 35 × PenaltySeverity)
```

Weights are defaults, not holy scripture. Every change creates a new scoring version and
must be evaluated against a labeled gold set.

### 13.4 Priority bands

- `ship_now`: priority ≥ 75 and confidence ≥ 0.65.
- `validate_next`: priority ≥ 55 and confidence ≥ 0.45.
- `monitor`: priority ≥ 35.
- `reject`: below 35 or fails policy/promotion gates.

A high score never overrides an explicit compliance block.

---

## 14. Engagement normalization

Raw upvotes/comments are retained as source facts but are not directly comparable.

For each source/community, calculate:

- Age-adjusted engagement velocity.
- Percentile versus posts from the same community and content type.
- Comments-per-view or replies-per-impression where available.
- Unique participant estimate only when allowed and privacy-safe.
- Baseline median/MAD or robust percentile, not simple mean.
- Community size and typical decay curve.
- Evidence recurrence independent of engagement.

A low-engagement specialist question can outrank a viral generic post when it has higher
commercial proximity, recurrence, first-party support, and coverage gap.

---

## 15. Temporal model

Compute separate windows rather than one arbitrary “last 30 days” number:

- **7-day spike:** rapid emergence.
- **30-day pulse:** current active concern.
- **90-day persistence:** durable problem.
- **365-day baseline:** seasonality and structural demand.
- **Year-over-year comparison:** when enough history exists.

Classify regimes:

- `emerging`: recent acceleration, limited long baseline.
- `persistent`: stable recurring demand.
- `seasonal`: repeats in comparable calendar windows.
- `event_driven`: tied to launch/outage/policy/recall/news event.
- `evergreen_latent`: steady low-volume but high-value recurrence.
- `decaying`: falling after a prior peak.
- `unknown`: insufficient history.

Content and monitoring cadence should depend on regime. An outage question may need a
status/support update within hours, not an evergreen 2,000-word article two weeks later,
a ritual the content industry nevertheless performs with remarkable commitment.

---

## 16. Promotion lifecycle

```text
DISCOVERED
  → NORMALIZED
  → CLUSTERED
  → CORROBORATED
  → PROMOTED
  → ACTIONED
  → MEASURED
  → DECAYED or retained

Any stage may → REJECTED
```

### 16.1 Default promotion gate

A family normally requires one of:

- Two independent community sources.
- Community evidence plus search-observed evidence.
- Community evidence plus first-party evidence.
- One exceptional first-party signal with clear commercial impact.
- A market-event override approved by a human.

Generated candidates never satisfy this gate alone.

### 16.2 Human controls

- Split or merge family.
- Mark cross-post or independent evidence.
- Promote with action and rationale.
- Dismiss with reason code.
- Override temporal regime.
- Freeze canonical question/ID for longitudinal reporting.
- Reopen a decayed family when evidence returns.

Every mutation is audited.

---

## 17. Coverage and action engine

Before recommending a new URL:

1. Retrieve potentially relevant current pages, product docs, support docs, and tools.
2. Evaluate whether the family is answered, partially answered, buried, outdated, or
   contradicted.
3. Check canonical intent and cannibalization risk.
4. Check competitors and cited sources.
5. Select one primary action and optional secondary action.

### 17.1 Action taxonomy

- `update_existing_page`
- `create_supporting_page`
- `add_faq`
- `create_comparison`
- `create_tool`
- `create_troubleshooter`
- `update_product_or_offer`
- `create_sales_enablement`
- `create_support_article`
- `monitor_only`
- `reject`

### 17.2 Action examples

| Evidence pattern                               | Preferred action                              |
| ---------------------------------------------- | --------------------------------------------- |
| Same objection appears in sales and reviews    | offer/copy update + sales enablement          |
| Product failure after new release              | support article/troubleshooter, not SEO essay |
| Repeated comparison with clear SERP demand     | comparison page or section                    |
| Existing page ranks but omits new sub-question | update existing page                          |
| High-intent calculation repeated               | calculator/tool                               |
| Viral one-off, weak ICP fit                    | monitor/reject                                |
| Strong community pain, zero search volume      | support/product/email test before new page    |

---

## 18. Constellation integration contract

OpenSEO exports only normalized/corroborated families. Constellation does not need raw
community bodies by default.

### 18.1 Export payload

```json
{
  "prompt_family_id": "pf_cabinet_finish_choice",
  "version": 3,
  "canonical_question": "Should I paint or restain kitchen cabinets?",
  "problem_statement": "Homeowners need to choose a cabinet refinishing path based on condition, budget, durability, and desired finish.",
  "market": { "language": "en", "location": "US" },
  "regime": "persistent",
  "evidence_summary": {
    "observations": 18,
    "independent_sources": 6,
    "classes": [
      "community_observed",
      "search_observed",
      "first_party_observed"
    ],
    "first_observed_at": "2026-05-04T00:00:00Z",
    "last_observed_at": "2026-07-24T00:00:00Z"
  },
  "score": {
    "version": "demand-pulse-v1.0.0",
    "priority": 82.4,
    "confidence": 0.78
  },
  "provenance": [
    {
      "observation_id": "obs_1",
      "source_class": "community_observed",
      "url": "https://example.com/thread"
    }
  ]
}
```

### 18.2 Constellation returns

- Existing page candidates and coverage quality.
- Prompt-to-page mapping.
- Search/AI visibility and source citation observations.
- Competitor/cited-source gaps.
- Recommended action and target URL.
- Measurement plan and worklist priority.

### 18.3 Versioning

Longitudinal comparisons require:

- Stable family ID.
- Family version.
- Observation snapshot timestamp.
- Seed/source configuration version.
- Scoring version.
- Clustering model/revision.
- Coverage evaluator version.
- Prompt-set version used for AI visibility testing.

---

## 19. MCP surface

### 19.1 Read-only tools first

- `list_demand_sources`
- `discover_live_questions` with `dryRun=true` default.
- `get_demand_pulse`
- `get_prompt_family`
- `get_topic_evidence`
- `get_demand_gaps`

### 19.2 Confirmed write tools later

- `promote_prompt_family`
- `dismiss_demand_candidate`
- `split_prompt_family`
- `merge_prompt_families`
- `update_demand_action`

Write tools require:

- project-scoped auth,
- explicit `confirm: true`,
- expected scoring/family version to prevent stale writes,
- audit record,
- no hidden source-connection changes.

### 19.3 MCP response rules

- Return structured content and a human-readable table.
- Label evidence classes.
- Include score/confidence/version.
- Include bounded provenance URLs.
- Distinguish unavailable, not queried, blocked, and no evidence.
- Never invent engagement or search metrics.
- Never expose secrets or full retained raw bodies.

---

## 20. UI

### 20.1 Demand Pulse overview

Cards:

- Emerging this week.
- Persistent high-value problems.
- First-party corroborated.
- Search corroborated.
- AI-surface corroborated.
- Current-site coverage gaps.
- Actioned and measuring.
- Source health/cost warnings.

Filters:

- 7/30/90/365 days.
- Source class/platform.
- Locale/geography.
- Intent/funnel.
- Regime.
- Confidence/priority.
- Action/lifecycle.
- New versus existing-page update.

### 20.2 Prompt family detail

- Canonical question/problem/decision.
- Trend/regime chart.
- Full signal vector and score version.
- Evidence grouped by class, with cross-post labels.
- Existing site coverage.
- Competitor/citation evidence.
- Recommended action.
- Retention/compliance warnings.
- Audit timeline.
- Outcome snapshots after action.

### 20.3 Source management

- Adapter capability and auth state.
- Terms profile/date reviewed.
- Retention policy.
- Last successful run and cursor.
- Cost/request budget.
- Error/backoff status.
- Enable only after policy and test checks pass.

### 20.4 Safety defaults

- No navigation item until feature flag and migration health pass.
- Read-only view before writes.
- Raw excerpts collapsed by default.
- PII warning for first-party imports.
- Reddit connection hidden until compliance approval.

---

## 21. Privacy, terms, and retention

### 21.1 Data minimization

Default storage:

- Source external ID and canonical URL.
- Title and bounded excerpt only when allowed.
- Timestamps, source, locale, and engagement facts.
- Derived problem/question/entities/score.
- No username, avatar, email, or profile unless required for an approved use.
- Raw artifacts in R2 only when necessary, encrypted by platform controls, with expiry.

### 21.2 Source policy profile

Every adapter must declare:

- Terms URL and version/date reviewed.
- Commercial-use status.
- Authentication requirements.
- Allowed fields/use.
- Raw/excerpt/derived retention.
- Deletion requirements.
- Rehydration policy.
- Rate limits and backoff.
- Attribution requirements.
- Whether AI processing is permitted for classification/summarization.

### 21.3 Deletion propagation

- Source deletion sync where API supports it.
- Manual deletion queue by source external ID/URL/hash.
- Delete raw artifacts, excerpts, cached representations, and prohibited derivatives.
- Preserve only minimal compliance/audit tombstones where lawful.
- Record completion and failures.

### 21.4 First-party PII

- Importer must identify whether data contains personal data.
- Redact emails, phone numbers, addresses, payment data, health data, and sensitive
  identifiers before semantic processing unless explicitly approved.
- Provide project retention and delete/export controls.
- Do not mix customer identities into public community evidence.

---

## 22. Adversarial and quality controls

### 22.1 Spam and astroturfing

Signals:

- Sudden identical wording across accounts/sites.
- Affiliate/promo link concentration.
- Repeated author/content hashes where allowed.
- Engagement anomalies versus normal decay.
- Low source diversity despite high volume.
- Coordinated timing.
- Domain reputation and moderation quality.

Response:

- Increase spam and source-concentration penalties.
- Quarantine rather than delete when uncertain.
- Require independent corroboration.

### 22.2 Cross-post and syndication

- Preserve original and repost relationships.
- One original plus ten reposts is not eleven independent observations.
- Independent follow-up discussions may still add evidence.

### 22.3 Moderation and deletion bias

Deleted or heavily moderated communities may hide real demand. Mark missingness rather
than treating absence as proof that demand disappeared.

### 22.4 Platform demographic bias

Each source has audience bias. Display source mix and do not generalize one platform to
the whole market without corroboration.

### 22.5 Feedback-loop bias

Publishing content can change future searches/discussions. Record action timestamps so
post-action growth is interpreted with causal humility rather than celebratory graph
worship.

---

## 23. Multilingual and local markets

- Store original language and text.
- Detect locale/geography separately.
- Create translation sibling edges, not automatic family collapse.
- Promote a merged global family only when intent and solution are truly equivalent.
- Preserve local entities, laws, prices, units, and cultural vocabulary.
- Score local source relevance separately from global engagement.
- Compare language-specific search evidence.

Initial MVP can be English-first, but the schema must not bake English into IDs or
normalization contracts.

---

## 24. Reliability and operations

### 24.1 Idempotency

- Unique source connection + external ID.
- Canonical URL/content hashes.
- Run ID and cursor.
- Upsert engagement snapshots without duplicating observations.
- Replay fixtures produce identical normalized output for a fixed code/config version.

### 24.2 Concurrency

- Per-project/source lock.
- Maximum two active collectors per project initially.
- Adapter-specific concurrency.
- Queue when source rate/cost budget is exhausted.

### 24.3 Circuit breakers

Open when:

- auth failures repeat,
- terms/capability probe changes,
- error rate exceeds threshold,
- unexpected response schema appears,
- cost exceeds run/day budget,
- deletion sync fails repeatedly.

### 24.4 Observability

Metrics:

- runs, requests, latency, retries, errors, cost.
- observations discovered/accepted/rejected/deduped.
- family creation/merge/split rates.
- source diversity and concentration.
- promotion precision and human rejection reasons.
- retention sweeper/deletion queue age.
- MCP tool latency and response size.

Logs must include project/source/run IDs but no secrets or unnecessary raw text.

### 24.5 Kill switches

- Global Demand Pulse off.
- Global write off.
- Source-specific off.
- Project-specific off.
- Dry-run mode.
- Collection pause while retaining read access.

---

## 25. Safe rollout after upstream sync

The fork is behind upstream and production is live. Therefore all work is additive and
feature-flagged.

### 25.1 Branch order

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main
git checkout -b agent/demand-pulse-v1
```

Apply the packaged Phase 0 commit only after the sync.

### 25.2 Rollout phases

#### Phase 0 — contracts and fixtures

- Add types, scoring, dedupe, retention, adapter interface, tests, skill, PRD.
- No route, navigation, schema mutation, scheduler, or production API call.
- Feature flags default off/dry-run.

#### Phase 1 — storage and read-only ingestion

- Add D1 migrations using the next current migration number.
- Add repository/service layer.
- Wire manual first-party imports.
- Wire DataForSEO discussions/forums normalizer through existing transport.
- Wire Hacker News.
- Store bounded evidence and run ledger.
- Add retention sweeper.

#### Phase 2 — read-only UI and MCP

- Hidden route for one canary project.
- Read-only MCP tools.
- Source health/cost view.
- Human family split/merge feedback captured but no automatic promotion.

#### Phase 3 — Constellation integration

- Export corroborated families.
- Import coverage/action/AI evidence.
- Enable promotion/dismissal with explicit confirmation.
- Add outcome ledger.

#### Phase 4 — additional adapters

- Discourse, Stack Exchange, GitHub Issues/Discussions, YouTube, reviews, Trends.
- Reddit only after policy review and deletion tests.
- Bluesky/Mastodon after source-quality evaluation.

### 25.3 Canary

Use one project with:

- known conversion events,
- sufficient GSC/first-party data,
- manageable niche vocabulary,
- real forum/support conversations,
- an owner able to label top recommendations.

Run in dry mode first, then read-only, then action one small set.

### 25.4 Rollback

- Disable feature/source flags.
- Stop Workflows.
- Keep existing OpenSEO routes unaffected.
- New tables remain unused; migration is additive.
- No modification to existing keyword/rank/audit data contracts.
- Raw artifacts expire normally.

---

## 26. Testing strategy

### 26.1 Unit tests

- URL canonicalization and tracking removal.
- Exact duplicate and cross-post classification.
- Scoring weights sum and deterministic outputs.
- Penalty behavior and band thresholds.
- Retention profile selection and expiry.
- Adapter config validation and cursor behavior.
- First-party import redaction/validation hooks.

### 26.2 Contract tests

Per adapter, freeze fixtures for:

- valid response,
- empty response,
- deletion/dead item,
- missing fields,
- rate limit/backoff,
- auth failure,
- changed schema,
- duplicate replay,
- partial run retry.

### 26.3 Integration tests

- D1 migration from current upstream schema.
- Idempotent run replay.
- R2 lifecycle/retention deletion.
- Workflows retry and lock behavior.
- MCP project auth and bounded outputs.
- Source disabled/blocked states.
- Constellation export/import version checks.

### 26.4 Evaluation sets

Create labeled gold sets by niche:

- duplicate vs cross-post vs independent.
- family merge/split.
- relevance/ICP fit.
- commercial proximity.
- action selection.
- spam/astroturf.
- regime classification.

Promotion target:

- ≥80% human approval in top 20.
- ≥90% true-duplicate collapse.
- ≥95% provenance completeness.
- 100% versioned scores and source policy profiles.
- zero source secrets in output/logs.

---

## 27. KPIs

### 27.1 Signal quality

| KPI                                         |                  Target |
| ------------------------------------------- | ----------------------: |
| Top-20 human approval                       |                    ≥80% |
| Promoted families with ≥2 evidence classes  |                    ≥75% |
| Provenance completeness                     |                    100% |
| Duplicate collapse precision                |                    ≥90% |
| Cross-posts incorrectly counted independent |                     <5% |
| Recommendations with explicit action        |                    100% |
| Recommendations defaulting to new page      | <50%, tracked not gamed |

### 27.2 Operational

| KPI                                                      |                                     Target |
| -------------------------------------------------------- | -----------------------------------------: |
| Run idempotency                                          |                                       100% |
| Source run success                                       | ≥98% excluding documented upstream outages |
| Unbounded cost incidents                                 |                                          0 |
| Retention/deletion SLA misses                            |                                 0 critical |
| MCP p95 read latency                                     |        <3 seconds excluding live discovery |
| Feature-related regression to existing OpenSEO workflows |                                          0 |

### 27.3 Commercial/outcome

Compare Demand Pulse actions with conventional keyword-only controls:

- 60/90-day impressions and clicks.
- AI retrieval/citation gains.
- Lead/conversion contribution.
- Support deflection and resolution time.
- Sales objection/win-rate movement.
- Product adoption/churn effects.
- Time from signal to action.
- Value per implementation hour.

The primary KPI is not articles published. Civilization has suffered enough dashboard
metrics that reward typing.

---

## 28. Unknown unknowns and mitigations

| Unknown                                               | Failure mode                             | Mitigation                                                      |
| ----------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| New source domains emerge                             | fixed adapters miss niche demand         | SERP source discovery + source registry                         |
| Search volume remains zero                            | valuable latent demand gets discarded    | preserve first-party/community evidence and alternative actions |
| Viral entertainment dominates                         | irrelevant topics rank high              | commercial/ICP/coverage scoring + normalization                 |
| Cross-post campaign                                   | fake source diversity                    | cross-post/syndication graph                                    |
| Quiet specialist forum                                | low raw engagement undervalued           | source percentile + recurrence                                  |
| Platform API/terms change                             | collector breaks or becomes noncompliant | capability/terms version probe + circuit breaker                |
| Deleted content persists internally                   | legal/privacy breach                     | deletion queue + TTL + rehydration model                        |
| LLM extraction drifts                                 | families/scoring change silently         | model revision + gold set + shadow evaluation                   |
| Multilingual false merges                             | wrong market action                      | translation sibling edges + locale-specific evidence            |
| Product launch/outage regime                          | evergreen workflow reacts too slowly     | market-event triggers and shorter windows                       |
| Existing page is “about” topic but does not answer it | false coverage                           | answer-level coverage evaluation                                |
| Competitor astroturfing                               | manipulation enters roadmap              | spam/source concentration penalties                             |
| Review bombing                                        | false negative demand spike              | platform anomaly and independent evidence gate                  |
| First-party data includes PII                         | privacy exposure                         | import redaction + bounded fields + retention controls          |
| Publishing affects observed demand                    | misleading causal claims                 | action timestamps + control comparisons                         |
| Source outage creates apparent decay                  | false trend decline                      | source health-aware missingness                                 |
| Cost grows with projects/seeds                        | margin erosion                           | source/day/project budgets + cache + tiered cadence             |
| Family taxonomy explodes                              | unusable UI and unstable IDs             | merge/split governance + frozen canonical IDs                   |
| One page covers many families                         | action duplication                       | prompt-to-page graph and grouped work orders                    |
| One family needs multiple actions                     | under-scoped recommendation              | primary action + ordered secondary actions                      |
| “Current concern” is already resolved                 | stale content                            | staleness/version/event checks                                  |
| Forum is indexed but terms prohibit reuse             | compliance risk                          | source policy before excerpt retention                          |
| API key exists but commercial approval does not       | false sense of readiness                 | separate auth, terms, and compliance statuses                   |
| Model-generated candidates dominate                   | plausible junk returns                   | generated evidence class cannot promote alone                   |

---

## 29. Acceptance criteria

### Phase 0

- [x] Additive feature contracts exist.
- [x] Scoring is deterministic, versioned, and retains component contributions.
- [x] Duplicate and cross-post are distinct outcomes.
- [x] Hacker News adapter uses no secret and has bounded concurrency.
- [x] DataForSEO normalizer reuses the existing transport boundary.
- [x] First-party import normalizer exists.
- [x] Reddit is off by default and mapped to a strict retention profile.
- [x] All feature/source flags default off; dry-run defaults on.
- [x] No existing OpenSEO route/schema/nav is modified by the package.

### Phase 1

- [ ] Current upstream fork is synced and branch created.
- [ ] D1 migration is additive and passes current migration tests.
- [ ] Run ledger, observations, families, evidence, scores, actions, and deletion queue persist.
- [ ] Replays are idempotent.
- [ ] R2 raw artifacts have lifecycle expiry.
- [ ] Per-project/source locks and budgets work.
- [ ] Retention sweeper and deletion workflow pass fixtures.

### Phase 2

- [ ] Hidden canary UI displays 7/30/90-day pulse and full vector.
- [ ] Read-only MCP tools return structured, source-labeled evidence.
- [ ] Top 20 achieves ≥80% human approval on initial canary.
- [ ] Existing OpenSEO tests and workflows remain green.

### Phase 3

- [ ] Corroborated families export to Constellation with stable IDs/versions.
- [ ] Coverage and action recommendations return with provenance.
- [ ] Promotion/dismissal writes require explicit confirmation and version checks.
- [ ] Outcome snapshots connect actions to search, AI, and business KPIs.

### Reddit adapter

- [ ] Current terms profile reviewed and stored.
- [ ] Commercial-use status approved for the intended use.
- [ ] Secret stored outside code.
- [ ] Deletion and retention tests pass.
- [ ] Raw author identity is not stored by default.
- [ ] Adapter can be killed independently.

---

## 30. Implementation backlog

### Epic A — foundation

- DP-001 Domain types and lifecycle.
- DP-002 Versioned scoring and confidence.
- DP-003 URL/content normalization and dedupe relations.
- DP-004 Retention/source-policy contracts.
- DP-005 Adapter interface and run envelope.
- DP-006 Feature flags and kill switches.

### Epic B — persistence and operations

- DP-101 D1 schema/migration.
- DP-102 Source connection repository.
- DP-103 Run ledger and raw artifact repository.
- DP-104 Observation/upsert/engagement snapshots.
- DP-105 Family/evidence/score/action repository.
- DP-106 Durable Object locks and budgets.
- DP-107 Workflow orchestration/retries.
- DP-108 Retention sweeper/deletion queue.

### Epic C — MVP sources

- DP-201 Manual first-party import UI/API.
- DP-202 GSC observation adapter.
- DP-203 DataForSEO discussions/forums query planner and normalizer.
- DP-204 Hacker News adapter.
- DP-205 Source-domain emergence registry.

### Epic D — intelligence

- DP-301 Structured extraction.
- DP-302 Hybrid family clustering.
- DP-303 Cross-post/syndication resolution.
- DP-304 Temporal regime classifier.
- DP-305 Source normalization baselines.
- DP-306 Coverage and action integration with Constellation.

### Epic E — UI/MCP

- DP-401 Source management.
- DP-402 Pulse overview.
- DP-403 Family detail/evidence graph.
- DP-404 Read-only MCP tools.
- DP-405 Confirmed mutation tools.
- DP-406 Outcome board.

### Epic F — expansion

- DP-501 Trends and reviews.
- DP-502 Discourse.
- DP-503 Stack Exchange.
- DP-504 GitHub Issues/Discussions.
- DP-505 YouTube comments.
- DP-506 Approved Reddit adapter.
- DP-507 Bluesky/Mastodon.
- DP-508 Event feeds and advisories.

---

## 31. Repository integration map

The packaged files intentionally avoid guessing current upstream registry paths. After
sync, the builder should locate the current equivalents for:

- Drizzle/D1 schema and migration sequence.
- MCP tool registry and server instructions.
- Cloudflare Workflow definitions.
- project settings/source connection routes.
- authenticated navigation and route manifest.
- feature/billing/cache helpers for DataForSEO.
- current test scripts and fixtures.

Then wire the additive contracts rather than copying an obsolete path from a four-commit-
behind fork. This is less theatrical than breaking production and more useful.

---

## 32. Research references

Current official/primary references reviewed for this design:

- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Reddit Developer Data Protection Addendum: https://redditinc.com/policies/developer-data-protection-addendum
- Hacker News API: https://github.com/HackerNews/API
- Discourse API/OpenAPI: https://docs.discourse.org/openapi.json
- Stack Exchange API throttles: https://api.stackexchange.com/docs/throttle
- Stack Exchange search: https://api.stackexchange.com/docs/search
- GitHub Issues REST API: https://docs.github.com/en/rest/issues/issues
- GitHub Discussions GraphQL: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions
- YouTube commentThreads.list: https://developers.google.com/youtube/v3/docs/commentThreads/list
- YouTube quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
- Mastodon timelines: https://docs.joinmastodon.org/methods/timelines/
- Mastodon search: https://docs.joinmastodon.org/methods/search/
- Bluesky API: https://docs.bsky.app/docs/category/http-reference
- Bluesky firehose: https://docs.bsky.app/docs/advanced-guides/firehose
- DataForSEO SERP advanced: https://docs.dataforseo.com/v3/serp-se-type-task-get-advanced/
- DataForSEO Business Data: https://dataforseo.com/apis/business-data-api
- DataForSEO Google Trends: https://docs.dataforseo.com/v3/keywords_data-google-trends-overview/
- OpenSEO upstream: https://github.com/every-app/open-seo

---

## 33. Final product position

**OpenSEO Demand Pulse** is a live demand and evidence layer for humans and agents. It
finds what customers are starting to say, proves whether it matters, maps it to the
current site and business, recommends the right action, and measures the result.

It is not “Reddit with a score.” That market position would be easier to explain and
much easier to regret.
