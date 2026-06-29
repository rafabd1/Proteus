import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedVersion = String(packageJson.version);
const serverPath = path.join(repoRoot, "plugins", "proteus", "scripts", "proteus-mcp.cjs");
const mockOpenCode = path.join(repoRoot, "scripts", "mock-opencode.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-smoke-"));
const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-global-smoke-"));
const mergeSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-merge-source-smoke-"));

const child = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
    PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports"),
    PROTEUS_CHIMERA_CONFIG_PATH: path.join(globalRoot, "chimera", "config.json")
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

async function requestFail(method, params = {}) {
  try {
    await request(method, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${method} unexpectedly succeeded`);
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
    "proteus_merge_memory",
    "proteus_chimera_config",
    "proteus_chimera_doctor",
    "proteus_chimera_stop_server",
    "proteus_chimera_start",
    "proteus_chimera_swarm",
    "proteus_chimera_council",
    "proteus_chimera_broadcast",
    "proteus_chimera_send",
    "proteus_chimera_post",
    "proteus_chimera_snapshot",
    "proteus_chimera_workflow_snapshot",
    "proteus_chimera_heartbeat",
    "proteus_chimera_run",
    "proteus_chimera_attach_opencode",
    "proteus_chimera_poll",
    "proteus_chimera_list",
    "proteus_chimera_recover",
    "proteus_chimera_kill",
    "proteus_chimera_close",
    "proteus_ingest",
    "proteus_observe",
    "proteus_plan_round",
    "proteus_campaign_create",
    "proteus_campaign_resume",
    "proteus_campaign_checkpoint",
    "proteus_campaign_close",
    "proteus_record_branch",
    "proteus_update_branch",
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
  if (!migrationsText.includes(`"currentVersion": "${expectedVersion}"`) || !migrationsText.includes(`"storedVersion": "${expectedVersion}"`)) {
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

  await request("tools/call", {
    name: "proteus_init",
    arguments: { root: mergeSourceRoot, name: "mcp-stray-merge-target" }
  });
  await request("tools/call", {
    name: "proteus_record_evidence",
    arguments: {
      root: mergeSourceRoot,
      title: "MCP stray merge evidence",
      kind: "note",
      body: "MCP stray merge evidence body"
    }
  });
  const mergeDryRun = await request("tools/call", {
    name: "proteus_merge_memory",
    arguments: { root: tmpRoot, sources: [path.join(mergeSourceRoot, ".vros", "memory.sqlite")], dryRun: true }
  });
  const mergeDryRunText = String(mergeDryRun.content?.[0]?.text ?? "");
  if (!mergeDryRunText.includes('"dryRun": true') || !mergeDryRunText.includes('"evidence": 1')) {
    throw new Error("proteus_merge_memory dry-run did not preview source evidence");
  }
  const mergeResult = await request("tools/call", {
    name: "proteus_merge_memory",
    arguments: { root: tmpRoot, sources: [path.join(mergeSourceRoot, ".vros")] }
  });
  const mergeResultText = String(mergeResult.content?.[0]?.text ?? "");
  if (!mergeResultText.includes('"dryRun": false') || !mergeResultText.includes('"evidence": 1')) {
    throw new Error("proteus_merge_memory did not merge source evidence");
  }
  const mergedMemory = await request("tools/call", {
    name: "proteus_query_memory",
    arguments: { root: tmpRoot, text: "MCP stray merge evidence body" }
  });
  if (!String(mergedMemory.content?.[0]?.text ?? "").includes('"entityType": "evidence"')) {
    throw new Error("merged MCP evidence was not searchable in destination memory");
  }

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
  if (!text.includes('"proteusVersion"') || !text.includes(`"storedVersion": "${expectedVersion}"`)) {
    throw new Error("proteus_status did not return Proteus database version state");
  }

  const opencodeCommand = `"${process.execPath}" "${mockOpenCode}"`;
  const chimeraConfig = await request("tools/call", {
    name: "proteus_chimera_config",
    arguments: { action: "init", opencodeCommand, model: "mock/mock-model", variant: "high", maxAgents: 3 }
  });
  const chimeraConfigText = String(chimeraConfig.content?.[0]?.text ?? "");
  if (!chimeraConfigText.includes('"enabled": true') || !chimeraConfigText.includes("mock/mock-model") || !chimeraConfigText.includes('"defaultVariant": "high"')) {
    throw new Error("proteus_chimera_config did not enable mock Chimera config");
  }
  if (!chimeraConfigText.includes('"defaultTimeoutSec": 0')) {
    throw new Error("proteus_chimera_config should default to no run timeout");
  }
  const chimeraTimeoutConfig = await request("tools/call", {
    name: "proteus_chimera_config",
    arguments: { action: "init", timeout: 5 }
  });
  if (!String(chimeraTimeoutConfig.content?.[0]?.text ?? "").includes('"defaultTimeoutSec": 5')) {
    throw new Error("proteus_chimera_config did not persist explicit timeout");
  }
  const chimeraNoTimeoutConfig = await request("tools/call", {
    name: "proteus_chimera_config",
    arguments: { action: "init", timeout: 0 }
  });
  if (!String(chimeraNoTimeoutConfig.content?.[0]?.text ?? "").includes('"defaultTimeoutSec": 0')) {
    throw new Error("proteus_chimera_config timeout 0 did not disable default timeout");
  }
  const chimeraConfigPartial = await request("tools/call", {
    name: "proteus_chimera_config",
    arguments: { action: "init", model: "mock/other-model" }
  });
  const chimeraConfigPartialJson = JSON.parse(String(chimeraConfigPartial.content?.[0]?.text ?? "{}"));
  if (
    chimeraConfigPartialJson.record?.opencodeCommand !== opencodeCommand ||
    chimeraConfigPartialJson.record?.defaultVariant !== "high" ||
    chimeraConfigPartialJson.record?.defaultModel !== "mock/other-model"
  ) {
    throw new Error("proteus_chimera_config partial init did not preserve existing global config fields");
  }
  if (!fs.existsSync(path.join(globalRoot, "chimera", "config.json"))) {
    throw new Error("proteus_chimera_config did not write global config");
  }
  if (fs.existsSync(path.join(tmpRoot, ".vros", "chimera", "config.json"))) {
    throw new Error("proteus_chimera_config should not write workspace config");
  }
  const chimeraDoctor = await request("tools/call", {
    name: "proteus_chimera_doctor",
    arguments: { root: tmpRoot }
  });
  if (!String(chimeraDoctor.content?.[0]?.text ?? "").includes('"ok": true')) {
    throw new Error("proteus_chimera_doctor did not pass with mock OpenCode");
  }
  const chimeraStart = await request("tools/call", {
    name: "proteus_chimera_start",
    arguments: {
      root: tmpRoot,
      role: "chaining",
      goal: "MCP Chimera chain",
      access: "editor",
      accessNotes: "MCP smoke editor grant: non-destructive shell only; edit generated lab files only."
    }
  });
  const chimeraStartText = String(chimeraStart.content?.[0]?.text ?? "");
  if (!chimeraStartText.includes('"publicId": "CH-0001"') || !chimeraStartText.includes('"accessMode": "editor"') || !chimeraStartText.includes('"backgroundRun"') || !chimeraStartText.includes('"status": "starting"')) {
    throw new Error("proteus_chimera_start did not create editor CH-0001");
  }
  const chimeraRecover = await request("tools/call", {
    name: "proteus_chimera_recover",
    arguments: { root: tmpRoot, id: "CH-0001" }
  });
  const chimeraRecoverText = String(chimeraRecover.content?.[0]?.text ?? "");
  if (!chimeraRecoverText.includes('"publicId": "CH-0001"') || !chimeraRecoverText.includes('"controlStatus"')) {
    throw new Error("proteus_chimera_recover did not return reconciled session and control status");
  }
  const invalidAttach = await requestFail("tools/call", {
    name: "proteus_chimera_attach_opencode",
    arguments: { root: tmpRoot, id: "CH-0001", serverUrl: "http://127.0.0.1:4096" }
  });
  if (!invalidAttach.includes("Expected non-empty string")) {
    throw new Error("proteus_chimera_attach_opencode should require an OpenCode session id");
  }
  await waitForFile(path.join(tmpRoot, ".vros", "chimera", "sessions", "CH-0001", "opencode", "run.json"), 10000);
  const chimeraRunRecover = await request("tools/call", {
    name: "proteus_chimera_recover",
    arguments: { root: tmpRoot, id: "CH-0001" }
  });
  const chimeraRunJson = JSON.parse(String(chimeraRunRecover.content?.[0]?.text ?? "{}"));
  if (chimeraRunJson.record?.session?.opencodeSessionId !== "ses_mock_CH-0001") {
    throw new Error("proteus_chimera_start auto-run did not attach the mock OpenCode session");
  }
  const chimeraServerUrl = chimeraRunJson.record?.session?.opencodeServerUrl;
  if (typeof chimeraServerUrl !== "string" || !chimeraServerUrl.startsWith("http://127.0.0.1:")) {
    throw new Error("proteus_chimera_start auto-run did not persist a mock OpenCode server URL");
  }
  const mockRegistryPath = path.join(tmpRoot, ".vros", "chimera", "mock-opencode-sessions.json");
  fs.mkdirSync(path.dirname(mockRegistryPath), { recursive: true });
  fs.writeFileSync(mockRegistryPath, JSON.stringify([
    {
      id: "ses_mock_wrong_workspace_CH_0001",
      title: "proteus-CH-0001",
      directory: path.join(tmpRoot, "wrong-workspace", ".vros", "chimera", "sessions", "CH-0001"),
      time: { created: 1, updated: 9999999999999 }
    },
    {
      id: "ses_mock_CH-0001",
      title: "proteus-CH-0001",
      directory: path.join(tmpRoot, ".vros", "chimera", "sessions", "CH-0001"),
      time: { created: 1, updated: 2 }
    }
  ], null, 2) + "\n");
  await request("tools/call", {
    name: "proteus_chimera_attach_opencode",
    arguments: { root: tmpRoot, id: "CH-0001", serverUrl: chimeraServerUrl, opencodeSessionId: "ses_mock_wrong_workspace_CH_0001" }
  });
  const staleSnapshot = await request("tools/call", {
    name: "proteus_chimera_workflow_snapshot",
    arguments: { root: tmpRoot, id: "CH-0001", limit: 1, maxMessageChars: 80 }
  });
  const staleSnapshotText = String(staleSnapshot.content?.[0]?.text ?? "");
  if (!staleSnapshotText.includes('"opencodeSessionId": "ses_mock_CH-0001"') || staleSnapshotText.includes("ses_mock_wrong_workspace_CH_0001")) {
    throw new Error("proteus_chimera_workflow_snapshot did not reconcile a stale OpenCode session id");
  }
  const chimeraRunAfterWrongAttach = await request("tools/call", {
    name: "proteus_chimera_run",
    arguments: { root: tmpRoot, id: "CH-0001", timeout: 10, message: "MCP resume instruction" }
  });
  const chimeraRunAfterWrongAttachJson = JSON.parse(String(chimeraRunAfterWrongAttach.content?.[0]?.text ?? "{}"));
  if (chimeraRunAfterWrongAttachJson.record?.run?.exitCode !== 0 || chimeraRunAfterWrongAttachJson.record?.session?.opencodeSessionId !== "ses_mock_CH-0001") {
    throw new Error("proteus_chimera_run did not recover from a stale OpenCode session id");
  }
  const chimeraRunAfterWrongAttachRecord = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".vros", "chimera", "sessions", "CH-0001", "opencode", "run.json"), "utf8"));
  if (chimeraRunAfterWrongAttachRecord.args.includes("ses_mock_wrong_workspace_CH_0001")) {
    throw new Error("proteus_chimera_run reused a stale OpenCode session id from another workspace");
  }
  if (!chimeraRunAfterWrongAttachRecord.args.some((arg) => String(arg).includes("MCP resume instruction"))) {
    throw new Error("proteus_chimera_run did not pass the MCP resume instruction to OpenCode");
  }
  const chimeraWorkflowSnapshot = await request("tools/call", {
    name: "proteus_chimera_workflow_snapshot",
    arguments: { root: tmpRoot, id: "CH-0001", limit: 3, maxMessageChars: 80 }
  });
  const workflowSnapshotText = String(chimeraWorkflowSnapshot.content?.[0]?.text ?? "");
  if (!workflowSnapshotText.includes("First compact agent workflow message") || workflowSnapshotText.includes("TOOL RESULT THAT MUST NOT APPEAR")) {
    throw new Error("proteus_chimera_workflow_snapshot did not return filtered compact agent messages");
  }
  const removedExportKeys = ["requested" + "San" + "itize", "fallbackFrom" + "San" + "itizedExport"];
  if (removedExportKeys.some((key) => workflowSnapshotText.includes(key))) {
    throw new Error("proteus_chimera_workflow_snapshot should not expose removed export compatibility fields");
  }
  await request("tools/call", {
    name: "proteus_chimera_post",
    arguments: { root: tmpRoot, id: "CH-0001", kind: "finding", body: "MCP Chimera finding" }
  });
  const chimeraPoll = await request("tools/call", {
    name: "proteus_chimera_poll",
    arguments: { root: tmpRoot, id: "CH-0001", unreadOnly: true }
  });
  if (!String(chimeraPoll.content?.[0]?.text ?? "").includes("MCP Chimera finding")) {
    throw new Error("proteus_chimera_poll did not return unread agent message");
  }
  await request("tools/call", {
    name: "proteus_chimera_send",
    arguments: { root: tmpRoot, id: "CH-0001", kind: "redirect", message: "MCP coordinator redirect", priority: true }
  });
  const chimeraAgentPoll = await request("tools/call", {
    name: "proteus_chimera_poll",
    arguments: { root: tmpRoot, id: "CH-0001", unreadOnly: true, forAgent: true }
  });
  if (!String(chimeraAgentPoll.content?.[0]?.text ?? "").includes("MCP coordinator redirect")) {
    throw new Error("proteus_chimera_poll did not return coordinator-to-agent message");
  }
  if (!String(chimeraAgentPoll.content?.[0]?.text ?? "").includes('"priority": true')) {
    throw new Error("proteus_chimera_send did not preserve priority metadata");
  }
  await request("tools/call", {
    name: "proteus_chimera_broadcast",
    arguments: { root: tmpRoot, message: "MCP shared chat", priority: true }
  });
  const chimeraBroadcastPoll = await request("tools/call", {
    name: "proteus_chimera_poll",
    arguments: { root: tmpRoot, id: "CH-0001", unreadOnly: true, forAgent: true }
  });
  if (!String(chimeraBroadcastPoll.content?.[0]?.text ?? "").includes("MCP shared chat")) {
    throw new Error("proteus_chimera_broadcast did not deliver shared chat to agent");
  }
  if (!String(chimeraBroadcastPoll.content?.[0]?.text ?? "").includes('"priority": true')) {
    throw new Error("proteus_chimera_broadcast did not preserve priority metadata");
  }
  await request("tools/call", {
    name: "proteus_chimera_snapshot",
    arguments: { root: tmpRoot, id: "CH-0001", body: "MCP Chimera snapshot" }
  });
  const chimeraHeartbeat = await request("tools/call", {
    name: "proteus_chimera_heartbeat",
    arguments: { root: tmpRoot, id: "CH-0001" }
  });
  if (!String(chimeraHeartbeat.content?.[0]?.text ?? "").includes('"alive": true')) {
    throw new Error("proteus_chimera_heartbeat did not report alive");
  }
  const chimeraSwarm = await request("tools/call", {
    name: "proteus_chimera_swarm",
    arguments: {
      root: tmpRoot,
      plan: {
        agents: [
          { role: "codebase-research", goal: "MCP map surface" },
          { role: "fuzzing", goal: "MCP fuzz surface" }
        ]
      }
    }
  });
  const chimeraSwarmText = String(chimeraSwarm.content?.[0]?.text ?? "");
  if (!chimeraSwarmText.includes('"publicId": "CH-0002"') || !chimeraSwarmText.includes('"publicId": "CH-0003"')) {
    throw new Error("proteus_chimera_swarm did not create independent sessions");
  }
  const chimeraBackgroundStart = await request("tools/call", {
    name: "proteus_chimera_start",
    arguments: {
      root: tmpRoot,
      role: "explorer",
      goal: "MCP background Chimera launch",
      run: true
    }
  });
  const chimeraBackgroundStartText = String(chimeraBackgroundStart.content?.[0]?.text ?? "");
  if (!chimeraBackgroundStartText.includes('"publicId": "CH-0004"') || !chimeraBackgroundStartText.includes('"backgroundRun"') || !chimeraBackgroundStartText.includes('"started": true') || !chimeraBackgroundStartText.includes('"status": "starting"')) {
    throw new Error("proteus_chimera_start run=true without timeout should return a background run");
  }
  await waitForFile(path.join(tmpRoot, ".vros", "chimera", "sessions", "CH-0004", "opencode", "run.json"), 10000);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await request("tools/call", {
    name: "proteus_chimera_send",
    arguments: { root: tmpRoot, fromId: "CH-0001", toId: "CH-0002", message: "MCP direct Chimera message" }
  });
  const chimeraDirectPoll = await request("tools/call", {
    name: "proteus_chimera_poll",
    arguments: { root: tmpRoot, id: "CH-0002", unreadOnly: true, forAgent: true }
  });
  const chimeraDirectPollText = String(chimeraDirectPoll.content?.[0]?.text ?? "");
  if (!chimeraDirectPollText.includes("MCP direct Chimera message") || !chimeraDirectPollText.includes('"fromId": "CH-0001"')) {
    throw new Error("proteus_chimera_send did not deliver direct agent-to-agent message metadata");
  }
  const chimeraCouncil = await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: {
      root: tmpRoot,
      action: "start",
      topic: "MCP stalled branch brainstorm",
      reason: "MCP checkpoint needs fresh angles",
      ids: ["CH-0001", "CH-0002"],
      maxRounds: 1
    }
  });
  const councilText = String(chimeraCouncil.content?.[0]?.text ?? "");
  const councilId = councilText.match(/"councilId": "([^"]+)"/)?.[1];
  if (!councilId || !councilText.includes('"participants"')) {
    throw new Error("proteus_chimera_council start did not return a council id and participants");
  }
  await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: { root: tmpRoot, action: "accept", id: "CH-0001", councilId, body: "MCP CH-0001 ready" }
  });
  const councilOpenRound = await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: { root: tmpRoot, action: "open-round", councilId, round: 1, message: "MCP round 1 opening" }
  });
  const councilOpenRoundText = String(councilOpenRound.content?.[0]?.text ?? "");
  if (!councilOpenRoundText.includes('"firstCue"') || !councilOpenRoundText.includes("it is your ordered turn now") || !councilOpenRoundText.includes("MCP CH-0001 ready")) {
    throw new Error("proteus_chimera_council open-round did not automatically cue first accepted participant with transcript");
  }
  await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: { root: tmpRoot, action: "turn", id: "CH-0001", councilId, round: 1, body: "MCP CH-0001 observation" }
  });
  const councilStatus = await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: { root: tmpRoot, action: "status", councilId }
  });
  const councilStatusText = String(councilStatus.content?.[0]?.text ?? "");
  if (!councilStatusText.includes('"readyCount": 1') || !councilStatusText.includes("MCP CH-0001 observation")) {
    throw new Error("proteus_chimera_council status did not recover accept and turn messages");
  }
  const councilClose = await request("tools/call", {
    name: "proteus_chimera_council",
    arguments: { root: tmpRoot, action: "close", councilId, summary: "MCP council final decision", instruction: "Resume MCP smoke work" }
  });
  if (!String(councilClose.content?.[0]?.text ?? "").includes('"closed": true')) {
    throw new Error("proteus_chimera_council close did not mark the council closed");
  }
  await request("tools/call", {
    name: "proteus_chimera_kill",
    arguments: { root: tmpRoot, id: "CH-0001", reason: "MCP smoke kill" }
  });
  const chimeraClose = await request("tools/call", {
    name: "proteus_chimera_close",
    arguments: { root: tmpRoot, id: "CH-0001", verdict: "watchlist", summary: "MCP smoke close" }
  });
  if (!String(chimeraClose.content?.[0]?.text ?? "").includes('"closeVerdict": "watchlist"')) {
    throw new Error("proteus_chimera_close did not persist verdict");
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
          },
          {
            codename: "coordinator-main",
            assignedSurfaceIds: [1],
            purpose: "Coordinator-owned execution front",
            requiredOutput: ["operator status", "next move"]
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
  if (!suppliedText.includes('"codename": "coordinator-main"') || !suppliedText.includes('"family": "coordinator-supplied"')) {
    throw new Error("proteus_plan_round did not preserve custom coordinator-supplied agent fronts");
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
  const updateBranch = await request("tools/call", {
    name: "proteus_update_branch",
    arguments: { root: tmpRoot, id: "B1", status: "testing" }
  });
  if (!String(updateBranch.content?.[0]?.text ?? "").includes('"status": "testing"')) {
    throw new Error("proteus_update_branch did not move branch to testing");
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
      evidenceIds: ["1"]
    }
  });
  const decisionText = String(decision.content?.[0]?.text ?? "");
  if (!decisionText.includes("active_campaign_linked") || !decisionText.includes("has_decision")) {
    throw new Error("proteus_record_decision did not auto-link to the active campaign");
  }
  if (decisionText.includes("decision_without_evidence")) {
    throw new Error("proteus_record_decision dropped numeric-string evidenceIds");
  }
  const decisionRecord = await request("tools/call", {
    name: "proteus_get_record",
    arguments: { root: tmpRoot, entityType: "decision", entityId: 1 }
  });
  if (!String(decisionRecord.content?.[0]?.text ?? "").includes('"evidenceIds": [\n    1\n  ]')) {
    throw new Error("proteus_get_record did not preserve numeric-string decision evidenceIds");
  }
  const branchDecision = await request("tools/call", {
    name: "proteus_record_decision",
    arguments: {
      root: tmpRoot,
      entityType: "hypothesis_branch",
      entityId: 1,
      decision: "killed",
      reason: "MCP smoke branch killed by evidence-backed decision",
      evidenceIds: ["1"]
    }
  });
  const branchDecisionText = String(branchDecision.content?.[0]?.text ?? "");
  if (!branchDecisionText.includes('"entityType": "hypothesis_branch"') || !branchDecisionText.includes('"updated"')) {
    throw new Error("proteus_record_decision did not report branch status update");
  }
  const killedBranch = await request("tools/call", {
    name: "proteus_get_record",
    arguments: { root: tmpRoot, entityType: "branch", entityId: 1 }
  });
  if (!String(killedBranch.content?.[0]?.text ?? "").includes('"status": "killed"')) {
    throw new Error("proteus_record_decision on branch did not persist killed status");
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
      summary: "MCP gate smoke",
      evidenceIds: ["1"]
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
  await request("tools/call", {
    name: "proteus_chimera_stop_server",
    arguments: { root: tmpRoot }
  });

  console.log(`Proteus MCP smoke test passed: ${tmpRoot}`);
} finally {
  child.stdin.end();
  child.kill();
  await waitForExit(child, 2000);
  killMockOpenCodeServers();
  rmTemp(tmpRoot);
  rmTemp(globalRoot);
  rmTemp(mergeSourceRoot);
}

function waitForExit(childProcess, timeoutMs) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    childProcess.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForFile(filePath, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for file: ${filePath}`);
}

function rmTemp(target) {
  let lastError = null;
  const attempts = process.platform === "win32" ? 8 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      if (process.platform !== "win32") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  if (lastError) {
    console.warn(`warning: could not remove temp path ${target}: ${lastError.message}`);
  }
}

function killMockOpenCodeServers() {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "$mock=$env:PROTEUS_SMOKE_MOCK_OPENCODE; " +
      "Get-CimInstance Win32_Process | " +
      "Where-Object { $mock -and $_.CommandLine -like ('*' + $mock + '* serve *') } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    ], {
      env: { ...process.env, PROTEUS_SMOKE_MOCK_OPENCODE: mockOpenCode },
      stdio: "ignore"
    });
  } catch {
    // Best-effort cleanup for mock servers started by this smoke test.
  }
}
