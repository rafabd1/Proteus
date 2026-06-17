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
    "proteus_migrate",
    "proteus_ingest",
    "proteus_observe",
    "proteus_plan_round",
    "proteus_campaign_create",
    "proteus_campaign_resume",
    "proteus_campaign_checkpoint",
    "proteus_campaign_close",
    "proteus_record_branch",
    "proteus_link_entities",
    "proteus_roles",
    "proteus_prompt",
    "proteus_query_duplicates",
    "proteus_query_memory",
    "proteus_query_similar",
    "proteus_get_record",
    "proteus_list_records",
    "proteus_record_surface",
    "proteus_record_hypothesis",
    "proteus_record_evidence",
    "proteus_record_decision",
    "proteus_record_gate",
    "proteus_record_agent_output",
    "proteus_update_surface",
    "proteus_update_round",
    "proteus_update_rounds",
    "proteus_query_revisit",
    "proteus_query_surfaces",
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
  const migrations = await request("tools/call", {
    name: "proteus_migrate",
    arguments: { root: tmpRoot }
  });
  const migrationsText = String(migrations.content?.[0]?.text ?? "");
  if (!migrationsText.includes("2026-06-17-campaigns-links-branches")) {
    throw new Error("proteus_migrate did not report campaigns/links/branches migration");
  }
  if (!migrationsText.includes('"currentVersion": "1.0.0"') || !migrationsText.includes('"storedVersion": "1.0.0"')) {
    throw new Error("proteus_migrate did not report the Proteus database version");
  }
  fs.mkdirSync(path.join(tmpRoot, "REPORTS"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "REPORTS", "smoke-report.md"),
    "# Smoke Report\n\nSmoke daemon protocol surface duplicate report text.\n"
  );
  await request("tools/call", {
    name: "proteus_ingest",
    arguments: { root: tmpRoot, paths: ["REPORTS"] }
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
  if (!text.includes('"proteusVersion"') || !text.includes('"storedVersion": "1.0.0"')) {
    throw new Error("proteus_status did not return Proteus database version state");
  }

  await request("tools/call", {
    name: "proteus_plan_round",
    arguments: { root: tmpRoot, objective: "MCP smoke plan", markdown: false }
  });
  await request("tools/call", {
    name: "proteus_campaign_create",
    arguments: { root: tmpRoot, title: "MCP smoke campaign", objective: "MCP smoke campaign objective" }
  });
  const campaignDigest = await request("tools/call", {
    name: "proteus_campaign_resume",
    arguments: { root: tmpRoot }
  });
  if (!String(campaignDigest.content?.[0]?.text ?? "").includes("MCP smoke campaign")) {
    throw new Error("proteus_campaign_resume did not return campaign digest");
  }
  await request("tools/call", {
    name: "proteus_record_branch",
    arguments: {
      root: tmpRoot,
      campaignId: 1,
      roundId: 1,
      title: "MCP smoke branch",
      attackPrimitive: "attacker-controlled transition",
      steps: ["step one"],
      killConditions: ["control fails"]
    }
  });
  const checkpoint = await request("tools/call", {
    name: "proteus_campaign_checkpoint",
    arguments: {
      root: tmpRoot,
      id: 1,
      confirmed: ["surface mapped"],
      open: ["MCP smoke branch"],
      pivots: ["stay on daemon boundary"],
      contextToPersist: ["MCP checkpoint context"],
      nextHighRoiMove: "Validate MCP smoke branch",
      contractSignature: { status: "compliant", agent: "mcp-smoke" },
      summary: "MCP smoke checkpoint"
    }
  });
  const checkpointText = String(checkpoint.content?.[0]?.text ?? "");
  if (!checkpointText.includes('"checkpointId"') || !checkpointText.includes('"campaign_checkpoint"')) {
    throw new Error("proteus_campaign_checkpoint did not return the structured checkpoint envelope");
  }
  const checkpointRecord = await request("tools/call", {
    name: "proteus_get_record",
    arguments: { root: tmpRoot, entityType: "checkpoint", entityId: 1 }
  });
  if (!String(checkpointRecord.content?.[0]?.text ?? "").includes("MCP checkpoint context")) {
    throw new Error("proteus_get_record did not return the campaign checkpoint");
  }
  await request("tools/call", {
    name: "proteus_link_entities",
    arguments: { root: tmpRoot, fromType: "campaign", fromId: 1, relation: "has_round", toType: "round", toId: 1 }
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
  if (!suppliedText.includes('"status": "active"')) {
    throw new Error("proteus_plan_round did not create an active plan by default");
  }
  const activePlans = await request("tools/call", {
    name: "proteus_list_records",
    arguments: { root: tmpRoot, recordType: "rounds", status: "active" }
  });
  if (!String(activePlans.content?.[0]?.text ?? "").includes("MCP coordinator supplied plan")) {
    throw new Error("proteus_list_records did not return active rounds");
  }
  const branchRecords = await request("tools/call", {
    name: "proteus_list_records",
    arguments: { root: tmpRoot, recordType: "branches", entityType: "campaign", entityId: 1 }
  });
  if (!String(branchRecords.content?.[0]?.text ?? "").includes("MCP smoke branch")) {
    throw new Error("proteus_list_records did not return recorded branches");
  }
  await request("tools/call", {
    name: "proteus_update_round",
    arguments: { root: tmpRoot, id: 2, status: "paused" }
  });
  const pausedPlans = await request("tools/call", {
    name: "proteus_list_records",
    arguments: { root: tmpRoot, recordType: "rounds", status: "paused" }
  });
  if (!String(pausedPlans.content?.[0]?.text ?? "").includes('"status": "paused"')) {
    throw new Error("proteus_update_round did not pause a round");
  }
  await request("tools/call", {
    name: "proteus_update_round",
    arguments: { root: tmpRoot, id: 2, status: "active" }
  });
  await request("tools/call", {
    name: "proteus_plan_round",
    arguments: { root: tmpRoot, objective: "MCP queued planned round", status: "planned" }
  });
  const bulkRoundUpdate = await request("tools/call", {
    name: "proteus_update_rounds",
    arguments: { root: tmpRoot, fromStatus: "planned", status: "superseded" }
  });
  if (!String(bulkRoundUpdate.content?.[0]?.text ?? "").includes('"updated": 1')) {
    throw new Error("proteus_update_rounds did not update planned rounds");
  }
  await request("tools/call", {
    name: "proteus_record_surface",
    arguments: {
      root: tmpRoot,
      name: "Smoke daemon protocol surface",
      family: "daemon-protocol",
      description: "MCP target-specific surface",
      files: ["daemon.ts"],
      status: "active",
      revisitCondition: "mcp revisit",
      roi: { impactPotential: 8, externalReachability: 7, trustBoundaryDensity: 6 }
    }
  });
  const surfaces = await request("tools/call", {
    name: "proteus_list_records",
    arguments: { root: tmpRoot, recordType: "surfaces", text: "daemon" }
  });
  if (!String(surfaces.content?.[0]?.text ?? "").includes("Smoke daemon protocol surface")) {
    throw new Error("proteus_list_records did not return recorded surface");
  }
  const hypothesis = await request("tools/call", {
    name: "proteus_record_hypothesis",
    arguments: {
      root: tmpRoot,
      title: "MCP smoke hypothesis",
      primitive: "daemon transition",
      attackerBoundary: "external request",
      impactClaim: "mcp smoke impact",
      heuristicFamily: "state transition",
      surfaceId: 1,
      score: 8
    }
  });
  const hypothesisText = String(hypothesis.content?.[0]?.text ?? "");
  if (!hypothesisText.includes("active_campaign_linked") || !hypothesisText.includes("tracks_hypothesis")) {
    throw new Error("proteus_record_hypothesis did not auto-link to the active campaign");
  }
  const evidence = await request("tools/call", {
    name: "proteus_record_evidence",
    arguments: {
      root: tmpRoot,
      title: "MCP smoke evidence",
      kind: "command-output",
      body: "MCP smoke evidence body"
    }
  });
  const evidenceText = String(evidence.content?.[0]?.text ?? "");
  if (!evidenceText.includes("active_campaign_linked") || !evidenceText.includes("has_evidence")) {
    throw new Error("proteus_record_evidence did not auto-link to the active campaign");
  }
  const decision = await request("tools/call", {
    name: "proteus_record_decision",
    arguments: {
      root: tmpRoot,
      entityType: "hypothesis",
      entityId: 1,
      decision: "candidate",
      reason: "MCP smoke candidate decision",
      evidenceIds: [1]
    }
  });
  const decisionText = String(decision.content?.[0]?.text ?? "");
  if (!decisionText.includes("active_campaign_linked") || !decisionText.includes("has_decision")) {
    throw new Error("proteus_record_decision did not auto-link to the active campaign");
  }
  const agentOutput = await request("tools/call", {
    name: "proteus_record_agent_output",
    arguments: {
      root: tmpRoot,
      roundId: 1,
      codename: "argus",
      roleFamily: "intake",
      assignedSurface: "Smoke daemon protocol surface",
      coveredSurface: ["daemon.ts"],
      liveCandidates: ["MCP smoke hypothesis"],
      killedHypotheses: [],
      probes: ["read daemon.ts"],
      uncoveredAreas: [],
      validationStatus: "unvalidated"
    }
  });
  const agentOutputText = String(agentOutput.content?.[0]?.text ?? "");
  if (!agentOutputText.includes("active_campaign_linked") || !agentOutputText.includes("has_agent_output")) {
    throw new Error("proteus_record_agent_output did not auto-link to the active campaign");
  }
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
  if (!coverageText.includes('"entityType": "source"') || coverageText.includes('"entityType": "round"')) {
    throw new Error("proteus_query_duplicates should only return finding/report source coverage");
  }
  const similar = await request("tools/call", {
    name: "proteus_query_similar",
    arguments: { root: tmpRoot, text: "Smoke daemon protocol surface", limit: 5 }
  });
  const similarText = String(similar.content?.[0]?.text ?? "");
  if (!similarText.includes("duplicateCoverage") || !similarText.includes("memoryMatches")) {
    throw new Error("proteus_query_similar did not return duplicate and memory sections");
  }
  const gate = await request("tools/call", {
    name: "proteus_record_gate",
    arguments: {
      root: tmpRoot,
      entityType: "hypothesis",
      entityId: 1,
      gate: "G1 root cause in target",
      status: "pending",
      summary: "MCP gate smoke"
    }
  });
  const gateText = String(gate.content?.[0]?.text ?? "");
  if (!gateText.includes("active_campaign_linked") || !gateText.includes("has_validation_gate")) {
    throw new Error("proteus_record_gate did not auto-link to the active campaign");
  }
  const gates = await request("tools/call", {
    name: "proteus_list_records",
    arguments: { root: tmpRoot, recordType: "gates", entityType: "hypothesis", entityId: 1 }
  });
  if (!String(gates.content?.[0]?.text ?? "").includes("MCP gate smoke")) {
    throw new Error("proteus_list_records did not return recorded gate");
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
  if (!String(revisit.content?.[0]?.text ?? "").includes("Smoke daemon protocol surface")) {
    throw new Error("proteus_query_revisit did not return recorded surface");
  }

  console.log(`Proteus MCP smoke test passed: ${tmpRoot}`);
} finally {
  child.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
}
