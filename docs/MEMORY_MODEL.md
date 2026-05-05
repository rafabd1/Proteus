# Proteus Memory Model

## 1. Purpose

The memory system is the product's anti-slop and anti-revisit backbone.

It must let the coordinator ask:

- What have we already reviewed?
- Which hypotheses died, and why?
- Which surfaces are low ROI unless something changes?
- Which invariants did we learn?
- Which candidates have partial evidence?
- Which candidates need negative controls?
- Which findings look duplicate or expected?
- Which next targets have the highest marginal value?

Markdown logs are not enough for continuous research. They are useful exports,
but the source of truth should be a structured database.

## 2. Storage Recommendation

Use one SQLite database per target:

```text
<target-root>/.vros/memory.sqlite
```

Benefits:

- portable with the target workspace;
- easy backup;
- transactional writes;
- FTS support;
- no daemon;
- works on Windows, WSL, Linux, and CI.

Optional future mode:

```text
~/.vros/global.sqlite
```

The global database can store reusable playbook material across targets, but it
must not mix target-specific claims without namespaces.

## 3. Entity Model

### targets

```text
id
name
root_path
scope_summary
created_at
updated_at
```

### target_profiles

```text
id
target_id
languages_json
frameworks_json
package_managers_json
runtime_modes_json
test_commands_json
docker_available
wsl_available
notes
created_at
```

### sources

Represents files, docs, reports, issues, advisories, commits, or external intel.

```text
id
target_id
kind
path_or_url
title
content_hash
summary
created_at
```

### surfaces

```text
id
target_id
name
family
description
files_json
symbols_json
entrypoints_json
trust_boundaries_json
runtime_modes_json
status
roi_score
exhaustion_level
last_reviewed_at
revisit_condition
created_at
updated_at
```

`status` values:

```text
unmapped
active
covered
exhausted
low_roi
blocked
watch
```

### invariants

Security assumptions learned from code/docs/tests.

```text
id
target_id
surface_id
statement
evidence_ids_json
confidence
break_impact
created_at
updated_at
```

Examples:

- "Tenant identity should come only from authenticated session."
- "Cache key must include user and locale."
- "Webhook retries must not reauthorize stale state."

### hypotheses

```text
id
target_id
surface_id
title
primitive
attacker_boundary
impact_claim
heuristic_family
status
score
duplicate_risk
expected_behavior_risk
validation_cost
kill_criteria
revisit_condition
created_at
updated_at
```

`status` values:

```text
live
candidate
watchlist
discarded
promoted_to_poc
report_grade
```

### candidates

```text
id
target_id
hypothesis_id
name
root_cause
affected_versions
attacker_model
impact
docs_contract
validation_state
dedupe_state
public_intel_state
negative_controls_state
reportability
created_at
updated_at
```

### decisions

Append-only decision log.

```text
id
target_id
entity_type
entity_id
decision
reason
evidence_ids_json
actor
created_at
```

Examples:

- promoted to candidate;
- discarded as expected behavior;
- downgraded to watchlist;
- reopened due to new runtime mode;
- blocked on missing credentials.

### evidence

```text
id
target_id
kind
title
body
path_or_url
command
stdout_path
stderr_path
request_path
response_path
screenshot_path
source_id
hash
created_at
```

Evidence should be append-only. Edits should create new records or decisions.

### probes

```text
id
target_id
hypothesis_id
description
command
expected_vulnerable_result
expected_negative_control
status
evidence_ids_json
created_at
updated_at
```

### labs

```text
id
target_id
candidate_id
path
config_legitimacy
setup_commands_json
attack_steps_json
negative_controls_json
status
limitations
created_at
updated_at
```

### rounds

```text
id
target_id
objective
current_understanding
selected_surfaces_json
skipped_surfaces_json
agent_fronts_json
validation_gates_json
stop_conditions_json
outcome
created_at
completed_at
```

### agent_outputs

```text
id
target_id
round_id
agent_codename
agent_role_family
assigned_surface
output_path
covered_surface_json
live_candidates_json
killed_hypotheses_json
probes_json
uncovered_areas_json
validation_status
created_at
```

Canonical codenames:

```text
argus
loom
chaos
libris
mimic
artificer
skeptic
```

## 4. Full-Text Search

Create FTS indexes for:

- source content summaries;
- hypothesis titles and impact claims;
- discard reasons;
- report names;
- candidate root causes;
- evidence bodies;
- file/symbol references.

Important queries:

```text
find possible duplicates for this hypothesis
find surfaces killed for this reason
find prior reports touching this symbol
find candidates involving this primitive
find all evidence for this invariant
find low-ROI surfaces in this family
```

## 5. Anti-Revisit Logic

Before a round plan is accepted, query:

```text
surfaces where status in (exhausted, low_roi)
hypotheses where status = discarded
decisions where reason matches expected/duplicate/integration-only/lab-artifact
```

The coordinator can reopen only with:

```text
new_version
new_runtime_mode
new_evidence
new_chain_dependency
previous_kill_reason_invalidated
user_override
```

Every reopen must create a decision record.

## 6. ROI Scoring Fields

Store each factor separately for explainability:

```text
impact_potential
external_reachability
trust_boundary_density
recent_change_weight
unexplored_invariant_weight
tooling_readiness
duplicate_risk
expected_behavior_likelihood
prior_exhaustion_weight
validation_cost
low_signal_history
```

Do not store only the final score. The coordinator needs to explain why a
surface was selected.

## 7. Export Strategy

Generate:

```text
research-log.md
candidate-register.md
discarded.md
watchlist.md
surface-map.md
round-plan-<id>.md
poc-readme-<candidate-id>.md
report-draft-<candidate-id>.md
```

Exports should include source IDs and evidence references so the human can audit
the reasoning.

## 8. MCP Tools

Implemented MCP tools:

```text
proteus_init
proteus_status
proteus_ingest
proteus_observe
proteus_plan_round
proteus_query_duplicates
proteus_record_hypothesis
proteus_record_decision
proteus_record_agent_output
proteus_update_surface
proteus_export
proteus_lab_create
```

The CLI and MCP server share the same SQLite memory layer.
