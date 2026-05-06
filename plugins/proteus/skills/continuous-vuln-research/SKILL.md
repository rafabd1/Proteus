---
name: continuous-vuln-research
description: Run disciplined, continuous, professional vulnerability research against a codebase using structured memory, ROI-based surface planning, multi-agent heuristics, realistic validation, and anti-slop report gates.
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

Preferred command flow:

```text
proteus init --root <target-root> --name <target>
proteus ingest --root <target-root> findings REPORTS reports docs
proteus observe --root <target-root>
proteus plan-round --root <target-root> --objective "<objective>" --write
proteus query duplicates --root <target-root> "<candidate text>"
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
role contracts under `../../agents/` as the source of truth for the delegated
fronts:

```text
../../agents/proteus-argus.md
../../agents/proteus-loom.md
../../agents/proteus-chaos.md
../../agents/proteus-libris.md
../../agents/proteus-mimic.md
../../agents/proteus-artificer.md
../../agents/proteus-skeptic.md
```

For Codex, read the relevant contract and pass its role requirements into the
subagent prompt when spawning an available subagent. For Claude Code, these same
files are plugin subagents and should appear in `/agents` after installation.
If the host has no subagent facility, use the contracts as local execution
checklists.

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
