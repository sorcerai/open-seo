# Internal Backlink Ops v1

**Status:** implementation contract  
**Mode:** private, single operator, internal dogfood first  
**Primary operator:** Aria  
**Canonical application:** OpenSEO  
**First canary:** OnFarmCompost  
**Default safety mode:** dry-run discovery, human approval, no automatic email sending, no automatic submissions

## 1. Decision

Build this as a **project-scoped Link Ops module inside OpenSEO**, not as a separate SaaS.

The private system does not need:

- new user registration;
- workspace membership or role management;
- billing, entitlements, trials, or plans;
- a public marketing site;
- a customer-facing opportunity marketplace;
- an admin CMS for multiple curators;
- autonomous outreach or inbox management.

OpenSEO already owns the expensive foundations: projects, organization context, DataForSEO authentication and cost handling, backlink analysis, cache, search research, Cloudflare deployment, SQLite/Postgres support, and agent-facing workflows. The missing product is durable operator state around **what link to pursue, why, what happened, whether it is still live, and what outcome followed**.

Use the existing authentication boundary:

- `local_noauth` for a trusted local deployment; or
- Cloudflare Access for an internet-reachable private deployment.

Do not create a second identity system merely so one human can log in as herself with greater ceremony.

## 2. Product thesis

Backl.io's useful lesson is not its visual dashboard. The useful lesson is that backlink work becomes tractable when a small, curated opportunity corpus is combined with:

1. domain-specific eligibility;
2. a ranked next-action queue;
3. explicit progress states;
4. instructions and evidence;
5. placement verification;
6. reminders and outcome tracking.

For this implementation, reproduce the **workflow category** through clean-room design. Do not copy Backl.io's proprietary opportunity list, instructions, UI assets, code, authenticated traffic, or private data. Build the catalog from public sources, owned observations, DataForSEO evidence, and original operator notes.

The internal system should be better suited to Aria's portfolio than a generic startup directory list. It must support software, local services, informational resources, affiliate properties, and authority sites without pretending every domain deserves the same backlinks.

## 3. Mission

Turn OpenSEO's existing backlink and SERP intelligence into a controlled acquisition loop:

```text
owned linkable asset
  -> discover candidate pages/sites
  -> normalize and deduplicate
  -> qualify with evidence
  -> human decision
  -> manual submission or approved outreach draft
  -> verify the resulting placement
  -> measure referral/search/citation outcomes
  -> preserve reusable lessons
```

The daily operator surface should answer five questions:

1. What are the three highest-value link actions today?
2. Why does each prospect have a realistic reason to cite this asset?
3. What evidence supports the score?
4. What is blocked or stale?
5. Which acquired links produced durable value?

## 4. Repository ownership

| System | Owns | Must not own |
| --- | --- | --- |
| **OpenSEO Link Ops** | Opportunity discovery, catalog, qualification, queue, status, public contact-path evidence, execution records, verification, backlink outcome snapshots | Publishing on third-party sites, invented contacts, automatic mass outreach, ranking guarantees |
| **OpenSEO Backlinks** | Current and historical backlink/referring-domain evidence from DataForSEO | Campaign state or human decisions |
| **OpenSEO Demand Pulse** | Observed demand and source evidence that may justify a linkable asset or citation request | Link execution |
| **Constellation** | Coverage, citation fit, competing-page evidence, and action review for `request_partnership_or_citation` | Raw prospect PII, email sending, canonical task state |
| **Project repository** | The owned page/tool/data asset, factual claims, deployment, analytics instrumentation | Cross-project prospect memory |
| **Push Indexer** | Submission of changed **owned canonical URLs** after deployment | Submitting third-party backlink pages, forcing indexing, or claiming rankings |
| **PageSpace** | Human-readable queue/decision mirror when available | Canonical state, evidence blobs, raw contact PII |
| **Reverie** | Approved durable lessons, failed patterns, policy changes, reusable decisions | Raw email addresses, raw prospect archives, task state, canonical metrics |

## 5. Scope

### 5.1 P0: operator core

P0 creates the smallest useful private system:

- project-scoped linkable assets;
- clean-room opportunity catalog import;
- project-specific opportunity queue;
- deterministic qualification and risk scoring;
- evidence, notes, status, and next-action tracking;
- manual submission records;
- HTTP/HTML placement verification;
- bounded scheduled rechecks;
- JSON/CSV export;
- fixture-backed tests for parsing, deduplication, scoring, and state transitions.

### 5.2 P1: evidence-driven discovery

- competitor backlink-gap discovery through existing DataForSEO adapters;
- lost-link recovery candidates;
- SERP resource-page/listicle discovery through the existing `link-prospecting` skill;
- public contact-page and editorial-guideline discovery;
- Constellation action review;
- GSC and referral outcome snapshots for owned target pages.

### 5.3 P2: controlled outreach

- draft generation only after explicit approval;
- Gmail draft creation, never automatic send by default;
- external message/thread IDs and response states;
- suppression, duplicate-send prevention, and opt-out records;
- limited follow-up suggestions, still human-approved;
- deliverability and compliance health checks.

### 5.4 Explicit non-goals

- public SaaS;
- user/workspace/billing implementation;
- backlink exchange or reciprocal-link network;
- purchased dofollow-link marketplace;
- mass directory blasting;
- automated form submission;
- automatic cold-email sending;
- automated negotiation;
- scraping authenticated Backl.io data;
- copying another provider's curated catalog;
- claiming a third-party page is indexed without reliable evidence;
- using Push Indexer on third-party URLs;
- a DR guarantee or fake additive DR simulator.

## 6. Opportunity sources

Each candidate must record a discovery method, source URL/provider, timestamp, and evidence lineage.

### 6.1 Clean-room catalog

A reusable catalog of public opportunities researched independently. Examples:

- legitimate business and software directories;
- industry associations;
- local chambers and economic-development resources;
- municipal, university, extension, and nonprofit resource pages;
- product integrations and partner directories;
- supplier/manufacturer resource pages;
- editorial submission pages;
- curated tools, templates, statistics, and resource lists;
- podcasts, newsletters, expert roundups, and contributor programs.

A catalog entry is not automatically eligible for every project. It becomes a project opportunity only after eligibility and fit checks.

### 6.2 Competitor gap

Reuse DataForSEO through OpenSEO:

1. identify backlink-profile competitors;
2. collect referring domains/pages for a bounded competitor set;
3. subtract domains already linking to the owned project;
4. group duplicate domains/pages;
5. retain page-level context, anchors, rel attributes, rank, spam, first-seen, and last-seen evidence;
6. promote only candidates with a plausible editorial or submission path.

Default canary bounds:

- at most 3 competitors per run;
- at most 100 referring-page rows per competitor;
- at most 25 newly promoted candidates per run;
- a configurable hard USD cost ceiling;
- no provider call without an idempotent run record.

### 6.3 SERP prospecting

Reuse `.agents/skills/link-prospecting/SKILL.md` and OpenSEO SERP tools. Candidate query families include:

- `<topic> resources`;
- `<topic> statistics`;
- `<topic> tools`;
- `<topic> templates`;
- `<topic> guide`;
- `<topic> for <audience>`;
- `<competitor> alternatives`;
- `site:<relevant-domain> <topic>` where provider terms permit.

Do not scrape Google directly. Use approved search APIs and existing OpenSEO adapters.

### 6.4 Lost-link recovery

Create recovery candidates from known lost or broken backlinks when:

- the source page remains reachable;
- the original target moved, broke, or materially changed;
- the owned replacement is genuinely relevant;
- no current live equivalent link exists.

### 6.5 Linkable-asset demand

Demand Pulse or Constellation may propose `request_partnership_or_citation` only when an approved owned asset already exists or a separate human-approved asset action is complete. Link Ops must not invent a page merely because a prospect was found.

## 7. Qualification model

### 7.1 Hard gates

An opportunity is ineligible when any of the following is observed:

- no plausible relationship between source page and target asset;
- malware, deceptive behavior, or severe spam evidence;
- low-quality directory/bookmark page created mainly to sell or manufacture links;
- mandatory dofollow payment, goods-for-link, or undisclosed placement;
- excessive reciprocal-link requirement;
- automated link-creation scheme;
- direct client/owned-site conflict;
- unreachable source with no recovery path;
- explicit publisher prohibition;
- duplicate live placement already exists;
- missing provenance for the candidate.

Paid advertising or sponsorship may remain eligible for referral/brand value only when its link treatment and disclosure are appropriate. It must not be scored as purchased ranking credit.

### 7.2 Deterministic priority score

Store every component, evidence ID, missing value, config version, and calculation timestamp. Re-scoring creates a new score record.

| Dimension | Weight | Question |
| --- | ---: | --- |
| Topical/editorial fit | 25 | Would this page's audience reasonably benefit from the asset? |
| Asset/reference value | 20 | Is there a concrete fact, tool, data point, guide, or utility worth citing? |
| Source quality | 15 | Is the source real, maintained, discoverable, and non-spammy? |
| Acquisition probability | 15 | Is there a legitimate submission, editorial, contributor, or contact path? |
| Qualified referral potential | 10 | Could the placement send relevant humans, not merely metric vapor? |
| Competitive gap/uniqueness | 10 | Does it close a real gap or recover a lost relationship? |
| Freshness | 5 | Is the page/program currently active and recently verified? |

Visible penalties:

- policy/manipulation risk: up to `-40`;
- poor page-level fit: up to `-25`;
- direct competitor/conflict: up to `-25`;
- high effort or cost: up to `-15`;
- stale or uncertain evidence: up to `-15`;
- no verified contact/submission path: up to `-10`.

Priority bands:

- `80-100`: P0, review immediately;
- `65-79`: P1, strong queue candidate;
- `45-64`: research or defer;
- `<45`: archive unless new evidence arrives.

DataForSEO rank, spam score, backlink counts, or any third-party authority metric are inputs, not truth. The score must never imply a guaranteed ranking or DR change.

## 8. State model

### 8.1 Opportunity status

```text
discovered
  -> qualifying
  -> review_required
  -> approved
  -> executing
  -> live
  -> lost
```

Terminal or side states:

- `rejected`;
- `ineligible`;
- `deferred`;
- `duplicate`;
- `conflict_blocked`;
- `expired`.

State changes require an event row with actor, timestamp, reason, prior state, next state, and idempotency key when an external side effect is involved.

### 8.2 Execution method

- `manual_profile_or_directory_submission`;
- `editorial_update_request`;
- `resource_inclusion_request`;
- `broken_link_replacement`;
- `expert_quote_or_data_contribution`;
- `partnership_or_integration`;
- `press_or_news_pitch`;
- `sponsorship_with_qualified_link`;
- `lost_link_recovery`.

### 8.3 Execution status

- `not_started`;
- `instructions_ready`;
- `draft_ready`;
- `human_approved`;
- `submitted_or_sent`;
- `replied`;
- `accepted`;
- `rejected`;
- `no_response`;
- `cancelled`.

Opportunity, execution, and placement states remain separate. One outreach attempt failing does not erase the opportunity, and one temporary placement failure does not rewrite historical execution.

## 9. Data model

Implement matching SQLite and Postgres Drizzle schemas. Keep relationships explicit; do not hide relational state in a JSON blob.

### 9.1 `link_assets`

Owned pages, tools, studies, datasets, guides, or products that can earn references.

Key fields:

- `id`, `project_id`;
- canonical URL and normalized URL;
- title, asset type, audience, topic;
- reference reason;
- lifecycle state;
- content/build SHA or version;
- approved-at and last-verified-at.

### 9.2 `link_catalog_entries`

Reusable clean-room opportunity definitions.

Key fields:

- `id`, stable slug;
- site/domain and public opportunity URL;
- opportunity type and category;
- original operator guidance;
- eligibility summary;
- payment/disclosure expectations;
- active/stale state;
- source evidence and last-reviewed-at.

Never store copied proprietary Backl.io instructions here.

### 9.3 `link_opportunities`

Project-specific candidate relationship between an owned asset and a prospect page/domain.

Key fields:

- `id`, `project_id`, `link_asset_id`, optional `catalog_entry_id`;
- prospect domain, source page URL, normalized identities;
- discovery method and discovery run ID;
- opportunity status, execution method, priority band;
- current next action and due-at;
- created-at, updated-at, archived-at.

Unique identity should prevent the same project + asset + normalized prospect page + execution method from being promoted twice.

### 9.4 `link_opportunity_evidence`

Append-only evidence records:

- evidence type;
- `observed`, `inferred`, or `unknown` state;
- value and confidence;
- source provider/type/URL;
- captured-at;
- parser/provider/config version;
- R2 artifact reference and content hash where retained;
- permitted use and retention rule.

### 9.5 `link_opportunity_scores`

Versioned score snapshots with component values, penalties, total, config version, evidence IDs, and explanation.

### 9.6 `link_contacts`

Only public, evidenced contact paths:

- contact-page URL;
- editorial-guidelines URL;
- public byline/profile URL;
- public professional profile;
- public email address when actually observed;
- evidence source and captured-at;
- suppression/opt-out state.

Do not guess addresses. Do not mirror raw values into Reverie or PageSpace.

### 9.7 `link_execution_attempts`

Manual submissions and outreach attempts:

- method and status;
- draft/reference artifact;
- human approval actor/time;
- submitted/sent time;
- external message/thread/form reference;
- response classification;
- idempotency key;
- failure reason.

### 9.8 `link_placements`

Observed links:

- source URL;
- target URL;
- anchor text;
- rel attributes;
- dofollow interpretation;
- visible-context excerpt hash/reference;
- first seen, last seen, lost-at;
- current verification verdict.

### 9.9 `link_verification_runs`

One durable run per check attempt:

- trigger and scheduled-at;
- HTTP status and final URL;
- robots/meta/X-Robots findings;
- canonical findings;
- target href match;
- anchor/rel/visibility findings;
- provider-observation state;
- verdict, confidence, error, retry-at;
- fetched artifact hash/reference.

### 9.10 `link_outcome_snapshots`

Owned-page outcomes over explicit windows:

- GSC clicks, impressions, average position, and query/page scope;
- referral sessions and qualified conversions when instrumented;
- DataForSEO backlink/referring-domain observations;
- citation observations from Constellation where applicable;
- baseline, comparison window, confidence, and known external factors.

A temporal correlation is not automatically causal. Store the attribution confidence and limitations.

### 9.11 `link_suppressions`

Project/domain/contact/method suppression records used to block:

- duplicate sends;
- explicit opt-outs;
- client or owned-site conflicts;
- legal/policy restrictions;
- repeated rejection;
- manual do-not-contact decisions.

## 10. Verification semantics

### 10.1 What the checker can prove

The HTML verifier can observe:

- HTTP reachability and redirects;
- final URL;
- robots meta and `X-Robots-Tag` headers;
- canonical declaration;
- whether an `<a>` points to the normalized target;
- anchor text;
- `rel` values such as `nofollow`, `ugc`, or `sponsored`;
- whether the link is rendered in normal page content;
- first/last observation and content hash changes.

DataForSEO can independently report whether its crawler has observed the backlink and related properties.

### 10.2 What the checker must not pretend to prove

For a third-party source page, the system normally cannot use Search Console URL Inspection because the URL must belong to a property the operator manages. Therefore:

- `site:` visibility is only a low-confidence search observation;
- DataForSEO discovery is a provider observation;
- crawlability is not the same as indexing;
- a successful indexing-submission response is not proof of indexing;
- Push Indexer must never submit the third-party page.

Allowed third-party discovery states:

- `not_checked`;
- `reachable`;
- `crawlable`;
- `provider_observed`;
- `search_observed`;
- `not_observed`;
- `unknown`.

Reserve `search_console_indexed` for an owned URL verified through the corresponding owned Search Console property.

### 10.3 Recheck schedule

Default checks after execution:

- first check after the expected publisher/submission delay;
- 7-day check;
- 30-day check;
- monthly check for live placements;
- immediate check when DataForSEO reports loss or a source hash changes materially.

Use bounded retries, per-domain rate limits, jitter, and a descriptive user agent. Do not bypass authentication, CAPTCHAs, blocks, or publisher restrictions.

## 11. Operator UI

Add a separate project route rather than corrupting the existing backlink-analysis screen:

```text
/p/$projectId/link-ops
```

Primary tabs:

1. **Today**: no more than three recommended actions plus blocked/stale items;
2. **Opportunities**: filterable queue and evidence drawer;
3. **Catalog**: reusable clean-room entries and project eligibility;
4. **Placements**: live/lost links and verification history;
5. **Runs**: discovery, scoring, verification, cost, and error ledger.

Opportunity drawer:

- source page/domain;
- target asset and reference reason;
- score breakdown and penalties;
- evidence/provenance;
- instructions or suggested angle;
- contact/submission path evidence;
- current state, next action, and history;
- approve/reject/defer/request-research controls.

No vanity dashboard is required. The main KPI is completed, evidence-backed actions and durable outcomes, not a large number wearing a gradient.

## 12. Service architecture

Follow the repository's established pattern:

```text
TanStack server function
  -> service
  -> repository
  -> provider adapter / database
```

Recommended feature boundary:

```text
src/types/schemas/link-ops.ts
src/serverFunctions/linkOps.ts
src/server/features/link-ops/
  repositories/LinkOpsRepository.ts
  services/LinkAssetService.ts
  services/LinkCatalogService.ts
  services/LinkDiscoveryService.ts
  services/LinkQualificationService.ts
  services/LinkExecutionService.ts
  services/LinkVerificationService.ts
  services/LinkOutcomeService.ts
  adapters/DataForSeoLinkDiscoveryAdapter.ts
  adapters/HtmlLinkVerifier.ts
src/client/features/link-ops/
src/routes/_project/p/$projectId/link-ops.tsx
src/db/link-ops.schema.ts
src/db/pg/link-ops.schema.ts
```

Update `src/db/schema.ts` and the schema-parity tests. Add forward-only migrations for both supported databases.

### 12.1 Reuse, do not duplicate

- Call `BacklinksService` or its underlying approved DataForSEO client instead of creating new credentials or billing logic.
- Reuse URL normalization helpers.
- Reuse R2 artifact/cache helpers where semantics match.
- Reuse project middleware and organization scoping.
- Reuse existing GSC connections for owned-page outcomes.
- Extend the existing link-prospecting skill instead of creating a parallel prompt jungle.

### 12.2 Scheduled work

Single-operator volume does not justify Redis, Temporal, or a distributed crawler fleet in P0.

Use:

- durable run rows in the database;
- a scheduled Cloudflare/worker entrypoint;
- bounded batches;
- row-level due times;
- idempotency keys;
- retry counters and next-at timestamps;
- explicit terminal failures and a visible jobs view.

Preserve an interface seam for Cloudflare Workflows only if real wait states or recovery complexity later justify it.

## 13. Agent and MCP surface

Read-only or planning tools:

- `list_link_assets`;
- `list_link_opportunities`;
- `get_link_opportunity`;
- `get_link_ops_queue`;
- `preview_link_discovery`;
- `preview_link_score`;
- `get_link_placement_history`.

Mutation tools requiring project context:

- `create_link_asset`;
- `run_link_discovery`;
- `approve_link_opportunity`;
- `reject_link_opportunity`;
- `record_link_submission`;
- `request_link_verification`;
- `record_link_outcome`.

Side-effect tools requiring an additional human approval token/event:

- `create_link_outreach_draft`;
- any future `send_link_outreach` tool.

P0 does not expose `send_link_outreach`.

## 14. Integration contracts

### 14.1 Constellation

Link Ops may emit the `link-opportunity-envelope.v1` contract when a candidate needs citation/action review. Constellation returns:

- page/asset fit;
- competing coverage;
- citation context;
- claim/evidence concerns;
- recommended action;
- accept/reject/research-more decision evidence.

The OpenSEO opportunity remains canonical.

### 14.2 PageSpace

When the connector is available, mirror only:

- project and asset;
- opportunity title/domain/source URL;
- priority and score band;
- current state;
- next action and due date;
- blocker;
- decision summary;
- canonical OpenSEO record URL/ID.

Do not mirror raw contact values, full fetched HTML, provider payloads, or canonical state.

### 14.3 Reverie

Write only approved durable learnings, for example:

- a directory class repeatedly produced no durable placements;
- a specific asset format earned editorial citations;
- a scoring weight systematically overvalued weak prospects;
- a publisher type requires a particular evidence package;
- a policy or suppression rule changed.

Never write raw prospect emails, contact forms, message bodies, or active task queues.

### 14.4 Push Indexer

Trigger Push Indexer only when Link Ops caused a changed owned asset to deploy. The payload contains the owned canonical URL and deployment lineage. Never submit the referring third-party URL.

## 15. Outreach boundary

P0 stores instructions and manual submission records. P1 may create drafts after approval. P2 may connect Gmail in draft-only mode.

Rules:

- a real person/page-specific reason is required;
- contact details must have source evidence;
- no guessed email addresses;
- no mail merge pretending to be personalization;
- no more than one active attempt per opportunity/contact/channel;
- suppression and opt-out checks run before draft creation and again before any future send;
- commercial-email legal and provider requirements remain operator policy, not something a language model may waive;
- sending-domain authentication and reputation health must be visible before any send feature is enabled.

## 16. Cost controls

Configuration, not hard-coded provider assumptions:

```text
LINK_OPS_ENABLED=false
LINK_OPS_MODE=dry_run
LINK_OPS_DAILY_API_BUDGET_USD=1.00
LINK_OPS_MAX_COMPETITORS_PER_RUN=3
LINK_OPS_MAX_ROWS_PER_COMPETITOR=100
LINK_OPS_MAX_NEW_OPPORTUNITIES_PER_RUN=25
LINK_OPS_MAX_VERIFY_URLS_PER_RUN=50
LINK_OPS_MAX_DRAFTS_PER_DAY=3
LINK_OPS_AUTO_SEND=false
```

Every paid provider call records:

- provider and endpoint;
- request/run ID;
- estimated and actual cost when available;
- project and opportunity lineage;
- cache hit/miss;
- result count;
- error/retry state.

A failed or repeated job must not create duplicate charges or external side effects where idempotency can prevent them.

## 17. Canary

Use **OnFarmCompost** because it is already the first Owned Attention canary and has a credible path to original local and operational resources.

Initial asset candidates should be existing, approved pages or tools. Do not generate new pages merely to satisfy this canary.

Canary opportunity classes:

- Houston-area municipal and community resources;
- Texas agriculture, extension, soil, food-waste, and sustainability resources;
- composting and farming associations;
- local business and supplier partnerships;
- resource pages that already cite comparable guides;
- lost/broken references where an existing OnFarmCompost asset is a truthful replacement.

Canary bounds:

- one project;
- no more than three active linkable assets;
- 25 clean-room catalog candidates;
- one bounded competitor-gap run;
- one weekly human review queue;
- no automated sending;
- no new URL until existing-page/asset fit is checked.

## 18. Acceptance criteria

P0 is accepted only when:

1. A project can register at least one approved linkable asset.
2. A clean-room catalog import is idempotent and preserves source provenance.
3. Discovery produces normalized project opportunities without duplicates.
4. Every promoted opportunity has at least one observed evidence record and a clear reference reason.
5. Scoring is deterministic, versioned, evidence-linked, and identical across SQLite and Postgres fixtures.
6. Hard-gated spam, payment, reciprocal, duplicate, and conflict cases fail closed.
7. A human can approve, reject, defer, or request more research with a durable event history.
8. Manual submission can be recorded without sending email or submitting a form automatically.
9. The verifier correctly classifies fixture links, rel values, redirects, canonicals, noindex headers/meta, missing links, and changed targets.
10. Scheduled retries cannot create duplicate execution or verification rows.
11. The UI shows the top three actions, blockers, evidence, score breakdown, and state history.
12. JSON and CSV exports round-trip without losing IDs or lineage.
13. No user-management, billing, or entitlement schema is added.
14. No raw prospect PII is written to PageSpace or Reverie.
15. No third-party URL is sent to Push Indexer.
16. No automated outreach send exists in P0.
17. Schema parity, typecheck, lint, unit, integration, and route smoke tests pass.

## 19. KPI board

### Quality

- 100% of promoted opportunities have provenance and a reference reason.
- 0 duplicate external actions.
- 0 third-party indexing submissions.
- 0 raw prospect PII in PageSpace/Reverie.
- Verification fixture precision and recall are reported, not hand-waved.

### Operator efficiency

- The weekly queue contains no more than ten reviewed candidates.
- The daily view contains no more than three recommended actions.
- One opportunity can be reviewed from evidence to decision without leaving the drawer except for source inspection.

### Outcomes

- accepted live placements;
- retained placements at 30 and 90 days;
- qualified referral sessions/conversions where measurable;
- owned-page GSC change with explicit uncertainty;
- citations or mentions observed by Constellation;
- cost and operator time per retained placement;
- rejected/deferred reasons that improve future scoring.

Backlink count and provider rank remain diagnostic metrics. They are not the mission.

## 20. Build order

1. Add the dual-dialect schema, migrations, repository, state-transition tests, and import/export contract.
2. Build linkable assets, catalog import, opportunity queue, manual scoring, and operator decisions.
3. Add deterministic qualification, suppression/conflict gates, and evidence lineage.
4. Add bounded DataForSEO competitor-gap and lost-link discovery using existing clients.
5. Add the HTML verifier, fixtures, scheduled rechecks, and placements view.
6. Add GSC/referral/DataForSEO outcome snapshots and Constellation review envelopes.
7. Add PageSpace mirror export and Reverie learning export adapters.
8. Add approved Gmail draft creation only after the canary proves the core loop.
9. Consider send/reply automation only after repeated manual results justify its operational and compliance cost.

## 21. Stop rules

Do not add public SaaS, billing, multi-user roles, autonomous sending, a link exchange, or a generalized CRM until the system has completed one trustworthy loop:

```text
asset
  -> opportunity
  -> human approval
  -> execution
  -> verified live placement
  -> measured outcome
  -> reusable learning
```

Do not expand to the portfolio fleet until the OnFarmCompost canary produces a clean queue, one completed execution, and a verification/outcome record without manual database repair.

## 22. Primary references

- Backl.io public product and company pages: <https://backl.io/>
- DataForSEO Backlinks API overview: <https://docs.dataforseo.com/v3/backlinks-overview/>
- DataForSEO Backlinks endpoint: <https://docs.dataforseo.com/v3/backlinks-backlinks-live/>
- DataForSEO Competitors endpoint: <https://docs.dataforseo.com/v3/backlinks-competitors-live/>
- Google Search spam policies, including link spam: <https://developers.google.com/search/docs/essentials/spam-policies>
- Google guidance for qualifying sponsored, UGC, and nofollow links: <https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links>
- Google recrawl guidance: <https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl>
- Search Console URL Inspection API: <https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect>
- Gmail sender guidelines: <https://support.google.com/mail/answer/81126>
