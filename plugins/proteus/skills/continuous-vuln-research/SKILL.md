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
Validation gates:
Expected evidence:
Stop conditions:
Replan trigger:
```

Never ask an agent to "review the repo". Assign a bounded surface, a heuristic,
and kill criteria.

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
G7: public-known and expected-behavior checks are complete.
G8: affected version and timeline are understood.
G9: old/obvious classes have exceptional impact or are killed.
G10: PoC does not depend on artificial lab help.
```

Immediate kill reasons:

- expected/documented behavior;
- duplicate;
- no realistic attacker boundary;
- weak crash or weak DoS;
- integration-only;
- explicitly unsafe configuration only;
- lab-created behavior;
- stale UI or metadata without authority;
- old trivial bug with weak impact.

## Structured Memory

Use the Proteus runtime when available. The memory database lives in the target
workspace under `.vros/memory.sqlite`; Markdown files under `.vros/exports/`
are exports, not the source of truth.

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

## Agent Fronts

Use these fronts as reusable splits:

- Argus: component-level review. Inspects local primitives and covered modules.
- Loom: macro/chaining analysis. Connects components into emergent attack paths.
- Chaos: fuzzing and edge-case generation. Produces anomaly matrices and probes.
- Libris: docs/contract verification. Checks official docs, tests, issues,
  advisories, and public-known behavior.
- Mimic: runtime/adapter/environment divergence. Compares supported modes and
  deployment profiles.
- Artificer: PoC builder. Creates realistic labs and didactic validation.
- Skeptic: devil's advocate. Tries to refute, downgrade, or kill the finding.

Artificer starts only after initial gates pass. Skeptic starts only after
technical evidence exists.

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

## Output Verdicts

Use consistent verdicts:

```text
Report-grade:
Root cause, exploit path, impact, docs/contract, negative controls, and dedupe
are strong.

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
