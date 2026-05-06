---
name: continuous-vuln-research
description: Run disciplined, continuous, professional vulnerability research against a codebase using structured memory, coordinator-authored round planning, multi-agent heuristics, realistic validation, and anti-slop report gates.
---

# Proteus Continuous Vulnerability Research

Use this skill when the user asks for deep vulnerability research, continuous
codebase security analysis, exploitability-driven review, coordinated
multi-agent hunting, PoC validation, or professional bug bounty style research.

## Core Rule

This is not normal code review. The goal is to find or rule out realistic,
externally exploitable vulnerabilities with concrete impact and root cause in
the target.

Do not promote weak hypotheses, expected behavior, duplicate findings,
integration-only problems, forced vulnerable configuration, or lab artifacts.

## Host Capability Usage

When the host assistant session provides stronger orchestration capabilities,
use them to make Proteus more efficient and less repetitive:

- If the user explicitly requests continuous work, a persistent campaign, or
  "do not stop until the plugin/research is finished", use the available goal or
  campaign mechanism to bind the objective, budget, and stop conditions.
- If subagents or parallel delegation are available and allowed by the session,
  use them for independent, bounded Proteus fronts instead of doing every front
  serially in the coordinator context.
- Map each delegated subagent to one Proteus codename and one bounded surface:
  Argus, Loom, Chaos, Libris, Mimic, Artificer, or Skeptic.
- Keep the coordinator responsible for target strategy, memory updates, ROI
  selection, validation gates, kill/promote decisions, and replanning.
- If goal/campaign mode, subagents, MCP tools, or the CLI are unavailable,
  continue with the same Proteus workflow locally and record the limitation in
  memory or the round log.

Do not use subagents for vague repo-wide review. Do not use persistent
goal/campaign mode without a user-requested persistent objective. These
capabilities improve orchestration; they do not weaken the evidence,
validation, or anti-slop gates.

## Coordinator Loop

For every target, run:

```text
Observe -> Map -> Hypothesize -> Prioritize -> Delegate -> Validate -> Kill/Promote -> Replan
```

Before any broad exploration, define or load:

```text
Target:
Scope root:
In-scope repos/packages:
Out-of-scope:
Existing findings/reports/logs/advisories to dedupe:
Primary impact classes:
Hard exclusions:
Supported deployment/configuration assumptions:
Available local tooling:
Credentials or fixtures available:
Continuous mode: off | on
Stop-on-candidate: yes | no
```

## Required Round Plan

Each research round needs:

```text
Round objective:
Current target understanding:
Selected high-ROI surfaces:
Skipped surfaces and why:
Prior killed paths to avoid:
Agent fronts:
Host capabilities to use:
Validation gates:
Expected evidence:
Stop conditions:
Replan trigger:
```

Never ask an agent to "review the repo". Assign a bounded surface, a heuristic,
and kill criteria.

When subagents are available, each item in `Agent fronts` must include the
codename, exact surface, heuristic family, expected artifact, and kill criteria.
When a persistent goal or campaign is active, align `Stop conditions` and
`Replan trigger` with it so the campaign does not drift.

Do not treat `proteus_plan_round` or `proteus plan-round` as an autonomous
target-selection oracle. It is a formatter and memory recorder for a
coordinator-authored plan, or an empty scaffold when the plan has not been
written yet. For non-trivial targets, supply target-specific
`currentUnderstanding`, `selectedSurfaces`, `skippedSurfaces`, `agentFronts`,
`stopConditions`, and `replanTrigger` from the coordinator's analysis.

Do not ask Proteus runtime commands to generate rational security knowledge.
Use them to initialize, ingest, observe factual environment data, query memory,
record evidence, and render explicitly supplied planning content. Query global
learnings separately, review them in the coordinator context, and manually fold
only relevant items into the round plan.

Treat `.vros/memory.sqlite` as the source of truth. Local Markdown files are
exports for human reading, not the primary state store. Use
`proteus query duplicates` to check whether an area, candidate, primitive, root
cause, or impact has already been covered. It returns compact coverage rows;
use `proteus show <entityType> <id>` when the full record is needed. Use
`proteus query memory` only for broad exploratory full-text search.

When using `proteus plan-round --plan-json`, write a JSON file with this shape
before calling the command. The packaged template is
`plugins/proteus/templates/round-input.json`:

```json
{
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
  "skippedSurfaces": [
    {
      "id": 2,
      "name": "Specific skipped surface",
      "family": "short-family-name",
      "roiScore": 0,
      "reason": "Coordinator-written skip reason.",
      "files": [],
      "revisitCondition": "When to reconsider it."
    }
  ],
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

Valid `codename` values are `argus`, `loom`, `chaos`, `libris`, `mimic`,
`artificer`, and `skeptic`.

## Hypothesis Heuristics

Prefer:

- state and authority drift;
- validation/use mismatch;
- auth/authz/session boundary confusion;
- cache key or state authority bugs;
- adapter/runtime divergence;
- parser differential and canonicalization drift;
- generated code or manifest mismatch;
- webhook, callback, retry, or replay behavior;
- trusted metadata crossing an external boundary;
- composition bugs where two safe features combine unsafely;
- docs/tests/security contract violations;
- recently introduced security-relevant changes.

Avoid:

- generic TODO findings;
- vague best-practice claims;
- one-off lab behavior;
- unrealistic attacker control;
- weak crashes or weak DoS;
- integration-only issues outside target responsibility;
- known or expected behavior;
- repeated low-ROI surfaces without a new reason.

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

Before any vulnerability claim, run an explicit pre-claim review:

```text
Libris/intel:
- search local findings, reports, changelogs, advisories, CVEs/GHSAs, issues,
  PRs, releases, discussions, docs, tests, and public writeups;
- identify affected versions and the likely introduction commit, PR, release,
  or feature window;
- record exact queries, sources, dates checked, and why the behavior is not
  already known, documented, patched, or expected.

Skeptic:
- argue the strongest case that the candidate is expected, duplicate,
  integration-only, misused, lab-created, low impact, or missing an attacker
  boundary;
- require evidence-backed rebuttals for each argument;
- block report-grade promotion if any refutation remains unresolved.
```

Do not say "not known" or "novel" unless the intel/timeline search is recorded.
If internet access or public intel tooling is unavailable, status must remain
`Candidate` or `Watchlist`, not `Report-grade`.

Immediate kill reasons:

- expected/documented behavior;
- duplicate;
- no realistic attacker boundary;
- weak crash or weak DoS;
- integration-only;
- explicitly unsafe configuration only;
- lab-created behavior;
- unresolved Skeptic refutation;
- incomplete public intel or timeline;
- stale UI or metadata without authority;
- old trivial bug with weak impact.

## Structured Memory

Use the Proteus runtime when available. The memory database lives in the target
workspace under `.vros/memory.sqlite`; Markdown files under `.vros/exports/`
are exports, not the source of truth.

Use global learnings for reusable cross-target memory, not target-specific
evidence. Global learnings live under `~/.vros/global.sqlite` and may store user
preferences, research heuristics, validation patterns, anti-patterns, targeting
strategy, tooling notes, and playbook material.

Use memory commands as part of the research loop, not as bookkeeping after the
fact. The coordinator should update memory whenever the result changes future
work:

- Use `proteus status` at the start of a session or after reinstalling/runtime
  changes to confirm the target is initialized and to see whether SQL memory
  already contains sources, hypotheses, decisions, rounds, and agent outputs.
- Use `proteus ingest` when local prior work exists in `findings/`, `REPORTS/`,
  `reports/`, `docs/`, or target-specific research logs. Re-run it after adding
  or editing important local notes; `unchanged` means the same content hash is
  already in memory.
- Use `proteus query duplicates` before spending time on a candidate, surface,
  primitive, root cause, or impact claim. Treat results as prior coverage hints,
  not automatic kills. If a result looks relevant, call
  `proteus show <entityType> <id>` and read the full record before deciding.
- Use `proteus query memory` for broad exploratory search when you need raw text
  recall. Do not use broad FTS results as a duplicate verdict without checking
  the full record.
- Use `proteus record hypothesis` as soon as a concrete candidate, watchlist
  item, or discarded idea has a name, primitive, attacker boundary, and impact
  claim. Record weak or killed ideas too if they are likely to be rediscovered.
- Use `proteus record evidence` for command output, PoC results, negative
  controls, code-reading notes, docs/intel references, and other facts that
  support or kill a hypothesis.
- Use `proteus record decision` whenever the coordinator promotes, downgrades,
  discards, blocks, or keeps watching an entity. The reason should be specific
  enough that a later agent can avoid repeating the same path.
- Use `proteus record agent-output` after Argus, Loom, Chaos, Libris, Mimic,
  Artificer, or Skeptic returns. Record covered areas, live candidates, killed
  hypotheses, probes, uncovered areas, and validation status.
- Use `proteus update surface` when a surface is covered, exhausted, low ROI,
  blocked, or watchlisted. Always include a revisit condition that explains what
  would make the surface worth reopening.
- Use `proteus learn add` only for reusable cross-target lessons: user
  preferences, validation patterns, anti-patterns, tooling notes, and general
  strategy. Do not store target-specific evidence as a global learning.
- Use `proteus export` when the user needs readable artifacts or when ending a
  substantial round. Do not treat exports as the canonical database.

Preferred command flow:

```text
proteus init --root <target-root> --name <target>
proteus ingest --root <target-root> findings REPORTS reports docs
proteus observe --root <target-root>
proteus plan-round --root <target-root> --objective "<objective>" --plan-json round-input.json --write
proteus query duplicates --root <target-root> "<candidate text>"
proteus show --root <target-root> <entityType> <id>
proteus record hypothesis --root <target-root> --title "<title>" --impact "<impact>"
proteus record agent-output --root <target-root> --round-id <id> --role argus --surface "<surface>"
proteus update surface --root <target-root> --id <id> --status exhausted --revisit "<condition>"
proteus lab create --root <target-root> --candidate-id <id> --name <name>
proteus learn query --root <target-root> --target-scope
proteus learn add --category validation_pattern --scope "<scope>" --title "<title>" --body "<lesson>"
proteus export --root <target-root>
```

If the runtime is unavailable, keep files in the target workspace under
`.vros/exports/` using the same schema names:

```text
surface-map.md
candidate-register.md
discarded.md
watchlist.md
research-log.md
round-plan-<id>.md
```

Each meaningful decision must record:

- entity;
- decision;
- reason;
- evidence;
- revisit condition.

Discarded hypotheses are valuable. Record enough detail so future rounds do not
repeat them.

Global learnings must be scoped and conservative. Do not record a target finding
as a global truth. Use global memory for reusable lessons such as "prefer WSL for
Linux-first stacks", "reject SDK reports whose root cause is only an insecure
integration", or "the user prefers realistic exploitability over weak
best-practice claims".

## Agent Fronts

Use these fronts as reusable splits:

- Argus: component-level review. Inspects local primitives and covered modules.
- Loom: macro/chaining analysis. Connects components into emergent attack paths.
- Chaos: fuzzing and edge-case generation. Produces anomaly matrices and probes.
- Libris: docs/contract verification. Checks official docs, tests, issues,
  advisories, public-known behavior, and intro/fix timeline.
- Mimic: runtime/adapter/environment divergence. Compares supported modes and
  deployment profiles.
- Artificer: PoC builder. Creates realistic labs and didactic validation.
- Skeptic: devil's advocate. Tries to refute, downgrade, or kill the finding.

Artificer starts only after initial gates pass. Skeptic starts only after
technical evidence exists. A candidate cannot become report-grade until Skeptic
and Libris have both produced recorded outputs for the pre-claim review.

When the host supports subagents or parallel delegated work, use the packaged
role contracts as the source of truth for delegated fronts. These contracts must
be resolved from the Proteus plugin/package location, never from the target
workspace.

Role contract filenames:

```text
proteus-argus.md
proteus-loom.md
proteus-chaos.md
proteus-libris.md
proteus-mimic.md
proteus-artificer.md
proteus-skeptic.md
```

Resolve contracts in this order:

```text
1. From this skill file:
   <SKILL.md directory>/../../agents/<contract>.md

2. From the host-exposed Proteus plugin root, when available:
   <proteus plugin root>/agents/<contract>.md

3. From an installed Codex plugin cache:
   $CODEX_HOME/plugins/cache/proteus-marketplace/proteus/*/agents/<contract>.md
   or ~/.codex/plugins/cache/proteus-marketplace/proteus/*/agents/<contract>.md

4. In Claude Code, prefer the native installed plugin subagents shown in
   `/agents`; only use filesystem lookup if Claude exposes the installed
   Proteus plugin package root.
```

For Codex, the coordinator should read the relevant contract itself and inline
the role requirements into the spawned subagent prompt together with the
target-specific surface, files, objective, evidence, and kill criteria. Do not
ask the spawned subagent to open these paths from the target workspace.

For Claude Code, these same files are plugin subagents and should appear in
`/agents` after installation. Even there, the coordinator should still provide
the specific objective, target context, evidence, and stop criteria for each
delegation.

If the host has no subagent facility, use the contracts as local execution
checklists.

## Packaged Templates

Use the packaged templates when creating structured handoff files, report
drafts, labs, or exports outside the CLI-generated defaults. Templates must be
resolved from the Proteus plugin/package location, never from the target
workspace.

Template filenames:

```text
research-contract.md
round-plan.md
candidate-register.md
report-draft.md
```

Resolve templates in this order:

```text
1. From this skill file:
   <SKILL.md directory>/../../templates/<template>.md

2. From the host-exposed Proteus plugin root, when available:
   <proteus plugin root>/templates/<template>.md

3. From an installed Codex plugin cache:
   $CODEX_HOME/plugins/cache/proteus-marketplace/proteus/*/templates/<template>.md
   or ~/.codex/plugins/cache/proteus-marketplace/proteus/*/templates/<template>.md

4. In Claude Code, use the installed Proteus plugin package root if the host
   exposes it. Otherwise, follow the report and memory structure described in
   this skill.
```

If a packaged template is unavailable, recreate the same section structure from
this skill instead of inventing a new format.

## Lab Rules

Allowed:

- default or documented config;
- normal correct-practice setup;
- realistic users, roles, tenants, projects, tokens, and fixtures;
- local reproduction of externally reachable flows;
- negative controls.

Not allowed:

- disabling security controls without documentation;
- patching target code to create the bug;
- relying on test-only bypasses;
- treating debug-only behavior as production impact without scope support;
- removing the real attacker boundary.

## Report Draft Rules

Write report drafts for triage, not for internal project documentation. The
reader should understand the bug, impact, and reproduction path without knowing
Proteus, the workspace, the agent roles, or the research process.

Style:

- use natural, direct language;
- be concise, didactic, and specific;
- explain the root cause in simple terms before going deep;
- explain impact as a realistic attacker scenario, not as abstract severity;
- avoid unnecessary sections, filler, and process narration;
- avoid LLM-style phrasing such as "this is not about X, it is about Y";
- avoid em dashes, ornate transitions, and generic hype;
- do not mention Proteus, `.vros`, internal memory, subagents, local workspace
  paths, or "Skeptic/Libris/Artificer" in the submitted report;
- preserve uncertainty where evidence is incomplete.

Required report substance:

```text
Title:
CWE:
Summary:
Root cause, when applicable:
PoC details, when applicable:
Steps to reproduce:
Impact:
```

Only include sections that help triage. If a program has its own template, map
the same substance into that template instead of forcing this exact structure.
Add other sections only when the program asks for them or the triage context
specifically needs them.

PoC presentation:

- prefer manual, blackbox-style reproduction steps when possible;
- use `curl`, browser actions, HTTP requests, CLI commands, or normal attacker
  workflows before abstract automated harnesses;
- if automation is necessary, also explain the underlying manual sequence;
- present the PoC as a realistic high-impact scenario with attacker and victim
  roles, tenants, projects, tokens, or resources;
- make every step understandable to someone with zero prior context;
- include short snippets only when they clarify how the PoC works;
- explain what each snippet does and what output proves the issue;
- keep negative controls visible so triage can distinguish the bug from lab
  setup or misconfiguration.

## Output Verdicts

Use consistent verdicts:

```text
Report-grade:
Root cause, exploit path, impact, docs/contract, negative controls, local dedupe,
public intel/timeline, and Skeptic rebuttal are strong.

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
