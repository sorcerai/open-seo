# DemandActionEnvelope v1

**Schema ID:** `https://sorcerai.dev/schemas/owned-attention/demand-action-envelope.v1.schema.json`  
**Producer:** OpenSEO Demand Pulse  
**Primary consumer:** Constellation  
**Status:** target contract; exporter not yet wired

## Purpose

`DemandActionEnvelope` is the immutable handoff from an accepted Demand Pulse feed item into downstream decision and production systems.

It prevents a downstream agent from receiving a vague topic, discarding source and coverage lineage, and expanding it into unsupported content.

The envelope carries:

- what was observed;
- which evidence events are independent;
- what is generated or inferred;
- current page coverage;
- the exact human decision;
- score and uncertainty;
- governance boundaries;
- downstream monetization hypotheses without treating them as proven.

## Export gate

An envelope may be produced only when:

1. the project profile is enabled, dry-run safe, and publication-disabled;
2. the feed item belongs to the requested project;
3. run, evidence, selection, score, coverage, and family lineage match;
4. a human decision exists;
5. the decision is `accept`;
6. the export is read-only and idempotent;
7. no downstream publication is triggered.

Reject, defer, and research decisions remain queryable but are not production envelopes.

## Field rules

### Observed versus inferred

`evidence.observedLanguage` contains bounded language captured from approved sources.

`family.canonicalQuestion`, `family.problemStatement`, `economics`, and recommendations may include normalized or inferred values. Each field must preserve its confidence and may remain `null`.

Generated prompt variants must be labeled `generated` and cannot raise corroboration counts.

### Coverage

Coverage must use one of:

- `answered`
- `partial`
- `buried`
- `outdated`
- `contradicted`
- `missing`
- `unknown`

`unknown` is a valid result. It must not silently become `missing`.

### Recommended action

The action is a proposal, not a publishing command. The accepted action belongs to the human decision record.

### Governance

Every v1 envelope must carry:

```json
{
  "dryRun": true,
  "publicationAllowed": false,
  "autoPublishAllowed": false,
  "paidTrafficAllowed": false
}
```

These values cannot be relaxed by a downstream consumer.

## Example

```json
{
  "schemaVersion": "owned-attention.demand-action.v1",
  "eventId": "2d239177-4d0b-4ecb-a1cf-f8ac4dd2de91",
  "projectId": "project-uuid",
  "generatedAt": "2026-07-27T23:30:00.000Z",
  "producer": {
    "system": "open-seo",
    "repository": "sorcerai/open-seo",
    "commit": "941c615808c3b4c61aa4955b3bf4b9199b5237f7",
    "runId": "run-uuid",
    "evidenceVersion": "demand-pulse-evidence.v1",
    "selectionVersion": "demand-pulse-feed-selection.v1"
  },
  "lineage": {
    "profileId": "profile-uuid",
    "feedItemId": "feed-item-uuid",
    "familyId": "family-uuid",
    "coverageCheckId": "coverage-uuid",
    "scoreId": "score-uuid",
    "decisionId": "decision-uuid"
  },
  "family": {
    "canonicalQuestion": "What does commercial food-waste pickup cost in Houston?",
    "problemStatement": "Houston businesses need to estimate pickup fit and cost without confusing residential drop-off information with commercial service.",
    "intent": "commercial_investigation",
    "funnelStage": "consideration",
    "temporalRegime": "persistent",
    "locale": "en-US",
    "geography": "Greater Houston, Texas"
  },
  "evidence": {
    "independentEventCount": 3,
    "sourceClassCounts": {
      "first_party": 1,
      "official": 1,
      "community": 1,
      "search_observed": 0,
      "generated": 0,
      "other": 0
    },
    "observedLanguage": [
      "bounded exact wording retained under the source policy"
    ],
    "provenanceRefs": ["evidence-event-uuid"],
    "sourceHealth": "healthy",
    "limitations": []
  },
  "coverage": {
    "status": "partial",
    "candidateUrls": ["https://www.onfarmcompost.com/commercial-composting"],
    "reason": "The current page explains the service but does not answer pricing inputs or route-fit constraints.",
    "recommendedAction": "update_existing_page"
  },
  "decision": {
    "kind": "accept",
    "action": "update_existing_page",
    "reason": "Improve the canonical page before considering a new URL.",
    "reviewedBy": "authenticated-reviewer",
    "reviewedAt": "2026-07-27T23:25:00.000Z"
  },
  "economics": {
    "businessValue": "medium",
    "monetizationCandidates": ["lead_generation"],
    "estimatedProductionHours": null,
    "maintenanceRisk": "medium",
    "confidence": "low"
  },
  "governance": {
    "dryRun": true,
    "publicationAllowed": false,
    "autoPublishAllowed": false,
    "paidTrafficAllowed": false,
    "requiresHumanProductionApproval": true
  }
}
```

## Consumer requirements

Constellation must:

- verify the envelope schema and version;
- preserve all lineage;
- compare the family with the current crawl and Prompt Demand Graph;
- distinguish imported observations from generated fan-outs;
- return a decision artifact, not mutate the source envelope;
- refuse to recommend a new page when coverage is unknown;
- expose competing pages, citation sources, stability, business value, and maintenance burden;
- never publish.

Production systems must:

- accept only a Constellation-reviewed and human-approved brief;
- record every created or changed asset;
- preserve source and claim ledgers;
- return one or more `OutcomeEnvelope` records.

## Versioning

Breaking field or semantic changes require a new schema ID and `schemaVersion`.

Adding optional fields is permitted only when older consumers ignore them safely.

Historical envelopes are immutable. Corrections create a superseding envelope linked by `supersedesEventId`; they do not rewrite the original record.
