# Proteus 2.0.0 Chimera Mode Architecture

## Summary

Proteus 2.0.0 should introduce Chimera mode: an optional Goose-backed
multi-agent research mode where Proteus remains the coordinator, state owner,
message broker, and validation authority.

Chimera is not a generic agent framework. It is a practical Proteus workflow for
launching one or more complete secondary agents against bounded research goals,
while keeping all communication, memory, session state, labs, and final
decisions under Proteus control.

The first implementation should use Goose directly. Do not add multiple provider
adapters in 2.0.0. Goose is enough for the initial design because it already
provides an agent CLI, sessions, provider/model configuration, MCP extensions,
permission modes, `.gooseignore`, task execution, and machine-readable output
paths. Proteus should provide the missing Chimera layer: dossiers, skills,
message flow, unread message recovery, snapshots, kill/close control, swarm
orchestration, and durable `.vros` state.

## Goals

- Launch complete Goose agents from Proteus with a bounded goal and Proteus
  context.
- Support specialized agents such as `chaining`, `fuzzing`,
  `codebase-research`, `web-intel`, `web-research`, `poc-exploit`, and
  `cicada`.
- Support generalist or explorer co-agents for broader but still bounded
  research fronts.
- Support swarm mode: multiple independent Chimera agents launched together on
  different fronts.
- Keep agents on private labs by default, with broader inherited access only
  when the coordinator explicitly chooses it for that launch.
- Give each agent a private session/lab directory where it can write notes,
  scripts, PoC material, snapshots, and outputs.
- Route all Chimera coordination through Proteus CLI/MCP tools.
- Let the coordinator recover unread messages, status, and snapshots without
  manually reading files.
- Let the coordinator send follow-up messages, redirect goals, kill agents, and
  close sessions.
- Let agents communicate with the coordinator through Proteus commands, not
  ad-hoc file writes.
- Inject the Proteus base contract and relevant skills into each agent's
  dossier.
- Record final agent outputs and session summaries into Proteus memory.
- Keep Chimera optional and disabled unless configured.

## Non-Goals

- Do not build a generic multi-provider abstraction in 2.0.0.
- Do not add OpenCode, Claude Code, Qwen Code, or other adapters in the first
  Chimera release.
- Do not allow agents to edit the main repository by default.
- Do not add file locks, leases, or complex path-edit permissions in 2.0.0.
- Do not make Chimera required for normal Proteus CLI/MCP usage.
- Do not let Chimera agents promote findings or bypass Proteus validation gates.
- Do not treat agent brainstorm output as evidence until independently
  validated.

## Core Principle

Every Chimera action that affects coordination or research state must go through
Proteus.

Files under `.vros/chimera` are the durable backend, but coordinators and agents
should use Proteus commands/tools to interact with them:

```text
Coordinator -> proteus chimera send/poll/kill/close
Agent       -> proteus chimera post/snapshot/heartbeat
Proteus     -> JSONL/state files + SQLite records + exports
Goose       -> execution runtime only
```

This keeps the workflow practical, auditable, and standardized.

## Runtime Choice

Use Goose as the only runtime for Proteus 2.0.0 Chimera.

Reasons:

- Goose has a CLI-oriented agent runtime.
- Goose supports configurable providers/models, making GLM-style usage feasible
  through the user's configured Goose provider.
- Goose supports MCP extensions, so agents can use Proteus through MCP if the
  configuration enables it.
- Goose supports task execution through CLI commands such as `goose run`.
- Goose has session management and resume concepts.
- Goose supports permission modes and `.gooseignore`, which fit the read-only
  repo plus private lab model.
- Goose can be driven from Proteus as an external process with timeout/kill
  control.

Implementation should initially use the Goose CLI path because it is simpler and
easier to validate. ACP can remain a future improvement if the CLI path proves
insufficient for persistent interactive sessions.

Reference docs:

- Goose CLI commands: https://goose-docs.ai/docs/guides/goose-cli-commands/
- Goose running tasks: https://goose-docs.ai/docs/guides/running-tasks/
- Goose sessions: https://goose-docs.ai/docs/guides/sessions/session-management/
- Goose ACP clients: https://goose-docs.ai/docs/guides/acp-clients/

## Configuration

Chimera should be unavailable until explicitly enabled.

Configuration should live in Proteus target memory metadata and optionally a
human-editable file:

```text
.vros/chimera/config.json
```

Minimal config:

```json
{
  "enabled": true,
  "runtime": "goose",
  "gooseCommand": "goose",
  "defaultModel": "glm-5.2",
  "defaultProvider": null,
  "maxAgents": 4,
  "defaultTimeoutSec": 900,
  "defaultNetwork": false
}
```

Keep config small. Every extra field is operational weight. Add fields only when
the runtime needs them.

Useful commands:

```text
proteus chimera config show --root <workspace>
proteus chimera config init --root <workspace> --model glm-5.2
proteus chimera doctor --root <workspace>
```

`doctor` should verify:

- Chimera is enabled.
- Goose command exists.
- Goose can print version/help.
- Proteus CLI path can be invoked by agents.
- `.vros/chimera` is writable.
- Required skills/templates can be resolved.

## Filesystem Layout

Use one directory per Chimera session:

```text
.vros/chimera/
  config.json
  sessions/
    CH-0001/
      status.json
      dossier.md
      contract.md
      agent-instructions.md
      inbox.jsonl
      outbox.jsonl
      transcript.jsonl
      snapshot.md
      kill.flag
      goose/
        prompt.md
        stdout.log
        stderr.log
        run.json
      skills/
        continuous-vuln-research.md
        chimera-agent.md
        chaining.md
      lab/
        README.md
        notes.md
        poc/
        scripts/
        evidence/
```

The default access mode is `lab`: the agent reads the workspace as needed and
writes research artifacts only inside its session lab. The coordinator may
choose `inherit` for a session when the task or user instruction requires the
agent to inherit the coordinator's workspace permissions. Even in inherited
mode, the lab remains the preferred place for notes, scripts, PoC material, and
evidence. This keeps the common path simple and avoids locks, leases, and
collision management.

## Session Model

Persist Chimera sessions in SQLite and mirror them to `status.json`.

Suggested table:

```sql
CREATE TABLE chimera_sessions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  target_id INTEGER NOT NULL,
  campaign_id INTEGER,
  round_id INTEGER,
  role TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  access_notes TEXT,
  model TEXT,
  provider TEXT,
  session_dir TEXT NOT NULL,
  lab_dir TEXT NOT NULL,
  pid INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  close_verdict TEXT,
  close_summary TEXT
);
```

Statuses:

```text
starting
running
waiting
killed
closed
failed
timeout
```

Keep role flexible:

```text
generalist
explorer
codebase-research
chaining
fuzzing
web-intel
web-research
poc-exploit
cicada
custom
```

Only `role` and `goal` should be required for a basic start. Campaign/round/surface
links are useful but optional.

## Message Model

Messages are stored in SQLite and mirrored to JSONL files.

Suggested table:

```sql
CREATE TABLE chimera_messages (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES chimera_sessions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  read_by_coordinator INTEGER NOT NULL DEFAULT 0,
  read_by_agent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Directions:

```text
coordinator_to_agent
agent_to_coordinator
system
```

Kinds:

```text
message
redirect
finding
blocker
snapshot
heartbeat
kill
close
error
```

The coordinator should recover unread agent messages with one command:

```text
proteus chimera poll --unread
proteus chimera poll --id CH-0001 --unread
```

MCP equivalent:

```text
proteus_chimera_poll({ "unreadOnly": true })
```

Polling should mark returned agent messages as read by default, with an option
to peek:

```text
proteus chimera poll --unread --peek
```

## Agent Contract

Add a new skill:

```text
plugins/proteus/skills/chimera-agent/SKILL.md
```

Purpose: teach Goose-backed agents how to operate inside Chimera.

It should include:

- You are a secondary Proteus agent, not the final authority.
- Read `dossier.md`, `contract.md`, `agent-instructions.md`, and `skills/*.md`.
- Respect the coordinator-selected access mode.
- Prefer your session directory and `lab/` for research artifacts.
- Use Proteus CLI for communication:
  - `proteus chimera post`
  - `proteus chimera snapshot`
  - `proteus chimera heartbeat`
- Use Proteus CLI for research state when allowed:
  - `proteus status`
  - `proteus query similar`
  - `proteus query memory`
  - `proteus show`
  - `proteus record evidence`
  - `proteus record agent-output`
- Do not promote findings.
- Do not invent evidence.
- Do not ignore known duplicate/expected-behavior checks.
- Check `kill.flag` or use heartbeat response before continuing long work.
- Report blockers early.
- If output becomes speculative or repetitive, say so and stop.

Every Chimera agent should receive:

- the base Proteus contract;
- the Chimera agent skill;
- the role-specific skill when applicable;
- a compact dossier created by the coordinator;
- known kill conditions;
- expected output shape.

## Dossier

Proteus generates `dossier.md` at session start.

Minimal structure:

```text
# Chimera Dossier CH-0001

Role:
Goal:
Campaign:
Round:
Surface/Hypothesis:
Coordinator context:
Relevant memory:
Known killed paths:
Allowed actions:
Output requirements:
Stop conditions:
How to communicate:
```

The dossier should be short enough for model context and explicit enough to
avoid broad repo review. Do not dump the whole memory base.

## CLI Surface

Keep commands small and practical:

```text
proteus chimera config init
proteus chimera config show
proteus chimera doctor
proteus chimera start
proteus chimera swarm
proteus chimera send
proteus chimera post
proteus chimera snapshot
proteus chimera heartbeat
proteus chimera poll
proteus chimera list
proteus chimera kill
proteus chimera close
```

### start

```text
proteus chimera start --role chaining --goal "Explore non-obvious upload pipeline chains"
proteus chimera start --role cicada --goal "Try bypass/chaining on B7" --access inherit --access-notes "Coordinator grants inherited access for exploit lab work"
```

Useful optional flags:

```text
--campaign-id <id>
--round-id <id>
--surface-id <id>
--hypothesis-id <id>
--model <model>
--timeout <seconds>
--access lab|inherit
--access-notes <text>
--background
```

Default behavior:

- create session;
- create session directory;
- write dossier and skills;
- create private lab;
- record coordinator start message;
- launch Goose if `--background` or configured start mode asks for execution;
- return `sessionId`, paths, and next coordinator action.

### send

```text
proteus chimera send --id CH-0001 --message "Drop the cache angle and focus on parser side effects."
```

Writes a coordinator message for the agent.

### post

Used by the agent:

```text
proteus chimera post --id CH-0001 --kind finding --body "Two plausible pivots..."
```

Writes an agent-to-coordinator message in the standard format.

### snapshot

Used by the agent:

```text
proteus chimera snapshot --id CH-0001 --body "State summary..."
```

Updates `snapshot.md` and records a snapshot message.

### heartbeat

Used by the agent:

```text
proteus chimera heartbeat --id CH-0001
```

Updates status and returns whether the session is still alive or killed.

### poll

Used by the coordinator:

```text
proteus chimera poll --unread
proteus chimera poll --id CH-0001 --unread
```

Returns:

- unread messages;
- session status;
- latest snapshot;
- kill/timeout information;
- suggested next coordinator action.

### kill

```text
proteus chimera kill --id CH-0001 --reason "Looping and not adding testable hypotheses"
```

Behavior:

- write `kill.flag`;
- send a kill message;
- update status;
- attempt to terminate the Goose process if Proteus owns the PID;
- preserve transcript and lab.

### close

```text
proteus chimera close --id CH-0001 --verdict watchlist --summary "Useful chain ideas, no validated PoC"
```

Verdicts:

```text
useful
lab-needed
watchlist
kill
blocked
superseded
```

Close should optionally create `agent-output`, link to campaign/round, and
write a checkpoint-ready summary.

### swarm

Swarm starts multiple independent sessions from a small JSON file:

```json
{
  "campaignId": 1,
  "roundId": 7,
  "agents": [
    {
      "role": "codebase-research",
      "goal": "Map upload pipeline trust boundaries"
    },
    {
      "role": "chaining",
      "goal": "Find non-obvious chains from upload side effects"
    },
    {
      "role": "poc-exploit",
      "goal": "Build an isolated lab plan for surviving candidates"
    }
  ]
}
```

Command:

```text
proteus chimera swarm --plan chimera-swarm.json
```

No complex permissions matrix. All agents get read-only repo access and their
own lab/session directory.

## MCP Tools

Expose the practical coordinator and agent operations:

```text
proteus_chimera_config
proteus_chimera_doctor
proteus_chimera_start
proteus_chimera_swarm
proteus_chimera_send
proteus_chimera_post
proteus_chimera_snapshot
proteus_chimera_heartbeat
proteus_chimera_poll
proteus_chimera_list
proteus_chimera_kill
proteus_chimera_close
```

MCP responses should use the existing Proteus envelope style:

```json
{
  "ok": true,
  "record": {},
  "advisories": [],
  "stateDelta": {
    "created": [],
    "linked": [],
    "updated": []
  }
}
```

Poll should return unread messages in a compact form and include
`nextSuggestedReads` where useful.

## Goose Invocation

Initial simple path:

```text
goose run --name proteus-CH-0001 --no-session --text-file .vros/chimera/sessions/CH-0001/goose/prompt.md
```

Exact flags should be verified against the installed Goose CLI during
implementation. The plan should not depend on a brittle command shape until the
runtime is validated.

Proteus should capture:

```text
goose/stdout.log
goose/stderr.log
goose/run.json
```

If Goose supports stream JSON in the validated version, use it. Otherwise,
Chimera can still be robust because the agent is instructed to communicate via
`proteus chimera post/snapshot/heartbeat`.

## Permissions And Safety

2.0.0 should be intentionally simple:

```text
Default access: lab
Inherited access: coordinator-selected per launch
Agent artifacts: session directory and lab
Network: disabled by default
Proteus memory: through allowed Proteus CLI/MCP commands
Promotion: coordinator only
```

No locks or leases in 2.0.0. If the coordinator grants inherited access, the
agent is expected to avoid colliding with other work and preserve artifacts in
its own lab unless the task explicitly requires workspace edits.

Use `.gooseignore` or Goose configuration to reinforce the contract when
possible, but do not rely on it as the only enforcement layer. The prompt,
session directory layout, Proteus commands, and final validation are the primary
controls.

## Memory Integration

On start:

- create a `chimera_session` record;
- optionally link to campaign, round, surface, and hypothesis;
- record a campaign event when a campaign is active or specified.

On agent `post`:

- write `chimera_message`;
- optionally create evidence only when the agent explicitly labels the message
  as evidence-worthy and the coordinator later accepts it.

On close:

- create `agent-output` with final summary;
- link it to campaign/round when available;
- preserve transcript paths;
- include final verdict and remaining blockers.

Do not automatically promote agent ideas into findings.

## Implementation Phases

### Phase 1: Local State And CLI Broker

- Add schema tables for `chimera_sessions` and `chimera_messages`.
- Add `.vros/chimera/sessions/<id>` creation.
- Add CLI:
  - `chimera config init/show`
  - `chimera start`
  - `chimera send`
  - `chimera post`
  - `chimera snapshot`
  - `chimera heartbeat`
  - `chimera poll`
  - `chimera list`
  - `chimera kill`
  - `chimera close`
- Add `chimera-agent` skill.
- Add tests for message unread/read flow, snapshot updates, kill flag, and close.

### Phase 2: Goose Launch

- Add Goose doctor checks.
- Generate Goose prompt from dossier/skills.
- Launch Goose with timeout and process tracking.
- Capture stdout/stderr/run metadata.
- Verify agent can use `proteus chimera post`.
- Add tests using a mock Goose command before requiring real Goose in CI.

### Phase 3: MCP Tools

- Add MCP wrappers for the CLI/state operations.
- Keep response envelopes consistent with current Proteus MCP tools.
- Add MCP smoke tests for start/send/post/poll/kill/close.

### Phase 4: Swarm

- Add `chimera swarm --plan`.
- Create multiple sessions with shared campaign/round context.
- Return aggregate poll output grouped by session.
- Add max-agent enforcement from config.

### Phase 5: Documentation And Release

- Update README, runtime usage, architecture, and skills docs.
- Add migration notes for 2.0.0.
- Add release validation for Chimera disabled-by-default behavior.
- Validate normal Proteus usage without Goose installed.
- Validate Chimera doctor and mock runtime path.

## Test Plan

Required tests:

- Chimera disabled: commands return clear config guidance.
- Config init/show works.
- Start creates DB records and session files.
- Send creates unread coordinator-to-agent message.
- Post creates unread agent-to-coordinator message.
- Poll unread returns and marks agent messages read.
- Poll with `--peek` does not mark messages read.
- Snapshot writes latest snapshot and message.
- Heartbeat updates status and reports kill state.
- Kill writes kill flag and updates status.
- Close writes final verdict and optional agent-output.
- Swarm creates N independent sessions and enforces maxAgents.
- Normal `npm test` passes without Goose installed.
- Mock Goose command verifies prompt generation, process capture, timeout, and
  transcript preservation.

Manual validation:

- Configure Goose with the user's intended GLM model.
- Run one Cicada session on a harmless local target.
- Run one three-agent swarm with read-only repo and separate labs.
- Confirm coordinator can recover unread messages without reading files.
- Confirm agents can use Proteus CLI to post, snapshot, and heartbeat.

## Acceptance Criteria

- Chimera is disabled by default and normal Proteus works without Goose.
- `proteus chimera doctor` gives actionable setup status.
- Coordinator can start, message, poll, kill, and close a Goose-backed agent
  through Proteus only.
- Agent can communicate back through Proteus only.
- Unread message recovery is reliable and practical.
- Each agent has an isolated lab/session directory.
- Main repo editing is not part of 2.0.0.
- Swarm can launch multiple goal-specific sessions.
- Final session output is recordable as Proteus `agent-output`.
- Chimera messages and snapshots are auditable in `.vros`.
- Validation gates remain under coordinator control.

## Open Questions

- Which exact Goose CLI flags are stable across the version the user wants to
  support?
- Should Goose run once per turn or as a longer background process in 2.0.0?
- Should `post` support structured JSON bodies or only Markdown plus metadata?
- Should close automatically checkpoint an active campaign, or only suggest it?
- Should network be globally disabled in Chimera v1 or controlled by config?

## Recommended 2.0.0 Scope

Ship the smallest complete system:

- Goose-only runtime.
- Optional config.
- Local session/lab directories.
- Proteus-managed messages.
- Start/send/post/snapshot/heartbeat/poll/list/kill/close.
- Swarm.
- Coordinator-selected access mode with `lab` as default.
- Base and role-specific skill injection.
- Agent-output recording on close.
- Robust tests with mock Goose.

Defer edit-capable agents, locks, leases, multiple runtime adapters, ACP, and
fine-grained permission matrices until the core Chimera loop is proven useful.
