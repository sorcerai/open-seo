# OnFarmCompost Demand Pulse Canary

**Status:** implementation handoff
**Mode:** dry-run only
**Publication:** manual only
**Timezone:** America/Chicago
**Project owners:** Aria and Scotty

## 1. Purpose

OnFarmCompost is the first internal project canary for OpenSEO Demand Pulse.

The canary must prove that Demand Pulse can turn observed evidence into a small number of useful actions without creating thin content, compliance debt, source-policy violations, or an unmanageable review queue.

The objective is not daily article production. The objective is daily evidence collection and disciplined action selection.

```text
collect
-> normalize
-> deduplicate
-> cluster
-> corroborate
-> compare with existing coverage
-> select the best action
-> review
-> implement manually
-> measure outcomes
```

## 2. Canonical cross-repository contract

The canonical project policy and seed configuration live in the OnFarmCompost repository at commit:

`4d436f12ab2853410e1f4930f4cb0ee3b82cad93`

Files:

- `docs/CONTENT_INTELLIGENCE_OS.md`
- `ops/content-intelligence/onfarmcompost-canary.seed.json`

Tracking:

- OnFarmCompost issue `#10`: Demand Pulse canary implementation
- OnFarmCompost issue `#14`: public-claim ledger and CI regression gate

The JSON file beside this runbook is a bridge manifest. It points to the canonical contract and records OpenSEO implementation state. It is not consumed by production code.

Do not fork the project policy into a second independently edited configuration. The site repository owns market, editorial, claim, and publishing decisions. OpenSEO owns acquisition, normalization, provenance, source health, cost controls, and evidence artifacts.

## 3. Current OpenSEO baseline

Demand Pulse Phase 0 introduced additive contracts for:

- evidence and source types
- scoring vectors
- duplicate handling
- retention and deletion policy
- feature flags
- MCP shapes
- initial DataForSEO discussion, Hacker News, and manual first-party adapters

Phase 0 deliberately did not wire routes, schedules, persistence migrations, navigation, or a live project.

The OnFarmCompost work begins from that boundary. Do not report the canary as operational until a scheduler has completed a real dry run and persisted its evidence artifact.

## 4. Canary boundaries

### Primary market

- Houston, Texas
- Harris County, Texas
- Fort Bend County, Texas

### Secondary market

- Southeast Texas
- Texas, when a state rule, program, market event, research finding, or farm-operating issue materially affects the primary market

### Primary problem territory

- commercial food-waste pickup
- restaurant, office, cafeteria, grocer, caterer, brewery, and food-producer waste operations
- food-waste measurement and diversion reporting
- contamination, odor, pests, liners, containers, pickup reliability, and staff workflow
- Houston-area providers, programs, events, and service changes
- Texas composting rules and authoritative guidance
- on-farm composting, feedstock management, carbon sources, runoff, heat, rainfall, storms, and soil use
- route fit, route density, price, objections, conversion, and retention

### Exclusions

- generic gardening content without local, commercial, or farm-operating relevance
- residential-pickup lead generation for OnFarmCompost
- generated facts, invented benchmarks, or synthetic customer stories
- legal advice or automatic permit determinations
- auto-publishing
- new location pages created solely to occupy search results

## 5. Source rollout

### Enabled for the first seven runs

#### Google Search Console

Use query-to-page relationships, not isolated keyword rows.

Required outputs:

- newly observed non-branded queries
- query families gaining or losing impressions
- pages receiving mismatched intent
- pages with impressions but weak clicks
- questions that already have a canonical answer but need better evidence or formatting

#### DataForSEO

Use existing OpenSEO authentication, budgeting, cache, and failure handling.

Initial surfaces:

- organic search results
- People Also Ask
- related queries
- trend corroboration
- `discussions_and_forums`
- official-source and provider discovery

DataForSEO discussion results are discovery evidence. They do not automatically grant permission to fetch, retain, or republish content from the destination domain.

#### Manual first-party import

Accepted input classes:

- waste-audit notes
- measured drum weights
- contamination observations
- customer and prospect questions
- sales objections
- won and lost reasons
- route-fit and no-fit reasons
- support and service issues
- operator field notes
- anonymized monthly diversion records

Requirements:

- redact unnecessary personal information
- preserve a stable internal record identifier
- label whether the language is verbatim or summarized
- preserve event date, import date, owner, consent or internal-use basis, and retention class
- do not expose customer-identifying language in a public recommendation

#### Official-source monitoring

Initial official source families:

- TCEQ composting, waste, air, water, storage, nuisance, and reporting guidance
- Texas statutes and agency notices
- City of Houston programs, provider pages, public data, agendas, and announcements
- Harris County and Fort Bend County pages
- EPA Sustainable Management of Food and measurement guidance
- USDA and NRCS Texas conservation resources
- Texas A&M AgriLife Extension

Store the source URL, publication or modification date when available, fetch date, content fingerprint, change summary, and affected problem families.

#### Local news and trade discovery

Use local and trade coverage to detect events, partnerships, provider changes, programs, enforcement, grants, facilities, education, and public-interest questions.

Resolve the original source. Three articles copied from one press release are one event.

### Disabled for the first seven runs

#### Reddit

Reddit remains disabled until all of these are approved:

- current commercial-use terms
- project use case
- minimal-retention design
- deletion propagation
- user and post identifier handling
- privacy controls
- quotation and publication policy
- adapter budget, backoff, and failure behavior

Possessing an API key does not satisfy these gates.

#### YouTube comments

Disabled until the official API integration includes quota budgeting, deletion handling, channel and query scope, provenance, and retention rules.

#### Restricted social platforms

Do not scrape private Facebook Groups, LinkedIn, Instagram, Threads, TikTok, X, Quora, or other authenticated or restricted surfaces. Use official or licensed access only when a later source policy explicitly permits the project use.

## 6. Acquisition schedule and budget

Schedule the canary once daily at `05:00` America/Chicago.

Comparison windows:

- 1 day
- 7 days
- 30 days
- 90 days
- 365 days

Initial DataForSEO ceiling:

- USD 1.00 per day
- configurable per environment
- stop nonessential acquisition when reached
- preserve source-health and cost reporting even when acquisition stops
- cache unchanged official pages

A failed source must remain a failure or unknown. It must never become a positive observation or silent zero.

## 7. Evidence contract

Every observation must preserve:

- observation ID
- project ID
- source ID
- source class
- canonical URL or first-party record ID
- author or publisher where appropriate
- published time when known
- observed time
- fetched time
- geography
- entities
- exact observed language or bounded excerpt
- normalized problem, question, comparison, objection, failure, or event type
- engagement vector when available
- source capability and access policy
- retention and deletion policy
- provenance chain
- raw artifact pointer when retention permits

Evidence classes must remain distinct:

- first-party observed
- primary authoritative
- search observed
- community observed
- market-event observed
- AI-surface observed
- generated candidate

Generated candidates may improve recall. They cannot promote themselves.

## 8. Deduplication and independence

The canary must resolve:

- syndication
- reposts
- press-release copies
- cross-posted community discussions
- copied questions
- repeated observations from one customer or account
- URL variants and canonical redirects
- semantically near-identical query forms

Each candidate card must report both:

- raw observation count
- independent evidence-event count

Corroboration uses independent evidence events and evidence classes. It must not use raw copy count.

## 9. Problem-family clustering

Cluster into durable user jobs and decisions rather than one family per keyword.

Initial families are defined in the canonical seed. Examples include:

- restaurant food-waste pickup cost
- commercial compost service comparison
- accepted materials and contamination
- odor and pest containment
- staff separation workflow
- diversion reporting and environmental claims
- Texas compost notification, registration, permit, and exemption questions
- on-farm feedstock and carbon planning
- Gulf Coast heat, rain, storm, runoff, and storage operations
- farm soil baseline and compost-use measurement
- local programs, events, partnerships, and provider changes

The clustering output must retain every supporting observation and the exact user language that led to the family.

## 10. Existing-coverage gate

Before recommending a new URL, inspect the OnFarmCompost inventory and identify:

- current canonical page
- query and intent overlap
- content quality
- source quality
- freshness class
- conversion role
- internal-link position
- AI and search visibility
- missing evidence, example, tool, workflow, or decision aid
- cannibalization risk

Prefer these actions in order when they solve the user job:

1. correct a risky claim
2. update an existing canonical page
3. add a concise FAQ or direct-answer block
4. add a source, example, field note, table, or downloadable asset
5. create a citation or outreach task
6. improve a service, sales, reporting, or support workflow
7. monitor for corroboration
8. create a new resource only when a distinct intent remains

## 11. Scoring and penalties

Use the canonical seed's 100-point positive vector:

- Houston or Texas relevance: 20
- independent corroboration: 20
- freshness and velocity: 15
- buyer or farmer usefulness: 15
- coverage gap: 10
- citation potential: 10
- commercial value: 10

Apply explicit penalties:

- legal, regulatory, health, or safety uncertainty: -30
- weak provenance or one unverified source: -20
- cannibalization risk: -20
- no original contribution: -10
- unowned maintenance burden: -10
- vanity engagement: -15

Thresholds:

- 75 to 100: priority action brief
- 60 to 74: existing-page update, asset, or further research
- 45 to 59: monitor and seek corroboration
- below 45: reject or archive

A high score never bypasses compliance review.

## 12. Candidate-card contract

No run may return more than five candidate cards.

Each card must contain:

```json
{
  "familyId": "string",
  "title": "string",
  "whyNow": "string",
  "observedLanguage": ["string"],
  "evidence": [
    {
      "sourceClass": "string",
      "urlOrRecordId": "string",
      "publishedAt": "ISO-8601|null",
      "observedAt": "ISO-8601",
      "independentEvidenceId": "string"
    }
  ],
  "scoreVector": {},
  "penalties": {},
  "existingCoverage": [],
  "recommendedAction": "string",
  "riskFlags": [],
  "owner": "string",
  "reviewBy": "YYYY-MM-DD"
}
```

Allowed actions:

- update existing page
- add FAQ
- create dated data note
- create resource page
- create tool
- create template
- create or update directory entry
- create case study or field note
- create outreach or citation task
- change offer or workflow
- monitor
- reject

## 13. Artifact and review sinks

### Evidence artifacts

Store one versioned artifact per run with:

- run ID and timestamps
- source health
- acquisition cost
- source cursors
- observations
- duplicate graph
- problem families
- coverage checks
- scoring version
- candidate cards
- rejected and monitored families
- errors and policy blocks

### Weekly review

Until PageSpace is available:

- create or update one weekly review issue in the OnFarmCompost repository
- do not create one issue per observation
- link the versioned evidence artifacts
- record accepted, rejected, deferred, and requested-research decisions

When PageSpace is restored:

- mirror the bounded candidate queue into one editorial board
- keep canonical evidence and provenance in OpenSEO
- do not move source artifacts into PageSpace

## 14. Publication boundary

OpenSEO does not publish OnFarmCompost content.

A selected action enters the OnFarmCompost review workflow. New public claims must satisfy that repository's claim, source, operator, compliance, and CI gates.

A changed URL reaches Push Indexer only after:

- reviewed content is merged
- the production build passes
- Cloudflare deployment is verified
- live HTML matches the merged commit

URL submission is not evidence that a page is useful, safe, or indexable.

## 15. First seven-run acceptance gate

The canary passes only when:

- seven consecutive scheduled dry runs complete
- zero content is auto-published
- no run emits more than five cards
- every card preserves provenance
- every card includes an existing-coverage check
- syndicated or copied sources do not inflate corroboration
- failed or uncertain acquisition cannot become a positive signal
- at least one accepted action updates an existing page
- at least one accepted action is non-content
- cost per accepted action is reported
- operator review decisions are recorded
- outcomes can later be joined to citations, impressions, clicks, qualified leads, corrections, and revenue

The canary does not pass merely because the scheduler ran seven times.

## 16. Implementation work order

### Phase A: registration and validation

- [ ] Add an internal project registry entry that references the canonical seed.
- [ ] Validate the seed schema without copying project policy into OpenSEO.
- [ ] Add source and feature flags scoped to `onfarmcompost`.
- [ ] Confirm dry-run and auto-publish false at the last execution boundary.
- [ ] Add a USD 1.00 daily vendor ceiling.
- [ ] Add tests for disabled sources and fail-closed acquisition.

### Phase B: enabled acquisition

- [ ] Read GSC query and page data.
- [ ] Run bounded DataForSEO family discovery.
- [ ] Import a redacted first-party fixture.
- [ ] Monitor and fingerprint official pages.
- [ ] Discover local news and resolve original sources.
- [ ] Emit source-health and cost summaries.

### Phase C: evidence processing

- [ ] Normalize the observation contract.
- [ ] Resolve canonical URLs and duplicates.
- [ ] calculate independent evidence-event IDs.
- [ ] Cluster the canonical problem families.
- [ ] Apply coverage checks against the OnFarmCompost inventory.
- [ ] Apply scoring and penalties.
- [ ] Emit no more than five cards.

### Phase D: sinks and review

- [ ] Persist one versioned dry-run artifact.
- [ ] Update one weekly OnFarmCompost review issue.
- [ ] Record human decisions and reasons.
- [ ] Keep PageSpace mirroring disabled until the connector is available.

### Phase E: seven-run review

- [ ] Complete seven consecutive runs.
- [ ] Calculate cost per accepted action.
- [ ] Inspect false positives and missed signals.
- [ ] Confirm at least one existing-page and one non-content win.
- [ ] Decide whether any source family should expand.
- [ ] Keep Reddit disabled unless its separate policy gate passes.

## 17. Commercialization gate

Do not generalize or sell Demand Pulse from this canary until it demonstrates measurable internal value.

Minimum evidence for a reusable product:

- accepted recommendations materially outperform rejected or random candidates
- bounded review load remains sustainable
- source failures and policy blocks are visible
- provenance survives every transform
- existing-page updates are surfaced before new URLs
- at least one authority, search, lead, retention, or revenue outcome can be attributed to an accepted action
- no material privacy, source-policy, legal, or claim-quality incident occurs

Only then extract project-independent configuration, onboarding, billing, support, and source-policy workflows.
