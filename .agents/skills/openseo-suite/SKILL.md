---
name: openseo-suite
description: Use when a user asks OpenSEO to act as an Ahrefs, Semrush, Moz, or all-in-one SEO suite for a broad report spanning multiple areas—competitors/gaps, site health/rank tracking, backlinks/lost links, local visibility, or dashboard/search visibility—or an Ahrefs/Semrush-style domain overview, organic traffic, or keyword footprint. Also use for multi-workflow OpenSEO MCP briefs needing a project-aware route. Do not use for other narrow single-workflow requests when an existing OpenSEO skill owns the task; use its focused workflow instead.
---

# Operate OpenSEO as an SEO Suite

Translate suite terms to bounded evidence; distinguish native, derived, dashboard, and public-web work.

## Context

Call `whoami`, then `list_projects`; use the matching `projectId` and defaults, ask if several match. State scope, comparisons, market, dates, and query set. Label **OpenSEO state**, **GSC**, **third-party estimate**, or **public-web evidence**. Name unavailable GSC.

## Guardrails

- Batch paid reads; above 2,000 credits, state calls/scope/value and confirm. `save_keywords` needs confirmation. Never expose secrets.
- Before `run_site_audit`, confirm canonical URL (not inferred), `maxPages` (propose 50 unless specified), Lighthouse, and AI live check. Never enable the AI live check implicitly.
- Fresh rank checks are dashboard-only: the user sees cost and chooses **Run Now**.
- Contacts require source-attributed public-web research; never invent or send them without separate instruction.

## Translate suite requests

| Request | Route | Limit |
| --- | --- | --- |
| Domain overview | `get_domain_overview`; expand with `get_ranked_keywords` or `get_domain_keyword_suggestions` | Organic traffic/keywords are third-party estimates and may be absent; summary can be cached. |
| Organic competitors | Queries → `find_serp_competitors`; inspect decisive terms with `get_serp_results` | No one-call report; small sets are directional. |
| Keyword/content gap | Compare competitor ranked keywords with GSC or own-domain rows; hydrate shortlist with `get_keyword_metrics` | Derived; never exhaustive without comparable complete sets. |
| Site health | Confirmed `run_site_audit` → `get_audit_status` → issues/pages | Robots-aware crawl, not a vendor-comparable health score. |
| Rank movement | `get_rank_tracker`, then selected tracker; ask when multiple exist | Derived. MCP uses 7 days, or the earliest snapshot; `previousPosition: null` means no prior position. |
| GSC/indexing | `get_search_console_performance`, `inspect_urls` | 1,000 rows/call; paginate `startRow` while `hasMore`. Inspect 10 URLs/call; dates can be incomplete. |
| Backlink gap | `get_backlinks_overview`, bounded `get_backlinks_profile` pages | Derived from fetched rows; profiles are paginated. |
| Lost/broken links | `get_backlinks_profile` with `mode: as_is`, `hideSpam: false`, `pageSize: 50`, `100`, or `200` (max 200; ~30 credits/page), and finite pages; filter returned status | Not historical, date-windowed, or exhaustive. |
| Local visibility | `search_local_businesses`, `get_local_serp_results`, optional questions | Distinguish Maps/local-pack from organic results. |

## Handoff and report

Then use `seo-project-setup`, `keyword-research`, `competitive-landscape`, `competitor-analysis`, `keyword-clustering`, or `link-prospecting`.

Lead with decision, then scope, sourced facts, derivations, limits, and one next action. Never treat missing, blocked, or unavailable evidence as zero, a pass, or a negative conclusion.

**Example — competitor gap:** find recurring competitors from focused queries, compare ranked terms with GSC or own-domain evidence, hydrate viable candidates, and report a directional—not native or complete—gap.