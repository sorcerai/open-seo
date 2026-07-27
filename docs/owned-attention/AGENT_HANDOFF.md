# Agent handoff — Owned Attention phase 1

## Mission

Implement the smallest trustworthy bridge from an **accepted** OpenSEO Demand Pulse feed item to a versioned `DemandActionEnvelope`.

Do not build the publisher, video generator, ad stack, PageSpace sink, or generalized SaaS in this slice.

## Baseline

Start from OpenSEO `main` at or after:

```text
941c615808c3b4c61aa4955b3bf4b9199b5237f7
```

Read in order:

1. `CLAUDE.md`
2. `specs/demand-pulse-v1.md`
3. `src/server/features/demand-pulse/README.md`
4. `docs/owned-attention/README.md`
5. `docs/owned-attention/DEMAND_ACTION_ENVELOPE_V1.md`
6. `docs/owned-attention/demand-action-envelope.v1.schema.json`
7. `docs/owned-attention/outcome-envelope.v1.schema.json`
8. Existing Demand Pulse service, repository, schemas, server functions, MCP tools, and tests.

Search for existing helpers before adding abstractions. The repository already has project auth, service/repository boundaries, Zod schemas, MCP formatters, normalized lineage, and SQLite/Postgres parity tests.

## First implementation slice

### Contract

Add an idiomatic TypeScript/Zod representation of `DemandActionEnvelope v1`.

The JSON Schema in `docs/owned-attention/` is the interoperability contract. The runtime Zod schema must match it and must reject unknown enum values, malformed lineage, unsafe governance flags, and blank identifiers.

### Service

Add a read-only service function that:

1. resolves the authorized project profile;
2. loads the exact feed item and lineage;
3. verifies an `accept` decision exists;
4. maps observed, normalized, inferred, and unknown fields without fabricating defaults;
5. builds a stable event ID from immutable lineage or stores an explicit export record if the repository design requires it;
6. returns the same envelope on repeat reads;
7. never writes a downstream task or publication event.

Prefer the existing TanStack server function → service → repository shape.

### MCP

Add one read-only MCP tool:

```text
export_demand_action
```

Input must include the exact project and feed-item lineage. Output must contain the validated envelope and project metadata.

Annotations:

```text
readOnlyHint: true
destructiveHint: false
openWorldHint: false
```

Do not add a write MCP tool.

### Tests

Minimum behavioral coverage:

- accepted item exports;
- rejected, deferred, and research items do not export;
- missing decision does not export;
- lineage mismatch fails closed;
- unauthorized project access fails;
- unknown coverage stays `unknown`;
- missing economics stays `null`, not zero;
- generated evidence remains labeled and does not inflate independent counts;
- governance flags are always the safe v1 values;
- repeat reads are stable;
- response validates against the runtime schema;
- no publication or downstream write occurs;
- SQLite and Postgres schema parity remains green if persistence changes.

## Second implementation slice

After the read-only export is proven, add an append-only outcome ingestion contract behind explicit authorization.

Do not begin this slice until one real downstream action has an approved implementation plan.

Outcome ingestion must:

- attach to an existing action event;
- append measurements by window and source;
- record cost and attribution confidence;
- preserve corrections and incidents;
- never rewrite the original evidence, score, decision, or envelope;
- reject anonymous or cross-project outcomes.

## Explicit stop rules

Stop and report rather than improvising when:

- the current decision repository cannot identify the accepted decision deterministically;
- a required value exists only inside unversioned prose;
- coverage or economics would need a synthetic default;
- exporter idempotency would require a schema decision not represented here;
- an implementation would touch `.agents/skills/**`, `.greptile/**`, `CLAUDE.md`, `AGENTS.md`, or `.github/**` without explicit maintainer review;
- any change creates a path to automatic publication.

## Quality gates

```bash
pnpm ci:check
pnpm test:ci
pnpm build
```

Also inspect the generated route/MCP registration and run the project authorization tests.

## Handoff output

Report:

- files changed;
- schema/version decisions;
- tests and results;
- any migration;
- exact remaining unknowns;
- whether the seven-run canary gate has real outcome evidence.

Do not report the flywheel as complete until a real action has produced measured outcomes.
