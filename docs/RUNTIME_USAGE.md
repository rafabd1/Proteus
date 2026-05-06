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

Proteus is designed to benefit from host-assistant orchestration features when
they are available in the session:

- Use goal or campaign mode for user-requested continuous campaigns,
  long-running work, or research objectives that should persist until explicit
  stop conditions are met.
- Use subagents for independent, bounded Proteus fronts when delegation is
  available and allowed. Assign one codename and one surface per subagent:
  Argus, Loom, Chaos, Libris, Mimic, Artificer, or Skeptic.
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

## Ingest Prior Work

```powershell
node dist/cli.js ingest --root C:\path\to\target findings REPORTS reports docs
```

Ingested content becomes searchable through full-text search and is used for
dedupe and anti-revisit checks.

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
```

`plan-round` is a structured recorder and scaffold, not an autonomous
target-selection oracle. For serious targets, pass coordinator-supplied surfaces
and fronts through `--plan-json` or the MCP `proteus_plan_round` structured
fields. Query global learnings separately, review them in the coordinator
context, and manually include only relevant conclusions in the supplied plan.

The command records the round in memory and optionally writes a Markdown plan.
It does not select targets, rank surfaces, assign fronts, or generate strategic
understanding by itself.

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
```

## Record Research State

```powershell
node dist/cli.js record hypothesis --title "Tenant state reused across request boundary" --impact "possible unauthorized read" --score 72

node dist/cli.js record evidence --title "Negative control output" --kind command-output --body "403 for unrelated tenant"

node dist/cli.js record decision --entity-type hypothesis --entity-id 1 --decision discarded --reason "Expected behavior documented in official guide"
```

## Query Memory

```powershell
node dist/cli.js query duplicates "tenant state reused"
node dist/cli.js query revisit "auth"
```

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
research-log.md
```

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
proteus_ingest
proteus_observe
proteus_plan_round
proteus_query_duplicates
proteus_record_hypothesis
proteus_record_decision
proteus_record_agent_output
proteus_update_surface
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
