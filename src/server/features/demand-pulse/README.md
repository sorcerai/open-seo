# Demand Pulse Phase 0 contracts

This folder is an additive, feature-flagged foundation for OpenSEO Demand Pulse.
It intentionally does **not** register routes, mutate the production schema, or
add navigation. Those seams must be wired after the fork is synced with current
upstream so the implementation follows the repository's actual registries and
migration sequence.

Included:

- Canonical demand observation, prompt-family, action, and scoring types.
- Deterministic scoring with versioned weights and explicit penalties.
- URL/text normalization, duplicate detection, and cross-post preservation.
- Source-adapter interface with bounded concurrency.
- Working Hacker News source adapter using the public Firebase API.
- First-party import normalizer.
- DataForSEO `discussions_and_forums` normalizer that reuses OpenSEO's existing
  transport/billing/cache layer instead of inventing a second one.
- Retention profiles, including a strict Reddit override.
- Zod MCP input contracts and tests.

## Required integration after upstream sync

1. Add D1/Drizzle tables from `docs/demand-pulse/REFERENCE_SCHEMA.sql` using the
   next repository migration number.
2. Implement repositories/services around the current OpenSEO database layer.
3. Connect DataForSEO SERP transport to the normalizer.
4. Register read-only MCP tools first.
5. Add scheduled Workflows behind per-project locks and source budgets.
6. Add a hidden route and enable it only for the canary project.
7. Keep all write/promote/dismiss actions behind explicit confirmation.

## Feature flags

All default to safe/off:

```env
DEMAND_PULSE_ENABLED=false
DEMAND_PULSE_WRITE_ENABLED=false
DEMAND_PULSE_DRY_RUN=true
DEMAND_PULSE_SOURCE_DATAFORSEO_DISCUSSIONS=false
DEMAND_PULSE_SOURCE_HACKER_NEWS=false
DEMAND_PULSE_SOURCE_FIRST_PARTY_IMPORT=false
DEMAND_PULSE_SOURCE_REDDIT=false
```
