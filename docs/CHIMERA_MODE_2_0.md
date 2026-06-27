# Proteus 2.0.0 Chimera Mode Architecture

## Summary

Proteus 2.0.0 should introduce Chimera mode: an optional OpenCode-backed
multi-agent research mode where Proteus remains the coordinator, state owner,
message broker, and validation authority.

Chimera is not a generic agent framework. It is a practical Proteus workflow for
launching one or more complete secondary agents against bounded research goals,
while keeping all communication, memory, session state, labs, and final
decisions under Proteus control.

The first implementation uses OpenCode directly. Do not add multiple provider
adapters in 2.0.0. OpenCode is enough for the initial design because it already
provides an agent CLI, provider/model configuration, model variants, agents,
skills, MCP configuration, permissions, task execution, machine-readable JSON
events, session APIs, and compaction support. Proteus provides the Chimera
layer: dossiers, skills, message flow, unread message recovery, snapshots,
kill/close control, swarm orchestration, and durable `.vros` state.

## Goals

- Launch complete OpenCode agents from Proteus with a bounded goal and Proteus
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
- Do not add Goose, Claude Code, Qwen Code, or other adapters in the first
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
OpenCode   -> execution runtime only
```

This keeps the workflow practical, auditable, and standardized.

## Runtime Choice

Use OpenCode as the only runtime for Proteus 2.0.0 Chimera.

Reasons:

- OpenCode has a CLI-oriented agent runtime.
- OpenCode supports configurable providers/models, making GLM-style usage feasible
  through the user's configured OpenCode provider.
- OpenCode supports MCP extensions, so agents can use Proteus through MCP if the
  configuration enables it.
- OpenCode supports task execution through CLI commands such as `opencode run`.
- OpenCode has session management and resume concepts.
- OpenCode supports agent-level tools/permissions, which fit the private lab
  model and coordinator-selected inherited access.
- OpenCode can be driven from Proteus as an external process with timeout/kill
  control.

Implementation should use the OpenCode CLI path first because it is simple,
portable, and easy to validate. Proteus keeps communication in its own
pull-based broker, so coordinator messages can be delivered while agents are
running as long as agents follow the contract and poll their inbox.

Reference docs:

- OpenCode docs: https://opencode.ai/docs/
- OpenCode agents: https://opencode.ai/docs/agents/
- OpenCode skills: https://opencode.ai/docs/skills/
- OpenCode permissions: https://opencode.ai/docs/permissions/

## Configuration

Chimera should be unavailable until explicitly enabled.

Configuration should live in Proteus target memory metadata and optionally a
human-editable file:

```text
.vros/chimera/config.json
```

This is target-level configuration, not session/lab configuration. The
coordinator configures OpenCode command, default model, variant, agent name,
timeouts, and `maxAgents` once for the Proteus target. New Chimera sessions and
labs inherit these defaults unless the coordinator passes a per-session model or
variant override.

Minimal config:

```json
{
  "enabled": true,
  "runtime": "opencode",
  "opencodeCommand": "opencode",
  "opencodeServerUrl": null,
  "opencodeServerPid": null,
  "defaultModel": "zai/glm-5.2",
  "defaultVariant": "high",
  "defaultAgent": "proteus-chimera",
  "maxAgents": 5,
  "defaultTimeoutSec": 900,
  "defaultNetwork": false,
  "skipPermissions": true
}
```

Keep config small. Every extra field is operational weight. Add fields only when
the runtime needs them.

Useful commands:

```text
proteus chimera config show --root <workspace>
proteus chimera config init --root <workspace> --model zai/glm-5.2 --variant high
proteus chimera doctor --root <workspace>
```

`doctor` should verify:

- Chimera is enabled.
- OpenCode command exists.
- OpenCode can print version/help.
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
      notifications.json
      snapshot.md
      kill.flag
      opencode/
        prompt.md
        stdout.log
        stderr.log
        run.json
      .opencode/
        agents/
          proteus-chimera.md
        skills/
          chimera-agent/
            SKILL.md
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
council
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

`send` and `broadcast` also update each destination session's
`notifications.json` with `pending`, `priority`, `unreadForAgent`,
`updatedAt`, and the latest message id/kind. This is a lightweight notification
marker for running agents. It is not the source of truth; agents still recover
messages through `poll`. Priority messages are a nudge to poll as soon as
practical, while normal messages are recovered through the agent's periodic
polling contract.

When Proteus has an attached OpenCode server URL and `opencodeSessionId` for a
session, priority messages should also send a direct OpenCode v2 prompt:

```text
POST /api/session/{sessionID}/prompt
delivery: steer
resume: true
prompt.text: "Priority Proteus coordinator message... poll Proteus now"
```

This direct steer is only a notification path. Proteus remains the broker and
audit source. The agent still retrieves the actual canonical message with
`proteus chimera poll --id <CH-ID> --unread --agent`.

### Brainstorm Council

A council is a bounded ordered brainstorm across active Chimera co-agents. Use
it at checkpoints, between campaigns, or when a campaign has stalled and needs
fresh independent angles.

The council uses normal Chimera messages with `kind=council` and metadata:

```json
{
  "councilId": "CO-...",
  "councilState": "invited|accepted|turn|closed",
  "round": 1
}
```

Flow:

```text
1. Coordinator starts the council and sends priority invites.
2. Agents accept when free or at a safe pause point.
3. Coordinator checks status and opens the round with `open-round`.
4. Proteus sends the exclusive council transcript to that agent via inbox and
   direct OpenCode steer when possible.
5. The called agent sends one separated `turn` response for that round.
6. Proteus automatically cues the next accepted participant until the round is
   complete.
7. Control returns to the coordinator, who closes or opens another round.
```

Commands:

```text
proteus chimera council start --topic "..." --ids CH-0001,CH-0002 --max-rounds 1
proteus chimera council accept --id CH-0001 --council-id CO-... --body "ready"
proteus chimera council open-round --council-id CO-... --round 1 --message "Give one pivot, one risk, one next experiment"
proteus chimera council turn --id CH-0001 --council-id CO-... --round 1 --body "..."
proteus chimera council status --council-id CO-...
proteus chimera council close --council-id CO-... --summary "..." --instruction "..."
```

`open-round` normally cues the first accepted participant automatically. After
each agent posts `turn`, Proteus cues the next accepted participant
automatically. Direct `cue-turn` is reserved for manual recovery when automatic
advance was intentionally disabled; it requires an explicit manual flag in the
CLI/MCP. When no accepted participant remains without a turn for that round,
the response returns `roundComplete=true` and `nextCue=null`; the coordinator
then decides whether to close, record outcomes, or open another round.

Each council has an exclusive logical transcript keyed by `councilId`. Messages
are still stored in the normal Chimera broker, but `status`, `cue-turn`, and
`close` filter by `councilId`, so overlapping councils do not mix.

Default to one round and normally cap at two. Extend only for a concrete
unresolved high-ROI question. Agents should not reply to every other agent or
turn the council into debate. Proteus rejects a second turn from the same agent
in the same round; if the coordinator extends the council, agents must post to
the next explicit round. The transcript is coordination history, not evidence
until the coordinator validates and records resulting decisions, branches,
evidence, or checkpoints.

Concurrency note: SQLite memory is the source of truth and runs with WAL plus a
busy timeout so concurrent Chimera writes wait briefly for locks instead of
failing immediately. JSONL files are mirrors for local inspection and recovery,
not the authoritative lock or ordering mechanism.

## Agent Contract

Add a new skill:

```text
plugins/proteus/skills/chimera-agent/SKILL.md
```

Purpose: teach OpenCode-backed agents how to operate inside Chimera.

It should include:

- You are a secondary Proteus agent, not the final authority.
- Read `dossier.md`, `contract.md`, `agent-instructions.md`, and `skills/*.md`.
- Respect the coordinator-selected access mode.
- Prefer your session directory and `lab/` for research artifacts.
- Use Proteus CLI for communication:
  - `proteus chimera post`
  - `proteus chimera snapshot`
  - `proteus chimera heartbeat`
- Poll coordinator and peer messages periodically with `proteus chimera poll`.
  Check before long work, after completing a branch, after meaningful pivots,
  before finalizing, after heartbeat, and whenever `notifications.json` changes.
  Treat `priority: true` as a request to poll as soon as practical.
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
proteus chimera council start|accept|open-round|turn|status|close
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
proteus chimera run --id CH-0001
proteus chimera attach-opencode --id CH-0001 --server-url http://127.0.0.1:4096 --opencode-session-id ses_xxx
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
- launch OpenCode if `--background` or configured start mode asks for execution;
- return `sessionId`, paths, and next coordinator action.
- when `--run` is used, start or reuse a local OpenCode server, run OpenCode
  against the existing session directory, discover the matching `ses_...`
  session from the server by title/directory, and persist it on the Chimera
  session.

### run

```text
proteus chimera run --id CH-0001
```

Reuses an existing Chimera lab/session directory instead of creating another
agent. If an OpenCode `ses_...` id is already attached, use it. Otherwise run
OpenCode with title `proteus-CH-0001`, discover the resulting OpenCode session,
and persist it.

### send

```text
proteus chimera send --id CH-0001 --message "Drop the cache angle and focus on parser side effects." --priority
```

Writes a coordinator message for the agent. `--priority` updates the
destination notification marker so a running agent knows to poll as soon as
practical. If the session has an attached OpenCode server and `ses_...` id,
`--priority` also sends `delivery=steer` so the running OpenCode agent receives
an immediate ping to poll Proteus.

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
- attempt to terminate the OpenCode process if Proteus owns the PID;
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
proteus_chimera_stop_server
proteus_chimera_start
proteus_chimera_swarm
proteus_chimera_council
proteus_chimera_send
proteus_chimera_post
proteus_chimera_snapshot
proteus_chimera_heartbeat
proteus_chimera_run
proteus_chimera_attach_opencode
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

## OpenCode Invocation

Managed server path:

```text
opencode serve --hostname 127.0.0.1 --port <managed-port>
opencode run --attach http://127.0.0.1:<managed-port> --format json --thinking --dir .vros/chimera/sessions/CH-0001 --file .vros/chimera/sessions/CH-0001/opencode/prompt.md --title proteus-CH-0001 --agent proteus-chimera --model zai/glm-5.2 --variant high --dangerously-skip-permissions
```

After run, query `GET /session` and persist the matching OpenCode session id on
the Chimera session. Match by title `proteus-CH-0001`, session directory, and
most recent update time.

The coordinator can omit `--dangerously-skip-permissions` only if the generated
OpenCode agent permissions are sufficient for the task and will not ask for
interactive approval. Chimera defaults to non-interactive runs because the
coordinator cannot approve prompts inside a secondary agent.

Proteus should capture:

```text
opencode/stdout.log
opencode/stderr.log
opencode/run.json
```

OpenCode JSON events are parsed for a compact final assistant message, but
Proteus does not depend on the transcript as the primary communication channel.
Agents are instructed to communicate via `proteus chimera
post/broadcast/snapshot/heartbeat/poll`.

History semantics:

- `proteus chimera poll` returns the Proteus message history: coordinator
  messages, agent posts, snapshots, heartbeats, kill/close events, and latest
  snapshots from SQLite.
- `.vros/chimera/sessions/<id>/inbox.jsonl` and `outbox.jsonl` mirror Proteus
  broker traffic.
- `transcript.jsonl` records OpenCode run/direct-steer metadata.
- OpenCode's own full chat history remains in the OpenCode session store and is
  addressable through the persisted `opencodeSessionId`; a future sync/export
  command can import it when deeper forensic history is needed.

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

Use generated OpenCode agent permissions to reinforce the contract when
possible, but do not rely on them as the only enforcement layer. The prompt,
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

### Phase 2: OpenCode Launch

- Add OpenCode doctor checks.
- Generate OpenCode prompt from dossier/skills.
- Launch OpenCode with timeout and process tracking.
- Capture stdout/stderr/run metadata.
- Verify agent can use `proteus chimera post`.
- Add tests using a mock OpenCode command before requiring real OpenCode in CI.

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
- Validate normal Proteus usage without OpenCode installed.
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
- Normal `npm test` passes without OpenCode installed.
- Mock OpenCode command verifies prompt generation, process capture, timeout, and
  transcript preservation.

Manual validation:

- Configure OpenCode with the user's intended GLM model.
- Run one Cicada session on a harmless local target.
- Run one three-agent swarm with read-only repo and separate labs.
- Confirm coordinator can recover unread messages without reading files.
- Confirm agents can use Proteus CLI to post, snapshot, and heartbeat.

## Acceptance Criteria

- Chimera is disabled by default and normal Proteus works without OpenCode.
- `proteus chimera doctor` gives actionable setup status.
- Coordinator can start, message, poll, kill, and close a OpenCode-backed agent
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

- Which exact OpenCode CLI flags are stable across the version the user wants to
  support?
- Should OpenCode run once per turn or as a longer background process in 2.0.0?
- Should `post` support structured JSON bodies or only Markdown plus metadata?
- Should close automatically checkpoint an active campaign, or only suggest it?
- Should network be globally disabled in Chimera v1 or controlled by config?

## Recommended 2.0.0 Scope

Ship the smallest complete system:

- OpenCode-only runtime.
- Optional config.
- Local session/lab directories.
- Proteus-managed messages.
- Start/send/post/snapshot/heartbeat/poll/list/kill/close.
- Swarm.
- Coordinator-selected access mode with `lab` as default.
- Base and role-specific skill injection.
- Agent-output recording on close.
- Robust tests with mock OpenCode.

Defer edit-capable agents, locks, leases, multiple runtime adapters, ACP, and
fine-grained permission matrices until the core Chimera loop is proven useful.
