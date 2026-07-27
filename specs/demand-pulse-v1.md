# Specification — Demand Pulse v1 and Owned Attention handoff

## Status

**Implemented canary; operational validation pending.**

The OnFarmCompost vertical slice is on `main` after PR #6. The normalized schemas, repositories, scheduled acquisition, evidence processing, coverage checks, deterministic scoring, bounded review feed, decisions, hidden UI, and read-only MCP surfaces exist.

Demand Pulse is **not** yet a generalized multi-project product. The seven-run usefulness gate remains the release boundary.

## Objective

Prove that OpenSEO can turn bounded, source-labeled evidence into a small, project-tailored queue of useful actions without:

- auto-publishing;
- hiding source failures;
- inflating corroboration with duplicates or syndication;
- treating generated prompts as observed demand;
- inventing coverage certainty;
- creating an unbounded review queue;
- or optimizing traffic before proving user and business value.

OnFarmCompost remains the first configured instance.

## Invariants

1. Evidence classes remain distinct throughout acquisition, scoring, display, export, and outcome learning.
2. Generated candidates cannot self-promote.
3. Duplicate observations and independent evidence events are separate relations.
4. Failed, blocked, or uncertain acquisition remains explicit and never becomes zero.
5. Every feed item traces to a versioned run, evidence graph, coverage check, score, and selection version.
6. Sources require project-owner approval before collection.
7. Feature and source flags default off; dry-run defaults on.
8. No run emits more than five feed items.
9. OpenSEO never publishes project content.
10. Reddit and restricted social sources remain disabled until approved.
11. Queryable relationships stay normalized; JSON is limited to bounded versioned snapshots.
12. SQLite and Postgres behavior remain compatible.
13. Human review decisions never imply publication.
14. Downstream systems must return outcomes against the original action lineage.

## Current architecture

```text
project profile and approved source registry
  -> scheduled safety, cost, and idempotency gates
  -> independent source acquisition
  -> source-run health and observation persistence
  -> exact/URL/syndication/semantic duplicate resolution
  -> independent evidence-event graph
  -> configured problem-family mapping
  -> existing-page coverage evaluation
  -> versioned scoring and penalties
  -> bounded feed selection
  -> hidden UI and read-only MCP
  -> human review decision
```

### Implemented records

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

## Acquisition boundary

The canary supports approved, bounded acquisition through:

- official-page monitoring;
- GSC query-to-page evidence;
- DataForSEO discussion/forum evidence;
- redacted first-party imports;
- Hacker News;
- local-news discovery with original-source resolution.

Every adapter reports:

- source identity and class;
- approval/policy state;
- health;
- requests and cost;
- cursor;
- bounded observations;
- warnings and explicit errors;
- raw artifact pointers only where retention permits.

A source flag being available is not approval to turn it on.

## Processing boundary

Normalization preserves source class, bounded observed language, locale, geography, timestamps, provenance, retention metadata, and allowed artifact pointers.

Deduplication records exact duplicates, URL variants, syndication, copied questions, and semantic near-duplicates. Corroboration counts independent evidence events, not copies.

Coverage evaluation prefers:

1. correcting or updating an existing canonical page;
2. adding a direct answer, FAQ, table, tool, or asset;
3. improving a service, support, or offer workflow;
4. creating a genuinely distinct supporting page;
5. monitoring or rejecting the signal.

A new article is one possible action, not the default output.

## Review boundary

The hidden Demand Pulse surface shows:

- why the item matters now;
- exact observed language;
- evidence classes and independent-event count;
- current coverage;
- score components and penalties;
- recommended action;
- risks and uncertainty;
- source health and acquisition cost;
- exact lineage.

Owners can accept, reject, defer, or request more research. Decisions persist with `publicationTriggered=false`.

Current read-only MCP tools:

- `get_demand_pulse_feed`
- `get_demand_pulse_feed_item`

## Validation gate

The canary must complete seven consecutive scheduled dry runs and review:

- source health and cost;
- false positives;
- missed demand;
- duplicate/corroboration accuracy;
- coverage accuracy;
- recommendation usefulness;
- accepted versus rejected actions;
- whether any accepted action produced measurable user or business value.

Green code is necessary but does not establish recommendation usefulness.

## v1.1 target: Owned Attention export

After the seven-run gate, an **accepted** feed item may be mapped into a versioned `DemandActionEnvelope`.

The exporter must:

- preserve project, run, evidence, score, selection, family, coverage, and decision lineage;
- expose observed facts separately from generated or inferred fields;
- carry explicit unknowns instead of synthetic defaults;
- include governance flags proving publication is still disallowed;
- support a read-only server/MCP response before any write sink exists;
- never create a page, ticket, video, campaign, or ad configuration by itself.

Canonical design:

- `docs/owned-attention/README.md`
- `docs/owned-attention/DEMAND_ACTION_ENVELOPE_V1.md`
- `docs/owned-attention/demand-action-envelope.v1.schema.json`
- `docs/owned-attention/outcome-envelope.v1.schema.json`
- `docs/owned-attention/AGENT_HANDOFF.md`

## v1.2 target: outcome feedback

One implemented downstream action must return an `OutcomeEnvelope` containing:

- the original action event ID;
- changed or created asset identifiers;
- publication and distribution events;
- traffic and engagement by source;
- citation and AI-visibility changes;
- lead, affiliate, product, sponsorship, or display revenue where applicable;
- production, media, and maintenance cost;
- attribution confidence and limitations;
- quality, correction, policy, and stale-data incidents.

Outcome ingestion must append measurements. It must not rewrite the historical demand evidence or retroactively improve the original score.

## Explicit non-goals

- Automatic publishing.
- Automatic page creation from every signal.
- Cold paid-traffic arbitrage.
- Push-traffic acquisition.
- Unreviewed Reddit ingestion.
- A generalized social-listening SaaS.
- A single magic demand score.
- Treating pageviews as profit.
- Letting downstream agents discard provenance.
- Adding PageSpace or GitHub writes before the read-only export proves useful.

## Verification

For code changes:

```bash
pnpm ci:check
pnpm test:ci
pnpm build
```

Required behavioral tests for the next slice:

1. Only an accepted, lineage-valid feed item can export.
2. Export is read-only and idempotent.
3. Unknown economics and coverage fields remain unknown.
4. Generated evidence cannot masquerade as observed evidence.
5. The envelope validates against the versioned schema.
6. An unauthorized project cannot export another project's action.
7. An outcome cannot attach to an unknown action event.
8. Outcome ingestion appends history and never mutates original evidence.
9. No export or outcome path can trigger publication.
