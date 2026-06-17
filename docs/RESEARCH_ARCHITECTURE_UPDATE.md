# Proteus Research Architecture Update

Issue: https://github.com/rafabd1/Proteus/issues/2

Status: planned

## Summary

This update focuses on making Proteus stronger as a GPT-only research system before adding Chimera or Claude-based secondary-agent integration. Chimera remains deferred. Cicada is included only as a normal Proteus role contract for Codex or any host that supports bounded subagents.

The core goal is to move Proteus from passive memory plus broad role prompts into a stateful research framework with explicit campaign state, hypothesis branching, structured checkpoints, role contracts, MCP advisories, and robust migrations for existing `.vros/memory.sqlite` databases.

## Non-Goals

- Do not implement Chimera mode in this update.
- Do not add Claude CLI or Claude SDK integration yet.
- Do not make role prompts into narrow bug-class checklists.
- Do not rely on broad speculative vulnerability categories as the primary research method.
- Do not break existing Proteus databases.

## Architecture Direction

Proteus should model research as structured state:

```text
Campaign
  -> Rounds
    -> Surfaces
      -> Hypothesis trees
        -> Branches
          -> Steps, evidence, blockers, kill conditions, decisions, gates, labs, agent outputs
```

The agent should be able to resume the current campaign without searching the entire database. MCP tools should proactively return compact, useful context about active work, related records, duplicate-like paths, and suggested reads.

## Plugin, CLI, MCP, App Boundary

Keep the plugin as the distribution layer for skills, role contracts, templates, and host-facing instructions.

Keep the CLI and MCP runtime as the operational layer:

```text
Proteus plugin
  -> skills, role contracts, templates, slash-command guidance

Proteus CLI
  -> setup, doctor, runtime commands, migrations, local workflows

Proteus MCP
  -> structured state, memory, campaigns, branches, advisories, links, labs

Possible future app
  -> UI and observability, not required for this update
```

Plugin installation and MCP hosting are separate in practice. This update should improve setup and doctor checks around that reality, but should not become an app rewrite.

## Skill Modularization

Split the current broad `continuous-vuln-research` guidance into precise skills or reusable sections:

- `proteus:coordinator`: campaign and round orchestration, dedupe, state recovery, branch selection, promotion and kill decisions.
- `proteus:codebase-research`: code reading, architecture, dataflow, trust boundaries, recent diffs.
- `proteus:web-intel`: docs, changelogs, advisories, maintainer comments, expected behavior, duplicate risk.
- `proteus:chaining`: heuristic chaining, authority transitions, primitive strengthening, cross-component reasoning.
- `proteus:fuzzing`: harness and oracle design, stateful probes, differential testing, mutation strategy.
- `proteus:poc-exploit`: lab construction, exploit reliability, negative controls, impact validation.
- `proteus:checkpoint`: reflection checkpoints, context compression, campaign digest updates.

Each skill should have a precise contract and structured output. The model can reason freely, but its deliverable must be auditable.

## Heuristic Contracts

Skills should avoid fixed bug-class checklists as the primary frame. Those narrow the search space and make the agent miss stranger chains.

Preferred methodology:

- map authority boundaries
- identify interpretation gaps
- find competing sources of truth
- trace state transitions
- inspect invariant assumptions
- reduce attacker preconditions
- look for capability amplification
- compare build, runtime, and documented behavior
- design negative controls
- kill weak hypotheses early

Bug classes may appear as examples only when useful.

## Base Research Contract

Every Proteus role should import a shared base contract.

Mandatory rules:

- Maintain a realistic attacker model and exploitability standard.
- Do not promote speculative findings.
- Do not rely on lab-only assistance or non-standard configuration unless the target documentation requires it.
- Validate expected behavior before treating behavior as vulnerable.
- Check known findings, reports, discarded paths, and TODO or known-issue context before investing heavily.
- Track kill conditions from the beginning.
- Work through primitives, invariants, trust boundaries, state transitions, and interpretation gaps rather than bug-class lists.
- Record enough detail for future agents to avoid repeating dead paths.
- Reassess ROI after new evidence.

## Contract Signature

Every specialist output, checkpoint, and final round summary should include an attestation that the role followed the contract.

Suggested shape:

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

This must not be a meaningless checkbox. The role must include short evidence of how it followed the contract. If it deviated, it must name the deviation, repair it, and continue from the corrected state.

## Hypothesis Trees and Branching

Rounds should support explicit hypothesis trees and branches.

Each branch should include:

```json
{
  "hypothesis": "...",
  "attackPrimitive": "...",
  "whyNonObvious": "...",
  "preconditions": [],
  "steps": [],
  "successCriteria": [],
  "negativeControls": [],
  "killConditions": [],
  "roi": {
    "probability": 1,
    "impact": 1,
    "effort": 1,
    "novelty": 1
  },
  "status": "open|testing|killed|promoted|blocked"
}
```

Operational loop:

1. Generate 3-5 distinct non-obvious branches.
2. Require each branch to name an attack primitive, not just a vague idea.
3. Score by probability, impact, effort, novelty, and validation readiness.
4. Execute the top 2 branches first.
5. Backtrack if top branches die or become low ROI.
6. Record why branches were killed or parked.
7. Promote only when evidence and gates justify it.

## Specialist Roles

Roles should be sharper and more professional:

- `Loom`: macro chaining, cross-component reasoning, authority transitions, capability amplification.
- `Chaos`: fuzzing strategy, stateful probes, edge cases, differential oracles.
- `Skeptic`: expected behavior, duplicate risk, attacker-model refutation, lab-artifact detection.
- `Artificer`: realistic PoC/lab/report-grade evidence and negative controls.
- `Libris`: documentation, changelog, advisory, issue, PR, and maintainer-context intelligence.
- `Cicada`: normal Codex/host subagent for exploit-development and bypass/chaining when a branch already has meaningful signal.

Cicada launch criteria:

- There is already a concrete signal.
- The missing piece is bypass, chaining, exploit reliability, or impact proof.
- The coordinator has provided known blockers and kill conditions.
- The target remains in authorized local or OSS scope.

## Reflection Checkpoints

After every 3-5 meaningful steps, or at the end of a round/front, require a checkpoint:

```json
{
  "confirmed": [],
  "killed": [],
  "open": [],
  "pivots": [],
  "scoreChanges": [],
  "contextToPersist": [],
  "nextHighRoiMove": "...",
  "contractSignature": {}
}
```

Checkpoints should update campaign state and compress recent learnings. The implemented storage keeps checkpoints as first-class records in `campaign_checkpoints` and includes recent checkpoints in `campaignDigest`, so future agents can recover confirmed/killed/open state without reading the whole timeline.

## Campaigns

Add a campaign entity above rounds.

Suggested schema:

```sql
campaigns(
  id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  current_state_summary TEXT,
  recent_learning_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
)
```

Core operations:

- `proteus_campaign_create`
- `proteus_campaign_resume`
- `proteus_campaign_checkpoint`
- `proteus_campaign_close`
- `proteus_record_branch`
- `proteus_link_entities`
- CLI `proteus campaign resume` as the campaign digest/read model

## Entity Links

Add a generic relation table so records can be connected without adding hard foreign keys everywhere.

Suggested schema:

```sql
entity_links(
  id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  note TEXT,
  created_at TEXT NOT NULL
)
```

Example relations:

```text
campaign#2 has_round round#9
campaign#2 tracks_hypothesis hypothesis#12
campaign#2 has_evidence evidence#31
campaign#2 has_decision decision#7
campaign#2 has_validation_gate gate#4
campaign#2 has_agent_output agent_output#5
round#9 selected_surface surface#4
hypothesis#12 belongs_to_branch branch#3
hypothesis#12 supported_by evidence#31
hypothesis#12 refuted_by decision#7
agent_output#5 suggests hypothesis#12
hypothesis#12 similar_to source#18
lab#3 validates hypothesis#12
```

## Campaign Events

Add event logging for timeline recovery and digest generation.

Suggested schema:

```sql
campaign_events(
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

## MCP Advisory Outputs

Standardize MCP responses with a compact contextual envelope.

Suggested shape:

```json
{
  "ok": true,
  "record": {},
  "advisories": [
    {
      "severity": "info|warn|blocker",
      "code": "active_campaign_exists",
      "message": "There is already an active campaign for this target.",
      "links": [{ "entityType": "campaign", "entityId": 3 }],
      "reason": "..."
    }
  ],
  "relatedRecords": [],
  "nextSuggestedReads": [],
  "stateDelta": {
    "created": [],
    "linked": [],
    "updated": []
  }
}
```

Advisories should help the agent recover context in real time without flooding the response. Record tools that run while exactly one campaign is active should also emit `active_campaign_linked` and include the created entity link in `stateDelta.linked`.

## Advisory Triggers

Implement gradually:

- On campaign create: warn if another active or similar campaign exists.
- On round plan: warn if active rounds already exist in the campaign or target.
- On hypothesis record: show similar hypotheses, findings, reports, decisions, agent outputs, and killed branches.
- On evidence record: auto-link to the single active campaign or warn when campaign state is missing/ambiguous.
- On decision record: warn if no evidence ids are attached to a promotion or kill decision.
- On gate and agent-output record: auto-link to the single active campaign or warn when campaign state is missing/ambiguous.
- On checkpoint: update campaign digest and surface unresolved blockers.

## Similarity and Dedupe

Start with deterministic search before adding embeddings.

Use:

- FTS over title/body/summary
- normalized tokens
- weighted fields: surface, primitive, attacker boundary, impact claim, files, symbols, status
- status-aware ranking so discarded, killed, and report-grade items are surfaced clearly

Embeddings can be added later if deterministic recall is not enough.

## Migration System

Existing `.vros/memory.sqlite` databases must remain usable.

The migration system should:

- maintain ordered migration versions
- run idempotently
- wrap each migration in a transaction
- record applied version and timestamp
- tolerate existing columns and tables
- support `proteus migrate --root <target>`
- run migrations automatically on DB open
- record the Proteus runtime version in the target database and skip automatic
  migration checks when the stored version matches the current runtime
- expose explicit CLI and doctor commands
- include backup guidance before major migrations
- include tests against a pre-update fixture database

Suggested migration versions:

- `2026-05-17-validation-gates-surfaces-and-focused-duplicates`
- `2026-06-17-campaigns-links-branches`
- `2026-06-17-campaign-checkpoints`

## CI and Release Automation

Add GitHub Actions workflow to:

- run checks/tests on PRs and pushes to `main`
- run checks/tests on tag push matching `v*`
- create a GitHub release for `v*` tags
- attach the npm pack tarball as a release artifact
- use scoped `GITHUB_TOKEN` permissions

## Acceptance Criteria

- [x] Add or refactor skill contracts into modular, professional research phases.
- [x] Add shared base research contract.
- [x] Add contract signature/attestation requirement to specialist outputs and checkpoints.
- [x] Add Cicada as a normal Proteus role contract for exploit-development/bypass/chaining.
- [x] Add hypothesis tree/branching data model or structured artifacts.
- [x] Add campaigns above rounds.
- [x] Add entity links and campaign events.
- [x] Add campaign resume/digest/checkpoint tooling.
- [x] Add MCP advisory response envelope.
- [x] Add similarity warnings on key record tools.
- [x] Add robust migration system for existing `.vros/memory.sqlite` databases.
- [x] Add migration tests/fixtures.
- [x] Add CI workflow and tag `v*` release workflow.
- [x] Update docs to explain plugin vs CLI vs MCP runtime responsibilities.
- [x] Keep Chimera/Claude integration deferred to a later issue.

## Recommended Implementation Order

1. Introduce migration runner and tests first.
2. Add campaigns, entity links, and campaign events.
3. Add MCP envelope/advisory helpers.
4. Add campaign tools and digest/resume flow.
5. Add hypothesis branches/tree support.
6. Refactor skills/contracts and add Cicada.
7. Add CI/release workflow.
8. Update README/docs.
