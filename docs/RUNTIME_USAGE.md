# Proteus Runtime Usage

## Install

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

For local development:

```powershell
npm install
npm run build
```

Proteus requires Node.js 24 or newer because the first runtime uses
`node:sqlite` for local structured memory.

## Assistant Orchestration

In Codex, invoke Proteus with `@proteus`. Treat `@proteus` as the normal
entrypoint because it lets the assistant load the plugin, start from the main
coordinator skill, and pull in specialist skills only when needed. Slash-style
skill references should be reserved for cases where the user intentionally wants
one specific skill.

In Claude Code, use the plugin command `/proteus`.

Proteus is designed to benefit from host-assistant orchestration features when
they are available in the session:

- Use goal or campaign mode for user-requested continuous campaigns,
  long-running work, or research objectives that should persist until explicit
  stop conditions are met.
- Use subagents for independent, bounded Proteus fronts when delegation is
  available and allowed. Assign one codename and one surface per subagent:
  Argus, Loom, Chaos, Libris, Mimic, Artificer, Skeptic, or Cicada.
- Keep the coordinator in charge of ROI selection, memory updates, validation
  gates, duplicate checks, kill/promote decisions, and replanning.
- Fall back to serial local execution when goal mode, subagents, MCP tools, or
  the CLI are unavailable, while preserving the same memory schema and round
  plan.

These features are efficiency tools, not evidence shortcuts. A report-grade
candidate still needs realistic attacker control, documented/default
configuration, negative controls, dedupe, and a PoC that does not depend on
artificial lab help. It also needs recorded public intel/timeline review and an
evidence-backed Skeptic refutation pass.

## Initialize A Target

```powershell
node dist/cli.js init --root C:\path\to\target --name target-name
```

This creates:

```text
<target>/.vros/memory.sqlite
<target>/.vros/exports/
```

## Memory Root And Base Merge

Prefer the actual workspace/repository root as the target `--root` unless you
intentionally want a separate memory base. If a `.vros` base was accidentally
created in a nested folder, merge it into the canonical root before continuing:

```powershell
node dist/cli.js merge --root C:\path\to\target --source C:\path\to\target\packages\foo\.vros\memory.sqlite --dry-run
node dist/cli.js merge --root C:\path\to\target --sources .\old\.vros\memory.sqlite,.\nested\.vros
```

Sources may be workspace roots, `.vros` directories, or direct
`.vros/memory.sqlite` paths. The destination is always the Proteus `--root`.

## Ingest Prior Work

```powershell
node dist/cli.js ingest --root C:\path\to\target findings REPORTS reports docs
```

Ingested content is stored in `.vros/memory.sqlite` and becomes available to
coverage checks, full-text memory search, and anti-revisit decisions. Markdown
exports are reader-facing views; SQL memory is the source of truth. Re-running
ingest reports `unchanged` for content already present by hash.

## Observe The Environment

```powershell
node dist/cli.js observe --root C:\path\to\target
```

Observation records:

- git branch/commit/status;
- languages;
- package managers;
- framework hints;
- runtime modes;
- test hints;
- local tools such as Docker, WSL, git, Node, npm, Python, and ripgrep.

## Plan A Research Round

```powershell
node dist/cli.js plan-round --root C:\path\to\target --objective "Find high-ROI daemon, archive, indexer, and storage candidates" --plan-json round-input.json --write
node dist/cli.js list rounds --root C:\path\to\target --status active
```

`plan-round` is a structured recorder and scaffold, not an autonomous
target-selection oracle. For serious targets, pass coordinator-supplied surfaces
and fronts through `--plan-json` or the MCP `proteus_plan_round` structured
fields. Query global learnings separately, review them in the coordinator
context, and manually include only relevant conclusions in the supplied plan.

The command records the round in memory and optionally writes a Markdown plan.
It does not select targets, rank surfaces, assign fronts, or generate strategic
understanding by itself.

Recorded rounds are operational plan goals, not only historical notes. New
rounds default to `active`. Use `list rounds --status active|paused|completed`
to recover current or parked work, `show round <id>` to read the full plan, and
`update round --id <id> --status paused|active|completed|blocked|superseded`
whenever the coordinator pauses, resumes, finishes, blocks, or replaces the
plan. `superseded` is the neutral state for old or replaced round records that
should stay searchable but should not become future work. For legacy workspaces
with many old `planned` rounds, use `update rounds --from planned --status
superseded --keep-latest`, then explicitly keep or update the remaining planned
round.

Minimal `round-input.json` shape:

```json
{
  "status": "active",
  "currentUnderstanding": "Coordinator-written target understanding.",
  "selectedSurfaces": [
    {
      "id": 1,
      "name": "Specific bounded surface",
      "family": "short-family-name",
      "roiScore": 0,
      "reason": "Coordinator-written selection reason.",
      "files": ["relative/path/from/target/root.ext"],
      "revisitCondition": "When to revisit this surface."
    }
  ],
  "skippedSurfaces": [],
  "agentFronts": [
    {
      "codename": "argus",
      "assignedSurfaceIds": [1],
      "purpose": "Bounded objective for this front.",
      "requiredOutput": ["covered surface map", "live candidates", "killed hypotheses with evidence"]
    }
  ],
  "stopConditions": ["Report-grade candidate needs user decision."],
  "replanTrigger": "Coordinator-written trigger for the next round."
}
```

The packaged template is `plugins/proteus/templates/round-input.json`.

## Generate Agent Prompts

```powershell
node dist/cli.js prompt --role argus --surface "Auth/session boundary" --objective "Inspect validation/use mismatch"
```

Valid roles:

```text
argus
loom
chaos
libris
mimic
artificer
skeptic
cicada
```

## Record Research State

```powershell
node dist/cli.js record surface --name "Auth/session boundary" --family "auth-session" --files "src/auth.ts,src/session.ts" --status active --revisit "New auth mode, new tenant boundary, or invalidated kill reason"

node dist/cli.js record hypothesis --title "Tenant state reused across request boundary" --impact "possible unauthorized read" --score 72

node dist/cli.js record evidence --title "Negative control output" --kind command-output --body "403 for unrelated tenant"

node dist/cli.js record gate --entity-type hypothesis --entity-id 1 --gate "G2 realistic external attacker input" --status pass --summary "Reproduced through normal request input" --evidence-ids 1

node dist/cli.js record decision --entity-type hypothesis --entity-id 1 --decision discarded --reason "Expected behavior documented in official guide"
```

Use `record surface` for target-specific components and areas the coordinator
has actually selected or reviewed. `update surface` changes status and revisit
conditions after work has happened; it is not a creation command.

## Query Memory

```powershell
node dist/cli.js query duplicates "tenant state reused"
node dist/cli.js query similar "tenant state reused"
node dist/cli.js query memory "tenant state reused"
node dist/cli.js query surfaces "auth"
node dist/cli.js list surfaces
node dist/cli.js list hypotheses
node dist/cli.js list evidence
node dist/cli.js list decisions
node dist/cli.js list gates --entity-type hypothesis --entity-id 1
node dist/cli.js list rounds --status active
node dist/cli.js show source 1
node dist/cli.js show round 1
node dist/cli.js query revisit "auth"
```

`query duplicates` is intentionally narrow. It searches only ingested finding
and report source records for possible duplicate prior coverage. It does not
search hypotheses, decisions, evidence, rounds, generic docs, watchlists,
discarded paths, or candidate registers.

Use `query similar` as the normal first pass for a candidate, primitive, or
impact claim because it returns both narrow duplicate coverage and broad memory
matches. Use `query memory` for broad FTS recall across hypotheses, decisions,
evidence, gates, rounds, surfaces, reports, docs, watchlists, discarded paths,
candidate registers, and agent outputs. Use `list` commands when the agent
needs structured records by category, such as decisions, evidence, gates, and
surfaces. Use `show <entityType> <id>` to inspect the complete record.

## Record Global Learnings

Target memory is local to `.vros/memory.sqlite`. Reusable cross-target memory is
stored separately in:

```text
~/.vros/global.sqlite
```

Use it for user preferences, research heuristics, validation patterns,
anti-patterns, targeting strategy, tooling notes, and playbook material that
should survive across targets.

```powershell
node dist/cli.js learn add --category user_preference --scope "bug-bounty,oss" --title "Prefer realistic exploitability" --body "Prioritize concrete externally exploitable impact over weak best-practice issues." --tags "impact,anti-slop"
```

Recover it later:

```powershell
node dist/cli.js learn query "realistic exploitability" --scope "bug-bounty"
node dist/cli.js learn query --target-scope --root C:\path\to\target
node dist/cli.js learn export
```

When a round is planned, Proteus attempts to pull relevant global learnings into
the round plan from the objective and target contract. These learnings guide
strategy; they are not evidence for a target-specific vulnerability.

## Create A Lab

```powershell
node dist/cli.js lab create --candidate-id 1 --name tenant-state-reuse
```

Labs are created under `.vros/labs/` with a README that forces configuration
legitimacy, attacker model, attack steps, negative controls, limitations, and
evidence capture. They also include `report-draft.md`, a triage-oriented draft
template that avoids internal Proteus/workspace language and favors concise
root-cause, impact, and manual PoC explanation.

## Export Markdown

```powershell
node dist/cli.js export --root C:\path\to\target
```

Exports:

```text
target-contract.md
surface-map.md
candidate-register.md
validation-gates.md
research-log.md
```

`target-contract.md` reflects the target contract stored in SQLite. A fresh
`proteus init` does not invent impact classes, exclusions, assumptions, or prior
work paths; those fields remain empty until the agent or user records
target-specific context.

Exports are non-destructive. If an export file already exists with different
content, Proteus preserves it and writes the generated view beside it as
`<name>.generated-<timestamp>.md`.

## MCP Server

```powershell
npm run build
node dist/mcp.js
```

The MCP server exposes the same memory and planning operations for assistant
integrations:

```text
proteus_init
proteus_status
proteus_migrate
proteus_merge_memory
proteus_chimera_config
proteus_chimera_doctor
proteus_chimera_stop_server
proteus_chimera_start
proteus_chimera_swarm
proteus_chimera_council
proteus_chimera_broadcast
proteus_chimera_send
proteus_chimera_post
proteus_chimera_snapshot
proteus_chimera_workflow_snapshot
proteus_chimera_heartbeat
proteus_chimera_run
proteus_chimera_attach_opencode
proteus_chimera_poll
proteus_chimera_list
proteus_chimera_recover
proteus_chimera_kill
proteus_chimera_close
proteus_ingest
proteus_observe
proteus_plan_round
proteus_campaign_create
proteus_campaign_resume
proteus_campaign_checkpoint
proteus_campaign_close
proteus_record_branch
proteus_update_branch
proteus_link_entities
proteus_roles
proteus_prompt
proteus_query_duplicates
proteus_query_memory
proteus_query_similar
proteus_query_surfaces
proteus_query_revisit
proteus_list_records
proteus_get_record
proteus_record_surface
proteus_record_hypothesis
proteus_record_evidence
proteus_record_decision
proteus_record_gate
proteus_record_agent_output
proteus_update_surface
proteus_update_round
proteus_update_rounds
proteus_export
proteus_lab_create
proteus_record_global_learning
proteus_query_global_learnings
proteus_export_global_learnings
```

The Codex plugin-level MCP configuration lives at:

```text
plugins/proteus/.mcp.json
```

Claude Code uses the project-level MCP configuration at:

```text
.mcp.json
```

## Anti-Revisit Updates

```powershell
node dist/cli.js update surface --root C:\path\to\target --id 1 --status exhausted --revisit "Only reopen on new runtime mode or new chain dependency"
```

Use this after a round when Argus, Loom, Chaos, Libris, Mimic, Artificer, or
Skeptic has exhausted or downgraded a surface. The planner uses these status
fields to avoid repeated low-ROI work.

## Agent Output Records

```powershell
node dist/cli.js record agent-output --root C:\path\to\target --round-id 1 --role argus --surface "Auth/session boundary" --covered "src/auth.ts,src/session.ts" --killed "expected refresh-token behavior"
```

Agent output records preserve covered surfaces, live candidates, killed
hypotheses, probes, uncovered areas, and validation status.
