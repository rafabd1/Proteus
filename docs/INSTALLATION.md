# Proteus Installation

Proteus has three install surfaces:

- CLI/runtime: the `proteus` and `proteus-mcp` commands.
- Codex plugin: installed through a Codex plugin marketplace.
- Claude Code plugin: `/proteus`, plugin subagents, and MCP config.

Install the CLI first. The plugin instructions can load without it, but target
memory, exports, labs, and MCP tools depend on the `proteus` and `proteus-mcp`
runtime commands.

## 1. CLI Install From GitHub

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
proteus --version
```

Expected shape:

```text
@rafabd1/proteus 0.1.19
```

The GitHub tarball install uses the committed `dist/` runtime and has no
install-time build lifecycle, so it does not need to compile TypeScript on the
installing machine.

After publishing to npm, the registry install should be:

```powershell
npm install -g @rafabd1/proteus
proteus --version
```

## CLI Upgrade

```powershell
npm install -g https://codeload.github.com/rafabd1/Proteus/tar.gz/refs/heads/main
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

## 2. Codex Plugin Install

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

Then register the MCP server from the CLI install:

```powershell
codex mcp add proteus -- proteus-mcp
```

## 3. Claude Code Plugin Install

Install directly inside Claude Code:

```text
/plugin marketplace add rafabd1/Proteus
/plugin install proteus@proteus-marketplace
```

Then use `/proteus` from Claude Code.

Then register the MCP server from the CLI install:

```powershell
claude mcp add -s user proteus -- proteus-mcp
```

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

For Codex, use `codex mcp add proteus -- proteus-mcp`. For Claude Code, use
`claude mcp add -s user proteus -- proteus-mcp`. Plugin hosts that support
plugin-declared MCP servers can also use `plugins/proteus/.mcp.json`. The
wrapper builds the runtime if `dist/` is not present yet.

## Uninstall CLI

```powershell
npm uninstall -g @rafabd1/proteus
```

If installed directly from GitHub, npm still records the installed package under
the package name `@rafabd1/proteus`.
