# Proteus

Proteus is a planned Codex plugin and local research runtime for
professional vulnerability research in codebases.

The project is designed for deep, efficient, evidence-driven offensive review:
mapping a target, generating non-obvious hypotheses, delegating focused research
rounds, validating candidates in realistic labs, and retaining structured memory
so future rounds do not repeat low-ROI work.

This is not a generic scanner and not a normal code review workflow. The goal is
to coordinate realistic exploitability research across large repositories while
aggressively suppressing weak hypotheses, duplicates, expected behavior, and lab
artifacts.

## Project Shape

```text
docs/
  DEVELOPMENT_PLAN.md
  REQUIREMENTS.md
  ARCHITECTURE.md
  MEMORY_MODEL.md
plugins/
  proteus/
    .codex-plugin/plugin.json
    skills/continuous-vuln-research/SKILL.md
    templates/
    scripts/
```

## Core Idea

The coordinator follows a fixed research loop:

```text
Observe -> Map -> Hypothesize -> Prioritize -> Delegate -> Validate -> Kill/Promote -> Replan
```

Every round must produce a plan, a surface split, validation gates, stop
conditions, and structured memory updates. The coordinator is explicitly
responsible for avoiding random wandering, repeated coverage, and superficial
bug-shaped claims.

Proteus standardizes its research roles with stable codenames:

```text
Argus: component-level review.
Loom: macro and chaining analysis.
Chaos: fuzzing and edge-case generation.
Libris: docs and contract verification.
Mimic: runtime, adapter, and environment divergence.
Artificer: PoC and lab construction.
Skeptic: adversarial review and finding refutation.
```

## Current Status

This repository contains the product plan, Codex plugin scaffold, and a working
Node/TypeScript runtime backed by a local SQLite memory database.

## CLI Quick Start

```powershell
npm install
npm run build
node dist/cli.js init --name Proteus
node dist/cli.js ingest README.md docs plugins/proteus/templates
node dist/cli.js observe
node dist/cli.js plan-round --objective "Initial high-ROI research round" --write
node dist/cli.js export
```

Target state is stored under `.vros/memory.sqlite`. Human-readable exports are
generated under `.vros/exports/`.
