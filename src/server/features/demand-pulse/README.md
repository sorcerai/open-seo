# Demand Pulse

This folder is an additive, feature-flagged foundation for OpenSEO Demand Pulse.

Phase 0 introduced contracts and source adapters without registering routes, mutating the production schema, or adding navigation. The first executable canary slice now adds a disabled-by-default OnFarmCompost official-page monitor. It uses the existing Worker cron and R2 binding, but it does not register UI routes, migrate D1, cluster evidence, score recommendations, update GitHub, or publish content.

## Included contracts

- Canonical demand observation, prompt-family, action, and scoring types.
- Deterministic scoring with versioned weights and explicit penalties.
- URL/text normalization, duplicate detection, and cross-post preservation.
- Source-adapter interface with bounded concurrency.
- Working Hacker News source adapter using the public Firebase API.
- First-party import normalizer.
- DataForSEO `discussions_and_forums` normalizer that reuses OpenSEO's existing transport, billing, and cache layer instead of inventing a second one.
- Retention profiles, including a strict Reddit override.
- Zod MCP input contracts and tests.

## OnFarmCompost official-page monitor

The monitor is implemented in:

`canaries/onfarmcompost-official-monitor.ts`

When every required flag is enabled, the existing 15-minute Worker cron checks once per America/Chicago calendar day after 05:00 local time. It fetches a bounded set of official pages from TCEQ, the Texas Attorney General, the City of Houston, EPA, USDA NRCS Texas, and Texas A&M AgriLife Extension.

Controls:

- Disabled by default.
- Refuses to run unless dry-run is true and write-enabled is false.
- Uses `Intl.DateTimeFormat` with `America/Chicago`, so daylight-saving changes do not require a UTC cron rewrite.
- Uses the daily R2 artifact key as an idempotency gate.
- Retries on a later cron when fewer than three official sources are healthy.
- Limits each response to 1.5 MB and each request to 15 seconds.
- Rejects redirects outside the requested official host or its parent/subdomain relationship.
- Removes scripts, styles, templates, SVG, and other executable or decorative markup.
- Stores fingerprints, bounded excerpts, headers, source health, and provenance.
- Does not retain full page HTML or text.
- Emits observations only when the normalized page fingerprint changes.
- Emits no candidate cards and exposes `coverage_clustering_scoring_and_review_not_wired` in every artifact.
- Never publishes or changes the OnFarmCompost site.

R2 keys:

```text
demand-pulse/onfarmcompost/state/official-pages.json
demand-pulse/onfarmcompost/runs/YYYY-MM-DD.json
```

## Required flags for the canary

All defaults remain safe and off:

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

To enable only the official-page dry run, set:

```env
DEMAND_PULSE_ENABLED=true
DEMAND_PULSE_DRY_RUN=true
DEMAND_PULSE_WRITE_ENABLED=false
DEMAND_PULSE_SOURCE_OFFICIAL_PAGES=true
DEMAND_PULSE_CANARY_ONFARMCOMPOST=true
```

Do not enable Reddit as part of this change.

## Remaining integration

1. Add D1/Drizzle tables from `docs/demand-pulse/REFERENCE_SCHEMA.sql` using the next repository migration number.
2. Implement repositories and services around the current OpenSEO database layer.
3. Connect GSC and DataForSEO transport to the canary seed families.
4. Add official-page observations to deduplication, clustering, coverage analysis, and scoring.
5. Persist versioned evidence and recommendation entities, not only daily R2 artifacts.
6. Register read-only MCP tools first.
7. Add per-project locks and source budgets for paid acquisition.
8. Add a hidden route and enable it only for the canary project.
9. Update one weekly OnFarmCompost review issue from accepted run artifacts.
10. Keep all write, promote, dismiss, and publish actions behind explicit confirmation.

The official monitor is an acquisition slice, not the completed Demand Pulse product. A daily JSON object is evidence that collection ran. It is not evidence that a recommendation is useful.
