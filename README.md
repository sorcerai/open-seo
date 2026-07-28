# OpenSEO — legacy internal fork

> **Status:** retained for provenance during an internal repository cutover. This fork is not the canonical home for new internal development.

The upstream OpenSEO project remains a useful open-source SEO application. This SorcerAI fork was also used as the historical foundation for an internal search-demand and decision system.

New internal feature work has moved to a private canonical repository. Do not open or revive internal Demand Pulse, Decision Surface, Link Ops, action-export, provider, source-policy, or portfolio work in this fork.

Historical commits, issues, pull requests, schemas, migrations, environment variables, routes, and resource names may remain here for auditability. Their presence does not make this repository an active internal product or canonical producer.

## Repository rules during cutover

- Preserve history and upstream attribution.
- Do not implement new internal features here.
- Close duplicate internal PRs with a pointer to the canonical replacement.
- Do not emit this repository's historical producer identity from a new runtime.
- Do not rewrite historical events or schemas merely to improve naming.
- Do not archive or delete the repository until live infrastructure, secrets, deployments, stored data, integrations, and compatibility aliases have been inventoried.
- Public OpenSEO packaging, upstream contribution, and internal product decisions remain separate concerns.

## Archive gate

Archive this fork only after the internal owner verifies:

- [ ] the canonical private repository has its own README, project state, CI, and deployment boundary;
- [ ] current Demand Pulse, Decision Surface, Link Ops, and action-handoff contracts live only in the canonical repository;
- [ ] the downstream decision system accepts the canonical producer identity;
- [ ] active internal project repositories point to the canonical system;
- [ ] no internal feature PR remains open only in this fork;
- [ ] deployed resources that still use OpenSEO names are listed as compatibility aliases;
- [ ] required historical fixtures and migration notes are preserved;
- [ ] rollback and retention obligations are documented.

Until those checks pass, this repository is **legacy provenance**, not archived completion.

---

## Historical upstream project description

OpenSEO is an open-source alternative to Semrush and Ahrefs. The upstream product provides keyword research, rank tracking, competitor insights, backlinks, site audits, AI visibility, MCP access, agent skills, hosted service, and self-hosting paths.

Upstream project and documentation:

- Website: `https://openseo.so`
- MCP setup: `https://openseo.so/docs/mcp`
- Agent Skills: `https://openseo.so/docs/skills/setup`
- Docker self-hosting: [`docs/SELF_HOSTING_DOCKER.md`](./docs/SELF_HOSTING_DOCKER.md)
- Cloudflare self-hosting: [`docs/SELF_HOSTING_CLOUDFLARE.md`](./docs/SELF_HOSTING_CLOUDFLARE.md)
- DataForSEO setup: [`docs/DATAFORSEO_API_KEY.md`](./docs/DATAFORSEO_API_KEY.md)
- Local development: [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md)
- Contributing: [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)

The original upstream README and history remain available in Git. This notice changes the status of the SorcerAI fork; it does not claim ownership of the upstream OpenSEO project or erase its provenance.
