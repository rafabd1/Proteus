# Chimera Mode

Chimera mode is the optional Proteus runtime for OpenCode-backed co-agents. It
lets the coordinator launch secondary agents with a bounded goal, Proteus
context, role skills, a private lab, message flow, snapshots, and kill/close
control.

Chimera is not required for normal Proteus usage. CLI commands, MCP tools,
campaign memory, exports, labs, and skills work without OpenCode.

## OpenCode

Proteus uses OpenCode as the Chimera execution runtime. Install and configure
OpenCode by following the official project:

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode docs: <https://opencode.ai/docs/>

Proteus does not manage provider credentials. Configure the model/provider in
OpenCode first, then point Proteus at the OpenCode command and model name.
When a Chimera run needs the OpenCode server API, Proteus reuses the configured
server URL if it is healthy. Otherwise it scans the managed local range and
reuses the first healthy OpenCode server it finds, so multiple coordinator
chats can share one server. If no healthy server is available, Proteus starts a
managed local server on the first free port in the range.

## Enable Chimera

Configuration is global for the current user and persistent across workspaces.
It is stored outside target workspaces under the user's
`.vros/chimera/config.json`.

```powershell
proteus chimera config init --opencode-command opencode --model zai/glm-5.2 --variant high
proteus chimera doctor --root C:\path\to\target
```

If OpenCode is outside `PATH`, pass the executable path as
`--opencode-command`. `maxAgents` defaults to 5. Chimera runs have no default
wall-clock timeout. Use `--timeout N` only for an intentionally bounded smoke
test or short probe, and use `chimera kill` or `chimera close` to stop normal
research sessions. Passing `--timeout 0` stores the no-timeout behavior
explicitly.

`doctor`, `start`, `run`, messages, sessions, and labs still receive `--root`
because they operate on a specific workspace. `config` does not need `--root`.

## Co-Agent Sessions

A Chimera session has an id such as `CH-0001`.

```powershell
proteus chimera start --root C:\path\to\target --role chaining --goal "Develop non-obvious chains from branch B7"
```

`start` creates the lab, writes the dossier and contract, and starts OpenCode
bootstrap automatically. `starting` and `running` are live states. `stopped`
means the Chimera session is persisted and reusable, but no Proteus-controlled
OpenCode process is necessarily listening. `kill`, `close`, failed runs, and
completed runs all leave a reusable stopped session with the verdict or summary
stored separately. Use `run` only when intentionally resuming or recovering an
existing non-running session into another work cycle:

```powershell
proteus chimera run --root C:\path\to\target --id CH-0001 --message "Continue the same front, but prioritize parser side effects."
```

Create new co-agents only when there is a distinct research front, role, model,
or lab need. For continuation of the same bounded front, inspect the existing
session with `poll`, `workflow-snapshot`, and `heartbeat`, then use normal
`send` to queue a message, `send --priority` to nudge a parked/live agent to
poll, or `run --message` only when the session should do another full work
cycle. `run` and priority `wake` do not time out by default, so an active
OpenCode agent can keep working until it finishes, blocks, is killed, or is
closed.

Use `chimera list --active` when you only want sessions that are actually
`starting` or `running`. Without `--active`, `chimera list` defaults to sessions
linked to currently active campaigns. When multiple campaigns are active, it
returns sessions from all of them and each session includes its campaign label.
Use `--all` to inspect historical sessions outside the active campaign set.

If status, pid, or OpenCode session attachment looks stale, use `recover`
before deciding to start a new session or run an existing one again:

```powershell
proteus chimera recover --root C:\path\to\target --id CH-0001
```

Chimera is for parallel co-agent fronts, not step-by-step supervision. The
coordinator should launch a session with enough context, scope, access limits,
expected artifact, and stop conditions for the co-agent to reason and probe
independently. After launch, use `poll`, `workflow-snapshot`, agent-authored
snapshots, heartbeats, and checkpoints to observe progress. Intervene when
strategy, scope, duplicate work, low-ROI drift, blockers, new evidence, or user
instructions require it.

Large agent snapshots are stored in full at
`.vros/chimera/sessions/<CH-ID>/snapshot.md`. `chimera poll` returns a bounded
preview plus `bodyLength`, `bodyTruncated`, and `fullBodyPath` so the
coordinator can inspect the full snapshot only when needed.

`workflow-snapshot` depends on OpenCode session export. Proteus retries short
transient export failures and returns export attempt diagnostics, but an export
failure by itself does not prove the co-agent crashed or lost state. Check
`poll`, `list --active`, latest snapshots, and `recover` before killing or
restarting a useful session.

Session state is stored under:

```text
.vros/chimera/sessions/<CH-ID>/
  dossier.md
  contract.md
  agent-instructions.md
  inbox.jsonl
  outbox.jsonl
  transcript.jsonl
  notifications.json
  snapshot.md
  opencode/
  lab/
  skills/
```

SQLite memory remains the source of truth. JSONL and Markdown files are local
mirrors for inspection and recovery.

The session directory holds the per-agent dossier, prompt, status, transcript
mirrors, and private lab. Skill files are linked from the installed Proteus
package when the filesystem allows it; Proteus falls back to generated copies
only when links are unavailable.

## Agent Context

Each co-agent receives:

- a compact dossier with target context, goal, role, allowed actions, stop
  conditions, campaign/round links, and output requirements;
- the Chimera contract explaining that it is a co-agent, not a normal
  lightweight subagent;
- exact Proteus communication commands;
- the `chimera-agent` skill as the primary co-agent contract, including the
  Proteus gates and research discipline adapted to secondary agents;
- a `skills/README.md` index showing injected skills and available specialist
  skills, including the package path for coordinator-directed consultation;
- the role-specific skill when available, or all non-coordinator specialist
  skills for `generalist` sessions;
- a private lab for notes, evidence, scripts, and PoC material.

Every co-agent is a `CH-...` session with its own assigned `campaignId`,
`roundId`, access mode, and lab path. When a co-agent records evidence,
hypotheses, decisions, gates, branches, or agent output through Proteus, the
CLI links the record to the assigned campaign and round from that session. This
avoids ambiguity when several campaigns are active.

Co-agents must run Proteus against the shared workspace root, not their lab or a
package subdirectory. Generated contracts and skills include commands with
`--root C:\path\to\target`, and the CLI rejects Chimera-session commands when
`PROTEUS_TARGET_ROOT` does not match the selected root.

The coordinator leads strategy and validation. Chimera agents run independent
research fronts and bring different angles, but they do not promote findings or
bypass Proteus gates.

Do not create a new session for every coordinator turn. Use
`proteus chimera list --root ...` first, inspect role, goal, campaign label,
status, lab path, and `opencodeSessionId`, then reuse the existing `CH-...`
session with normal `send`, priority `send`, `workflow-snapshot`, or
`chimera run --id --message` when the front is still the same. Use
`chimera list --active` only when you specifically need currently live
sessions. New sessions are for genuinely separate fronts, models, access
modes, or labs.

Co-agents may read campaign context, but campaign and round state belongs to
the coordinator. From inside a Chimera session, Proteus blocks `campaign
create`, `campaign checkpoint`, `campaign close`, `plan-round`, round updates,
and manual campaign links. Agents should post a message, blocker, or snapshot
when campaign state needs coordinator action.

## Access Modes

Default access is `explorer`:

```powershell
proteus chimera start --root C:\path\to\target --role explorer --goal "Map side effects around branch B7"
```

In `explorer` mode, repository writes are out of scope and artifacts belong in
the session lab. The agent may read the workspace and use shell for read-only
inspection and lab-local scripts.

Access modes are Proteus/OpenCode coordination controls, not an operating-system
sandbox. When network is disabled in the global Chimera config, Proteus omits
OpenCode web permissions from the generated agent file. Shell access is still
governed by the coordinator's contract and access notes, so do not describe
network or write limits as hard OS isolation.

Editor access is explicit:

```powershell
proteus chimera start --root C:\path\to\target --role cicada --goal "Try bypass/chaining on branch B7" --access editor --access-notes "Allowed: edit only .vros/chimera lab and generated PoC harness files; shell may run targeted tests and non-destructive probes; ask before workspace source edits."
```

Use editor access only when the task needs it or the user grants it.
`--access-notes` is required for editor mode and should define allowed paths,
shell boundaries, destructive-command limits, network expectations, test/lab
scope, and whether workspace source edits are allowed. Even in editor mode, the
agent is instructed to create/edit files only inside its Chimera lab unless the
restrictions explicitly name another allowed workspace path and action.

## Messages

Coordinator to one agent:

```powershell
proteus chimera send --root C:\path\to\target --id CH-0001 --message "Drop parser diffing and focus on policy side effects."
```

This stores the message in the Proteus inbox only. It does not re-run the
session. Add `--priority` when the destination should be steered or woken to
poll soon:

```powershell
proteus chimera send --root C:\path\to\target --id CH-0001 --message "Poll now and answer this scope question." --priority
```

Coordinator to all active agents:

```powershell
proteus chimera broadcast --root C:\path\to\target --message "Shared pivot: B7 matters only if it crosses the policy cache boundary."
```

Broadcast only targets active Chimera sessions. Use direct `send --id` for a
stopped session that should receive queued context or be nudged back into work.

Agent to coordinator:

```powershell
proteus chimera post --root C:\path\to\target --kind message --body "Current state..."
```

Agent to agent from inside a Chimera lab:

```powershell
proteus chimera send --root C:\path\to\target --to-id CH-0002 --message "This side effect may affect your branch."
```

For commands executed by a Chimera agent inside its own session directory,
Proteus can infer the current `CH-...` id from the session environment or path.
The `--id <CH-ID>` flag is only explicit routing: coordinator commands use it
to target a session, and agent commands may use it as a portability fallback
when run from the workspace root or another cwd. Agents should use the command
Proteus provides and should not invent, swap, or manage ids manually. For
agent-to-agent `send` from outside the session directory, pass
`--from-id <CH-ID>`.

Unread messages:

```powershell
proteus chimera poll --root C:\path\to\target --unread
proteus chimera poll --root C:\path\to\target --id CH-0001 --unread
proteus chimera poll --root C:\path\to\target --unread --agent
```

`--peek` returns unread messages without marking them read.

Priority messages update the destination `notifications.json`. If an OpenCode
server and `opencodeSessionId` are attached, Proteus also sends a direct
OpenCode steer ping telling the agent to poll Proteus. If the session is parked,
Proteus uses a compact wake prompt focused on the queued message rather than
re-running the whole dossier. The canonical message still lives in Proteus.

## Snapshots

Agent-authored research snapshot:

```powershell
proteus chimera snapshot --root C:\path\to\target --body "Confirmed / killed / open / next move"
```

Coordinator snapshot of recent OpenCode assistant messages:

```powershell
proteus chimera workflow-snapshot --root C:\path\to\target --id CH-0001 --limit 8 --max-message-chars 1200
```

`workflow-snapshot` exports the attached OpenCode session and returns only
recent assistant text messages. It excludes user messages, tool calls, tool
outputs, command output, diffs, patches, and file payloads. Output is bounded by
message count and max characters per message. Proteus exports the session and
filters the raw data locally before returning or writing the compact snapshot.

## Councils

A council is an ordered, bounded brainstorm across active Chimera agents. Use
it for pivots, stalled campaigns, conflicting branch priorities, or non-obvious
chaining ideation. Do not use it for routine status updates.

```powershell
proteus chimera council start --root C:\path\to\target --topic "B7 chain pivot" --ids CH-0001,CH-0002 --max-rounds 1
proteus chimera council status --root C:\path\to\target --council-id CO-...
proteus chimera council open-round --root C:\path\to\target --council-id CO-... --round 1 --message "Give one pivot, one risk, and one next experiment."
proteus chimera council close --root C:\path\to\target --council-id CO-... --summary "..." --instruction "Resume prior work or follow this pivot."
```

Agents accept when they are free or at a safe pause point:

```powershell
proteus chimera council accept --root C:\path\to\target --council-id CO-... --body "ready"
```

When a round is opened, Proteus cues accepted participants in order. Each agent
posts exactly one turn for that round:

```powershell
proteus chimera council turn --root C:\path\to\target --council-id CO-... --round 1 --body "..."
```

After each turn, Proteus automatically cues the next accepted participant. When
the round is complete, control returns to the coordinator. `cue-turn` is manual
recovery only and requires an explicit manual flag.

Keep councils short. One round is the default, two rounds is normally enough.
The coordinator should open each round with the shared state and exact decision
needed, then close with the final instruction so agents can resume previous
work or follow the new pivot.

## Swarm

Swarm starts multiple independent sessions from a compact plan:

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
    }
  ]
}
```

Run:

```powershell
proteus chimera swarm --root C:\path\to\target --plan chimera-swarm.json
proteus chimera swarm --root C:\path\to\target --plan chimera-swarm.json --run
```

## Lifecycle

```powershell
proteus chimera heartbeat --root C:\path\to\target
proteus chimera list --root C:\path\to\target --active
proteus chimera attach-opencode --root C:\path\to\target --id CH-0001 --server-url http://127.0.0.1:4096 --opencode-session-id ses_xxx
proteus chimera stop-server --root C:\path\to\target
proteus chimera kill --root C:\path\to\target --id CH-0001 --reason "Looping without new testable signal"
proteus chimera close --root C:\path\to\target --id CH-0001 --verdict watchlist --summary "Useful ideas, no validated PoC yet"
```

## MCP Tools

```text
proteus_chimera_config
proteus_chimera_doctor
proteus_chimera_stop_server
proteus_chimera_start
proteus_chimera_swarm
proteus_chimera_council
proteus_chimera_send
proteus_chimera_broadcast
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
proteus_update_branch
```

## Validation

```powershell
npm run release:validate
```

The smoke tests use a mock OpenCode command, so CI validates Chimera control
flow without a real API key. Validate real OpenCode/provider behavior manually
before relying on Chimera in a campaign.
