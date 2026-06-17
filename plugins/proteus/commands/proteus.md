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
proteus list rounds --root <target-root> --status active
proteus plan-round --root <target-root> --objective "<objective>" --plan-json round-input.json --status active --write
proteus query duplicates --root <target-root> "<candidate text>"
proteus show --root <target-root> <entityType> <id>
proteus record hypothesis --root <target-root> --title "<title>" --impact "<impact>"
proteus record agent-output --root <target-root> --round-id <id> --role argus --surface "<surface>"
proteus update round --root <target-root> --id <id> --status completed
proteus update rounds --root <target-root> --from planned --status superseded --keep-latest
proteus update surface --root <target-root> --id <id> --status exhausted --revisit "<condition>"
proteus lab create --root <target-root> --candidate-id <id> --name <name>
proteus export --root <target-root>
```

Use `query duplicates` only for compact finding/report duplicate checks. Use
`query memory` for broad text search, and use structured lists such as
`list decisions`, `list evidence`, `list gates`, `list surfaces`, and
`list rounds --status active` to decide whether an area was already killed,
blocked, downgraded, covered, or part of the current plan. Use `show` to inspect
a full record from a returned `entityType#id`.

Use `superseded` for old or replaced plans that should remain searchable but
must not be treated as active or queued work. For legacy workspaces with many
stale `planned` rounds, run `proteus update rounds --from planned --status
superseded --keep-latest`, then inspect the remaining planned round.

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
- `proteus-skeptic`: devil's advocate and pre-claim refutation;
- `proteus-cicada`: exploit-development, bypass, and chaining for branches with concrete signal.

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

Write reports for triage, not for Proteus. If the user, program, or platform
provides a template or custom instructions, follow that structure first. Do not
add extra sections that are not in the template unless they are truly necessary
for triage.

Use natural, objective, concise language. The report should not read like a
legal document, a checklist, a questionnaire, or an AI-generated worksheet. A
human with zero prior context should understand the flaw in simple terms, the
realistic impact, and the reproduction path without reading internal research
notes.

Include likely triager questions organically in the prose, usually in the
summary or existing template fields: why the attacker boundary is realistic, why
the target owns the root cause, why the behavior is not expected, what the
victim loses, and why the PoC is not a lab artifact. Do not create a separate
section for every gate or validation concern unless the supplied template asks
for it.

Avoid em dashes, filler, unnecessary sections, long bullet lists, legalistic
caveats, generic hype, and phrases like "this is not about X, it is about Y".
Do not mention Proteus, `.vros`, Claude subagents, workspace paths, memory
records, or internal workflow in a submitted report.

When adjusting a report, write the final report text for the external triager.
Do not answer the user, narrate the edit, cite local workspace details, or keep
context that only exists in the local research session.

Avoid common LLM habits: defensive phrasing, unnecessary caveats, reframing the
Impact section around what the issue is not, headings or transitions like "Why
this matters", "This matters", or "This is security relevant because", and em
dashes.

Impact should preferably be bullet points listing concrete impacts only. Do not
use Impact to explain prerequisites, caveats, or why the bug is security
relevant. Put necessary conditions in the Summary, PoC Details, or Limitations.

Steps To Reproduce should keep each step to an action title and expected output.
Do not include long redundant explanations in the numbered steps. Put output
interpretation in PoC Details or immediately after the steps.

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

## Round Input JSON

When recording a round through `proteus plan-round --plan-json`, the coordinator
must write the JSON first. The packaged template is
`plugins/proteus/templates/round-input.json`.

```json
{
  "status": "active",
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
  "skippedSurfaces": [],
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
