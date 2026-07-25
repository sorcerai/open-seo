# Specification — Demand Pulse v1

## Status

Accepted architecture; implementation staged behind feature flags after upstream sync.

## Decision

Add Demand Pulse as an additive OpenSEO feature plane. OpenSEO collects and stores
source-labeled observations. Constellation promotes corroborated prompt/problem families,
evaluates page coverage and AI/search evidence, and measures outcomes.

## Invariants

1. Evidence classes never collapse into an unlabeled score.
2. Generated candidates cannot self-promote.
3. Duplicate, cross-post, and independent evidence are distinct relations.
4. Raw engagement is normalized by source/community and time.
5. One discussion never automatically means one new page.
6. Every recommendation traces to evidence, versions, and an action.
7. Source terms, retention, deletion, and commercial status are runtime data.
8. Feature and source flags default off; dry-run defaults on.
9. Existing OpenSEO data contracts and navigation remain unchanged until canary gates pass.
10. Reddit requires a separate compliance-approved source state beyond possessing an API key.

## System boundary

| Plane | Owns |
| --- | --- |
| OpenSEO | connections, adapters, schedules, raw/normalized evidence, D1/R2, source health, cost, UI, MCP |
| Constellation | Prompt Demand Graph, corroboration promotion, coverage, action, AI/search measurement, outcomes |

## MVP adapters

- Manual first-party import.
- Existing GSC data.
- DataForSEO `discussions_and_forums` discovery through current transport.
- Hacker News public API.

Reddit, YouTube, Discourse, Stack Exchange, GitHub, reviews, Bluesky, Mastodon, and event
feeds follow after source policy, quality, and deletion requirements are implemented.

## Storage

Reference schema lives in `docs/demand-pulse/REFERENCE_SCHEMA.sql`. Apply it through the
current upstream Drizzle/migration conventions, never as a standalone production script.

## Score

Store the entire `[0,1]` vector, component contributions, scoring version, priority, and
confidence. Default formula is implemented in `src/server/features/demand-pulse/scoring.ts`.

## Promotion

Default gate requires:

- two independent community sources; or
- community + search; or
- community + first-party; or
- one exceptional first-party signal; or
- human-approved market-event override.

## Initial MCP

Read-only:

- `list_demand_sources`
- `discover_live_questions` (dry-run by default)
- `get_demand_pulse`
- `get_prompt_family`
- `get_topic_evidence`
- `get_demand_gaps`

Write tools follow only after audit/version/confirmation controls exist.

## Rollout

1. Sync fork with upstream main.
2. Create `agent/demand-pulse-v1`.
3. Apply Phase 0 additive commit.
4. Run current lint/typecheck/test suite.
5. Add migration/repositories on a second commit.
6. Canary one project in dry-run/read-only mode.
7. Enable Constellation export after top-20 precision ≥80%.
8. Add Reddit only after current commercial/retention/deletion review passes.
