# Specification — Demand Pulse OnFarmCompost Canary

## Status

Approved design. Implement the full OnFarmCompost dry-run vertical slice before
generalizing Demand Pulse into a reusable product feature.

## Objective

Prove that OpenSEO can turn bounded, source-labeled evidence into a small,
project-tailored feed of useful actions without auto-publishing, hiding source
failures, inflating corroboration, or creating an unbounded review queue.

OnFarmCompost is the first configured instance. Shared code must avoid
hard-coding its market and editorial rules, but self-service onboarding and
multi-project commercialization remain out of scope until the seven-run gate
demonstrates measurable internal value.

## Invariants

1. Evidence classes remain distinct throughout acquisition, scoring, and display.
2. Generated candidates cannot self-promote.
3. Duplicate observations and independent evidence events are separate relations.
4. Failed, blocked, or uncertain acquisition remains explicit and never becomes zero.
5. Every feed item traces to versioned evidence, coverage checks, and scoring inputs.
6. Sources require project-owner approval before collection.
7. Feature and source flags default off; dry-run defaults on.
8. No run emits more than five feed items.
9. OpenSEO never publishes OnFarmCompost content.
10. Reddit and restricted social sources remain disabled.
11. D1 stores queryable relationships; R2 stores bounded versioned artifacts.
12. SQLite and Postgres behavior remain compatible.

## Architecture

Build on `feat/official-source-monitor`. The existing OnFarmCompost official-page
monitor becomes the first acquisition adapter rather than a parallel implementation.

The daily flow is:

1. Resolve the registered OnFarmCompost profile.
2. Enforce dry-run, no-publication, source approval, and daily budget.
3. Acquire enabled source adapters independently.
4. Persist source health and normalized observations.
5. Resolve canonical duplicates and independent evidence events.
6. Map evidence to configured problem families.
7. compare families with the OnFarmCompost content inventory.
8. Apply versioned score components and penalties.
9. Persist at most five feed items.
10. Write one bounded R2 artifact for the run.
11. Expose canonical records through a hidden in-app feed and read-only MCP tools.

No GitHub issue or PageSpace sink is part of this version.

## Tailoring boundary

The reusable core consists of:

- normalized repositories and services
- acquisition adapter interface
- source approval states
- observation and provenance contracts
- duplicate and independence processing
- family mapping and scoring
- coverage-check interface
- feed and review-decision services
- read-only MCP response contracts

OnFarmCompost supplies project-owned configuration for:

- market and geography
- problem-family seeds
- source discovery queries
- adapter permissions
- GSC property
- paid-acquisition budget
- scoring weights and penalties
- retention policy
- coverage inventory
- owners and review cadence

Automatic discovery creates pending source records. A project owner must approve
each source before acquisition. The canonical market/editorial policy remains in
the OnFarmCompost repository; OpenSEO stores its source reference and the
operational configuration needed to execute the canary.

## Data model

Use explicit normalized tables and foreign keys:

- `demand_pulse_profiles`
- `demand_pulse_sources`
- `demand_pulse_runs`
- `demand_pulse_source_runs`
- `demand_pulse_observations`
- `demand_pulse_evidence_events`
- `demand_pulse_observation_events`
- `demand_pulse_duplicate_edges`
- `demand_pulse_families`
- `demand_pulse_family_evidence`
- `demand_pulse_coverage_checks`
- `demand_pulse_scores`
- `demand_pulse_feed_items`
- `demand_pulse_decisions`

Project, source, run, evidence, family, coverage, score, feed, and decision
relationships must not be hidden in JSON columns. JSON is permitted only for
bounded versioned payloads whose internal fields are not relational query keys,
such as immutable score-vector snapshots.

## Acquisition

The first canary supports:

- approved official-source pages
- existing GSC query-to-page evidence
- bounded DataForSEO discovery and corroboration
- redacted manual first-party imports
- local-news discovery with original-source resolution

Every adapter reports source health, policy state, cost, cursor, and explicit
errors. Paid acquisition stops at the configured USD 1.00 daily ceiling while
health reporting and free acquisition continue.

## Processing

Normalization preserves source class, exact bounded observed language,
geography, provenance, retention metadata, and raw-artifact pointer when allowed.

Deduplication records exact duplicates, URL variants, syndication, copied
questions, and semantic near-duplicates. Corroboration counts independent
evidence events, not raw copies.

Family mapping uses the configured OnFarmCompost jobs and decisions. Each family
retains all supporting observations and the language that caused the match.

Coverage checks prefer correcting or updating an existing canonical page,
adding a direct answer or asset, or changing a service/support workflow before
recommending a new URL.

Scoring stores positive components, penalties, scoring version, confidence, and
the resulting action regime. Compliance risk can block promotion regardless of
score.

## Feed and review

The hidden Demand Pulse route presents a project-scoped feed with:

- why the item matters now
- evidence classes and independent-event count
- exact observed language
- existing coverage
- score components and penalties
- recommended action
- risks and uncertainty
- source health and acquisition cost

Owners can accept, reject, defer, or request research and must record a reason.
Decisions never trigger content publication.

Read-only MCP tools expose the same service layer:

- `list_demand_sources`
- `get_demand_pulse`
- `get_prompt_family`
- `get_topic_evidence`
- `get_demand_gaps`

No MCP write tool is included.

## Failure behavior

- One adapter failure does not erase successful evidence from other adapters.
- A failed source run remains visible in D1, the R2 artifact, UI, and MCP.
- Below the minimum healthy-source threshold, the run is incomplete and emits
  no promoted feed items.
- Missing coverage data yields `unknown`, not a clean coverage result.
- Budget exhaustion blocks only additional paid acquisition and is reported.
- Retries preserve idempotency through the daily run key and source-run keys.
- Final execution rechecks dry-run and publication-disabled state.

## Verification

Each vertical slice must prove observable behavior:

1. Schema works on SQLite and Postgres migrations.
2. Pending sources cannot be collected.
3. Paid acquisition stops at the daily ceiling.
4. Source failures survive every transformation and output.
5. Duplicate copies do not inflate independent corroboration.
6. Every feed item contains provenance and a coverage check.
7. No run emits more than five feed items.
8. UI and MCP enforce project authorization and return the same records.
9. Decisions persist without invoking publication.
10. Seven consecutive scheduled dry runs satisfy the canary acceptance gate.

Project gates are `pnpm ci:check`, `pnpm test:ci`, and `pnpm build`, plus a
browser smoke test of source approval, the feed, and review decisions.

## Delivery slices

1. Fix the existing PR #5 baseline lint failure.
2. Add profile/source/run schema and repositories.
3. Add automatic source discovery and approval flow.
4. Persist official-monitor output through the canonical repositories.
5. Add GSC, DataForSEO, first-party, and local-news adapters.
6. Add normalization, duplicate independence, family mapping, and scoring.
7. Add coverage checks and bounded feed generation.
8. Add hidden feed UI and human decisions.
9. Add read-only MCP tools.
10. Run the seven-run canary and review cost, false positives, missed signals,
    accepted actions, and measurable outcomes before any generalization.
