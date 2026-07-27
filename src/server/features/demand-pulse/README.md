# Demand Pulse

Demand Pulse is OpenSEO's feature-flagged demand-sensing and action-review subsystem.

It collects bounded, source-labeled evidence, preserves source health and provenance, resolves duplicates and independent evidence events, maps observations into durable problem families, compares those families with current site coverage, scores the result, and exposes a maximum of five candidate actions for human review.

It does **not** publish content.

## Current implementation state

Baseline: OpenSEO `main` after PR #6 (`941c615808c3b4c61aa4955b3bf4b9199b5237f7`).

Implemented:

- SQLite and Postgres-compatible normalized schemas and migrations.
- Project-scoped profiles, approved sources, daily runs, source runs, observations, evidence events, duplicate edges, families, coverage checks, scores, feed items, and review decisions.
- Disabled-by-default source adapters and acquisition boundaries for approved official pages, GSC, DataForSEO discussions/forums, first-party imports, Hacker News, and local-news discovery.
- The OnFarmCompost official-source monitor and scheduled daily canary orchestrator.
- Source-health thresholds, daily idempotency, bounded artifacts, cost recording, and failure preservation.
- Deduplication, independent-evidence preservation, family mapping, coverage evaluation, deterministic scoring, and bounded feed selection.
- A hidden project route for the latest review feed and item detail.
- Human decisions: accept, reject, defer, or request more research. A decision never triggers publication.
- Read-only MCP tools:
  - `get_demand_pulse_feed`
  - `get_demand_pulse_feed_item`

Still canary-specific:

- Scheduled execution is gated by `DEMAND_PULSE_CANARY_ONFARMCOMPOST`.
- The project ID is supplied through `DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID`.
- The seven-run usefulness gate has not yet promoted Demand Pulse into a generalized multi-project product.
- No GitHub, PageSpace, publishing, monetization, or distribution sink is wired.

## Safety invariants

1. Feature and source flags default off.
2. Dry-run defaults on.
3. The scheduled canary refuses to run when dry-run is disabled or write mode is enabled.
4. Reddit remains disabled until its terms, commercial-use, retention, and deletion profile is approved.
5. Failed, blocked, skipped, or uncertain acquisition remains explicit. It never becomes zero or a clean pass.
6. Duplicate copies do not inflate independent corroboration.
7. Every feed item keeps exact run, evidence, score, selection, coverage, and provenance lineage.
8. No run emits more than five feed items.
9. A human decision records intent only. `publicationTriggered` remains false.
10. OpenSEO does not create or mutate downstream content.

## Daily canary flow

```text
registered profile
  -> safety and budget gates
  -> independently acquire approved sources
  -> persist source health and normalized observations
  -> resolve duplicates and independent evidence events
  -> map observations into configured problem families
  -> compare each family with current coverage
  -> score with explicit positive components and penalties
  -> persist at most five feed items
  -> write one bounded versioned R2 artifact
  -> expose the same records through UI and read-only MCP
  -> record a human review decision
```

## Feature flags

All defaults remain safe:

```env
DEMAND_PULSE_ENABLED=false
DEMAND_PULSE_WRITE_ENABLED=false
DEMAND_PULSE_DRY_RUN=true
DEMAND_PULSE_SOURCE_DATAFORSEO_DISCUSSIONS=false
DEMAND_PULSE_SOURCE_HACKER_NEWS=false
DEMAND_PULSE_SOURCE_FIRST_PARTY_IMPORT=false
DEMAND_PULSE_SOURCE_OFFICIAL_PAGES=false
DEMAND_PULSE_SOURCE_REDDIT=false
DEMAND_PULSE_CANARY_ONFARMCOMPOST=false
```

The OnFarmCompost scheduled canary also requires:

```env
DEMAND_PULSE_ONFARMCOMPOST_PROJECT_ID=<registered-project-uuid>
```

Do not enable Reddit as part of the canary.

## Owned Attention handoff

Demand Pulse is the sensing layer of the broader Owned Attention system:

```text
OpenSEO Demand Pulse
  -> Constellation decision and coverage intelligence
  -> approved content or product brief
  -> project repository implementation
  -> MotionPress and other owned distribution
  -> monetization routing
  -> traffic, revenue, citation, lead, and quality outcomes
  -> OpenSEO and Constellation learning loop
```

Canonical design material:

- [`docs/owned-attention/README.md`](../../../../docs/owned-attention/README.md)
- [`docs/owned-attention/DEMAND_ACTION_ENVELOPE_V1.md`](../../../../docs/owned-attention/DEMAND_ACTION_ENVELOPE_V1.md)
- [`docs/owned-attention/demand-action-envelope.v1.schema.json`](../../../../docs/owned-attention/demand-action-envelope.v1.schema.json)
- [`docs/owned-attention/outcome-envelope.v1.schema.json`](../../../../docs/owned-attention/outcome-envelope.v1.schema.json)
- [`docs/owned-attention/AGENT_HANDOFF.md`](../../../../docs/owned-attention/AGENT_HANDOFF.md)

These contracts are design targets. The exporter, Constellation importer, downstream production sink, and outcome ingestion are not yet wired.

## Next implementation gate

Do not generalize the product because the code exists. Generalize only after the OnFarmCompost canary proves that the review feed is useful.

Required next sequence:

1. Complete seven consecutive scheduled dry runs.
2. Review false positives, missed demand, source health, cost, accepted actions, and rejected noise.
3. Freeze the first `DemandActionEnvelope` mapping from an accepted feed item.
4. Add a read-only export service and MCP surface.
5. Add a Constellation importer that preserves the original lineage rather than re-scoring anonymous prose.
6. Add outcome ingestion after one approved action is implemented and measured.
7. Only then generalize project onboarding and optional review sinks.

## Verification

For code changes:

```bash
pnpm ci:check
pnpm test:ci
pnpm build
```

Also smoke-test:

- authorized project feed access;
- unauthorized project rejection;
- exact feed-item lineage lookup;
- review decision recording with `publicationTriggered=false`;
- scheduled canary fail-closed behavior;
- bounded feed size;
- artifact and database lineage parity.

A daily JSON artifact proves collection ran. It does not prove that a recommendation is useful or that a new page deserves to exist.
