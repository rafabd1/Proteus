import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "plugins", "proteus", "scripts", "proteus-mcp.cjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-smoke-"));
const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-global-smoke-"));

const child = spawn("node", [serverPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
    PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports")
  },
  stdio: ["pipe", "pipe", "pipe"]
});

let nextId = 1;
let stdout = "";
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  while (true) {
    const index = stdout.indexOf("\n");
    if (index === -1) break;
    const line = stdout.slice(0, index);
    stdout = stdout.slice(index + 1);
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  }
});

child.stderr.on("data", (chunk) => process.stderr.write(chunk));

function request(method, params = {}) {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(message) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 5000);
  });
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "proteus-smoke-client", version: "0.1.0" }
  });
  const tools = await request("tools/list");
  if (!tools.tools.some((tool) => tool.name === "proteus_init")) {
    throw new Error("proteus_init tool was not registered");
  }

  await request("tools/call", {
    name: "proteus_init",
    arguments: { root: tmpRoot, name: "mcp-smoke-target" }
  });

  const status = await request("tools/call", {
    name: "proteus_status",
    arguments: { root: tmpRoot }
  });
  const text = status.content?.[0]?.text ?? "";
  if (!text.includes("mcp-smoke-target")) {
    throw new Error("proteus_status did not return initialized target");
  }

  await request("tools/call", {
    name: "proteus_plan_round",
    arguments: { root: tmpRoot, objective: "MCP smoke plan", markdown: false }
  });
  const suppliedPlan = await request("tools/call", {
    name: "proteus_plan_round",
    arguments: {
      root: tmpRoot,
      objective: "MCP coordinator supplied plan",
      coordinatorPlan: {
        currentUnderstanding: "Smoke coordinator context",
        selectedSurfaces: [
          {
            id: 1,
            name: "Smoke daemon protocol surface",
            family: "daemon-protocol",
            reason: "Coordinator supplied a narrow surface"
          }
        ],
        agentFronts: [
          {
            codename: "argus",
            assignedSurfaceIds: [1],
            purpose: "Inspect the supplied smoke surface"
          }
        ]
      },
      markdown: false
    }
  });
  const suppliedText = String(suppliedPlan.content?.[0]?.text ?? "");
  if (!suppliedText.includes('"planningMode": "coordinator_supplied"')) {
    throw new Error("proteus_plan_round did not preserve coordinator-supplied planning mode");
  }
  await request("tools/call", {
    name: "proteus_record_global_learning",
    arguments: {
      root: tmpRoot,
      category: "validation_pattern",
      scope: "mcp,smoke",
      title: "MCP global learning",
      body: "MCP smoke learning body",
      tags: ["mcp", "smoke"]
    }
  });
  const globalLearning = await request("tools/call", {
    name: "proteus_query_global_learnings",
    arguments: { text: "MCP", scope: "smoke" }
  });
  if (!String(globalLearning.content?.[0]?.text ?? "").includes("MCP global learning")) {
    throw new Error("proteus_query_global_learnings did not return expected learning");
  }
  await request("tools/call", {
    name: "proteus_update_surface",
    arguments: { root: tmpRoot, id: 1, status: "covered", revisitCondition: "mcp smoke revisit" }
  });

  console.log(`Proteus MCP smoke test passed: ${tmpRoot}`);
} finally {
  child.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
}
