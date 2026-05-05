#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const candidates = [
  path.join(pluginRoot, "dist", "mcp.js"),
  path.join(repoRoot, "dist", "mcp.js")
];
const server = candidates.find((candidate) => fs.existsSync(candidate));

if (!server) {
  run("npm", ["run", "build"], repoRoot);
}

require(server ?? path.join(repoRoot, "dist", "mcp.js"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
