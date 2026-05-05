# Proteus Requirements

## 1. Product Requirements

### R1: Target Initialization

The system must initialize a target with:

- scope root;
- in-scope and out-of-scope packages;
- declared assumptions;
- available credentials or fixtures;
- existing findings/reports/logs for dedupe;
- hard exclusions;
- primary impact classes.

Acceptance criteria:

- target state is stored in structured memory;
- missing critical scope fields are visible before research starts;
- initialization can run without network access.

### R2: Existing Work Ingestion

The system must ingest prior local work:

- findings directories;
- reports directories;
- research logs;
- PoC notes;
- discarded hypotheses;
- advisory or issue notes.

Acceptance criteria:

- ingested content is searchable;
- candidate dedupe can query ingested records;
- discarded paths include revisit conditions where available.

### R3: Target Observation

The system must inspect the codebase and record:

- languages;
- frameworks;
- package managers;
- entrypoints;
- docs and tests;
- runtime modes;
- Docker/WSL/native support;
- test commands;
- high-level dependency graph;
- recent security-relevant changes when git history is available.

Acceptance criteria:

- observation produces a target profile;
- unknown tooling is recorded as a blocker, not silently ignored.

### R4: Surface Mapping

The system must map attack-relevant surfaces:

- request routing;
- auth/authz/session;
- state/cache/storage;
- parsers and serializers;
- URL/path/origin handling;
- adapters and runtime boundaries;
- plugin/tool/sandbox execution;
- callbacks/webhooks/replay;
- generated output;
- docs/tests/security contract areas.

Acceptance criteria:

- surfaces have files/symbols/entrypoints where possible;
- each surface has status and ROI factors;
- covered and exhausted surfaces can be queried later.

### R5: Round Planning

The coordinator must create a round plan before broad work starts.

Each plan must include:

- objective;
- current understanding;
- selected high-ROI surfaces;
- skipped surfaces and reasons;
- prior killed paths to avoid;
- agent fronts;
- validation gates;
- expected evidence;
- stop conditions;
- replan trigger.

Acceptance criteria:

- no agent receives an unbounded "review the repo" task;
- each selected surface has an ROI explanation;
- repeated surfaces require a recorded revisit condition.

Canonical fronts:

```text
Argus: component-level review.
Loom: macro/chaining analysis.
Chaos: fuzzing and edge-case generation.
Libris: docs/contract verification.
Mimic: runtime/adapter/environment divergence.
Artificer: PoC/lab construction.
Skeptic: adversarial review and refutation.
```

### R6: Hypothesis Generation

The system must generate hypotheses from offensive heuristics:

- validation/use mismatch;
- authority drift;
- identity confusion;
- state/cache security decisions;
- adapter/runtime divergence;
- parser differential;
- replay/retry/callback behavior;
- generated-code mismatch;
- cross-component chaining;
- docs/tests contract violations.

Acceptance criteria:

- hypotheses record primitive, attacker boundary, impact claim, kill criteria,
  duplicate risk, and validation cost;
- generic best-practice claims are not promoted without a security boundary.

### R7: Agent Output Validation

Agent outputs must be structured.

Required sections:

- covered surface map;
- live candidates;
- watchlist;
- killed hypotheses with reasons;
- concrete probes;
- uncovered areas;
- recommended next split.

Acceptance criteria:

- missing kill criteria or covered surface map is flagged;
- outputs can be written to memory without losing entity relationships.

### R8: Candidate Gates

The system must block report-grade promotion unless all gates pass:

- root cause in target;
- realistic external attacker input;
- concrete security impact;
- legitimate configuration;
- negative controls;
- local dedupe;
- public-known, advisory, issue, changelog, and expected-behavior checks;
- affected version, likely introduction point, and timeline;
- mandatory Skeptic refutation and recorded rebuttal;
- old/obvious class threshold;
- no artificial lab help.

Acceptance criteria:

- each gate has explicit state: unknown, pass, fail, or not applicable;
- fail states require reason and evidence;
- unknown gates block report-grade status.
- report-grade promotion is blocked unless public intel/timeline evidence and a
  Skeptic verdict are recorded.

### R9: Lab and PoC Creation

The system must help create realistic labs:

- isolated PoC directory;
- setup commands;
- documented configuration rationale;
- attack steps;
- negative controls;
- evidence capture;
- limitations.

Acceptance criteria:

- labs cannot be marked valid without configuration legitimacy;
- PoC README can be exported from structured lab state.

### R10: Continuous Replanning

The system must support recursive research:

- integrate round results;
- update ROI;
- kill or promote hypotheses;
- identify uncovered surfaces;
- relaunch new fronts only when justified;
- stop on report-grade candidate, exhaustion, blocker, or user interruption.

Acceptance criteria:

- each replan references what changed in understanding;
- low-ROI areas are not reopened without explicit reason.

## 2. Non-Functional Requirements

### N1: Local-First

The system must work locally without a hosted backend.

### N2: Portable

Target memory must be portable with the workspace.

### N3: Auditable

Every promotion, discard, reopen, and report-grade decision must have evidence
or a stated blocker.

### N4: Conservative

The system must prefer killing a weak finding over overclaiming it.

### N5: Extensible

The system must support target-specific adapters without embedding one vendor or
ecosystem into the core.

### N6: Cross-Platform

The first implementation should run on Windows, WSL, and Linux with minimal
differences.

### N7: Secret-Safe

Exports must support redaction and must not store secrets by default.

## 3. Technical Requirements

### T1: Runtime

Use TypeScript for the main CLI/runtime.

### T2: Storage

Use SQLite with FTS for local memory.

### T3: Schema Validation

Use explicit schemas for:

- target contracts;
- surfaces;
- hypotheses;
- candidates;
- evidence;
- labs;
- round plans;
- agent outputs.

### T4: Tool Execution

Use a tool orchestration layer that records:

- command;
- working directory;
- environment profile;
- exit code;
- stdout/stderr paths;
- evidence link.

### T5: Exports

Generate Markdown exports from memory:

- research log;
- candidate register;
- discarded hypotheses;
- surface map;
- round plan;
- PoC README;
- report draft.

### T6: Plugin Packaging

Keep the Codex plugin as the interaction layer:

- manifest;
- skill;
- templates;
- scripts;
- MCP tools.

## 4. Security Requirements

### S1: No Forced Vulnerability

The system must reject validation paths that require disabling real controls or
patching target code unless the target documentation explicitly defines that
mode as supported and in scope.

### S2: Evidence Separation

Hypothesis-generation evidence and validation evidence must be distinguishable.

### S3: Negative Controls

Every PoC must define negative controls appropriate to the claimed impact.

### S4: Scope Respect

Out-of-scope areas must be stored and included in prompts to prevent accidental
drift.

### S5: Dangerous Action Awareness

The system must mark commands that modify services, mutate external state, or
use credentials.

## 5. UX Requirements

### U1: Researcher-Centric

The tool should explain why it selected a surface and what evidence would change
the decision.

### U2: Resume-Friendly

A researcher should be able to resume after days and see:

- last round;
- current candidates;
- killed paths;
- high-ROI next surfaces;
- blockers.

### U3: Low Noise

The system should not produce long generic summaries by default. It should
produce decisions, evidence, and next actions.

### U4: Explicit Uncertainty

Unknown gate state must remain visible. It should not be hidden by confident
language.

## 6. Initial Definition of Done

The first usable version is done when it can:

- initialize target memory;
- ingest local reports and findings;
- produce a round plan with ROI reasoning;
- generate role-specific agent prompts;
- record agent outputs;
- query duplicates and revisit blockers;
- create a PoC lab checklist;
- export Markdown artifacts;
- resume from prior state without repeating exhausted paths.
