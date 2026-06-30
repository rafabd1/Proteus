import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedVersion = String(packageJson.version);
const cli = path.join(repoRoot, "dist", "cli.js");
const mockOpenCode = path.join(repoRoot, "scripts", "mock-opencode.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-smoke-"));
const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-global-smoke-"));
const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-legacy-smoke-"));
const helpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-help-smoke-"));
const mergeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-merge-source-smoke-"));
const killRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-kill-smoke-"));
const concurrencyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-concurrency-smoke-"));
const chimeraScopeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-chimera-scope-smoke-"));
const chimeraGeneralistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-chimera-generalist-smoke-"));
const chimeraCampaignListRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-chimera-campaign-list-smoke-"));

function run(args, cwd = tmpRoot, extraEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: smokeEnv(extraEnv),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function smokeEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
    PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports"),
    PROTEUS_CHIMERA_CONFIG_PATH: path.join(globalRoot, "chimera", "config.json")
  };
}

function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error(`timed out waiting for file: ${filePath}`);
}

function waitForChild(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`child did not exit in time\nstdout=${stdout}\nstderr=${stderr}`));
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function runFail(args, cwd = tmpRoot, extraEnv = {}) {
  try {
    run(args, cwd, extraEnv);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  throw new Error(`command unexpectedly succeeded: ${args.join(" ")}`);
}

try {
  const planHelp = run(["plan-round", "--help"], helpRoot);
  if (!planHelp.includes("Proteus plan-round") || !planHelp.includes("Usage:")) {
    throw new Error("plan-round --help did not print command help");
  }
  if (fs.existsSync(path.join(helpRoot, ".vros"))) {
    throw new Error("plan-round --help created target memory state");
  }

  fs.mkdirSync(path.join(legacyRoot, ".vros"), { recursive: true });
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning?.message;
    const warningType = typeof args[0] === "string" ? args[0] : undefined;
    if (warningType === "ExperimentalWarning" && String(message).includes("SQLite")) return;
    return emitWarning.call(process, warning, ...args);
  };
  const { DatabaseSync } = require("node:sqlite");
  const legacyDb = new DatabaseSync(path.join(legacyRoot, ".vros", "memory.sqlite"));
  process.emitWarning = emitWarning;
  legacyDb.exec(`
    CREATE TABLE targets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      contract_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb.prepare("INSERT INTO targets (name, root_path, contract_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "legacy-target",
    legacyRoot,
    JSON.stringify({
      target: "legacy-target",
      scopeRoot: legacyRoot,
      inScope: [],
      outOfScope: [],
      existingWork: [],
      primaryImpactClasses: [],
      hardExclusions: [],
      assumptions: [],
      availableTooling: [],
      credentialsAvailable: "unknown",
      continuousMode: false,
      stopOnCandidate: true
    }),
    new Date().toISOString(),
    new Date().toISOString()
  );
  legacyDb.close();
  const migratedStatus = run(["status", "--root", legacyRoot], legacyRoot);
  if (!migratedStatus.includes("legacy-target") || !migratedStatus.includes("Gates: 0") || !migratedStatus.includes(`Proteus DB version: ${expectedVersion}`)) {
    throw new Error("legacy memory migration did not preserve target and create new gate schema");
  }
  const migratedVersions = run(["migrate", "--root", legacyRoot], legacyRoot);
  if (!migratedVersions.includes("2026-06-17-campaigns-links-branches")) {
    throw new Error("migrate did not report the campaigns/links/branches migration");
  }
  if (!migratedVersions.includes(`Proteus DB version: ${expectedVersion}`) || !migratedVersions.includes(`previous ${expectedVersion}`)) {
    throw new Error("migrate did not report the stored Proteus database version");
  }
  const partiallyMigratedDb = new DatabaseSync(path.join(legacyRoot, ".vros", "memory.sqlite"));
  partiallyMigratedDb
    .prepare("DELETE FROM schema_migrations WHERE version = ?")
    .run("2026-06-27-chimera-access-modes");
  partiallyMigratedDb
    .prepare("DELETE FROM schema_migrations WHERE version = ?")
    .run("2026-06-27-chimera-opencode-control");
  partiallyMigratedDb
    .prepare("UPDATE proteus_metadata SET value = ? WHERE key = 'proteus_version'")
    .run(expectedVersion);
  partiallyMigratedDb.close();
  const repairedMigrations = run(["migrate", "--root", legacyRoot], legacyRoot);
  if (!repairedMigrations.includes("2026-06-27-chimera-access-modes") || !repairedMigrations.includes("2026-06-27-chimera-opencode-control")) {
    throw new Error("migration check skipped a missing migration when stored version already matched runtime");
  }
  run([
    "record",
    "gate",
    "--root",
    legacyRoot,
    "--entity-type",
    "hypothesis",
    "--entity-id",
    "1",
    "--gate",
    "G1 root cause in target",
    "--status",
    "pending"
  ]);

  fs.mkdirSync(path.join(tmpRoot, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "docs", "prior-finding.md"),
    "# Prior Finding\n\nValidation gate duplicate text for smoke testing.\n"
  );
  fs.writeFileSync(
    path.join(tmpRoot, "docs", "general-note.md"),
    "# General Note\n\nGeneric glossary mention of broad-only cache glossary phrase.\n"
  );
  fs.writeFileSync(
    path.join(tmpRoot, "docs", "watchlist.md"),
    "# Watchlist\n\nValidation gate watchlist text should stay available in broad memory but not count as duplicate coverage.\n"
  );
  fs.writeFileSync(
    path.join(tmpRoot, "server.ts"),
    "export function handler(request: Request) { return request.url; }\n"
  );

  run(["init", "--name", "smoke-target"]);
  const status = run(["status"]);
  if (!status.includes("smoke-target") || !status.includes(`Proteus DB version: ${expectedVersion}`)) {
    throw new Error("status did not return initialized target");
  }
  run(["init", "--root", concurrencyRoot, "--name", "concurrency-smoke"], concurrencyRoot);
  const concurrentWrites = await Promise.all(Array.from({ length: 8 }, (_, index) => waitForChild(spawn(process.execPath, [
    cli,
    "record",
    "evidence",
    "--root",
    concurrencyRoot,
    "--title",
    `Concurrent evidence ${index + 1}`,
    "--kind",
    "note",
    "--body",
    `Concurrent body ${index + 1}`
  ], {
    cwd: concurrencyRoot,
    env: smokeEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  }), 20000)));
  for (const [index, result] of concurrentWrites.entries()) {
    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(combined)) {
      throw new Error(`concurrent SQLite write ${index + 1} failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    }
  }
  const concurrentEvidence = run(["list", "evidence", "--root", concurrencyRoot], concurrencyRoot);
  for (let index = 1; index <= 8; index += 1) {
    if (!concurrentEvidence.includes(`Concurrent evidence ${index}`)) {
      throw new Error(`concurrent SQLite write missing evidence ${index}`);
    }
  }
  const disabledChimeraStart = runFail(["chimera", "start", "--role", "chaining", "--goal", "should fail while disabled"]);
  if (!disabledChimeraStart.includes("Chimera is disabled")) {
    throw new Error("chimera start should fail clearly before config init");
  }
  const opencodeCommand = `"${process.execPath}" "${mockOpenCode}"`;
  const chimeraConfig = run([
    "chimera",
    "config",
    "init",
    "--opencode-command",
    opencodeCommand,
    "--model",
    "mock/mock-model",
    "--variant",
    "high",
    "--max-agents",
    "3"
  ]);
  if (!chimeraConfig.includes('"enabled": true') || !chimeraConfig.includes("mock/mock-model") || !chimeraConfig.includes('"defaultVariant": "high"')) {
    throw new Error("chimera config init did not persist enabled mock config");
  }
  if (!chimeraConfig.includes('"defaultTimeoutSec": 0')) {
    throw new Error("chimera config init should default to no run timeout");
  }
  const chimeraTimeoutConfig = run(["chimera", "config", "init", "--timeout", "5"]);
  if (!chimeraTimeoutConfig.includes('"defaultTimeoutSec": 5')) {
    throw new Error("chimera config init did not persist explicit timeout");
  }
  const chimeraNoTimeoutConfig = run(["chimera", "config", "init", "--timeout", "0"]);
  if (!chimeraNoTimeoutConfig.includes('"defaultTimeoutSec": 0')) {
    throw new Error("chimera config init --timeout 0 did not disable default timeout");
  }
  const chimeraConfigPartial = JSON.parse(run(["chimera", "config", "init", "--model", "mock/other-model"]));
  if (
    chimeraConfigPartial.config?.opencodeCommand !== opencodeCommand ||
    chimeraConfigPartial.config?.defaultVariant !== "high" ||
    chimeraConfigPartial.config?.defaultModel !== "mock/other-model"
  ) {
    throw new Error("chimera config init with partial flags did not preserve existing global config fields");
  }
  const chimeraDoctor = run(["chimera", "doctor"]);
  if (!chimeraDoctor.includes('"ok": true') || !chimeraDoctor.includes("mock-opencode")) {
    throw new Error("chimera doctor did not validate mock OpenCode runtime");
  }
  run(["init", "--root", killRoot, "--name", "kill-smoke-target"], killRoot);
  const liveRun = spawn(process.execPath, [
    cli,
    "chimera",
    "start",
    "--root",
    killRoot,
    "--role",
    "explorer",
    "--goal",
    "Long-running mock OpenCode kill validation",
    "--run",
    "--timeout",
    "30"
  ], {
    cwd: killRoot,
    env: smokeEnv({ MOCK_OPENCODE_SLEEP_MS: "30000" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  waitForFile(path.join(killRoot, ".vros/chimera/sessions/CH-0001/opencode/opencode.pid"));
  run(["chimera", "kill", "--root", killRoot, "--id", "CH-0001", "--reason", "Live kill smoke"], killRoot);
  const liveRunResult = await waitForChild(liveRun);
  if (liveRunResult.code !== 0 || !liveRunResult.stdout.includes('"killed": true')) {
    throw new Error(`live Chimera kill did not terminate the running OpenCode process cleanly\nstdout=${liveRunResult.stdout}\nstderr=${liveRunResult.stderr}`);
  }
  const killedSession = run(["chimera", "list", "--root", killRoot, "--all"], killRoot);
  if (!killedSession.includes('"status": "stopped"') || !killedSession.includes('"closeVerdict": "kill"') || fs.existsSync(path.join(killRoot, ".vros/chimera/sessions/CH-0001/opencode/opencode.pid"))) {
    throw new Error("live Chimera kill did not persist stopped kill verdict and clear opencode.pid");
  }
  run(["chimera", "stop-server", "--root", killRoot], killRoot);
  if (!fs.existsSync(path.join(globalRoot, "chimera", "config.json"))) {
    throw new Error("chimera config init did not write global config");
  }
  if (fs.existsSync(path.join(tmpRoot, ".vros", "chimera", "config.json"))) {
    throw new Error("chimera config init should not write workspace config");
  }
  const editorWithoutNotes = runFail([
    "chimera",
    "start",
    "--role",
    "cicada",
    "--goal",
    "Editor without restrictions must fail",
    "--access",
    "editor"
  ]);
  if (!editorWithoutNotes.includes("editor access requires --access-notes")) {
    throw new Error("chimera editor access without restrictions did not fail clearly");
  }
  const chimeraStart = run([
    "chimera",
    "start",
    "--role",
    "chaining",
    "--goal",
    "Smoke non-obvious chain",
    "--access",
    "editor",
    "--access-notes",
    "Smoke editor grant: non-destructive shell only; edit generated lab files only."
  ]);
  if (!chimeraStart.includes('"publicId": "CH-0001"') || !chimeraStart.includes('"accessMode": "editor"') || !chimeraStart.includes('"backgroundRun"') || !chimeraStart.includes('"status": "starting"')) {
    throw new Error("chimera start did not create CH-0001 with editor access");
  }
  const chimeraRecoverStart = JSON.parse(run(["chimera", "recover", "--id", "CH-0001"]));
  if (chimeraRecoverStart.session?.publicId !== "CH-0001" || !chimeraRecoverStart.controlStatus) {
    throw new Error("chimera recover did not return reconciled session and control status");
  }
  const attachWithoutSession = runFail(["chimera", "attach-opencode", "--id", "CH-0001", "--server-url", "http://127.0.0.1:4096"]);
  if (!attachWithoutSession.includes("Missing --opencode-session-id")) {
    throw new Error("chimera attach-opencode should require an OpenCode session id");
  }
  for (const required of [
    ".vros/chimera/sessions/CH-0001/dossier.md",
    ".vros/chimera/sessions/CH-0001/contract.md",
    ".vros/chimera/sessions/CH-0001/agent-instructions.md",
    ".vros/chimera/sessions/CH-0001/notifications.json",
    ".vros/chimera/sessions/CH-0001/skills/README.md",
    ".vros/chimera/sessions/CH-0001/skills/chimera-agent.md",
    ".vros/chimera/sessions/CH-0001/.opencode/agents/proteus-chimera.md",
    ".vros/chimera/sessions/CH-0001/.opencode/skills/README.md",
    ".vros/chimera/sessions/CH-0001/.opencode/skills/chimera-agent/SKILL.md",
    ".vros/chimera/sessions/CH-0001/lab/README.md"
  ]) {
    if (!fs.existsSync(path.join(tmpRoot, required))) {
      throw new Error(`missing Chimera artifact: ${required}`);
    }
  }
  if (fs.existsSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/skills/continuous-vuln-research.md"))) {
    throw new Error("Chimera sessions should not inject the coordinator continuous-vuln-research skill");
  }
  const specialistSkillsIndex = fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/skills/README.md"), "utf8");
  if (!specialistSkillsIndex.includes("continuous-vuln-research: coordinator-only") || !specialistSkillsIndex.includes("chaining: injected")) {
    throw new Error("Chimera skills index did not identify injected and coordinator-only skills");
  }
  run(["init", "--root", chimeraGeneralistRoot, "--name", "chimera-generalist-smoke"], chimeraGeneralistRoot);
  run(["chimera", "start", "--root", chimeraGeneralistRoot, "--role", "generalist", "--goal", "Smoke generalist skills"], chimeraGeneralistRoot);
  const generalistSkillsDir = path.join(chimeraGeneralistRoot, ".vros/chimera/sessions/CH-0001/skills");
  for (const expected of ["chimera-agent.md", "chaining.md", "codebase-research.md", "fuzzing.md", "poc-exploit.md", "web-intel.md", "web-research.md"]) {
    if (!fs.existsSync(path.join(generalistSkillsDir, expected))) {
      throw new Error(`generalist Chimera session did not inject expected skill: ${expected}`);
    }
  }
  if (fs.existsSync(path.join(generalistSkillsDir, "continuous-vuln-research.md"))) {
    throw new Error("generalist Chimera session should not inject the coordinator skill");
  }
  run(["chimera", "post", "--id", "CH-0001", "--kind", "finding", "--body", "Smoke Chimera finding"]);
  const chimeraUnread = run(["chimera", "poll", "--id", "CH-0001", "--unread"]);
  if (!chimeraUnread.includes("Smoke Chimera finding")) {
    throw new Error("chimera poll unread did not return agent message");
  }
  const chimeraUnreadAgain = run(["chimera", "poll", "--id", "CH-0001", "--unread"]);
  if (chimeraUnreadAgain.includes("Smoke Chimera finding")) {
    throw new Error("chimera poll unread did not mark message read");
  }
  run(["chimera", "send", "--id", "CH-0001", "--kind", "redirect", "--message", "Smoke coordinator redirect", "--priority"]);
  const notificationAfterSend = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/notifications.json"), "utf8"));
  if (notificationAfterSend.pending !== true || notificationAfterSend.priority !== true || notificationAfterSend.unreadForAgent < 1) {
    throw new Error("chimera send did not update priority notifications.json");
  }
  const chimeraAgentUnread = run(["chimera", "poll", "--id", "CH-0001", "--unread", "--agent"]);
  if (!chimeraAgentUnread.includes("Smoke coordinator redirect")) {
    throw new Error("chimera agent poll did not return coordinator message");
  }
  const notificationAfterAgentPoll = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/notifications.json"), "utf8"));
  if (notificationAfterAgentPoll.pending !== false || notificationAfterAgentPoll.priority !== false || notificationAfterAgentPoll.unreadForAgent !== 0) {
    throw new Error("chimera agent poll did not clear notifications.json");
  }
  const chimeraBroadcast = JSON.parse(run(["chimera", "broadcast", "--message", "Smoke shared chat message", "--priority"]));
  if (chimeraBroadcast.delivered.length !== 0 || !chimeraBroadcast.skipped.some((entry) => entry.publicId === "CH-0001" && entry.reason === "status stopped")) {
    throw new Error(`chimera broadcast should skip stopped sessions: ${JSON.stringify(chimeraBroadcast)}`);
  }
  const largeSnapshotBody = `Confirmed smoke snapshot\n${"GLQL quoted code block ".repeat(500)}`;
  run(["chimera", "snapshot", "--id", "CH-0001", "--body", largeSnapshotBody]);
  const snapshotPath = path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/snapshot.md");
  if (!fs.readFileSync(snapshotPath, "utf8").includes("Confirmed smoke snapshot")) {
    throw new Error("chimera snapshot did not write snapshot.md");
  }
  const largeSnapshotPoll = JSON.parse(run(["chimera", "poll", "--id", "CH-0001", "--peek"]));
  const largeSnapshotMessage = largeSnapshotPoll.messages.find((message) => message.kind === "snapshot");
  if (!largeSnapshotMessage?.bodyTruncated || largeSnapshotMessage.bodyLength <= largeSnapshotMessage.body.length || largeSnapshotMessage.fullBodyPath !== snapshotPath || !fs.readFileSync(largeSnapshotMessage.fullBodyPath, "utf8").includes("GLQL quoted code block")) {
    throw new Error(`chimera poll did not expose large snapshot preview and full body path: ${JSON.stringify(largeSnapshotMessage)}`);
  }
  const chimeraHeartbeat = JSON.parse(run(["chimera", "heartbeat", "--id", "CH-0001"]));
  if (chimeraHeartbeat.killed !== false || chimeraHeartbeat.session?.publicId !== "CH-0001" || chimeraHeartbeat.session?.status !== "stopped") {
    throw new Error(`chimera heartbeat did not report stopped reusable session state: ${JSON.stringify(chimeraHeartbeat)}`);
  }
  run(["init", "--root", chimeraScopeRoot, "--name", "chimera-scope-smoke"], chimeraScopeRoot);
  run(["campaign", "create", "--root", chimeraScopeRoot, "--title", "Chimera scoped campaign", "--objective", "Validate Chimera scoped records"], chimeraScopeRoot);
  run(["plan-round", "--root", chimeraScopeRoot, "--objective", "Chimera scoped round"], chimeraScopeRoot);
  run([
    "chimera",
    "start",
    "--root",
    chimeraScopeRoot,
    "--role",
    "codebase-research",
    "--goal",
    "Validate scoped Proteus records"
  ], chimeraScopeRoot);
  const chimeraScopeLab = path.join(chimeraScopeRoot, ".vros/chimera/sessions/CH-0001/lab");
  const chimeraScopeEnv = {
    PROTEUS_CHIMERA_SESSION_ID: "CH-0001",
    PROTEUS_TARGET_ROOT: chimeraScopeRoot
  };
  const wrongRootOutput = runFail(["status"], chimeraScopeLab, chimeraScopeEnv);
  if (!wrongRootOutput.includes("must use the shared Proteus target root")) {
    throw new Error("Chimera session command without shared --root did not fail clearly");
  }
  const chimeraCampaignMutation = runFail(["campaign", "create", "--root", chimeraScopeRoot, "--title", "Should fail"], chimeraScopeLab, chimeraScopeEnv);
  if (!chimeraCampaignMutation.includes("cannot mutate campaign state")) {
    throw new Error("Chimera session was allowed to mutate campaign state");
  }
  const chimeraScopedEvidence = run([
    "record",
    "evidence",
    "--root",
    chimeraScopeRoot,
    "--title",
    "Chimera scoped evidence test",
    "--body",
    "Evidence recorded by Chimera scope smoke"
  ], chimeraScopeLab, chimeraScopeEnv);
  const chimeraScopedEvidenceId = Number(chimeraScopedEvidence.match(/E(\d+)/)?.[1]);
  if (!chimeraScopedEvidenceId) {
    throw new Error("Chimera scoped evidence test did not record evidence");
  }
  const chimeraScopedLinks = run(["list", "links", "--root", chimeraScopeRoot, "--entity-type", "campaign", "--entity-id", "1"], chimeraScopeRoot);
  if (!chimeraScopedLinks.includes(`campaign#1 -[has_evidence]-> evidence#${chimeraScopedEvidenceId}`)) {
    throw new Error("Chimera scoped evidence did not link to the session campaign");
  }
  if (!chimeraScopedLinks.includes("campaign#1 -[has_chimera_session]-> chimera_session#1")) {
    throw new Error("Chimera session did not link to the active campaign");
  }
  run(["init", "--root", chimeraCampaignListRoot, "--name", "chimera-campaign-list-smoke"], chimeraCampaignListRoot);
  run(["campaign", "create", "--root", chimeraCampaignListRoot, "--title", "Chimera active campaign A", "--objective", "Validate campaign-scoped Chimera list A"], chimeraCampaignListRoot);
  run(["campaign", "create", "--root", chimeraCampaignListRoot, "--title", "Chimera active campaign B", "--objective", "Validate campaign-scoped Chimera list B"], chimeraCampaignListRoot);
  const campaignRunA = spawn(process.execPath, [
    cli,
    "chimera",
    "start",
    "--root",
    chimeraCampaignListRoot,
    "--role",
    "explorer",
    "--goal",
    "Campaign A active list smoke",
    "--campaign-id",
    "1",
    "--run",
    "--timeout",
    "30"
  ], {
    cwd: chimeraCampaignListRoot,
    env: smokeEnv({ MOCK_OPENCODE_SLEEP_MS: "30000" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  waitForFile(path.join(chimeraCampaignListRoot, ".vros/chimera/sessions/CH-0001/opencode/opencode.pid"));
  const campaignRunB = spawn(process.execPath, [
    cli,
    "chimera",
    "start",
    "--root",
    chimeraCampaignListRoot,
    "--role",
    "explorer",
    "--goal",
    "Campaign B active list smoke",
    "--campaign-id",
    "2",
    "--run",
    "--timeout",
    "30"
  ], {
    cwd: chimeraCampaignListRoot,
    env: smokeEnv({ MOCK_OPENCODE_SLEEP_MS: "30000" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  waitForFile(path.join(chimeraCampaignListRoot, ".vros/chimera/sessions/CH-0002/opencode/opencode.pid"));
  const multiCampaignActiveList = JSON.parse(run(["chimera", "list", "--root", chimeraCampaignListRoot, "--active"], chimeraCampaignListRoot));
  const multiCampaignIds = multiCampaignActiveList.sessions.map((session) => session.publicId);
  const multiCampaignLabels = multiCampaignActiveList.sessions.map((session) => session.campaignLabel).join("\n");
  if (
    multiCampaignActiveList.scope?.activeOnly !== true ||
    multiCampaignActiveList.scope?.campaignIds?.length !== 2 ||
    !multiCampaignIds.includes("CH-0001") ||
    !multiCampaignIds.includes("CH-0002") ||
    !multiCampaignLabels.includes("C1 [active] Chimera active campaign A") ||
    !multiCampaignLabels.includes("C2 [active] Chimera active campaign B")
  ) {
    throw new Error(`chimera list --active did not return active sessions from all active campaigns with campaign labels: ${JSON.stringify(multiCampaignActiveList)}`);
  }
  const multiCampaignBroadcast = JSON.parse(run(["chimera", "broadcast", "--root", chimeraCampaignListRoot, "--message", "Active campaign broadcast smoke", "--priority"], chimeraCampaignListRoot));
  if (multiCampaignBroadcast.delivered.length !== 2 || multiCampaignBroadcast.skipped.length !== 0) {
    throw new Error(`chimera broadcast did not deliver only to active sessions: ${JSON.stringify(multiCampaignBroadcast)}`);
  }
  run(["chimera", "kill", "--root", chimeraCampaignListRoot, "--id", "CH-0001", "--reason", "Campaign list smoke done"], chimeraCampaignListRoot);
  run(["chimera", "kill", "--root", chimeraCampaignListRoot, "--id", "CH-0002", "--reason", "Campaign list smoke done"], chimeraCampaignListRoot);
  await waitForChild(campaignRunA);
  await waitForChild(campaignRunB);
  const chimeraRun = JSON.parse(run([
    "chimera",
    "start",
    "--role",
    "explorer",
    "--goal",
    "Run mock OpenCode once",
    "--run",
    "--timeout",
    "10"
  ]));
  if (
    chimeraRun.session?.publicId !== "CH-0002" ||
    chimeraRun.session?.provider !== "high" ||
    chimeraRun.run?.exitCode !== 0 ||
    !chimeraRun.run?.stdoutPreview?.includes("mock-opencode")
  ) {
    throw new Error(`chimera --run did not capture mock OpenCode output: ${JSON.stringify({ session: chimeraRun.session, run: chimeraRun.run })}`);
  }
  const chimeraRunList = run(["chimera", "list"]);
  if (!chimeraRunList.includes('"opencodeSessionId": "ses_mock_CH-0002"')) {
    throw new Error(`chimera --run did not persist discovered OpenCode session id: ${chimeraRunList}`);
  }
  const explorerAgentFile = fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0002/.opencode/agents/proteus-chimera.md"), "utf8");
  if (!explorerAgentFile.includes("edit: deny") || !explorerAgentFile.includes("webfetch: deny") || !explorerAgentFile.includes("websearch: deny")) {
    throw new Error("explorer Chimera agent file did not deny edit and web permissions by default");
  }
  const chimeraRunExisting = run(["chimera", "run", "--id", "CH-0002", "--timeout", "10", "--message", "Smoke resume instruction"]);
  if (!chimeraRunExisting.includes('"ok": true') || !chimeraRunExisting.includes('"ses_mock_CH-0002"')) {
    throw new Error("chimera run did not reuse existing OpenCode session/lab");
  }
  const chimeraRunRecord = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0002/opencode/run.json"), "utf8"));
  if (!Array.isArray(chimeraRunRecord.args) || !chimeraRunRecord.args.includes("--pure")) {
    throw new Error("chimera run should invoke OpenCode with --pure to avoid per-session plugin dependency installs");
  }
  if (!chimeraRunRecord.args.some((arg) => String(arg).includes("Smoke resume instruction"))) {
    throw new Error("chimera run --message did not pass the resume instruction to OpenCode");
  }
  const chimeraWorkflowSnapshot = JSON.parse(run(["chimera", "workflow-snapshot", "--id", "CH-0002", "--limit", "3", "--max-message-chars", "80"]));
  const workflowSnapshotText = JSON.stringify(chimeraWorkflowSnapshot);
  if (chimeraWorkflowSnapshot.messages.length !== 3 || !workflowSnapshotText.includes("First compact agent workflow message")) {
    throw new Error("chimera workflow-snapshot did not return compact agent messages");
  }
  const removedExportKeys = ["requested" + "San" + "itize", "fallbackFrom" + "San" + "itizedExport"];
  if (removedExportKeys.some((key) => workflowSnapshotText.includes(key))) {
    throw new Error("chimera workflow-snapshot should not expose removed export compatibility fields");
  }
  for (const forbidden of ["User prompt that must not appear", "TOOL CALL THAT MUST NOT APPEAR", "TOOL RESULT THAT MUST NOT APPEAR", "COMMAND OUTPUT THAT MUST NOT APPEAR"]) {
    if (workflowSnapshotText.includes(forbidden)) {
      throw new Error(`chimera workflow-snapshot leaked non-agent/tool content: ${forbidden}`);
    }
  }
  if (!fs.existsSync(chimeraWorkflowSnapshot.files.jsonPath) || !fs.existsSync(chimeraWorkflowSnapshot.files.markdownPath)) {
    throw new Error("chimera workflow-snapshot did not write compact snapshot files");
  }
  const retryWorkflowSnapshot = JSON.parse(run(["chimera", "workflow-snapshot", "--id", "CH-0002", "--limit", "1", "--max-message-chars", "80"], tmpRoot, { MOCK_OPENCODE_EXPORT_FAIL_ONCE: "1" }));
  if (retryWorkflowSnapshot.export.attempts.length < 2 || retryWorkflowSnapshot.export.attempts[0].parsed !== false || retryWorkflowSnapshot.messages.length !== 1) {
    throw new Error(`chimera workflow-snapshot did not retry a transient OpenCode export failure: ${JSON.stringify(retryWorkflowSnapshot.export)}`);
  }
  const chimeraDirectSend = JSON.parse(run(["chimera", "send", "--id", "CH-0002", "--message", "Smoke direct steer", "--priority"]));
  if (chimeraDirectSend.directDelivery?.ok !== true || !["steer", "queue"].includes(chimeraDirectSend.directDelivery?.mode)) {
    throw new Error(`chimera priority send did not steer or wake the Chimera session: ${JSON.stringify(chimeraDirectSend.directDelivery)}`);
  }
  run(
    ["chimera", "send", "--root", tmpRoot, "--to-id", "CH-0002", "--message", "Smoke inferred source id"],
    path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/lab"),
    { PROTEUS_CHIMERA_SESSION_ID: "CH-0001", PROTEUS_TARGET_ROOT: tmpRoot }
  );
  const chimeraInferredSourcePoll = run(["chimera", "poll", "--id", "CH-0002", "--unread", "--agent"]);
  if (!chimeraInferredSourcePoll.includes("Smoke inferred source id") || !chimeraInferredSourcePoll.includes('"fromId": "CH-0001"')) {
    throw new Error("chimera send did not infer source id for agent-to-agent message from a Chimera lab");
  }
  const chimeraCouncilStart = JSON.parse(run([
    "chimera",
    "council",
    "start",
    "--topic",
    "Smoke stalled branch brainstorm",
    "--reason",
    "Smoke checkpoint needs fresh angles",
    "--ids",
    "CH-0001,CH-0002",
    "--max-rounds",
    "1"
  ]));
  const councilId = chimeraCouncilStart.councilId;
  if (!councilId || chimeraCouncilStart.participants.length !== 2) {
    throw new Error("chimera council start did not invite the expected participants");
  }
  run(["chimera", "council", "accept", "--id", "CH-0001", "--council-id", councilId, "--body", "CH-0001 ready"]);
  run(["chimera", "council", "accept", "--id", "CH-0002", "--council-id", councilId, "--body", "CH-0002 ready"]);
  const cueBeforeRoundOpen = runFail(["chimera", "council", "cue-turn", "--id", "CH-0001", "--council-id", councilId, "--round", "1"]);
  if (!cueBeforeRoundOpen.includes("Manual cue-turn is disabled")) {
    throw new Error("chimera council allowed normal flow to use manual cue-turn directly");
  }
  const invalidStartId = runFail([
    "chimera",
    "council",
    "open-round",
    "--council-id",
    councilId,
    "--round",
    "1",
    "--message",
    "This should not create a round.",
    "--start-id",
    "CH-9999"
  ]);
  if (!invalidStartId.includes("Council participant not found")) {
    throw new Error("chimera council open-round should fail clearly for an invalid start-id");
  }
  const chimeraCouncilOpenRound = JSON.parse(run([
    "chimera",
    "council",
    "open-round",
    "--council-id",
    councilId,
    "--round",
    "1",
    "--message",
    "Round 1: give one non-obvious pivot, one risk, and one next experiment."
  ]));
  if (!chimeraCouncilOpenRound.firstCue || !JSON.stringify(chimeraCouncilOpenRound.firstCue).includes("CH-0001") || !JSON.stringify(chimeraCouncilOpenRound.firstCue).includes("Council transcript so far")) {
    throw new Error("chimera council open-round did not automatically cue the first accepted participant");
  }
  const duplicateRoundOpen = runFail([
    "chimera",
    "council",
    "open-round",
    "--council-id",
    councilId,
    "--round",
    "1",
    "--message",
    "Duplicate open should fail."
  ]);
  if (!duplicateRoundOpen.includes("round 1 is already open")) {
    throw new Error("chimera council allowed the same round to be opened twice");
  }
  const outOfOrderTurn = runFail(["chimera", "council", "turn", "--id", "CH-0002", "--council-id", councilId, "--round", "1", "--body", "out of order"]);
  if (!outOfOrderTurn.includes("Expected CH-0001")) {
    throw new Error("chimera council allowed an out-of-order turn");
  }
  const chimeraCouncilTurnOne = JSON.parse(run(["chimera", "council", "turn", "--id", "CH-0001", "--council-id", councilId, "--round", "1", "--body", "CH-0001 observation"]));
  if (
    !chimeraCouncilTurnOne.nextCue ||
    chimeraCouncilTurnOne.roundComplete !== false ||
    !JSON.stringify(chimeraCouncilTurnOne.nextCue).includes("CH-0002") ||
    !JSON.stringify(chimeraCouncilTurnOne.nextCue).includes("Required command:")
  ) {
    throw new Error("chimera council turn did not automatically cue the next accepted participant");
  }
  const duplicateCouncilTurn = runFail(["chimera", "council", "turn", "--id", "CH-0001", "--council-id", councilId, "--round", "1", "--body", "duplicate observation"]);
  if (!duplicateCouncilTurn.includes("already posted a council turn")) {
    throw new Error("chimera council allowed a duplicate turn for the same agent and round");
  }
  if (chimeraCouncilTurnOne.nextCue.directDelivery?.ok !== true || !["steer", "queue"].includes(chimeraCouncilTurnOne.nextCue.directDelivery?.mode)) {
    throw new Error(`chimera council automatic next cue did not steer or wake the next session: ${JSON.stringify(chimeraCouncilTurnOne.nextCue.directDelivery)}`);
  }
  const chimeraCouncilTurnTwo = JSON.parse(run(["chimera", "council", "turn", "--id", "CH-0002", "--council-id", councilId, "--round", "1", "--body", "CH-0002 observation"]));
  if (chimeraCouncilTurnTwo.nextCue !== null || chimeraCouncilTurnTwo.roundComplete !== true) {
    throw new Error("chimera council did not return to the coordinator after the last accepted participant");
  }
  const chimeraCouncilStatus = JSON.parse(run(["chimera", "council", "status", "--council-id", councilId]));
  if (chimeraCouncilStatus.readyCount !== 2 || chimeraCouncilStatus.turns.length !== 2 || chimeraCouncilStatus.closed !== false) {
    throw new Error("chimera council status did not recover ready participants and ordered turns");
  }
  const chimeraCouncilClose = JSON.parse(run([
    "chimera",
    "council",
    "close",
    "--council-id",
    councilId,
    "--summary",
    "Smoke council final decision",
    "--instruction",
    "Resume prior smoke work"
  ]));
  if (!chimeraCouncilClose.council.closed || chimeraCouncilClose.deliveries.length !== 2) {
    throw new Error("chimera council close did not notify all participants and mark the council closed");
  }
  const swarmPlan = path.join(tmpRoot, "chimera-swarm.json");
  fs.writeFileSync(swarmPlan, JSON.stringify({
    agents: [
      { role: "codebase-research", goal: "Map smoke surface" },
      { role: "fuzzing", goal: "Probe smoke parser", accessMode: "explorer" }
    ]
  }, null, 2));
  const swarm = run(["chimera", "swarm", "--plan", swarmPlan]);
  if (!swarm.includes('"publicId": "CH-0003"') || !swarm.includes('"publicId": "CH-0004"')) {
    throw new Error("chimera swarm did not create independent sessions");
  }
  run(["chimera", "kill", "--id", "CH-0001", "--reason", "Smoke kill"]);
  if (!fs.existsSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/kill.flag"))) {
    throw new Error("chimera kill did not write kill.flag");
  }
  const chimeraClose = run(["chimera", "close", "--id", "CH-0001", "--verdict", "watchlist", "--summary", "Smoke close"]);
  if (!chimeraClose.includes('"closeVerdict": "watchlist"')) {
    throw new Error("chimera close did not persist final verdict");
  }
  const activeChimeraList = run(["chimera", "list", "--active"]);
  const activeChimeraListJson = JSON.parse(activeChimeraList);
  if (activeChimeraListJson.sessions.some((session) => session.publicId === "CH-0001" || session.status === "stopped")) {
    throw new Error("chimera list --active returned stopped sessions");
  }
  const reusableChimeraList = JSON.parse(run(["chimera", "list"]));
  if (!reusableChimeraList.sessions.some((session) => session.publicId === "CH-0001" && session.status === "stopped" && session.closeVerdict === "watchlist") || !JSON.stringify(reusableChimeraList.advisories).includes("Session is stopped")) {
    throw new Error("chimera list did not expose reusable stopped sessions with resume guidance");
  }
  run(["init", "--root", mergeRoot, "--name", "stray-merge-target"], mergeRoot);
  run([
    "record",
    "evidence",
    "--root",
    mergeRoot,
    "--title",
    "Stray merge evidence",
    "--kind",
    "note",
    "--body",
    "Stray merge evidence body"
  ], mergeRoot);
  run([
    "record",
    "surface",
    "--root",
    mergeRoot,
    "--name",
    "Stray merge surface",
    "--family",
    "state-recovery",
    "--description",
    "Surface created in the wrong Proteus base"
  ], mergeRoot);
  run([
    "chimera",
    "start",
    "--root",
    mergeRoot,
    "--role",
    "explorer",
    "--goal",
    "Stray Chimera state"
  ], mergeRoot);
  run([
    "chimera",
    "post",
    "--root",
    mergeRoot,
    "--id",
    "CH-0001",
    "--body",
    "Stray Chimera message"
  ], mergeRoot);
  const sourceMigrationsBeforeDryRun = run(["migrate", "--root", mergeRoot], mergeRoot);
  const mergeDryRun = run(["merge", "--source", path.join(mergeRoot, ".vros", "memory.sqlite"), "--dry-run"]);
  const sourceMigrationsAfterDryRun = run(["migrate", "--root", mergeRoot], mergeRoot);
  if (sourceMigrationsAfterDryRun !== sourceMigrationsBeforeDryRun) {
    throw new Error("merge dry-run modified source migration state");
  }
  if (!mergeDryRun.includes('"dryRun": true') || !mergeDryRun.includes('"evidence": 1') || !mergeDryRun.includes('"chimeraSessions": 1')) {
    throw new Error("merge dry-run did not preview source evidence");
  }
  const mergeResult = run(["merge", "--source", path.join(mergeRoot, ".vros")]);
  if (!mergeResult.includes('"dryRun": false') || !mergeResult.includes('"surfaces": 1') || !mergeResult.includes('"chimeraMessages": 2')) {
    throw new Error("merge did not copy source records into destination memory");
  }
  const mergedMemory = run(["query", "memory", "Stray merge evidence body"]);
  if (!mergedMemory.includes("evidence#")) {
    throw new Error("merged evidence was not searchable in destination memory");
  }
  const mergedChimera = run(["chimera", "list"]);
  if (!mergedChimera.includes("Stray Chimera state")) {
    throw new Error("merge did not copy Chimera session state");
  }
  const mergedChimeraMessages = run(["chimera", "poll", "--id", "CH-0005", "--peek"]);
  if (!mergedChimeraMessages.includes("Stray Chimera message")) {
    throw new Error("merge did not copy Chimera messages");
  }
  run(["ingest", "docs"]);
  run(["observe"]);
  const roles = run(["roles"]);
  if (!roles.includes("Generalist") || !roles.includes("Argus") || !roles.includes("Skeptic")) {
    throw new Error("roles did not list expected Proteus fronts");
  }
  const prompt = run(["prompt", "--role", "Skeptic", "--surface", "Smoke request surface"]);
  if (!prompt.includes("Skeptic") || !prompt.includes("Smoke request surface")) {
    throw new Error("prompt did not normalize display-name role instructions");
  }
  const generalistPrompt = run(["prompt", "--role", "generalist", "--surface", "Smoke generalist triage"]);
  if (!generalistPrompt.includes("Generalist") || !generalistPrompt.includes("Smoke generalist triage")) {
    throw new Error("prompt did not render generalist role instructions");
  }
  run([
    "record",
    "surface",
    "--name",
    "Smoke request surface",
    "--family",
    "request-routing",
    "--description",
    "Smoke target-specific surface",
    "--files",
    "server.ts",
    "--status",
    "active",
    "--impact-potential",
    "8",
    "--external-reachability",
    "7",
    "--trust-boundary-density",
    "6",
    "--revisit",
    "new request boundary"
  ]);
  const surfaces = run(["list", "surfaces"]);
  if (!surfaces.includes("Smoke request surface")) {
    throw new Error("list surfaces did not return recorded surface");
  }
  const surfaceQuery = run(["query", "surfaces", "request"]);
  if (!surfaceQuery.includes("Smoke request surface")) {
    throw new Error("query surfaces did not return recorded surface");
  }
  run([
    "learn",
    "add",
    "--category",
    "user_preference",
    "--scope",
    "smoke,bug-bounty",
    "--title",
    "Prefer smoke exploitability",
    "--body",
    "Smoke global learning body",
    "--tags",
    "smoke,impact"
  ]);
  const learnings = run(["learn", "query", "exploitability", "--scope", "smoke"]);
  if (!learnings.includes("Prefer smoke exploitability")) {
    throw new Error("global learning query did not return expected record");
  }
  const targetScopedLearnings = run(["learn", "query", "--target-scope"]);
  if (!targetScopedLearnings.includes("Prefer smoke exploitability")) {
    throw new Error("target-scope global learning query did not return expected record");
  }
  run(["plan-round", "--objective", "Smoke high-ROI round", "--write"]);
  run(["campaign", "create", "--title", "Smoke campaign", "--objective", "Smoke campaign objective"]);
  const campaignDigest = run(["campaign", "resume"]);
  if (!campaignDigest.includes('"title": "Smoke campaign"')) {
    throw new Error("campaign resume did not return active campaign digest");
  }
  run([
    "branch",
    "add",
    "--campaign-id",
    "1",
    "--round-id",
    "1",
    "--title",
    "Smoke branch",
    "--primitive",
    "attacker-controlled transition",
    "--steps",
    "step one,step two",
    "--kill-conditions",
    "control fails"
  ]);
  const branches = run(["branch", "list", "--campaign-id", "1"]);
  if (!branches.includes("B1 [open] Smoke branch")) {
    throw new Error("branch list did not return recorded branch");
  }
  run(["branch", "update", "--id", "B1", "--status", "testing"]);
  const testingBranches = run(["branch", "list", "--campaign-id", "1", "--status", "testing"]);
  if (!testingBranches.includes("B1 [testing] Smoke branch")) {
    throw new Error("branch update did not move branch to testing");
  }
  run([
    "campaign",
    "checkpoint",
    "--id",
    "1",
    "--confirmed",
    "surface mapped",
    "--open",
    "Smoke branch",
    "--pivots",
    "stay on transition boundary",
    "--context",
    "Smoke context capsule",
    "--next",
    "Validate smoke branch",
    "--contract-signature",
    "{\"status\":\"compliant\",\"agent\":\"smoke\"}",
    "--summary",
    "Smoke checkpoint"
  ]);
  const checkpoints = run(["list", "checkpoints", "--campaign-id", "1"]);
  if (!checkpoints.includes("K1 campaign=C1") || !checkpoints.includes("Validate smoke branch")) {
    throw new Error("list checkpoints did not return recorded checkpoint");
  }
  const checkpointRecord = run(["show", "checkpoint", "1"]);
  if (!checkpointRecord.includes('"entityType": "campaign_checkpoint"') || !checkpointRecord.includes("Smoke context capsule")) {
    throw new Error("show checkpoint did not return campaign checkpoint record");
  }
  const campaignDigestWithCheckpoint = run(["campaign", "resume"]);
  if (!campaignDigestWithCheckpoint.includes('"recentCheckpoints"') || !campaignDigestWithCheckpoint.includes("Validate smoke branch")) {
    throw new Error("campaign resume did not include recent checkpoints");
  }
  run(["link", "--from-type", "campaign", "--from-id", "1", "--relation", "has_round", "--to-type", "round", "--to-id", "1"]);
  const links = run(["list", "links", "--entity-type", "campaign", "--entity-id", "1"]);
  if (!links.includes("campaign#1 -[has_round]-> round#1")) {
    throw new Error("list links did not return recorded campaign-round link");
  }
  const activeRounds = run(["list", "rounds", "--status", "active"]);
  if (!activeRounds.includes("R1 [active]") || !activeRounds.includes("Smoke high-ROI round")) {
    throw new Error("list rounds did not return the active round plan");
  }
  const roundRecord = run(["show", "round", "1"]);
  if (!roundRecord.includes('"status": "active"') || !roundRecord.includes("Smoke high-ROI round")) {
    throw new Error("show round did not expose active plan status");
  }
  const campaignRecord = run(["show", "campaign", "1"]);
  if (!campaignRecord.includes('"entityType": "campaign"') || !campaignRecord.includes("Smoke campaign")) {
    throw new Error("show campaign did not return campaign record");
  }
  const branchRecord = run(["show", "branch", "1"]);
  if (!branchRecord.includes('"entityType": "hypothesis_branch"') || !branchRecord.includes("Smoke branch")) {
    throw new Error("show branch did not return hypothesis branch record");
  }
  run(["update", "round", "--id", "1", "--status", "paused"]);
  const pausedRounds = run(["list", "rounds", "--status", "paused"]);
  if (!pausedRounds.includes("R1 [paused]")) {
    throw new Error("update round did not pause the round plan");
  }
  run(["update", "round", "--id", "1", "--status", "active"]);
  run(["plan-round", "--objective", "Legacy planned smoke round", "--status", "planned"]);
  run(["plan-round", "--objective", "Next prepared smoke round", "--status", "planned"]);
  const bulkRoundUpdate = run(["update", "rounds", "--from", "planned", "--status", "superseded", "--keep-latest"]);
  if (!bulkRoundUpdate.includes("Updated 1 rounds") || !bulkRoundUpdate.includes("kept R3 as planned")) {
    throw new Error("bulk round update did not supersede old planned rounds while keeping the newest planned round");
  }
  const plannedRounds = run(["list", "rounds", "--status", "planned"]);
  if (!plannedRounds.includes("R3 [planned]") || plannedRounds.includes("R2 [planned]")) {
    throw new Error("planned rounds were not cleaned up correctly");
  }
  const supersededRounds = run(["list", "rounds", "--status", "superseded"]);
  if (!supersededRounds.includes("R2 [superseded]")) {
    throw new Error("superseded rounds did not include the old planned round");
  }
  run([
    "record",
    "agent-output",
    "--round-id",
    "1",
    "--role",
    "Argus",
    "--surface",
    "Smoke request surface",
    "--covered",
    "server.ts",
    "--killed",
    "smoke-only duplicate"
  ]);
  run([
    "record",
    "hypothesis",
    "--title",
    "Smoke validation candidate",
    "--surface-id",
    "1",
    "--primitive",
    "validation gate",
    "--attacker-boundary",
    "external request",
    "--impact",
    "test impact",
    "--score",
    "10"
  ]);
  const smokeEvidenceOutput = run([
    "record",
    "evidence",
    "--title",
    "Smoke evidence",
    "--kind",
    "command-output",
    "--body",
    "Smoke evidence body"
  ]);
  const smokeEvidenceId = smokeEvidenceOutput.match(/E(\d+)/)?.[1];
  if (!smokeEvidenceId) {
    throw new Error("record evidence did not return an evidence id");
  }
  run([
    "record",
    "decision",
    "--entity-type",
    "hypothesis",
    "--entity-id",
    "1",
    "--decision",
    "candidate",
    "--reason",
    "Smoke candidate decision",
    "--evidence-ids",
    smokeEvidenceId
  ]);
  const branchKillDecision = run([
    "record",
    "decision",
    "--entity-type",
    "hypothesis_branch",
    "--entity-id",
    "1",
    "--decision",
    "killed",
    "--reason",
    "Smoke branch killed by evidence-backed decision",
    "--evidence-ids",
    smokeEvidenceId
  ]);
  if (!branchKillDecision.includes("Updated branch B1 to killed")) {
    throw new Error("record decision on branch did not update branch status");
  }
  const killedBranches = run(["branch", "list", "--campaign-id", "1", "--status", "killed"]);
  if (!killedBranches.includes("B1 [killed] Smoke branch")) {
    throw new Error("branch decision did not persist killed status");
  }
  run([
    "record",
    "gate",
    "--entity-type",
    "hypothesis",
    "--entity-id",
    "1",
    "--gate",
    "G2 realistic external attacker input",
    "--status",
    "pass",
    "--summary",
    "Smoke gate passed",
    "--evidence-ids",
    smokeEvidenceId
  ]);
  const gates = run(["list", "gates", "--entity-type", "hypothesis", "--entity-id", "1"]);
  if (!gates.includes("G2 realistic external attacker input") || !gates.includes("[pass]")) {
    throw new Error("list gates did not return recorded validation gate");
  }
  const campaignAutoLinks = run(["list", "links", "--entity-type", "campaign", "--entity-id", "1"]);
  for (const expectedLink of [
    "campaign#1 -[tracks_hypothesis]-> hypothesis#1",
    `campaign#1 -[has_evidence]-> evidence#${smokeEvidenceId}`,
    "campaign#1 -[has_decision]-> decision#1",
    "campaign#1 -[has_validation_gate]-> gate#1",
    "campaign#1 -[has_agent_output]-> agent_output#1"
  ]) {
    if (!campaignAutoLinks.includes(expectedLink)) {
      throw new Error(`campaign active-state auto-link missing: ${expectedLink}`);
    }
  }
  const gateRecord = run(["show", "gate", "1"]);
  if (!gateRecord.includes('"entityType": "gate"') || !gateRecord.includes("Smoke gate passed")) {
    throw new Error("show gate did not return full validation gate record");
  }
  const duplicates = run(["query", "duplicates", "validation gate"]);
  if (!duplicates.includes("source#") || duplicates.includes("hypothesis#")) {
    throw new Error("duplicate coverage query should only return finding/report style source records");
  }
  if (duplicates.includes("watchlist.md")) {
    throw new Error("duplicate coverage query returned watchlist source as duplicate coverage");
  }
  if (!duplicates.includes("score=") || !duplicates.includes("matched=")) {
    throw new Error("duplicate coverage query did not return summarized coverage metadata");
  }
  const memory = run(["query", "memory", "validation gate"]);
  if (!memory.includes("source#") && !memory.includes("hypothesis#")) {
    throw new Error("memory query did not return indexed records");
  }
  const similar = run(["query", "similar", "validation gate"]);
  if (!similar.includes("Duplicate/report coverage:") || !similar.includes("Memory matches:")) {
    throw new Error("similar query did not return coverage and memory sections");
  }
  const broadDuplicate = run(["query", "duplicates", "broad-only cache glossary phrase"]);
  if (!broadDuplicate.includes("No prior coverage found.")) {
    throw new Error("duplicate coverage query returned generic docs as coverage");
  }
  const broadMemory = run(["query", "memory", "broad-only cache glossary phrase"]);
  if (!broadMemory.includes("source#")) {
    throw new Error("memory query did not return generic docs");
  }
  const watchlistDuplicate = run(["query", "duplicates", "watchlist text"]);
  if (!watchlistDuplicate.includes("No prior coverage found.")) {
    throw new Error("duplicate coverage query returned watchlist-only memory as duplicate coverage");
  }
  const watchlistMemory = run(["query", "memory", "watchlist text"]);
  if (!watchlistMemory.includes("source#")) {
    throw new Error("memory query did not return watchlist source");
  }
  const sourceId = memory.match(/source#(\d+)/)?.[1];
  if (!sourceId) {
    throw new Error("memory query did not expose a source id");
  }
  const sourceRecord = run(["show", "source", sourceId]);
  if (!sourceRecord.includes('"entityType": "source"') || !sourceRecord.includes("Prior Finding")) {
    throw new Error("show did not return full source record");
  }
  const revisit = run(["query", "revisit", "request"]);
  if (!revisit.includes("Smoke request surface")) {
    throw new Error("revisit query did not return recorded target-specific surface");
  }
  run(["update", "surface", "--id", "1", "--status", "covered", "--revisit", "smoke revisit condition"]);
  const updatedSurface = run(["list", "surfaces", "--status", "covered"]);
  if (!updatedSurface.includes("smoke revisit condition")) {
    throw new Error("update surface did not preserve status and revisit condition");
  }
  run(["lab", "create", "--candidate-id", "1", "--name", "smoke-lab"]);
  run(["export"]);
  run(["learn", "export"]);
  const targetContract = fs.readFileSync(path.join(tmpRoot, ".vros/exports/target-contract.md"), "utf8");
  for (const inventedDefault of ["SSRF", "RCE", "unauthorized read", "forced vulnerable configuration"]) {
    if (targetContract.includes(inventedDefault)) {
      throw new Error(`target contract export included invented default: ${inventedDefault}`);
    }
  }
  fs.writeFileSync(path.join(tmpRoot, ".vros/exports/target-contract.md"), "# Manual Target Contract\n\nkeep me\n");
  run(["export"]);
  const preservedTargetContract = fs.readFileSync(path.join(tmpRoot, ".vros/exports/target-contract.md"), "utf8");
  if (!preservedTargetContract.includes("keep me")) {
    throw new Error("export overwrote an existing manual target-contract.md");
  }
  const generatedContractExports = fs
    .readdirSync(path.join(tmpRoot, ".vros/exports"))
    .filter((file) => /^target-contract\.generated-\d+\.md$/.test(file));
  if (generatedContractExports.length === 0) {
    throw new Error("export did not write a generated sidecar when target-contract.md already existed");
  }

  for (const required of [
    ".vros/memory.sqlite",
    ".vros/exports/target-contract.md",
    ".vros/exports/surface-map.md",
    ".vros/exports/candidate-register.md",
    ".vros/exports/validation-gates.md",
    ".vros/exports/research-log.md",
    ".vros/labs/C1-smoke-lab/README.md",
    ".vros/labs/C1-smoke-lab/report-draft.md"
  ]) {
    if (!fs.existsSync(path.join(tmpRoot, required))) {
      throw new Error(`missing expected artifact: ${required}`);
    }
  }
  if (!fs.existsSync(path.join(globalRoot, "global.sqlite"))) {
    throw new Error("missing global memory sqlite");
  }
  if (!fs.existsSync(path.join(globalRoot, "exports", "global-learnings.md"))) {
    throw new Error("missing global learning export");
  }
  const reportDraft = fs.readFileSync(path.join(tmpRoot, ".vros/labs/C1-smoke-lab/report-draft.md"), "utf8");
  for (const section of ["## Title", "## CWE", "## Summary", "## Steps To Reproduce", "## Impact"]) {
    if (!reportDraft.includes(section)) {
      throw new Error(`report draft missing expected section: ${section}`);
    }
  }
  for (const guidance of [
    "follow that structure first",
    "should not read like a legal document",
    "Anticipate the triager's likely questions organically",
    "When adjusting a draft, write the external report text",
    "Do not use headings or stock transitions like \"Why this matters\"",
    "Do not put long, redundant explanations inside the steps",
    "Impact should preferably be bullet points"
  ]) {
    if (!reportDraft.includes(guidance)) {
      throw new Error(`report draft missing writing guidance: ${guidance}`);
    }
  }

  console.log(`Proteus smoke test passed: ${tmpRoot}`);
} finally {
  for (const root of [tmpRoot, killRoot, chimeraScopeRoot, chimeraGeneralistRoot, chimeraCampaignListRoot]) {
    stopChimeraServer(root);
  }
  killMockOpenCodeServers();
  for (const root of [
    tmpRoot,
    globalRoot,
    legacyRoot,
    helpRoot,
    mergeRoot,
    killRoot,
    concurrencyRoot,
    chimeraScopeRoot,
    chimeraGeneralistRoot,
    chimeraCampaignListRoot
  ]) {
    rmTemp(root);
  }
}

function stopChimeraServer(root) {
  try {
    run(["chimera", "stop-server", "--root", root], root);
  } catch {
    // Best-effort cleanup; rmTemp retries below are the final guard.
  }
}

function rmTemp(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    if (process.platform !== "win32") throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch (retryError) {
      console.warn(`warning: could not remove temp path ${target}: ${retryError.message}`);
    }
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
    // The regular stop-server path is authoritative; this only avoids leaked test mocks.
  }
}
