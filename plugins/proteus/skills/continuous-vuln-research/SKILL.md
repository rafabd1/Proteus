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

## Proteus State

Treat `.vros/memory.sqlite` as the source of truth. Markdown exports are human
views, not canonical state.

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
