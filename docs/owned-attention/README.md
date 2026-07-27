# Owned Attention Arbitrage

**Status:** cross-repository operating contract, version 0.1  
**Canonical sensing layer:** OpenSEO Demand Pulse  
**First canary:** OnFarmCompost  
**Default mode:** dry-run, human approval required, no auto-publishing, no cold paid traffic

## Definition

Owned Attention Arbitrage means acquiring evidence and producing useful assets at a lower total cost than the durable value created by organic discovery, direct return visits, referrals, citations, leads, affiliate sales, products, sponsorships, or compliant display advertising.

It is not the classic model of buying dubious traffic and hoping ad revenue is larger than the media bill.

The system arbitrages:

- slow keyword tools versus live observed demand;
- scattered questions versus a structured evidence graph;
- one-off content production versus reusable briefs and artifacts;
- rented reach versus owned search, email, direct, social, and referral distribution;
- raw traffic versus page-level contribution profit and authority.

## Flywheel

```text
1. SNIFF
   OpenSEO collects approved demand evidence and source health.

2. CORROBORATE
   Duplicate copies collapse; independent evidence survives.

3. DECIDE
   Constellation verifies the problem family, current coverage, citation opportunity,
   competing pages, business value, and correct action.

4. APPROVE
   A human accepts, rejects, defers, or requests research.

5. PRODUCE
   The project repository implements the approved page, tool, offer, support change,
   data asset, or other bounded artifact.

6. DISTRIBUTE
   MotionPress and other owned-channel systems create channel-native derivatives
   from the approved source artifact.

7. MONETIZE
   A downstream yield router chooses the least-destructive suitable route:
   lead, product, affiliate, sponsorship, display, or no monetization.

8. MEASURE
   Traffic, citations, leads, revenue, cost, corrections, and maintenance return
   against the original action lineage.

9. LEARN
   OpenSEO and Constellation compare expected versus observed outcomes before
   promoting adjacent demand.
```

## Repository ownership

| System                     | Owns                                                                                                                                                             | Must not own                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **OpenSEO Demand Pulse**   | Source acquisition, source health, observations, provenance, dedupe, independent evidence, problem-family feed, initial coverage and score lineage               | Publishing, creative production, ad placement, final business claims                                  |
| **Constellation**          | Prompt Demand Graph, prompt-to-page fit, citation/retrieval evidence, competitor and coverage analysis, action prioritization, stability, outcome interpretation | Raw unrestricted social archives, autonomous publishing, anonymous recommendations without lineage    |
| **Project repository**     | Canonical facts, approved content, tools, schemas, tests, deployment, page-level conversion path                                                                 | Market-wide demand collection or cross-project memory                                                 |
| **MotionPress**            | Approved source-to-video planning, storyboard, rendering, editing, QA, channel assets                                                                            | Topic discovery without an approved brief, factual invention, replacing the canonical source artifact |
| **Publisher Yield Router** | Page-level monetization policy, display/affiliate/lead/product/sponsor routing, experiments, revenue and cost ledger                                             | Choosing what deserves to exist, overriding trust or conversion-critical boundaries                   |
| **Push Indexer**           | Submitting changed canonical URLs after deployment                                                                                                               | Topic discovery, content creation, ranking guarantees                                                 |
| **PageSpace**              | Human queue, approvals, owners, calendar, decision mirror when available                                                                                         | Canonical evidence or transactional state                                                             |
| **Reverie**                | Approved durable lessons, failures, policy changes, reusable decisions                                                                                           | Raw prospect PII, raw community archives, task tracking, canonical metrics                            |

## One lineage, many artifacts

The durable unit is not a keyword or a post. It is a versioned problem/decision family and its action lineage.

```text
observation
  -> evidence event
  -> problem family
  -> coverage check
  -> scored feed item
  -> human decision
  -> DemandActionEnvelope
  -> production artifacts
  -> publication/distribution events
  -> OutcomeEnvelope[]
```

No downstream agent may strip the original project, run, evidence, selection, score, coverage, and decision identifiers.

## Correct action taxonomy

A promoted signal must resolve to one primary action:

- `update_existing_page`
- `add_faq_or_direct_answer`
- `create_supporting_page`
- `create_comparison`
- `create_tool`
- `create_troubleshooter`
- `create_data_asset`
- `create_video`
- `create_sales_enablement`
- `update_offer_or_product`
- `create_support_article`
- `request_partnership_or_citation`
- `monitor_only`
- `reject`

A content format is an implementation detail, not the strategy.

## Traffic sniffing, not traffic worship

The system observes:

- new and changing GSC queries;
- query-to-page mismatches;
- official-source changes;
- first-party questions and objections;
- forum and discussion evidence through approved sources;
- local-news and market events;
- competitor and citation-source changes;
- direct, email, referral, social, and search return patterns;
- page-level revenue and cost outcomes.

Traffic is diagnostic. The decision metric is contribution and durable authority by problem family.

## Monetization routing

Every page or asset receives one route or an explicit combination:

| Route               | Best fit                                          | Primary risk                                              |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Lead generation     | High-intent service and consultation pages        | Ads or exits reducing conversion                          |
| Affiliate           | Product selection, compatibility, and comparison  | Trust erosion and merchant dependence                     |
| Paid product/report | Reusable decision tools and operational templates | Support burden and weak willingness to pay                |
| Sponsorship         | Trusted recurring data or niche media assets      | Hidden influence over rankings or claims                  |
| Display             | Broad informational and repeat-use utility pages  | UX, policy, RPM, and traffic-quality risk                 |
| No monetization     | Trust, policy, conversion-critical, or YMYL pages | Forcing monetization where it reduces trust or conversion |

A route can change after outcomes arrive. Historical decisions remain versioned.

## Hard gates

- No automatic publishing.
- No unreviewed source activation.
- No generated prompt may promote itself.
- No new URL before an existing-page and cannibalization check.
- No cold paid traffic before positive organic/owned-session economics are observed.
- No push traffic in the initial system.
- No display ads on conversion-critical or high-risk pages by default.
- No outcome claim without an attribution confidence and limitation.
- No fleet expansion before one canary completes the sensing-to-outcome loop.

## First canary

OnFarmCompost proves the loop:

```text
daily bounded collection
  -> weekly review
  -> one accepted existing-page action
  -> one accepted original resource/tool action
  -> manual implementation and deployment
  -> owned distribution
  -> measured citations, qualified demand, cost, and maintenance
```

The first success condition is one complete, trustworthy loop that another project can reuse without inventing missing evidence.

## Canonical contracts

- [`DEMAND_ACTION_ENVELOPE_V1.md`](DEMAND_ACTION_ENVELOPE_V1.md)
- [`demand-action-envelope.v1.schema.json`](demand-action-envelope.v1.schema.json)
- [`outcome-envelope.v1.schema.json`](outcome-envelope.v1.schema.json)
- [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md)
