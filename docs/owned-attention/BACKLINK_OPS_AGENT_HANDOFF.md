# Agent handoff — Internal Backlink Ops v1

## Mission

Implement the smallest trustworthy **single-operator** link acquisition loop inside OpenSEO:

```text
approved owned asset
  -> evidence-backed opportunity
  -> human decision
  -> manual execution record
  -> verified placement
  -> measured outcome
```

Do not build a public SaaS, user-management layer, billing, automated form submission, autonomous outreach, inbox sync, link exchange, or ranking guarantee in this slice.

## Baseline

Start from OpenSEO `main` after the planning PR is merged.

Read in order:

1. `CLAUDE.md`
2. `docs/owned-attention/README.md`
3. `docs/owned-attention/BACKLINK_OPS_V1.md`
4. `docs/owned-attention/link-opportunity-envelope.v1.schema.json`
5. `docs/owned-attention/link-opportunity-envelope.example.json`
6. `.agents/skills/link-prospecting/SKILL.md`
7. `src/server/features/backlinks/`
8. `src/serverFunctions/backlinks.ts`
9. `src/db/schema.ts`, `src/db/app.schema.ts`, `src/db/pg/app.schema.ts`
10. existing migrations, schema-parity tests, project authorization middleware, R2 helpers, GSC integration, and DataForSEO client adapters.

Search for existing helpers before creating abstractions. The repository already has project scoping, DataForSEO transport and cost attribution, backlink normalization, R2 caching, TanStack Query/Router patterns, Zod boundaries, and SQLite/Postgres parity. Reusing them is engineering. Rebuilding them with slightly different names is archaeology in real time.

## Locked decisions

- OpenSEO is the canonical application and database.
- The module is project-scoped and single-operator in product behavior.
- Reuse existing authentication: trusted `local_noauth` or Cloudflare Access.
- Do not add user, workspace, membership, billing, plan, entitlement, or public-signup schemas.
- D1/SQLite and Postgres definitions remain structurally compatible.
- Relational state is normalized. JSON is reserved for bounded derived payloads or provider artifacts, not primary relationships.
- Every material finding is `observed`, `inferred`, or `unknown` with provenance.
- Human approval is required before execution.
- P0 records manual execution. It does not send email or submit forms.
- Third-party source URLs must never be sent to Push Indexer.
- PageSpace is a mirror when available. It is not canonical.
- Reverie receives approved learnings only, never raw contact PII or active task state.
- No proprietary Backl.io catalog, instructions, assets, code, or authenticated data may be copied.

## First 25-minute task

1. Create a failing schema-parity test that names the required Link Ops tables in both database dialects.
2. Add a failing JSON fixture test for `link-opportunity-envelope.example.json` against the runtime contract placeholder.
3. Write the first migration plan and stop before changing production data.

The first commit should prove the repository understands the missing contract. Do not start with a dashboard. Humanity has enough empty dashboards.

## Implementation queue

Implement in order. Do not start a later queue item until the prior item passes its acceptance tests.

### Q0 — contracts and test harness

Deliver:

- runtime Zod schemas matching `link-opportunity-envelope.v1.schema.json`;
- fixture loader and valid/invalid envelope fixtures;
- state and enum definitions;
- score configuration v1;
- tests for blank IDs, unknown enums, malformed URLs, missing provenance, raw contact-value leakage, and invalid Push Indexer lineage.

Acceptance:

- the example envelope validates;
- invalid fixtures fail for the expected reason;
- the contract contains no raw email/contact value field;
- a `pushIndexerJobId` cannot be used as evidence that a third-party source URL was submitted or indexed.

### Q1 — dual-dialect persistence

Add matching SQLite and Postgres Drizzle schemas for:

- `link_assets`;
- `link_catalog_entries`;
- `link_opportunities`;
- `link_opportunity_evidence`;
- `link_opportunity_scores`;
- `link_contacts`;
- `link_execution_attempts`;
- `link_placements`;
- `link_verification_runs`;
- `link_outcome_snapshots`;
- `link_suppressions`;
- append-only opportunity state events if not represented by a dedicated generic event table.

Required database invariants:

- every project-owned record references `projects.id` directly or through a project-owned parent;
- normalized opportunity identity prevents duplicate promotion for the same project, asset, source page, and execution method;
- execution idempotency keys are unique within the relevant project/opportunity boundary;
- one active verification run per placement/trigger window where duplicate runs would waste work;
- historical scores, decisions, attempts, placements, and outcomes are append-only or explicitly versioned;
- suppressions fail closed;
- source and target URLs are stored in normalized and display forms where needed;
- schema parity remains green.

Add forward-only migrations. Do not rewrite existing migration history.

### Q2 — repository and state machine

Follow:

```text
TanStack server function -> service -> repository
```

Implement repository operations for:

- create/list/update/archive link assets;
- idempotent clean-room catalog import;
- promote/deduplicate opportunities;
- append evidence;
- append score snapshots;
- transition opportunity state;
- approve/reject/defer/request research;
- create manual execution attempts;
- record placements and verification runs;
- record outcome snapshots;
- create and enforce suppressions.

State transitions must:

- verify current state;
- record actor, timestamp, reason, prior state, next state, and evidence IDs;
- reject illegal transitions;
- remain stable under repeat commands;
- never infer approval from a high score.

Minimum state tests:

- `discovered -> qualifying -> review_required -> approved`;
- approved opportunity can create one manual execution attempt;
- rejected, deferred, ineligible, duplicate, and conflict-blocked opportunities cannot execute;
- repeat approval and repeat execution commands do not duplicate records;
- placement loss preserves prior live history;
- cross-project access fails.

### Q3 — linkable assets, catalog, and operator queue

Build the first usable route:

```text
/p/$projectId/link-ops
```

P0 tabs:

1. `Today`
2. `Opportunities`
3. `Catalog`
4. `Placements`
5. `Runs`

P0 functionality:

- register an existing approved owned asset;
- import original catalog entries from JSON/CSV;
- run eligibility checks;
- view evidence and score components;
- approve, reject, defer, or request research;
- record a manual submission/action;
- show no more than three recommended actions on `Today`;
- show blockers and stale evidence;
- export filtered JSON/CSV with IDs and lineage.

Do not add user onboarding, billing, public marketing, gamification, or a fake DR forecast.

### Q4 — deterministic qualification

Implement the v1 scoring model from `BACKLINK_OPS_V1.md` as pure, versioned functions.

Required behavior:

- missing evidence remains unknown and does not silently become zero or success;
- hard gates run before scoring;
- penalties are visible and evidence-linked;
- provider rank/spam/authority metrics are bounded inputs, not the score itself;
- re-scoring creates a new snapshot;
- identical evidence and config yield identical results in both database modes;
- direct conflicts, manipulative payment requirements, excessive reciprocal requirements, severe spam evidence, duplicate live placements, and missing provenance fail closed.

### Q5 — bounded discovery

Reuse existing OpenSEO/DataForSEO code paths. Do not create a second API client or credential path.

Implement, in this order:

1. clean-room catalog eligibility;
2. lost/broken backlink recovery from existing backlink rows;
3. bounded competitor gap;
4. SERP resource/list prospecting through existing tools and the link-prospecting skill.

Default canary limits:

```text
competitors per run: 3
rows per competitor: 100
new promoted opportunities per run: 25
hard provider budget per run: configuration required
```

Every discovery run records:

- idempotency key;
- project, assets, providers, endpoints, and query inputs;
- cache usage;
- estimated/actual cost where available;
- raw result artifact reference/hash when retention is permitted;
- normalized candidate count;
- rejected/deduplicated/promoted counts;
- error and retry state.

No raw provider payload becomes a PageSpace or Reverie record.

### Q6 — HTML placement verification

Implement a bounded `HtmlLinkVerifier` using existing fetch/HTML libraries where suitable.

Observe:

- HTTP status and redirect chain;
- final URL;
- canonical link;
- robots meta and `X-Robots-Tag`;
- normalized target href matches;
- anchor text;
- rel attributes;
- visible-content placement versus clearly non-content/hidden markup;
- content hash and first/last observation.

Required fixtures:

- live dofollow link;
- `nofollow`;
- `sponsored`;
- `ugc`;
- multiple rel values;
- relative target URL;
- redirect to canonical source;
- canonical mismatch;
- meta noindex;
- `X-Robots-Tag: noindex`;
- source 404/410/5xx;
- missing link;
- changed target;
- duplicate anchors;
- malformed HTML;
- fetch timeout/block.

Verdicts must distinguish `live`, `live_qualified`, `target_mismatch`, `missing`, `source_unreachable`, `blocked`, `lost`, and `unknown`.

Do not label a third-party page `indexed` from reachability. Search visibility or DataForSEO discovery remains a separate low-confidence/provider observation.

### Q7 — scheduler, outcomes, and canary

Use durable database run rows and the existing scheduled Worker surface. Do not add Redis, Temporal, or a distributed crawler in P0.

Scheduler requirements:

- bounded batches;
- due-at selection;
- per-domain rate limiting and jitter;
- descriptive user agent;
- lease/idempotency protection;
- retry count, backoff, next-at, and terminal failure;
- visible queue age and failure health;
- no bypass of auth, CAPTCHA, robots restrictions, or blocks.

Outcome snapshots may attach:

- existing DataForSEO backlink/referring-domain observations;
- existing GSC page/query outcomes for the owned target asset;
- referral/conversion metrics only when the project provides a legitimate source;
- Constellation citation observations;
- cost and operator-time estimates.

Store attribution confidence and limitations. A placement followed by a ranking change is not automatically the reason for it. SEO has already suffered enough from astrology with spreadsheets.

Run the OnFarmCompost canary with:

- one project;
- no more than three existing approved assets;
- 25 independently researched catalog candidates;
- one bounded competitor-gap run;
- one weekly review queue;
- no automated sending;
- no new content URL until existing-page fit is checked.

## Configuration

Add typed environment/config handling with safe defaults:

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

Missing or invalid cost limits must block paid discovery, not silently remove the budget.

## Integration boundaries

### Constellation

Preserve a service seam that can export a validated `Link Opportunity Envelope v1` and attach a returned review ID. OpenSEO remains canonical.

### Push Indexer

Only an owned asset deployment may reference a Push Indexer job. Add a test that rejects or ignores any attempt to submit the third-party prospect/source URL.

### PageSpace

Provide a PII-minimized mirror/export adapter after canonical CRUD works. Mirror IDs, URLs, score band, state, next action, blocker, due date, and decision summary. Never require PageSpace for Link Ops to function.

### Reverie

Provide an explicit learning-export formatter after an outcome exists. It may describe a reusable pattern or policy change. It must exclude contacts, message bodies, raw HTML, provider payloads, and active task state.

### Gmail

Out of P0. A later slice may create a Gmail draft only after an approved execution event and suppression checks. Do not add send capability during this implementation queue.

## Quality gates

Run the smallest focused tests during development, then the full repository gates before reporting completion:

```bash
pnpm format:check
pnpm types:check
pnpm lint
pnpm test:ci
pnpm build
pnpm ci:check
```

Also run:

- schema parity tests;
- migration tests from every supported prior schema/fixture;
- project authorization tests;
- Link Ops contract/fixture tests;
- state-machine/idempotency tests;
- verifier fixture suite;
- route smoke test;
- export round-trip tests.

Do not deploy or run paid DataForSEO calls merely to make CI look industrious.

## P0 acceptance

P0 is complete only when:

- an existing asset can be registered;
- a catalog import is idempotent;
- opportunities deduplicate with provenance intact;
- scores are deterministic, versioned, and evidence-linked;
- human decisions and manual execution records are durable;
- verifier fixtures pass;
- scheduled rechecks do not duplicate work;
- project isolation holds;
- JSON/CSV exports retain lineage;
- no auth/billing/public SaaS schema was added;
- no automated send or form submission exists;
- no third-party URL is routed to Push Indexer;
- no raw prospect PII is exported to PageSpace or Reverie;
- one OnFarmCompost canary opportunity reaches a verified placement or a truthful terminal failure with complete evidence.

## Stop rules

Stop and report rather than improvising when:

- an existing DataForSEO endpoint/client cannot provide the required data without a new paid-provider decision;
- exact opportunity identity cannot be made deterministic;
- a schema shortcut would put relational state into opaque JSON;
- a third-party index verdict would require pretending public search observations equal Search Console evidence;
- sending, form automation, CAPTCHA bypass, or authenticated scraping becomes necessary;
- implementation would copy Backl.io's private catalog or authenticated behavior;
- a change touches `.agents/skills/**`, `.greptile/**`, `CLAUDE.md`, `AGENTS.md`, or `.github/**` without explicit maintainer review;
- a proposed feature adds public SaaS, billing, or multi-user scope before the canary loop closes.

## Handoff report

Report:

- queue items completed;
- files and migrations changed;
- state/schema/version decisions;
- tests and exact results;
- provider calls and cost;
- canary records and evidence;
- unresolved unknowns;
- delta from this contract;
- whether the complete asset-to-outcome loop actually closed.

Do not call the system complete because the route renders. A dashboard is not a backlink, despite the sincere hopes of product managers everywhere.
