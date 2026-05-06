# Proteus Installation

Proteus has three install surfaces:

- CLI/runtime: the `proteus` and `proteus-mcp` commands.
- Codex plugin: installed through a Codex plugin marketplace.
- Claude Code project port: `/proteus`, project subagents, and MCP config.

## CLI Install From GitHub

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

Expected shape:

```text
@rafabd1/proteus 0.1.10
```

The GitHub tarball install uses the committed `dist/` runtime and has no
install-time build lifecycle, so it does not need to compile TypeScript on the
installing machine.

On npm versions where GitHub shorthand works reliably, this equivalent form may
also be used:

```powershell
npm install -g github:rafabd1/Proteus
```

After publishing to npm, the registry install should be:

```powershell
npm install -g @rafabd1/proteus
proteus --version
```

## CLI Upgrade

```powershell
npm install -g github:rafabd1/Proteus
```

After npm publishing:

```powershell
npm update -g @rafabd1/proteus
```

Pin a branch, tag, or commit:

```powershell
npm install -g github:rafabd1/Proteus#main
```

## Local Development Install

```powershell
git clone https://github.com/rafabd1/Proteus
cd Proteus
npm install
npm link
proteus --version
```

## Codex Plugin Install

Codex supports marketplace sources in the form `owner/repo[@ref]`, Git URLs,
SSH URLs, or local marketplace root directories.

```powershell
codex plugin marketplace add rafabd1/Proteus
```

Pin a ref:

```powershell
codex plugin marketplace add rafabd1/Proteus@main
```

The marketplace file is:

```text
.agents/plugins/marketplace.json
```

It exposes the plugin at:

```text
plugins/proteus
```

## Claude Code Project Port

Proteus includes project-level Claude Code files:

```text
.claude/commands/proteus.md
.claude/agents/proteus-*.md
.mcp.json
CLAUDE.md
```

Use from Claude Code:

```text
/proteus initialize continuous vulnerability research for this repository
/proteus plan the next high-ROI offensive research round
/proteus validate this candidate with realistic PoC gates and negative controls
```

The root `.mcp.json` exposes the Proteus MCP server to Claude Code:

```text
node ./plugins/proteus/scripts/proteus-mcp.cjs
```

Inside Claude Code, use `/mcp` to approve or inspect the project MCP server and
`/agents` to inspect the project subagents.

## Verify Runtime

```powershell
proteus --version
proteus roles
proteus --help
```

## Verify MCP

```powershell
proteus-mcp
```

For normal plugin use, Codex starts the MCP server through
`plugins/proteus/.mcp.json`. The wrapper builds the runtime if `dist/` is not
present yet.

## Uninstall CLI

```powershell
npm uninstall -g @rafabd1/proteus
```

If installed directly from GitHub, npm still records the installed package under
the package name `@rafabd1/proteus`.
