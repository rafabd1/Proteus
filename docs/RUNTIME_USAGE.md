# Proteus Runtime Usage

## Install

```powershell
npm install
npm run build
```

Proteus requires Node.js 24 or newer because the first runtime uses
`node:sqlite` for local structured memory.

## Initialize A Target

```powershell
node dist/cli.js init --root C:\path\to\target --name target-name
```

This creates:

```text
<target>/.vros/memory.sqlite
<target>/.vros/exports/
```

## Ingest Prior Work

```powershell
node dist/cli.js ingest --root C:\path\to\target findings REPORTS reports docs
```

Ingested content becomes searchable through full-text search and is used for
dedupe and anti-revisit checks.

## Observe The Environment

```powershell
node dist/cli.js observe --root C:\path\to\target
```

Observation records:

- git branch/commit/status;
- languages;
- package managers;
- framework hints;
- runtime modes;
- test hints;
- local tools such as Docker, WSL, git, Node, npm, Python, and ripgrep.

## Plan A Research Round

```powershell
node dist/cli.js plan-round --root C:\path\to\target --objective "Find high-ROI auth/cache/state confusion candidates" --write
```

The planner creates initial surface families when no surfaces exist, scores them
with ROI factors, selects bounded fronts, assigns Proteus roles, records the
round in memory, and optionally writes a Markdown plan.

## Generate Agent Prompts

```powershell
node dist/cli.js prompt --role argus --surface "Auth/session boundary" --objective "Inspect validation/use mismatch"
```

Valid roles:

```text
argus
loom
chaos
libris
mimic
artificer
skeptic
```

## Record Research State

```powershell
node dist/cli.js record hypothesis --title "Tenant state reused across request boundary" --impact "possible unauthorized read" --score 72

node dist/cli.js record evidence --title "Negative control output" --kind command-output --body "403 for unrelated tenant"

node dist/cli.js record decision --entity-type hypothesis --entity-id 1 --decision discarded --reason "Expected behavior documented in official guide"
```

## Query Memory

```powershell
node dist/cli.js query duplicates "tenant state reused"
node dist/cli.js query revisit "auth"
```

## Create A Lab

```powershell
node dist/cli.js lab create --candidate-id 1 --name tenant-state-reuse
```

Labs are created under `.vros/labs/` with a README that forces configuration
legitimacy, attacker model, attack steps, negative controls, limitations, and
evidence capture.

## Export Markdown

```powershell
node dist/cli.js export --root C:\path\to\target
```

Exports:

```text
target-contract.md
surface-map.md
candidate-register.md
research-log.md
```

