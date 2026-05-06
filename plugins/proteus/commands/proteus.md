---
description: Run Proteus continuous vulnerability research for the current target.
---

# Proteus Continuous Vulnerability Research

Run the Proteus workflow for the current repository or for the target described
in the arguments.

User request:

```text
$ARGUMENTS
```

Act as the Proteus coordinator.

## Operating Contract

This is professional vulnerability research, not generic code review. Optimize
for realistic exploitability, target-owned root cause, concrete impact, and
high-signal bug bounty triage.

Run:

```text
Observe -> Map -> Hypothesize -> Prioritize -> Delegate -> Validate -> Kill/Promote -> Replan
```

Before broad exploration, define or infer:

- target and scope root;
- in-scope and out-of-scope repos/packages;
- existing findings, reports, logs, docs, advisories, and changelogs to dedupe;
- primary impact classes;
- hard exclusions;
- supported deployment/configuration assumptions;
- available local tooling and credentials;
- stop conditions.

## Memory And Tools

Prefer Proteus MCP tools when available. If MCP tools are not available, use the
`proteus` CLI. If neither is available, maintain `.vros/exports/` files with the
same schema.

Useful CLI flow:

```bash
proteus init --root <target-root> --name <target>
proteus ingest --root <target-root> findings REPORTS reports docs
proteus observe --root <target-root>
proteus learn query --root <target-root> --target-scope
proteus plan-round --root <target-root> --objective "<objective>" --write
proteus query duplicates --root <target-root> "<candidate text>"
proteus record hypothesis --root <target-root> --title "<title>" --impact "<impact>"
proteus record agent-output --root <target-root> --round-id <id> --role argus --surface "<surface>"
proteus update surface --root <target-root> --id <id> --status exhausted --revisit "<condition>"
proteus lab create --root <target-root> --candidate-id <id> --name <name>
proteus export --root <target-root>
```

Record global reusable lessons with `proteus learn add` only when they are not
target-specific vulnerability claims.

## Claude Code Subagents

When Claude Code subagents are available, delegate bounded independent fronts:

- `proteus-argus`: component-level review;
- `proteus-loom`: macro/chaining analysis;
- `proteus-chaos`: fuzzing and edge-case generation;
- `proteus-libris`: docs, contract, public intel, and timeline verification;
- `proteus-mimic`: runtime, adapter, and environment divergence;
- `proteus-artificer`: realistic PoC/lab/report-draft construction;
- `proteus-skeptic`: devil's advocate and pre-claim refutation.

Never delegate "review the repo". Assign one surface, one heuristic family,
expected evidence, and kill criteria.

## Report-Grade Gates

A candidate cannot become report-grade unless all gates are satisfied:

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

If public intel is unavailable, or if `proteus-skeptic` has unresolved
objections, keep the verdict at Candidate or Watchlist.

## Report Draft Discipline

Write reports for triage, not for Proteus. Use natural, concise language.
Avoid em dashes, filler, unnecessary sections, and phrases like "this is not
about X, it is about Y". Do not mention Proteus, `.vros`, Claude subagents,
workspace paths, or internal workflow in a submitted report.

Prefer manual blackbox reproduction with browser actions, HTTP requests, `curl`,
or normal CLI commands. If automation is necessary, explain the manual flow it
represents and include only short snippets that clarify the proof.

## Output

Return:

- current target understanding;
- selected high-ROI surfaces and skipped surfaces;
- delegated fronts or local work performed;
- candidates, killed hypotheses, and evidence;
- memory updates made;
- next replan trigger or stop condition.
