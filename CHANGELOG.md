# Changelog

## 2.0.3 - 2026-06-29

### Fixed

- Changed Chimera list item hints so active sessions no longer display stopped-session resume guidance.
- Treated priority delivery as successful when a stopped session is queued and auto-wake starts cleanly.
- Reconciled stale attached OpenCode session ids from local Chimera session files before workflow snapshot export.
- Hardened `chimera workflow-snapshot` against transient OpenCode export failures with short retries, JSON recovery from noisy output, and more useful export diagnostics.
- Improved Chimera snapshot polling for large agent-authored snapshots by returning bounded previews plus the full `snapshot.md` path and body length metadata.

## 2.0.2 - 2026-06-29

### Fixed

- Removed the separate Chimera relay command surface. Direct single-recipient messages now use `chimera send`/`proteus_chimera_send` for coordinator-to-agent and agent-to-agent flows, with optional source metadata handled by the unified path.
- Changed Chimera `start` to auto-start OpenCode bootstrap by default and report `starting` during attachment instead of leaving new sessions in an ambiguous ready state.
- Added Chimera session recovery for stale or inconsistent pid, status, and OpenCode session attachment state, including `chimera recover` and MCP `proteus_chimera_recover`.
- Hardened `chimera run` so manual runs do not compete with sessions that are already starting or running, and added optional resume instructions through `--message`/`message`.
- Changed priority delivery for parked sessions to use compact wake behavior for queued messages instead of treating every priority message as a full research rerun.
- Changed OpenCode server selection to reuse an already healthy local OpenCode server in the managed range before starting a new one.
- Improved Chimera polling visibility with control status, priority-pending state, delivery state, and recommended next command.
- Added active Chimera session list filters through CLI `chimera list --active` and MCP `proteus_chimera_list active=true`.
- Collapsed parked, closed, killed, failed, timed-out, and legacy waiting Chimera session states into reusable `stopped` sessions with verdict details stored separately.
- Changed default Chimera list scope to sessions linked to active campaigns, including all active campaigns when more than one is open. Added campaign labels in list output and `--all`/`all=true` for historical sessions.
- Accepted prefixed numeric ids such as `B8` in CLI/MCP numeric-id parsing.

### Changed

- Updated coordinator and Chimera docs/skills to explain when to use `start`, `send`, `broadcast`, `poll`, `workflow-snapshot`, `recover`, `run`, `kill`, and `close`, including the difference between queued messages, priority wake, and `run --message` resume.
- Expanded CLI and MCP smoke coverage for auto-start, recovery, unified direct messaging, and prefixed branch ids.

## 2.0.0 - 2026-06-27

### Added

- Added optional Chimera mode for OpenCode-backed secondary agents managed by Proteus.
- Added Chimera CLI commands for config, doctor, start, swarm, council, send, broadcast, post, snapshot, workflow-snapshot, heartbeat, run, wake, attach-opencode, poll, list, kill, close, and stop-server.
- Added MCP tools matching the Chimera CLI control surface.
- Added SQLite-backed Chimera sessions and messages with mirrored `.vros/chimera` session files, labs, JSONL inbox/outbox, snapshots, kill flags, and OpenCode logs.
- Added coordinator-controlled Chimera access modes: default `explorer` and explicit `editor` per launched agent.
- Added `chimera-agent` skill for secondary agents, including communication commands, shared-chat broadcast, inbox polling, access-mode discipline, snapshots, heartbeat, and stop conditions.
- Added OpenCode doctor checks and mock-OpenCode smoke coverage so CI validates Chimera without requiring an API key.
- Added priority Chimera notifications for coordinator messages and broadcasts, plus a session-local `notifications.json` signal that running agents check periodically before polling Proteus.
- Added managed OpenCode server/session tracking for Chimera runs, `chimera run` reuse of existing labs, manual `attach-opencode`, and priority `delivery=steer` pings when an OpenCode session is attached.
- Added Chimera brainstorm councils with ordered turns, automatic cueing, exclusive council transcripts, and bounded close instructions.
- Added compact Chimera workflow snapshots that export recent OpenCode assistant messages while excluding user messages, tool calls, tool outputs, command output, patches, and file payloads.
- Added `proteus branch update` and MCP `proteus_update_branch` for correcting branch status directly, plus automatic branch-status updates when decisions are recorded against `hypothesis_branch` or `branch` records.
- Added a cross-process SQLite lock layer for Proteus writes so parallel Chimera agents and MCP/CLI calls coordinate through a single memory base more reliably.

### Changed

- Updated the main coordinator skill to explain when to use Chimera, how to check config, how to poll unread messages, and how to choose `explorer` versus `editor` access.
- Updated README and Chimera docs with the official OpenCode project link, GLM-style model/variant target config, CLI examples, swarm usage, MCP tools, broadcast chat, and access-mode guidance.
- Consolidated human docs by replacing redundant planning/update documents with the current technical Chimera reference.
- Expanded CLI and MCP smoke tests to cover Chimera config/start/post/poll/snapshot/workflow-snapshot/heartbeat/run/kill/close/swarm/council/direct-message flows, branch updates, no-timeout config, and MCP parity.

### Migration

- Existing `.vros/memory.sqlite` databases migrate automatically to add Chimera session and message tables when opened by Proteus 2.0.0. Proteus also checks the recorded migration ids, so a database stamped with the current runtime version still receives any missing idempotent migrations.
- Chimera remains disabled by default. Normal Proteus CLI/MCP usage does not require OpenCode.

## 1.0.3 - 2026-06-23

### Fixed

- Fixed MCP `evidenceIds` parsing for decisions and validation gates when agents send numeric IDs as strings, such as `["434"]`, or comma-separated strings.
- Updated MCP schemas to advertise numeric evidence ID arrays while keeping compatibility with numeric-string inputs.
- Added MCP smoke coverage so high-impact decisions with numeric-string evidence IDs do not trigger false `decision_without_evidence` advisories.
## 1.0.2 - 2026-06-22

### Added

- Added `proteus merge` and MCP `proteus_merge_memory` to merge one or more Proteus `.vros/memory.sqlite` bases into a destination workspace root.
- Merge accepts source workspace roots, `.vros` directories, or direct `.vros/memory.sqlite` paths, with `--dry-run` support for safe previews.
- Merge remaps copied campaign, round, surface, hypothesis, evidence, branch, checkpoint, link, gate, decision, and FTS references into the destination database.

### Changed

- Strengthened the base research contract and coordinator skill to prefer the actual workspace root for Proteus memory unless explicitly instructed otherwise.
- Documented recovery examples for merging accidental subfolder `.vros` bases back into the correct workspace root.

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
- Clarified that Codex users should invoke the plugin with `@proteus`, while `/proteus` is the Claude Code slash command.
- Made checkpoint contract-signature parsing friendlier to Windows shells by accepting comma-separated `key=value` pairs in addition to JSON.
- Changed release-note generation so a missing changelog section for a new version reuses the latest version notes instead of falling back to commit summaries.

### Migration

- Added transactional, idempotent schema migrations with recorded migration versions.
- Added `proteus_metadata` with `proteus_version` tracking for migration gating and status reporting.
- Existing `.vros/memory.sqlite` databases are migrated automatically when opened by the new runtime.
- Added explicit `proteus migrate --root <target>` and migration status reporting.

### Deferred

- Chimera/Claude hybrid mode remains intentionally deferred to a later update.
