# Proteus In Claude Code

Use `/proteus` to run the Proteus continuous vulnerability research workflow in
Claude Code.

Project-level Claude Code integration lives in:

```text
.claude/commands/proteus.md
.claude/agents/proteus-*.md
.mcp.json
```

The MCP server exposes Proteus memory, planning, hypothesis, decision,
agent-output, lab, export, and global-learning tools.

Core rules:

- optimize for bug bounty impact, realistic exploitability, and target-owned
  root cause;
- do not promote expected behavior, duplicate findings, forced vulnerable
  configuration, lab artifacts, or integration-only issues;
- before any report-grade claim, require Libris/public intel/timeline review and
  Skeptic refutation;
- prefer manual blackbox PoCs with curl, browser actions, HTTP requests, or
  normal CLI workflows;
- keep submitted reports natural, concise, didactic, and free of internal
  Proteus/Claude/workspace references.

Useful commands:

```bash
/proteus initialize continuous vulnerability research for this repository
/proteus plan the next high-ROI offensive research round
/proteus validate this candidate with realistic PoC gates and negative controls
/proteus draft a triage-ready report without internal workflow references
```
