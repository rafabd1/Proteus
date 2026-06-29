<p align="center">
  <img alt="Proteus chimera mark" src="docs/assets/proteus-chimera-mark.png" width="180" />
</p>
<h1 align="center">Proteus</h1>

<p align="center">
  <strong>Assistant-oriented runtime for continuous vulnerability research.</strong>
  <br />
  Map real codebases, preserve research memory, delegate specialist fronts, and validate exploitability with disciplined gates.
</p>

<p align="center">
  <a href="#install">Install</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#essential-cli">CLI</a> &bull;
  <a href="#chimera-mode">Chimera</a> &bull;
  <a href="#specialist-fronts">Specialists</a> &bull;
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-2.0.1-2f6feb" />
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D24-43853d" />
  <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue" />
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-CLI%20%2B%20MCP%20%2B%20Skills-7c3aed" />
</p>

<p align="center">
  <a href="https://github.com/rafabd1/Proteus/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/rafabd1/Proteus/actions/workflows/ci.yml/badge.svg" />
  </a>
</p>

<table>
  <tr>
    <td align="center"><strong>Continuous Research</strong><br />Campaigns, rounds, branches, gates, decisions, and checkpoints.</td>
    <td align="center"><strong>Durable Memory</strong><br />SQLite-backed target memory plus reusable global learnings.</td>
    <td align="center"><strong>Agent Native</strong><br />Codex and Claude Code skills with CLI and MCP runtime access.</td>
    <td align="center"><strong>Chimera Mode</strong><br />Optional OpenCode-backed co-agents with labs, messages, and snapshots.</td>
  </tr>
</table>

Proteus is built for professional bug bounty and offensive codebase research
against real repositories. It helps a coordinator agent map the codebase, select
high-ROI security surfaces, develop non-obvious hypotheses, delegate bounded
specialist fronts, validate candidates in realistic labs, and preserve memory
so future rounds do not repeat weak or already-killed work.

It favors realistic attacker modeling, duplicate checks, expected-behavior
checks, negative controls, and PoC validation under documented/default
conditions.

## What Proteus Adds

- A continuous research loop: observe, map, hypothesize, prioritize, delegate,
  validate, kill or promote, then replan.
- Structured target memory in `.vros/memory.sqlite`, with Markdown exports for
  review and handoff.
- Campaign-scoped state, branches, entity links, advisories, and checkpoints so
  agents can resume active context without searching the whole memory base.
- Global learnings in `~/.vros/global.sqlite` for reusable cross-target memory
  such as validation patterns, tooling notes, and playbook material.
- Specialist skills for codebase research, chaining, fuzzing, web intel,
  web research, PoC/exploit development, checkpoints, and Chimera co-agents.
- Validation gates that suppress weak hypotheses, duplicates, expected
  behavior, public-known issues, forced-vulnerable configs, and lab-created
  bugs.
- CLI and MCP interfaces so the same memory operations work from Codex, Claude
  Code, terminal usage, or other MCP-capable assistants.
- Optional Chimera mode for OpenCode-backed co-agents with Proteus-managed
  sessions, messages, snapshots, labs, kill/close control, and coordinator-set
  access mode.
- Triage-ready report guidance focused on natural language, realistic impact,
  concise PoC evidence, and external triagers with no internal context.

## Install

Proteus has three install surfaces:

- CLI/runtime: `proteus` and `proteus-mcp`
- Codex plugin: coordinator and specialist skills plus MCP configuration
- Claude Code plugin: `/proteus`, plugin agents, and MCP configuration

Install the CLI first. The plugin skills can load without it, but target memory,
exports, labs, and MCP tools depend on the runtime commands.

Proteus requires Node.js 24 or newer because it uses `node:sqlite` for local
structured memory.

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

Expected:

```text
@rafabd1/proteus 2.0.1
```

### Codex

```powershell
codex plugin marketplace add rafabd1/Proteus
codex mcp add proteus -- proteus-mcp
```

Then install or enable the `proteus` plugin from Codex's plugin UI if your host
does not install marketplace defaults automatically.

### Claude Code

Claude Code support is experimental and has not been exhaustively tested yet.
Because Proteus is heavily focused on offensive security research, Claude
models may also apply safety restrictions that affect exploit-development,
chaining, or other offsec workflows.

```text
/plugin marketplace add rafabd1/Proteus
/plugin install proteus@proteus-marketplace
```

```powershell
claude mcp add -s user proteus -- proteus-mcp
```

## Quick Start

In Codex, invoke Proteus with `@proteus`. This is the normal entrypoint because
it lets the assistant load the plugin, start from the main coordinator skill,
and pull in specialist skills only when needed. Slash-style skill references
are better reserved for cases where you explicitly want one specific skill.

In Claude Code, use `/proteus`. This path is experimental; for offsec-heavy
research, model-side restrictions may affect some workflows.

Example prompts:

```text
@proteus initialize continuous vulnerability research for this repository

@proteus plan the next high-ROI offensive research round for this codebase

@proteus use the existing findings and REPORTS folders, avoid duplicates, and focus on realistic exploitability

@proteus validate this candidate with realistic PoC gates, negative controls, and no forced vulnerable config

@proteus draft a triage-ready report for an external triager
```

The intended flow is agent-led. The coordinator should initialize or resume
memory, ingest prior work, observe the repo, plan a focused round, delegate
bounded fronts when useful, record evidence and decisions, then replan from
what was learned.

## Essential CLI

The CLI is mostly a runtime and recovery surface for agents. Use it manually
when you need explicit terminal control, debugging, or a host without direct
MCP/plugin access.

```powershell
proteus init --root C:\path\to\target --name target-name
proteus status --root C:\path\to\target
proteus ingest --root C:\path\to\target findings REPORTS reports docs
proteus observe --root C:\path\to\target
proteus plan-round --root C:\path\to\target --objective "Next high-ROI research round" --write
proteus campaign resume --root C:\path\to\target
proteus export --root C:\path\to\target
```

Use the actual workspace or repository root as `--root` unless you intentionally
want separate target memory. If a nested `.vros` is created by mistake, merge it
back into the canonical workspace base:

```powershell
proteus merge --root C:\path\to\workspace --source C:\path\to\workspace\packages\foo\.vros\memory.sqlite
```

Each target database records the Proteus runtime version and applied migration
ids. On startup, Proteus checks both values and runs missing idempotent
migrations automatically. `proteus migrate --root <path>` performs the same
check explicitly.

For the full runtime reference, see [Runtime usage](docs/RUNTIME_USAGE.md).

## Chimera Mode

Chimera is optional. It lets the coordinator launch OpenCode-backed co-agents
with Proteus context, role skills, private labs, messaging, snapshots, and
kill/close control. Normal Proteus memory, MCP, CLI, exports, and skills work
without OpenCode.

Install and configure OpenCode by following the official project:

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode docs: <https://opencode.ai/docs/>

After OpenCode works locally, configure Chimera globally for the current user:

```powershell
proteus chimera config init --opencode-command opencode --model zai/glm-5.2 --variant high
proteus chimera doctor --root C:\path\to\target
```

`chimera config` is global and does not need `--root`. Workspace-specific
actions such as `doctor`, `start`, `run`, messages, sessions, and labs still
use `--root`. Chimera has no default run timeout; use `--timeout N` only for
short bounded probes or tests, and stop normal sessions with `chimera kill` or
`chimera close`.

Common operations:

```powershell
proteus chimera start --root C:\path\to\target --role chaining --goal "Develop non-obvious chains from branch B7"
proteus chimera poll --root C:\path\to\target --unread
proteus chimera send --root C:\path\to\target --id CH-0001 --message "Focus on policy side effects."
proteus chimera run --root C:\path\to\target --id CH-0001 --message "Resume this same front with the updated priority."
proteus chimera workflow-snapshot --root C:\path\to\target --id CH-0001
proteus chimera recover --root C:\path\to\target --id CH-0001
proteus chimera kill --root C:\path\to\target --id CH-0001 --reason "Looping without new testable signal"
proteus chimera close --root C:\path\to\target --id CH-0001 --verdict watchlist --summary "Useful ideas, no validated PoC yet"
```

For councils, swarms, OpenCode session reuse, access modes, snapshots, and
message flow, see [Chimera mode](docs/CHIMERA.md).

## Specialist Fronts

Proteus can work serially, through host subagents, or through Chimera co-agents.
Specialist fronts give the coordinator bounded research roles with clear
outputs. The coordinator remains responsible for strategy, memory, validation
gates, duplicate checks, and final kill/promote decisions.

| Front | Focus |
| --- | --- |
| Argus, codebase research | Architecture, dataflow, trust boundaries, invariants, side effects, and high-ROI surfaces. |
| Loom, chaining | Non-obvious chains across components, state transitions, side effects, and capability amplification. |
| Chaos, fuzzing | Calibrated probes, harnesses, differential behavior, parser/state-machine learning, and edge cases. |
| Libris, web intel | Public-known status, advisories, changelogs, issues, docs, tests, timelines, and duplicate risk. |
| Mimic, web research | Authorized live or local web-surface mapping, runtime divergence, endpoint behavior, and workflow validation. |
| Artificer, PoC/exploit | Realistic labs, manual blackbox reproduction, negative controls, exploitability evidence, and report support. |
| Skeptic, adversarial review | Refutation, downgrade pressure, anti-slop checks, and evidence-backed challenge of promoted candidates. |
| Cicada, exploit chaining | Focused bypass/chaining work for promising branches that need deeper exploit development, side-effect discovery, or capability amplification. |
| Checkpoint | Context compression, killed paths, pivots, branch scores, and the next high-ROI move. |
| Chimera agent | OpenCode-backed secondary research fronts with coordinator-controlled scope and messaging. |

## Validation Model

A candidate is report-grade only when the core gates survive:

```text
G1: root cause is in the target.
G2: attacker input is realistic and external.
G3: impact is concrete and security-relevant.
G4: configuration is documented, default, or normal correct practice.
G5: negative controls pass.
G6: local findings/reports/logs do not already cover it.
G7: public-known, advisory, issue, changelog, and expected-behavior checks are complete and documented.
G8: affected version, likely introduction point, and timeline are understood.
G9: adversarial review tried to refute or downgrade the finding and the rebuttal is recorded.
G10: old or obvious classes have exceptional impact or are killed.
G11: PoC does not depend on artificial lab help.
```

Immediate kill reasons include expected behavior, duplicates, weak crashes,
weak DoS, integration-only issues, explicitly unsafe configuration only,
lab-created behavior, incomplete public intel/timeline, unresolved refutation,
and no realistic attacker boundary.

## Report Drafts

Report drafts should read like concise bug bounty submissions for a triager
with no prior context. The default shape is Title, CWE, Summary, Root Cause when
applicable, PoC Details when applicable, Steps To Reproduce, and Impact. Add
other sections only when the program template requires them or the triage
context specifically needs them.

Keep Proteus internals, `.vros`, subagents, workspace paths, and research
process out of the report. Prose should be natural, concise, and specific. Cut
defensive reframing, unnecessary caveats, em dashes, generic hype, and stock
phrases such as "Why this matters" or "This is security relevant because".
Impact should list concrete consequences; Steps should stay terse and put
interpretation in PoC Details or a short note after the steps.

## Architecture

```text
Assistant integration
  - coordinator and specialist skills
  - validation gates, role usage, report guidance, and output discipline

CLI runtime
  - initializes target memory
  - observes repositories and local tooling
  - plans rounds
  - records hypotheses, evidence, decisions, branches, and agent outputs
  - creates labs and exports Markdown

MCP server
  - exposes runtime operations to plugin-capable hosts

.vros memory
  - SQLite source of truth per target
  - exported Markdown views for review and handoff

global learnings
  - reusable memory in ~/.vros/global.sqlite
  - recovered by text, category, tags, or target scope
```

## Development

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
- [Runtime usage](docs/RUNTIME_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Chimera mode](docs/CHIMERA.md)
- [Requirements](docs/REQUIREMENTS.md)
- [Memory model](docs/MEMORY_MODEL.md)

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
