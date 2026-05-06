# Claude Code Port

Proteus includes a project-level Claude Code port using official Claude Code
extension points:

- custom slash command: `.claude/commands/proteus.md`;
- custom subagents: `.claude/agents/proteus-*.md`;
- project MCP server config: `.mcp.json`;
- project guidance: `CLAUDE.md`.

## Install

Install the Proteus CLI/runtime first:

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

From the Proteus repository, Claude Code can use the project-scoped MCP config
in `.mcp.json`. Claude Code may ask you to approve project MCP servers.

You can verify MCP visibility inside Claude Code with:

```text
/mcp
```

## User-Level Install

To make `/proteus` and the Proteus subagents available across many Claude Code
projects, copy the command and agents into your Claude Code user directory:

```powershell
New-Item -ItemType Directory -Force ~/.claude/commands, ~/.claude/agents
Copy-Item .claude/commands/proteus.md ~/.claude/commands/proteus.md -Force
Copy-Item .claude/agents/proteus-*.md ~/.claude/agents/ -Force
```

Then register the global Proteus MCP server:

```powershell
claude mcp add proteus --scope user -- proteus-mcp
```

Verify inside Claude Code:

```text
/help
/agents
/mcp
```

## Slash Command

The project command:

```text
.claude/commands/proteus.md
```

creates:

```text
/proteus
```

Examples:

```text
/proteus initialize continuous vulnerability research for this repository
/proteus plan the next high-ROI offensive research round
/proteus validate this candidate with realistic PoC gates and negative controls
/proteus draft a triage-ready report without internal workflow references
```

## Subagents

Project subagents live under:

```text
.claude/agents/
```

Available Proteus subagents:

```text
proteus-argus
proteus-loom
proteus-chaos
proteus-libris
proteus-mimic
proteus-artificer
proteus-skeptic
```

Use them explicitly:

```text
Use the proteus-argus subagent on the auth/session boundary.
Use the proteus-libris subagent to verify public intel and timeline.
Use the proteus-skeptic subagent to refute this candidate before any claim.
```

Claude Code can also delegate automatically when the task matches a subagent
description.

## MCP

The root `.mcp.json` configures:

```json
{
  "mcpServers": {
    "proteus": {
      "command": "node",
      "args": ["./plugins/proteus/scripts/proteus-mcp.cjs"],
      "env": {}
    }
  }
}
```

This exposes the same memory and planning tools used by the Codex plugin.

## Notes

- This port is intentionally project-level. Copy `.claude/` and `.mcp.json` into
  another target repository if you want `/proteus` inside that target.
- Keep the CLI installed or ensure `node` can run the bundled MCP wrapper.
- Report-grade claims still require public intel/timeline review and Skeptic
  refutation.
