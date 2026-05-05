# Proteus Development Plan

## 1. Vision

Proteus is a Codex plugin and local runtime for continuous,
professional-grade vulnerability research against arbitrary codebases.

It should help an agent behave like a serious offensive researcher:

- define a clear research contract before touching the target;
- map the codebase into attack-relevant surfaces;
- generate hypotheses from invariants, trust boundaries, state transitions, and
  component composition rather than obvious grep hits;
- prioritize high-ROI surfaces and avoid repeated low-signal areas;
- delegate focused research rounds with explicit stop conditions;
- validate candidates with realistic labs, documented configuration, and
  negative controls;
- store everything in structured memory so the next round starts from learned
  state instead of from a blank prompt;
- kill weak, duplicate, expected, integration-only, and lab-created findings
  aggressively while preserving useful playbook material.

The project can be inspired by iterative optimization systems, but its fitness
function is not "more activity" or "more findings". It is validated offensive
signal.

## 2. Non-Goals

Proteus must not become:

- a generic static analyzer;
- a mass vulnerability scanner;
- a prompt pack that only tells the model to "think harder";
- a tool that inflates weak behavior into findings;
- a tool that creates vulnerable labs by forcing unsafe configuration;
- a report generator detached from validation evidence;
- a system that rewards repeated shallow coverage of common files.

It may integrate scanners, fuzzers, test runners, browsers, Docker, WSL, and
language-specific tooling, but those tools are evidence sources. They are not
the research strategy.

## 3. Research Contract

Every target starts with a contract:

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

Default gates:

- root cause belongs to the target, not only a weak integration;
- attacker controls a realistic external input;
- impact is concrete and security-relevant;
- configuration is documented, default, or a normal correct-practice setup;
- negative controls show the app/model was otherwise configured correctly;
- duplicate, expected, and public-known behavior has been checked;
- PoC does not need artificial lab help that creates the bug;
- old or obvious classes advance only with unusually strong impact.

## 4. Coordinator Loop

The coordinator is the core product. It must run a disciplined loop:

```text
1. Observe
   Load target state, memory, existing reports, recent changes, docs, tests,
   dependency graph, and available tooling.

2. Map
   Build an attack-relevant surface map: trust boundaries, request flows,
   identity/authority decisions, parser boundaries, storage namespaces,
   adapters, generated code, runtime modes, and historical security changes.

3. Hypothesize
   Generate hypotheses from invariants and composition, not only from suspicious
   lines. Prefer non-obvious classes such as state drift, validation/use split,
   cache authority, replay, adapter divergence, and parser differentials.

4. Prioritize
   Score hypotheses by impact, external reachability, root-cause ownership,
   novelty, validation cost, available tooling, and duplicate risk.

5. Delegate
   Split work into disjoint, bounded fronts. Each agent gets a surface, a
   heuristic, kill criteria, required outputs, and prohibited re-opened paths.

6. Validate
   Run focused local probes, tests, labs, or instrumentation. Keep validation
   separate from hypothesis generation and require negative controls.

7. Kill/Promote
   Promote only candidates that pass gates. Kill weak paths with explicit
   evidence and revisit criteria.

8. Replan
   Update memory. Identify what was learned, what was exhausted, what invariant
   changed, and which next surfaces have the highest marginal value.
```

The coordinator must produce a plan for each round before launching agents.
Random file walking is a failure mode.

## 5. Agent Roles

The initial plugin should support these role templates as stable identities.
The codenames are part of Proteus's operating language: they make plans,
delegation, memory records, and exports easier to scan across long-running
research.

### Argus: Component-Level Review

Argus is the many-eyed reviewer. It inspects components in detail and looks for
local primitives that other roles can chain or validate.

Finds local primitives:

- validation mistakes;
- missing auth/authz checks;
- unsafe parsing;
- weak allowlists/blocklists;
- identity dispatch mistakes;
- path, URL, host, origin, header, cookie, and body handling bugs;
- file and object namespace mistakes.

Required output:

- covered file/module map;
- live candidates;
- killed hypotheses with evidence;
- concrete probes;
- uncovered areas.

### Loom: Macro/Chaining Analysis

Loom connects separate threads into attack paths. It looks for emergent bugs
created by composition, sequencing, and authority transfer.

Finds emergent bugs across safe-looking features:

- persisted state becoming authority;
- identity drift between validation and execution;
- retry/replay reintroducing permission;
- cache crossing tenant/user/request boundaries;
- build-time identity diverging from runtime identity;
- adapter weakening an invariant.

### Chaos: Fuzzing/Edge-Case Generation

Chaos generates anomalous inputs and edge cases. Its job is to produce useful
stress patterns and anomalies, not to inflate crashes into findings.

Generates input matrices and probes:

- double encoding;
- Unicode/case folding;
- duplicate or conflicting headers;
- content-type mismatch;
- path separator variants;
- query collisions;
- protocol/host/port ambiguity;
- old/new format compatibility.

This role does not declare vulnerabilities by itself. It feeds anomalies into
the coordinator for validation.

### Libris: Docs/Contract Verifier

Libris checks the written and executable contract: docs, tests, changelog,
advisories, issues, and public research.

Checks docs, tests, changelog, advisories, issues, and public research. It must
try to prove the candidate is expected or already known before report writing.
It also records the affected version, likely introduction point, public
advisory/issue status, and the exact intel searches performed. Without this
timeline and known-issue search, a candidate cannot become report-grade.

### Mimic: Runtime/Adapter/Environment Divergence

Mimic compares how the target behaves across supported environments and
execution modes.

Compares supported modes:

- development vs production;
- self-hosted vs managed;
- Node vs edge or equivalent runtimes;
- serverless vs long-lived process;
- official adapter vs direct framework usage;
- generated output vs source runtime;
- Docker, WSL, and local native execution where relevant.

### Artificer: PoC Builder

Artificer builds clean labs and proofs of concept after candidates pass initial
gates. It must model legitimate usage, not create the bug through unsafe lab
configuration.

Starts only after a candidate passes initial gates. It builds a clean lab with:

- documented/default/correct-practice configuration;
- reproducible setup;
- attack steps;
- negative controls;
- expected output;
- limitations.

It also prepares a report draft oriented to external triage. The draft should
use natural concise language, explain root cause and impact simply, avoid
internal workflow references, and prefer manual blackbox reproduction steps such
as `curl`, HTTP requests, browser actions, or normal CLI usage. Automated PoCs
are acceptable only when the manual flow is explained clearly.

### Skeptic: Devil's Advocate

Skeptic tries to refute the finding. It searches for expected behavior,
duplicates, missing controls, misuse explanations, and stronger negative
controls.

Starts after technical evidence exists. It tries to kill the finding through
docs, duplicate research, missing controls, misuse arguments, and stricter
negative controls.
Its verdict is a mandatory pre-claim gate. Unresolved Skeptic objections keep a
candidate in Candidate or Watchlist status, even when the PoC appears to work.

## 6. Hypothesis Generation Heuristics

The coordinator should generate targets from these families:

- request lifecycle and routing identity;
- auth/authz/session boundaries;
- mutation/action transports;
- cache/state authority;
- serializer/deserializer/parser boundaries;
- URL/path/host/origin normalization;
- adapter/runtime/platform divergence;
- generated manifests/module identity;
- build-time to runtime handoff;
- plugin/tool/sandbox execution;
- file/storage/object namespaces;
- fetch/proxy/SSRF boundaries;
- webhook/callback/replay;
- provider adapters and dependency wrappers;
- docs/tests mismatch;
- recent security fixes and regression-shaped commits.

It should prefer:

- authority drift;
- validation/use split;
- state becoming a security decision;
- trusted internal metadata crossing an external boundary;
- security feature failure in a normal configuration;
- composition bugs where two safe features create an unsafe system.

It should penalize:

- generic TODOs;
- lint-only claims;
- expected behavior;
- old obvious bugs without strong impact;
- integration-only flaws;
- unrealistic attacker control;
- labs that force the vulnerable condition;
- repeated routes already marked low ROI.

## 7. ROI and Anti-Revisit System

The project needs a formal ROI model so the agent does not repeatedly inspect
the same obvious surfaces.

Each surface gets a dynamic score:

```text
ROI = impact_potential
    + external_reachability
    + trust_boundary_density
    + recent_change_weight
    + unexplored_invariant_weight
    + tooling_readiness
    - duplicate_risk
    - expected_behavior_likelihood
    - prior_exhaustion_weight
    - validation_cost
    - low_signal_history
```

Each round stores:

- surfaces covered;
- heuristic used;
- files and symbols touched;
- hypotheses generated;
- kill reasons;
- controls observed;
- missing evidence;
- revisit condition.

A surface can be reopened only when one of these changes:

- new code or dependency version;
- new invariant learned from another component;
- new runtime/configuration mode enters scope;
- new public intel suggests a class;
- previous kill reason no longer applies;
- candidate chain requires the surface as a connection point.

## 8. Memory Tool Requirements

The memory layer should be programmatic, queryable, and local-first.

Minimum capabilities:

- initialize a target memory database;
- ingest existing `findings/`, `REPORTS/`, docs, notes, and prior logs;
- record surfaces, hypotheses, candidates, discarded paths, probes, evidence,
  labs, reports, and decisions;
- query for duplicates and low-ROI areas before each round;
- compute uncovered surfaces and revisit candidates;
- export Markdown summaries for humans;
- support append-only evidence records;
- keep target memory portable with the repo.

Recommended first implementation:

- SQLite database under `.vros/memory.sqlite`;
- JSON columns for flexible evidence metadata;
- FTS indexes for dedupe across notes, reports, stack traces, docs, and symbols;
- small TypeScript or Python CLI;
- human-readable Markdown exports generated from the database.

The database is the source of truth. Markdown is the reporting/export layer.

## 9. Environment Instrumentation

The plugin should detect and use available tools rather than assume one stack.

Tool discovery:

- git;
- package managers;
- language runtime versions;
- Docker;
- WSL;
- test frameworks;
- browser automation;
- fuzzing tooling;
- static analyzers;
- ripgrep and code search;
- local databases/services;
- secrets/credentials availability as declared by the user.

Instrumentation outputs:

- target environment profile;
- reproducible setup commands;
- test matrix;
- supported runtime modes;
- missing tool blockers;
- safe lab plan.

The agent may use Docker, WSL, browsers, debuggers, language-specific tests, and
local services when available. It must not silently change target configuration
to make a bug appear.

## 10. Lab and PoC Principles

Labs must model realistic target usage.

Allowed:

- default settings;
- documented deployment modes;
- configurations recommended by official docs;
- realistic credentials/roles/tenants;
- local reproduction of externally reachable flows;
- negative controls that prove expected enforcement works elsewhere.

Not allowed:

- disabling security controls without documentation;
- injecting test-only bypasses into target code;
- creating authority solely in the lab;
- treating debug-only behavior as production impact unless docs place it in
  scope;
- relying on mocked victims in ways that remove the real attacker boundary.

Every PoC must include:

- affected version/commit;
- setup;
- attacker model;
- exploit steps;
- expected vulnerable output;
- negative controls;
- why the configuration is legitimate;
- limitations and non-claims.

## 11. Technical Stack

Recommended architecture:

- Plugin manifest and skills for Codex integration.
- TypeScript for the coordinator runtime and CLI once implementation begins.
- SQLite for local structured memory.
- Zod or equivalent schema validation for all memory records and agent outputs.
- Node.js child processes for tool orchestration.
- Optional Python helper scripts for ecosystem-specific analysis where Python
  libraries are stronger.
- Markdown templates for human-readable exports.
- Docker/WSL integration through discovered local commands.
- Test harnesses per target ecosystem rather than one universal runner.

Why TypeScript first:

- strong fit for Codex plugin/MCP tooling;
- easy JSON schema handling;
- good process orchestration;
- portable across Windows, Linux, WSL, and CI;
- simple distribution through npm later.

Why SQLite:

- local-first and portable;
- transactional;
- queryable;
- supports FTS;
- easy backups;
- no service dependency.

## 12. Milestones

### M0: Specification and Scaffold

Deliverables:

- repository;
- plugin scaffold;
- development plan;
- architecture;
- memory model;
- initial coordinator skill.

### M1: Memory CLI

Deliverables:

- `vros init`;
- `vros ingest`;
- `vros record surface`;
- `vros record hypothesis`;
- `vros record decision`;
- `vros query duplicates`;
- `vros export markdown`.

Success criteria:

- a target can be initialized;
- existing reports can be indexed;
- discarded paths can be queried before a new round.

### M2: Coordinator Round Planner

Deliverables:

- target observation;
- surface map schema;
- ROI scoring;
- round plan generator;
- anti-revisit guard;
- agent prompt generator.

Success criteria:

- each round has explicit fronts, gates, and stop conditions;
- the coordinator can explain why it chose each target surface.

### M3: Agent Output Contracts

Deliverables:

- typed schemas for agent outputs;
- candidate, watchlist, discard, and probe records;
- strict validation before memory write;
- Markdown export templates.

Success criteria:

- weak free-form outputs are rejected or normalized;
- memory remains queryable after multiple rounds.

### M4: Lab and PoC Manager

Deliverables:

- environment discovery;
- lab plan generator;
- Docker/WSL/native execution profiles;
- negative-control checklist;
- PoC README generator;
- evidence attachment.

Success criteria:

- a candidate can be reproduced without forced-vulnerable config;
- negative controls are captured as first-class evidence.

### M5: Dedupe and Intel Layer

Deliverables:

- local report/log/finding dedupe;
- public-intel checklist;
- advisory/issue/PR timeline fields;
- duplicate-risk scoring.

Success criteria:

- candidates cannot become report-grade without duplicate status.

### M6: Continuous Research Mode

Deliverables:

- recursive replanning;
- budget and stop-condition controls;
- exhaustion tracking;
- watchlist promotion rules;
- interruption/resume support.

Success criteria:

- the coordinator can resume a target and choose new high-ROI work without
  repeating prior exhausted paths.

## 13. Quality Bar

The project is successful only if it improves research judgment, not just
automation volume.

Required qualities:

- high-signal hypothesis generation;
- explicit kill criteria;
- precise memory;
- reproducible validation;
- conservative impact framing;
- strong dedupe;
- clear separation between bug, expected behavior, misconfiguration, lab
  artifact, and report-grade vulnerability.
