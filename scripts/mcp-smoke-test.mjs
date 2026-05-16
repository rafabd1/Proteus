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
  const toolNames = tools.tools.map((tool) => tool.name);
  for (const expectedTool of [
    "proteus_init",
    "proteus_status",
    "proteus_ingest",
    "proteus_observe",
    "proteus_plan_round",
    "proteus_roles",
    "proteus_prompt",
    "proteus_query_duplicates",
    "proteus_query_memory",
    "proteus_get_record",
    "proteus_record_hypothesis",
    "proteus_record_evidence",
    "proteus_record_decision",
    "proteus_record_agent_output",
    "proteus_update_surface",
    "proteus_query_revisit",
    "proteus_export",
    "proteus_lab_create",
    "proteus_record_global_learning",
    "proteus_query_global_learnings",
    "proteus_export_global_learnings"
  ]) {
    if (!toolNames.includes(expectedTool)) {
      throw new Error(`${expectedTool} tool was not registered`);
    }
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
  if (!text.includes('"memory"')) {
    throw new Error("proteus_status did not return memory stats");
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
    name: "proteus_record_evidence",
    arguments: {
      root: tmpRoot,
      title: "MCP smoke evidence",
      kind: "command-output",
      body: "MCP smoke evidence body"
    }
  });
  const roles = await request("tools/call", { name: "proteus_roles", arguments: {} });
  if (!String(roles.content?.[0]?.text ?? "").includes("Argus")) {
    throw new Error("proteus_roles did not return role definitions");
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
  const coverage = await request("tools/call", {
    name: "proteus_query_duplicates",
    arguments: { root: tmpRoot, text: "Smoke daemon protocol surface", limit: 5 }
  });
  const coverageText = String(coverage.content?.[0]?.text ?? "");
  if (!coverageText.includes('"score"') || !coverageText.includes('"matchedTerms"')) {
    throw new Error("proteus_query_duplicates did not return coverage metadata");
  }
  const record = await request("tools/call", {
    name: "proteus_get_record",
    arguments: { root: tmpRoot, entityType: "round", entityId: 2 }
  });
  const recordText = String(record.content?.[0]?.text ?? "");
  if (!recordText.includes('"entityType": "round"') || !recordText.includes("Smoke daemon protocol surface")) {
    throw new Error("proteus_get_record did not return full record");
  }
  const revisit = await request("tools/call", {
    name: "proteus_query_revisit",
    arguments: { root: tmpRoot, surface: "Smoke daemon protocol surface" }
  });
  if (String(revisit.content?.[0]?.text ?? "") !== "[]") {
    throw new Error("proteus_query_revisit should be empty before target-specific surfaces exist in memory");
  }

  console.log(`Proteus MCP smoke test passed: ${tmpRoot}`);
} finally {
  child.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
}
