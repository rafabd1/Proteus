---
name: continuous-vuln-research
description: Coordinate disciplined, continuous, professional vulnerability research with Proteus memory, campaigns, bounded delegation, validation gates, realistic exploitability, anti-slop controls, and report-grade decision discipline.
---

# Proteus Continuous Vulnerability Research

Use this skill as the universal Proteus coordinator contract. It owns research
state, strategy, delegation, gates, memory, and kill/promote decisions. It does
not contain the detailed tactics for chaining, fuzzing, codebase reading, web
research, intelligence, or PoC construction; use the dedicated skills for those.

## Core Rule

This is not generic code review. The objective is to find or rule out realistic,
externally exploitable vulnerabilities with concrete impact and root cause in
the target.

Do not promote weak hypotheses, expected behavior, duplicate findings,
integration-only problems, forced vulnerable configuration, or lab-created
behavior. Do not reduce research to a fixed bug-class checklist. Work through
primitives, invariants, trust boundaries, state transitions, interpretation
gaps, competing sources of truth, side effects, and capability amplification.

## Base Contract

All Proteus roles and skills must follow
`plugins/proteus/templates/base-research-contract.md`.

Every specialist output, checkpoint, and final round summary must include:

```json
{
  "contractSignature": {
    "status": "compliant|deviated|blocked",
    "signedBy": "proteus-role-name",
    "attackerModel": "...",
    "heuristicCoverage": [],
    "antiSlopCheck": "...",
    "deviations": [],
    "deviationRepair": null
  }
}
```

If the role deviated from the contract, it must name the deviation, repair it,
and continue from the corrected state.

## Coordinator Responsibilities

The coordinator must:

- recover active campaign, round, surfaces, branches, decisions, gates, and
  prior killed paths before opening new work;
- define scope, assumptions, attacker model, available tooling, and stop
  conditions;
- select high-ROI surfaces and branches rather than broad repo-wide review;
- delegate bounded fronts to the right skill or role;
- keep memory current as work changes future decisions;
- enforce validation gates and anti-slop checks;
- kill, downgrade, watch, or promote based on evidence;
- checkpoint after meaningful progress or branch-score changes.

Use this loop:

```text
Recover state -> Map -> Hypothesize -> Prioritize -> Delegate -> Validate -> Kill/Promote -> Checkpoint -> Replan
```

Never ask an agent to "review the repo". Assign a bounded surface or branch,
the relevant heuristic family, expected artifact, and kill criteria.

## Host Capabilities

When available and allowed:

- Use goal/campaign mechanisms only for explicit persistent objectives.
- Use subagents for independent bounded fronts, not vague broad review.
- Keep the coordinator responsible for memory, ROI, gates, and final decisions.
- If MCP/CLI/subagents are unavailable, continue manually and record the
  limitation in the round log.

Host capabilities improve orchestration; they do not weaken evidence,
validation, or anti-slop gates.

## Chimera Mode

Chimera is optional. Use it only when the target benefits from one or more
bounded secondary agents working under Proteus coordination. Normal Proteus
research must still work without Chimera or OpenCode.

Chimera agents are co-agents, not ordinary lightweight subagents. Use them as
parallel research fronts when the work benefits from a different model,
independent reasoning, broader angle coverage, deeper prototyping, or a
complete specialist investigation. For small, mechanical, or narrow helper
tasks, prefer ordinary subagents when they are available.

The coordinator leads the campaign, but Chimera is not a step-by-step remote
control mode. Launch a co-agent with enough context, scope, heuristics, access
limits, expected artifact, and stop condition for it to reason independently.
After launch, let it work. Observe through unread polling, workflow snapshots,
heartbeats, snapshots, and checkpoints instead of interrupting every command or
minor branch choice.

Before launching Chimera agents:

- run global `proteus chimera config show` or MCP `proteus_chimera_config`
  with `action=show`; this checks the user's Chimera/OpenCode runtime defaults,
  not workspace state;
- run workspace-specific `proteus chimera doctor --root <workspace>` or MCP
  `proteus_chimera_doctor`;
- confirm the active campaign/round state;
- define the role, goal, expected artifact, and stop conditions;
- include enough workspace/research context in the goal or dossier material for
  the co-agent to understand the target, current campaign state, active
  hypothesis, relevant prior findings, killed paths, constraints, intended
  strategy, and applicable Proteus heuristics/gates;
- include the local dedupe and intel baseline the agent must check before deep
  work: `proteus query similar`, `proteus query duplicates`, active branches,
  recent decisions, findings, reports, killed paths, and any public-known or
  expected-behavior context already recovered;
- make the goal and stop conditions explicit enough that the agent can keep
  working until completion or a real blocker without guessing when to stop;
- check `proteus chimera list --root <workspace> --active` before creating new
  agents; inspect role, goal, status, `labDir`, and `opencodeSessionId`;
  create a new co-agent only when there is a distinct front, role, model, or
  lab need, otherwise continue with `poll`, `workflow-snapshot`, `heartbeat`,
  or a targeted `send`;
- choose the access mode deliberately.

Access modes:

- `explorer`: default. The agent reads the workspace as needed, may use shell
  for read-only inspection and lab-local scripts, and writes research artifacts
  only inside its private Chimera lab. Repository edits are out of scope.
- `editor`: grants shell plus edit capability. Use this only when needed for
  the task or explicitly instructed by the user. The coordinator must provide
  explicit restrictions through `--access-notes`, covering allowed paths,
  shell boundaries, destructive-command limits, network expectations, test/lab
  scope, and whether workspace edits are allowed. Even in editor mode, the
  agent must create/edit files only inside its Chimera lab unless the
  restrictions explicitly name another allowed workspace path and action.

Launch examples:

```text
proteus chimera start --root <workspace> --role chaining --goal "Develop non-obvious chains from the upload parser branch"
proteus chimera start --root <workspace> --role cicada --goal "Try bypass/chaining on branch B7" --access editor --access-notes "Allowed: edit only .vros/chimera lab and generated PoC harness files; shell may run targeted tests and non-destructive probes; ask before workspace source edits."
proteus chimera swarm --root <workspace> --plan chimera-swarm.json
```

`start` creates the lab, writes the dossier and contract, and starts OpenCode
bootstrap automatically. Do not follow every `start` with `run`. `starting`
and `running` are the only live session states. `stopped` means the session is
persisted and reusable, not necessarily that a live agent is connected and
listening. `kill`, `close`, failed runs, completed runs, and legacy parked or
error states all resolve to a stopped session with verdict details stored separately.
Use normal `send` to queue a message in the session inbox. Use `send --priority`
when the destination should be nudged to poll soon. Use
`chimera run --id <CH-ID> --message "..."` only when you intentionally want to
resume a parked existing session for another work cycle without creating a new
lab. Run and wake operations have no default wall-clock timeout. Use
`--timeout N` only for a deliberate smoke test or short bounded probe. For
normal research, let the agent continue until its stop condition, blocker,
kill, or close event.

Coordinator duties:

- lead the research strategy while allowing Chimera co-agents to operate as
  independent, rational research fronts that choose their own concrete next
  probes, labs, PoCs, payloads, and validation steps inside the assigned scope;
- use `proteus chimera start` to create and auto-start a new co-agent front;
- use `proteus chimera list` first to recover reusable sessions linked to the
  active campaign set before creating new ones. When multiple campaigns are
  active, list returns sessions from all active campaigns and shows which
  campaign each session belongs to;
- use `proteus chimera list --active` only when you need sessions that are
  actually live now, meaning `starting` or `running`;
- use `proteus chimera list --all --limit <n>` only when you explicitly need
  historical sessions outside the active campaign set;
- use `proteus chimera poll` to read Proteus-brokered messages and session
  control status;
- use `proteus chimera workflow-snapshot` to inspect recent OpenCode assistant
  messages without tool-output noise;
- use `proteus chimera recover --id <CH-ID>` when status, pid, or OpenCode
  session attachment looks stale or inconsistent;
- use `proteus chimera send --id <CH-ID> --message "..."`
  for one coordinator-to-agent message. This only queues the message and does
  not re-run the session;
- use `proteus chimera send --to-id <CH-ID> --message "..."` from inside a
  Chimera session for one agent-to-agent message;
- use `proteus chimera broadcast --message "..."` only when all active agents
  should see the same shared context;
- use `--priority` only when the destination should be nudged to poll soon.
  Proteus stores the canonical message in the inbox, updates notifications,
  and steers or wakes OpenCode when possible. Priority is for delivery/attention,
  not for changing the agent's research goal by itself;
- use `proteus chimera run --id <CH-ID> --message "..."`
  only for intentional recovery or resume of an existing non-running session
  into a new work cycle. Prefer this over creating a new co-agent when the
  same old session/lab/front should continue with updated instructions. Do not
  use `run` just because a new session id exists, because `opencodeSessionId`
  is still attaching, or merely to deliver a normal message;
- use `proteus chimera kill` to stop a session and `proteus chimera close` to
  preserve final useful/killed/watchlist outcome;
- expect Proteus to reuse the saved/configured OpenCode server URL when it is
  healthy. If no configured server is healthy, Proteus reuses the first healthy
  OpenCode server in the managed local range so parallel coordinator chats can
  share one server. If none is healthy, Proteus starts a managed local server
  on a free port;
- treat `proteus chimera poll` as the authoritative Proteus broker history:
  coordinator messages, agent posts, snapshots, heartbeat, kill/close events,
  and latest snapshots. It is not the full raw OpenCode chat transcript;
- for large co-agent snapshots, read the bounded preview first. If `poll`
  marks a snapshot as `bodyTruncated`, use `fullBodyPath` to inspect the full
  `snapshot.md` only when the complete body is needed for a decision;
- when the raw OpenCode session history is needed, use the stored
  `opencodeSessionId` with OpenCode's own export/session APIs, for example
  `opencode export <ses_id>`, and keep any imported conclusions summarized back
  into Proteus messages or snapshots;
- when you only need to inspect the co-agent's recent workflow without being
  flooded by context, use `proteus chimera workflow-snapshot --root <workspace> --id CH-...`.
  It returns only the latest agent text messages from the OpenCode session,
  excluding user messages, tool calls, tool outputs, command output, diffs,
  patches, and file payloads, with bounded message count and bounded size per
  message. Proteus exports the raw OpenCode session and filters locally before
  returning the compact snapshot;
- if `workflow-snapshot` reports an OpenCode export failure, do not assume the
  co-agent crashed. Check `poll`, `list --active`, latest snapshots, heartbeat,
  and `recover` before killing, restarting, or creating a replacement session;
- kill looping or low-ROI sessions with `proteus chimera kill --root <workspace>`;
- close sessions with a verdict and summary;
- independently validate any agent claim before recording it as a finding.

Agents use Proteus to post messages, snapshots, and heartbeats. Do not manually
mine `.vros/chimera` files unless the tool path is unavailable.

Treat active Chimera sessions as a coordinated research team: strategic,
pragmatic, low-noise, and focused on efficient progress toward precise
objectives. Do not over-control every step, rewrite the agent's plan after each
observation, or ask for constant micro-updates. Redirect only when one of these
is true:

- the agent is drifting outside scope, access limits, or the assigned stop
  condition;
- the branch is duplicating known work, repeating a killed path, or spending
  time on low-ROI material;
- new evidence changes the campaign strategy, invalidates the assigned front,
  or creates a better pivot;
- the agent is blocked, looping, idle, or failing to use Proteus messages and
  snapshots;
- the user gives a new instruction that changes scope, priority, permissions,
  or stopping criteria.

Use normal Chimera messages as productive research exchange, not supervision
noise. Share facts, pivots, dedupe discoveries, scope changes, and concrete
questions. Co-agents do not need to answer every broadcast; they should answer
direct questions and messages that materially affect their branch.

Before creating a new Chimera agent, prefer to reuse an active or stopped
session with the same role/front/lab context. Use `proteus chimera list` to
check existing sessions in the active campaign set, then continue with `poll`,
`workflow-snapshot`, `heartbeat`, `send`, `send --priority`, or `run --message`
only when the session is actually parked and should start another work cycle.
Start a new co-agent only when the campaign needs a distinct front, model,
access mode, or independent lab.

### Chimera Brainstorm Council

Use a Chimera council when a checkpoint, stalled campaign, cross-campaign
pivot, or difficult branch would benefit from ordered independent perspectives.
Do not call a council for routine decisions or every minor uncertainty.

Good council triggers include: a campaign has stalled after real effort, two
branches are competing for the next round, a low-level primitive needs fresh
chaining ideas, co-agents hold complementary partial context, or the coordinator
needs a concise sanity check before a major pivot or kill decision.

A council is a short structured meeting, not a free-form chat. The coordinator
must:

- choose a narrow topic and reason;
- list the participant `CH-...` ids, roles, and current goals;
- include the current state: confirmed facts, killed paths, open branches,
  constraints, evidence gaps, relevant heuristics, and the decision needed;
- start with `proteus chimera council start --root <workspace> --topic "..." --ids CH-0001,CH-0002`
  or MCP `proteus_chimera_council` with `action=start`;
- use priority invite delivery so agents are notified directly when possible;
- let agents accept when they are free or at a safe pause point;
- check readiness with `proteus chimera council status --root <workspace> --council-id CO-...`;
- begin once all useful participants are ready, or proceed with ready agents if
  waiting longer would stall the campaign;
- open every round with a coordinator message using
  `proteus chimera council open-round --root <workspace> --council-id CO-... --round N --message "..."`
  so every participant sees the same question, constraints, and output shape.
  In the normal flow, `open-round` automatically cues the first accepted
  participant with the council transcript and required response command through
  the Proteus inbox and direct OpenCode steer when possible;
- expect the called agent to answer with `proteus chimera council turn --root <workspace>`, not by
  replying directly to the steer notification;
- after each agent posts a turn, Proteus automatically cues the next accepted
  participant in that round when one remains. The coordinator and agents should
  not manually send the turn to the next participant unless automatic advance
  was explicitly disabled for troubleshooting. Direct `cue-turn` is a manual
  recovery command and must not be used in the normal council flow. When the
  last accepted participant has answered, the round returns to the coordinator with
  `roundComplete=true`;
- check `proteus chimera council status --root <workspace> --council-id CO-...` after turns and
  before deciding whether to close, open a new round, or record a resulting
  decision/branch/checkpoint;
- rely on Proteus to reject duplicate turns from the same agent in the same
  round, and open a new round only when you intentionally extend the council;
- keep the default to one round and normally cap at two rounds. Extend only for
  a concrete unresolved high-ROI question;
- end with `proteus chimera council close --root <workspace> --council-id CO-... --summary "..."`
  and include the final decision, next actions, and whether agents should
  resume prior work or follow a redirect.

During council turns, ask each co-agent for concise, non-obvious observations:
surprising side effects, cross-component links, low-level angles, evidence
gaps, kill risks, and the next high-ROI experiment. Do not ask them to debate
every other message. Do not let the council become a loop or replace concrete
validation work.

If a council produces a useful pivot, record the resulting decision, branch,
checkpoint, or kill reason in normal Proteus memory. The council transcript is
coordination history, not proof by itself.

Each council has an exclusive logical transcript keyed by `councilId`. Messages
still live in the normal Chimera message broker, but council status, cue-turn,
and close operations filter by `councilId`, so separate councils do not mix.

## Proteus State

Treat `.vros/memory.sqlite` as the source of truth. Markdown exports are human
views, not canonical state.

Prefer the actual workspace/repository root as the Proteus root unless the user
explicitly instructs otherwise. Always be deliberate with `--root`: do not let a
nested shell location create a stray `.vros` under a package, fixture, generated
lab, or subdirectory. If a stray base appears, merge it back into the canonical
workspace base with `proteus merge --root <workspace-root> --source <nested/.vros/memory.sqlite>` or MCP `proteus_merge_memory` before continuing important recording.

Use the runtime for state, not for inventing reasoning:

- `proteus status` to confirm initialization, current DB version, and memory
  counts.
- `proteus migrate` when explicit migration verification is needed.
- `proteus campaign resume` before planning or major recording.
- `proteus list rounds --status active` before creating a new plan.
- `proteus query similar` to see duplicate/report coverage and memory matches.
- `proteus query duplicates` for narrow finding/report dedupe.
- `proteus query memory`, `list ...`, and `show ...` for broader state recovery.
- `record surface|hypothesis|evidence|decision|gate|agent-output` when a fact,
  branch, validation result, or decision changes future work.
- `branch update --id <B> --status open|testing|killed|promoted|blocked` when a
  branch state changes without a new decision record. Recording a decision on
  `entity-type hypothesis_branch` or `branch` also updates branch status when
  the decision clearly says killed, promoted, blocked, testing, candidate,
  watchlist, or open.
- `campaign checkpoint` after meaningful progress.

If exactly one campaign is active, Proteus auto-links new hypotheses, evidence,
decisions, validation gates, and agent outputs to that campaign. If there are
zero or multiple active campaigns, resolve campaign state explicitly before
important recording.

## Round Planning

Each round needs:

```text
Round objective:
Current target understanding:
Selected high-ROI surfaces or branches:
Skipped surfaces and why:
Prior killed paths to avoid:
Agent fronts:
Validation gates:
Expected evidence:
Stop conditions:
Replan trigger:
```

`proteus plan-round` and MCP `proteus_plan_round` are recorders/scaffolds, not
autonomous target-selection oracles. For non-trivial targets, the coordinator
must supply target-specific understanding, selected surfaces, skipped surfaces,
agent fronts, stop conditions, and replan trigger.

Use `superseded` for old or replaced plans that should remain searchable but no
longer represent active work.

## Dedicated Skills

Use the dedicated skills for tactical execution:

- `codebase-research`: deep code understanding, dataflow, invariants,
  side effects, trust boundaries, recent-risk areas, and branch material.
- `chaining`: non-obvious exploit chains, side effects, authority transitions,
  cross-component coupling, and primitive strengthening.
- `fuzzing`: calibrated input-reaction learning, differential probes, oracles,
  harnesses, and mutation strategy.
- `web-intel`: public-known status, expected behavior, advisories, changelogs,
  issues, PRs, docs, tests, and affected-version timeline.
- `web-research`: authorized web workflow mapping, blackbox/graybox probes,
  endpoint behavior, and web side-effect discovery.
- `poc-exploit`: realistic PoC/lab design, manual blackbox reproduction,
  negative controls, reliability notes, and impact evidence.
- `checkpoint`: compact campaign state compression after meaningful progress.
- `chimera-agent`: instructions for OpenCode-backed secondary agents operating
  inside Chimera sessions.

Use role contracts for delegated fronts:

- Argus: component-level primitive review.
- Loom: macro chaining and cross-component reasoning.
- Chaos: fuzzing and edge-case generation.
- Libris: docs/contract/intelligence verification.
- Mimic: runtime, adapter, deployment, and environment divergence.
- Artificer: realistic PoC/lab validation.
- Skeptic: adversarial refutation and downgrade pressure.
- Cicada: exploit-development, bypass, reliability, and chaining for branches
  that already have concrete signal and a known blocker.

Artificer starts only after initial gates have enough evidence. Skeptic starts
after technical evidence exists. Cicada starts only after a branch has concrete
signal. A candidate cannot become report-grade until the intelligence/timeline
review and Skeptic rebuttal are recorded.

## Contract Resolution

Role contracts and templates must be loaded from the Proteus plugin/package, not
from the target workspace.

Role contract filenames:

```text
proteus-argus.md
proteus-loom.md
proteus-chaos.md
proteus-libris.md
proteus-mimic.md
proteus-artificer.md
proteus-skeptic.md
proteus-cicada.md
```

Template filenames:

```text
base-research-contract.md
research-contract.md
round-plan.md
candidate-register.md
report-draft.md
round-input.json
```

Resolve from:

```text
1. <this SKILL.md directory>/../../agents or ../../templates
2. the host-exposed Proteus plugin root
3. the installed Codex plugin cache
4. Claude Code installed plugin package root, when exposed
```

For Codex subagents, the coordinator should read the relevant contract and
inline the role requirements into the subagent prompt together with objective,
surface, evidence, and kill criteria.

## Validation Gates

A candidate may become report-grade only if:

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

Do not say "novel", "not known", or "report-grade" unless local dedupe,
public-known/timeline, negative controls, attacker model, and Skeptic review are
recorded. If public intel tooling is unavailable, status remains `Candidate` or
`Watchlist`.

## Verdicts

Use consistent verdicts:

```text
Report-grade:
Root cause, exploit path, impact, docs/contract, negative controls, local
dedupe, public intel/timeline, and Skeptic rebuttal are strong.

Candidate:
Primitive is real, but one or more gates need validation.

Watchlist:
Dangerous or bug-shaped behavior, but impact/boundary is not enough yet.

Discarded:
Expected, duplicate, integration-only, weak, old/obvious, or no realistic
impact.

Playbook material:
Useful technique for other targets, but not a report against this target.
```

Discarded and watchlisted work is valuable. Record why it was killed or parked,
what would reopen it, and what later agents should avoid repeating.

## Report Writing Discipline

When drafting a report, follow any user, program, or platform template first.
Do not invent extra sections or heavy formatting unless they are necessary for
triage. Write for a human triager with zero context: natural, objective,
concise, and precise.

The report should explain the flaw, realistic impact, attacker boundary, target
root cause, and PoC legitimacy organically, usually inside the summary and the
existing template fields. Do not turn validation gates into a visible checklist,
questionnaire, or legal-style document. Do not mention Proteus, internal memory,
agent roles, workspace paths, or research workflow in a submitted report.

When adjusting report text, write as the external triage report itself. Do not
respond to the user, narrate local changes, cite local paths, or preserve
workspace-only context.

Avoid common LLM report habits: "this is not about X, it is about Y",
defensive phrasing, unnecessary caveats, Impact-section reframing, "Why this
matters", "This matters", "This is security relevant because", em dashes,
filler, and generic hype.

Impact should preferably be concise bullet points listing concrete consequences
only. Do not use Impact to explain prerequisites, caveats, or why the issue is
security relevant. Put necessary conditions in Summary, PoC Details, or
Limitations.

Steps To Reproduce should use action title plus expected output. Do not embed
long redundant explanations inside steps. Put output interpretation in PoC
Details or after the steps, without repeating the same proof.

## Final Output

When ending a round or handoff, report:

```json
{
  "campaignState": "...",
  "confirmed": [],
  "killed": [],
  "openBranches": [],
  "highestRoiNextMove": "...",
  "recordsCreated": [],
  "validationStatus": {},
  "remainingBlockers": [],
  "contractSignature": {}
}
```
