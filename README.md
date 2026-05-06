# Proteus

Proteus is a Codex plugin and local runtime for structured, continuous
vulnerability research against arbitrary codebases.

You give it a target repository. Proteus helps the coordinator map the codebase,
select high-ROI security surfaces, generate non-obvious exploitability
hypotheses, delegate bounded specialist fronts, validate candidates in realistic
labs, and preserve structured memory so future rounds do not repeat low-value
work.

It is not a scanner and not a generic code review checklist. Proteus is built
for professional bug bounty and offensive codebase research where findings must
survive realistic attacker modeling, duplicate checks, expected-behavior checks,
negative controls, and PoC validation without artificial lab help.

## What Proteus Adds

- Continuous research loop: observe, map, hypothesize, prioritize, delegate,
  validate, kill or promote, then replan.
- Structured memory in `.vros/memory.sqlite`, with Markdown exports for humans.
- Global learnings in `~/.vros/global.sqlite` for reusable cross-target memory
  such as user preferences, validation patterns, tooling notes, and playbook
  material.
- ROI-based surface planning to avoid wandering through the same low-signal
  areas.
- Named specialist fronts for repeatable multi-agent research: Argus, Loom,
  Chaos, Libris, Mimic, Artificer, and Skeptic.
- Validation gates that aggressively suppress weak hypotheses, duplicates,
  expected behavior, public-known issues, forced-vulnerable configs, and
  lab-created bugs.
- CLI and MCP interfaces, so the same memory and planning operations work from
  the terminal or through the Codex plugin.
- Realistic PoC lab scaffolding with attacker model, documented/default config,
  negative controls, limitations, and evidence capture.
- Triage-ready report draft guidance that favors natural language, concise root
  cause explanation, realistic impact scenarios, and manual blackbox-style PoCs.

## Install

Proteus has two install surfaces:

- CLI/runtime: `proteus` and `proteus-mcp`
- Codex plugin: the `continuous-vuln-research` skill plus MCP configuration
- Claude Code project port: `/proteus`, project subagents, and `.mcp.json`

### 1. Install The CLI

Proteus currently requires Node.js 24 or newer because it uses `node:sqlite` for
local structured memory.

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

Expected:

```text
@rafabd1/proteus 0.1.10
```

The codeload tarball is the recommended install path while Proteus is distributed
directly from GitHub. It uses the committed runtime and avoids install-time
TypeScript builds on the target machine.

### 2. Add The Codex Plugin

```powershell
codex plugin marketplace add rafabd1/Proteus
```

Then install or enable the `proteus` plugin from Codex's plugin UI if your host
does not install marketplace defaults automatically.

Invoke the skill with your host's plugin syntax. In Codex, the skill is:

```text
$proteus:continuous-vuln-research
```

## Quick Start

### Claude Code

Proteus ships project-level Claude Code integration:

```text
.claude/commands/proteus.md
.claude/agents/proteus-*.md
.mcp.json
CLAUDE.md
```

From a Claude Code session in the repository, use:

```text
/proteus initialize continuous vulnerability research for this repository
/proteus plan the next high-ROI offensive research round
/proteus validate this candidate with realistic PoC gates and negative controls
/proteus draft a triage-ready report without internal workflow references
```

The Claude Code port provides the same Proteus codenames as project subagents:

```text
proteus-argus
proteus-loom
proteus-chaos
proteus-libris
proteus-mimic
proteus-artificer
proteus-skeptic
```

Use `/mcp` inside Claude Code to approve or inspect the project MCP server.

For user-level use across many Claude Code projects, install the CLI and then
copy the command/agents into your Claude Code home:

```powershell
New-Item -ItemType Directory -Force ~/.claude/commands, ~/.claude/agents
Copy-Item .claude/commands/proteus.md ~/.claude/commands/proteus.md -Force
Copy-Item .claude/agents/proteus-*.md ~/.claude/agents/ -Force
claude mcp add proteus --scope user -- proteus-mcp
```

### Codex Plugin

After the marketplace is installed, use Proteus from Codex with the plugin/skill
entrypoint exposed by your host.

Common forms:

```text
/proteus
$proteus
$proteus:continuous-vuln-research
```

Example prompts:

```text
/proteus initialize continuous vulnerability research for this repository.

/proteus plan the next high-ROI offensive research round for this codebase.

/proteus use the existing findings and REPORTS folders, avoid duplicates, and focus on realistic exploitability.

/proteus validate this candidate with realistic PoC gates, negative controls, and no forced vulnerable config.
```

When available, Proteus should use Codex `/goal` for persistent campaigns and
subagents for bounded fronts such as Argus, Loom, Chaos, Libris, Mimic,
Artificer, and Skeptic. The coordinator still owns strategy, memory, dedupe,
validation gates, and final kill/promote decisions.

### CLI Runtime

Use the CLI when you want explicit terminal control or when your Codex host does
not expose plugin tools directly.

Initialize memory for a target:

```powershell
proteus init --root C:\path\to\target --name target-name
```

Ingest prior work so Proteus can dedupe and avoid repeated coverage:

```powershell
proteus ingest --root C:\path\to\target findings REPORTS reports docs
```

Observe the repository and local environment:

```powershell
proteus observe --root C:\path\to\target
```

Plan a focused research round:

```powershell
proteus plan-round --root C:\path\to\target --objective "Find high-ROI auth, state, cache, and adapter divergence candidates" --write
```

Export human-readable state:

```powershell
proteus export --root C:\path\to\target
```

Proteus stores source-of-truth state under:

```text
<target>/.vros/memory.sqlite
```

Exports are written under:

```text
<target>/.vros/exports/
```

## Typical Flow

```text
you: use Proteus on this repository for continuous vulnerability research

coordinator:
  - loads or initializes .vros memory
  - ingests existing findings, reports, docs, and prior research logs
  - observes the repo, toolchain, package managers, tests, and runtime hints
  - builds a round plan with high-ROI surfaces and skipped low-ROI areas
  - assigns bounded fronts to Argus, Loom, Chaos, Libris, Mimic, Artificer, or Skeptic
  - records hypotheses, evidence, decisions, killed paths, and revisit conditions
  - promotes only candidates that survive the validation gates
  - replans from what was learned instead of restarting from scratch
```

When Codex provides `/goal`, subagents, or parallel delegation, Proteus expects
the coordinator to use those capabilities for efficiency:

- `/goal` is useful for user-requested continuous campaigns or persistent
  objectives with explicit stop conditions.
- Subagents are useful for independent bounded fronts, not vague repo-wide
  review.
- The coordinator remains responsible for strategy, memory, validation gates,
  duplicate checks, and final kill/promote decisions.

## Specialist Fronts

| Codename | Focus |
| --- | --- |
| Argus | Component-level review of local primitives and covered modules. |
| Loom | Macro and chaining analysis across components and trust boundaries. |
| Chaos | Fuzzing, edge-case generation, anomaly matrices, and probes. |
| Libris | Docs, tests, advisories, public-known behavior, timeline, and contract verification. |
| Mimic | Runtime, adapter, deployment-profile, and environment divergence. |
| Artificer | Realistic PoC labs and didactic validation artifacts. |
| Skeptic | Adversarial review, refutation, downgrade, and anti-slop pressure. |

Artificer starts only after initial gates pass. Skeptic starts only after there
is technical evidence worth challenging. No candidate should become report-grade
until Libris has recorded public intel/timeline results and Skeptic has recorded
an evidence-backed refutation attempt.

## Validation Model

A candidate is report-grade only when it satisfies the core gates:

```text
G1: root cause is in the target.
G2: attacker input is realistic and external.
G3: impact is concrete and security-relevant.
G4: configuration is documented, default, or normal correct practice.
G5: negative controls pass.
G6: local findings/reports/logs do not already cover it.
G7: public-known, advisory, issue, changelog, and expected-behavior checks are complete and documented.
G8: affected version, likely introduction point, and timeline are understood.
G9: Skeptic has tried to refute or downgrade the finding and the rebuttal is recorded.
G10: old/obvious classes have exceptional impact or are killed.
G11: PoC does not depend on artificial lab help.
```

Immediate kill reasons include expected behavior, duplicates, weak crashes,
weak DoS, integration-only issues, explicitly unsafe configuration only,
lab-created behavior, incomplete public intel/timeline, unresolved Skeptic
refutation, and no realistic attacker boundary.

## Report Drafts

Proteus report drafts are written for triagers, not for the internal research
workflow. They should be concise, natural, and direct. They should explain the
root cause in simple terms, present impact through a realistic attacker scenario,
and avoid unnecessary sections or internal references to Proteus, `.vros`,
subagents, workspace paths, or research process.

PoCs should prefer manual reproduction when possible: browser actions, HTTP
requests, `curl`, normal CLI commands, or other blackbox steps an attacker could
realistically perform. If automation is necessary, the report should explain the
manual flow being automated and include only short snippets that make the PoC
easier to trust.

## CLI Commands

```text
proteus init [--root <path>] [--name <target>]
proteus status [--root <path>]
proteus ingest [--root <path>] [paths...]
proteus observe [--root <path>]
proteus plan-round [--root <path>] [--objective <text>] [--write]
proteus roles
proteus prompt --role <argus|loom|chaos|libris|mimic|artificer|skeptic> --surface <text>
proteus record hypothesis --title <text> [--surface-id <id>] [--impact <text>]
proteus record evidence --title <text> [--kind <kind>] [--body <text>]
proteus record decision --entity-type <type> --entity-id <id> --decision <text> --reason <text>
proteus record agent-output --round-id <id> --role <codename> --surface <text>
proteus update surface --id <id> [--status exhausted|low_roi|covered|blocked|watch] [--revisit <text>]
proteus query duplicates <text>
proteus query revisit <surface>
proteus export [--root <path>]
proteus lab create --candidate-id <id> [--name <name>]
proteus learn add --title <text> [--category <category>] [--scope <scope>] [--body <text>] [--tags a,b]
proteus learn query [text] [--scope <scope>] [--category <category>] [--target-scope]
proteus learn export [--out <path>]
```

## MCP Tools

The plugin starts the MCP server through:

```text
plugins/proteus/.mcp.json
```

The server exposes:

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

You can run it manually for local testing:

```powershell
proteus-mcp
```

## Architecture

```text
Codex skill
  - operational contract for continuous vulnerability research
  - defines coordinator loop, validation gates, role usage, and output verdicts

CLI runtime
  - initializes target memory
  - observes repositories and local tooling
  - plans rounds
  - records hypotheses, evidence, decisions, surfaces, and agent outputs
  - creates labs and exports Markdown

MCP server
  - exposes runtime operations to plugin-capable hosts

.vros memory
  - SQLite source of truth per target
  - exported Markdown views for review and handoff

global learnings
  - reusable memory in ~/.vros/global.sqlite
  - recovered by text, category, tags, or target scope
  - guides strategy without becoming target-specific evidence
```

Project layout:

```text
docs/
  ARCHITECTURE.md
  CLAUDE_CODE.md
  DEVELOPMENT_PLAN.md
  INSTALLATION.md
  MEMORY_MODEL.md
  REQUIREMENTS.md
  RUNTIME_USAGE.md
.claude/
  commands/proteus.md
  agents/proteus-*.md
plugins/
  proteus/
    .codex-plugin/plugin.json
    .mcp.json
    dist/
    scripts/proteus-mcp.cjs
    skills/continuous-vuln-research/SKILL.md
src/
  cli.ts
  mcp.ts
  db.ts
  planner.ts
  roles.ts
```

## Dev Install

```powershell
git clone https://github.com/rafabd1/Proteus
cd Proteus
npm install
npm run build
npm link
proteus --version
```

Run validation:

```powershell
npm test
```

The test suite runs TypeScript checking, CLI smoke coverage, and MCP smoke
coverage against temporary targets.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Claude Code port](docs/CLAUDE_CODE.md)
- [Runtime usage](docs/RUNTIME_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Requirements](docs/REQUIREMENTS.md)
- [Memory model](docs/MEMORY_MODEL.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md)

## Status

Proteus is early and intentionally conservative. The current release focuses on
the Codex plugin contract, local memory runtime, CLI workflow, MCP exposure,
round planning, agent-output recording, anti-revisit state, and lab scaffolding.

The next major improvements are richer planner scoring, stricter output
validation, better public-known/advisory checks, and deeper host integration for
parallel research campaigns.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
