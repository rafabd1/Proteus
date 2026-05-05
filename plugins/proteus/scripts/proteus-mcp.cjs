#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..", "..");
const server = path.join(repoRoot, "dist", "mcp.js");

if (!fs.existsSync(server)) {
  run("npm", ["run", "build"], repoRoot);
}

require(server);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
