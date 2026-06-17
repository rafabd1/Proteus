# Changelog

## 1.0.0 - 2026-06-17

### Added

- Campaign-scoped research state with create, resume, checkpoint, close, digest, events, and entity links.
- Hypothesis branches for explicit creative attack paths, ROI scoring, preconditions, success criteria, kill conditions, and branch status.
- Structured campaign checkpoints with confirmed, killed, open, pivots, score changes, context compression, next high-ROI move, and contract signature fields.
- MCP response envelopes with advisories, related records, suggested reads, and state deltas.
- Deterministic similarity query that separates duplicate/report coverage from broader memory matches.
- Auto-linking from the single active campaign to newly recorded hypotheses, evidence, decisions, validation gates, and specialist outputs.
- Database-level Proteus version metadata so automatic migrations run only when the stored base version is missing or differs from the runtime version.
- Modular Proteus skills for chaining, fuzzing, codebase research, web intel, web research, PoC/exploit work, and checkpoints.
- Expanded individual skill contracts with professional heuristics for non-obvious chaining, calibrated fuzzing, active codebase learning, realistic PoCs, and intelligence-driven pivots.
- Strengthened report-writing guidance to follow supplied templates, avoid artificial checklist/legalistic prose, and write concise triage-ready summaries for readers with no prior context.
- Added report anti-pattern guardrails for common LLM phrasing, defensive caveats, Impact-section reframing, verbose reproduction steps, local workspace leakage, and adjustment replies that are not written for an external triager.
- Cicada specialist role for advanced exploit development, bypass work, and chaining on already-promising targets.
- Shared base research contract requiring realistic exploitability, anti-slop validation, dedupe, public-known checks, and explicit contract attestation.
- GitHub Actions CI and tag-based release automation for `v*` tags.

### Changed

- Strengthened coordinator and specialist prompts around Tree-of-Thoughts style branching, ROI ranking, validation gates, reflection checkpoints, and evidence-backed decisions.
- Updated README and architecture docs to explain plugin, CLI, MCP runtime, campaigns, branches, checkpoints, and release behavior.
- Expanded CLI and MCP smoke coverage to exercise campaigns, branches, checkpoints, links, similarity, migration, and MCP state recovery.
- Updated release automation so GitHub Release notes are copied from the matching `CHANGELOG.md` version section, and merges to `main` create the version tag/release when the tag is missing.

### Migration

- Added transactional, idempotent schema migrations with recorded migration versions.
- Added `proteus_metadata` with `proteus_version` tracking for migration gating and status reporting.
- Existing `.vros/memory.sqlite` databases are migrated automatically when opened by the new runtime.
- Added explicit `proteus migrate --root <target>` and migration status reporting.

### Deferred

- Chimera/Claude hybrid mode remains intentionally deferred to a later update.
