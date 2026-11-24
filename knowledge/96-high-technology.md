# High Technology — Open Learning & Action Doctrine

## Purpose
High Technology is the OSA company division for frontier technology intelligence and action. It is strictly separate from Psychiatry.

Its job is not to collect hype. It converts open scientific, engineering, patent, standards and funded-R&D evidence into one of five outputs:
1. watch,
2. reproducible experiment,
3. procurement/tool sandbox,
4. research handoff,
5. revenue qualification.

Before first verified external settlement, novelty alone never justifies a build.

## Domains
- Artificial intelligence and agent systems
- Robotics and physical intelligence
- Semiconductors, accelerators and advanced compute
- Quantum computing, sensing and networking
- Energy, storage, fusion and grid technology
- Space, aerospace, propulsion and autonomy
- Advanced materials and manufacturing
- Biotechnology and bioengineering

## Open-source priority stack

### Tier A — live public / lowest friction
- arXiv — frontier preprints and machine-readable research discovery.
- Crossref REST API — DOI, publication, funding, license and update metadata.
- OpenAlex — research graph across works, authors, institutions, topics and citations; casual/keyless access is useful, with a free key preferred for sustained use.
- Semantic Scholar Academic Graph — paper/author/citation graph and open-access filtering.
- OpenReview API — public conference submissions, review-stage evidence and venue context.
- Hugging Face Daily Papers — current AI papers linked to models, datasets, demos and code.
- GitHub REST Search — implementation reality, repositories, issues and maintenance evidence.
- DOE OSTI.GOV API — DOE-funded research, especially energy, fusion, materials, quantum and national-lab work.
- NIST Publications / CSRC feeds — standards, drafts, cybersecurity, AI, measurement and technical publications.
- CORDIS public search/RSS/SPARQL/open datasets — European funded R&D projects and results.

### Tier B — useful but current access friction
- USPTO PatentsView / Open Data Portal — patent-landscape and inventor/assignee data. Treat the 2026 API transition as a continuity risk; prefer public ODP/bulk data until current API behavior is verified.
- NASA TechPort — strong space/aerospace technology inventory, but current API access requires a current session token; do not call it zero-friction.

## Evidence rule
Every promoted high-technology signal must record:
- primary source and observed date,
- what is actually new,
- confidence,
- maturity / TRL proxy,
- independent corroboration when practical,
- code/data/model/patent availability,
- reproducibility evidence,
- likely capability value,
- likely commercial value,
- cost/friction to test,
- one explicit next action.

Popularity, citations, upvotes, prize pools, press coverage or a new paper do not by themselves prove technical readiness, buyer demand or revenue.

## Action policy
High Technology may:
- read public/open sources,
- deduplicate and cross-check signals,
- propose or run bounded reversible experiments,
- hand a verified tool to Procurement/Engineering,
- hand explicit buyer demand to Revenue,
- place weak signals on watch.

High Technology must not:
- classify research relevance as buyer demand,
- count papers, patents, grants or prototypes as revenue,
- create broad infrastructure merely because a technology is novel,
- bypass auth/KYC/platform controls,
- mix Psychiatry data, study memory or clinical work into this division.

## WIP rule
The division keeps at most one active high-tech experiment unless the CEO promotes another based on verified capability or commercial value.

## Company integration
Canonical source registry: `osa_brain.learning_sources`.
Division: `osa_company.divisions.high_technology`.
Manager: `mgr.hightech`.
Scout: `emp.hightech-scout`.
Daily tasks: `hightech.frontier_radar` and `hightech.promote_one`.

The existing company daily-plan scheduler owns these tasks. No separate High Technology cron is required.
