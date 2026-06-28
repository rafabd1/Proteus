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
@rafabd1/proteus 2.0.0
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

In Codex, invoke the plugin with `@proteus`, for example:

```text
@proteus initialize continuous vulnerability research for this repository
```

Use `@proteus` as the normal entrypoint so Codex can load the plugin and choose
the main coordinator skill plus any specialist skill it needs. Slash-style skill
mentions are for explicitly targeting a single skill and are less ergonomic now
that Proteus ships multiple skills.

## 3. Claude Code Plugin Install

Claude Code support is experimental and has not been exhaustively tested yet.
Because Proteus is heavily focused on offensive security research, Claude
models may also apply safety restrictions that affect exploit-development,
chaining, or other offsec workflows.

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

Use the repository/workspace root as the normal Proteus `--root`. If a memory
base is accidentally created in a nested folder, merge it into the intended
root before continuing:

```powershell
proteus merge --root C:\path\to\workspace --source .\packages\foo\.vros\memory.sqlite --dry-run
proteus merge --root C:\path\to\workspace --source .\packages\foo\.vros\memory.sqlite
```

## Verify MCP

```powershell
proteus-mcp
```

For Codex, use `codex mcp add proteus -- proteus-mcp`. For Claude Code, use
`claude mcp add -s user proteus -- proteus-mcp`. Plugin hosts that support
plugin-declared MCP servers can also use `plugins/proteus/.mcp.json`. The
wrapper builds the runtime if `dist/` is not present yet.

## Optional Chimera Runtime

Chimera mode uses OpenCode for secondary agents. Normal Proteus usage does not
require OpenCode. Install and configure OpenCode from the official project, then
enable Chimera for a target:

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode docs: <https://opencode.ai/docs/>

```powershell
proteus chimera config init --opencode-command opencode --model zai/glm-5.2 --variant high
proteus chimera doctor --root C:\path\to\target
```

## Uninstall CLI

```powershell
npm uninstall -g @rafabd1/proteus
```

If installed directly from GitHub, npm still records the installed package under
the package name `@rafabd1/proteus`.
