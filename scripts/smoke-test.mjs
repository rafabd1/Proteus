import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function run(args, cwd = tmpRoot) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: {
      ...process.env,
      PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
      PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports")
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFail(args, cwd = tmpRoot) {
  try {
    run(args, cwd);
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
  const chimeraDoctor = run(["chimera", "doctor"]);
  if (!chimeraDoctor.includes('"ok": true') || !chimeraDoctor.includes("mock-opencode")) {
    throw new Error("chimera doctor did not validate mock OpenCode runtime");
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
  if (!chimeraStart.includes('"publicId": "CH-0001"') || !chimeraStart.includes('"accessMode": "editor"')) {
    throw new Error("chimera start did not create CH-0001 with editor access");
  }
  for (const required of [
    ".vros/chimera/config.json",
    ".vros/chimera/sessions/CH-0001/dossier.md",
    ".vros/chimera/sessions/CH-0001/contract.md",
    ".vros/chimera/sessions/CH-0001/agent-instructions.md",
    ".vros/chimera/sessions/CH-0001/notifications.json",
    ".vros/chimera/sessions/CH-0001/skills/chimera-agent.md",
    ".vros/chimera/sessions/CH-0001/.opencode/agents/proteus-chimera.md",
    ".vros/chimera/sessions/CH-0001/.opencode/skills/chimera-agent/SKILL.md",
    ".vros/chimera/sessions/CH-0001/lab/README.md"
  ]) {
    if (!fs.existsSync(path.join(tmpRoot, required))) {
      throw new Error(`missing Chimera artifact: ${required}`);
    }
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
  const chimeraBroadcast = run(["chimera", "broadcast", "--message", "Smoke shared chat message", "--priority"]);
  if (!chimeraBroadcast.includes('"delivered"') || !chimeraBroadcast.includes("Smoke shared chat message")) {
    throw new Error("chimera broadcast did not deliver shared chat message");
  }
  const notificationAfterBroadcast = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/notifications.json"), "utf8"));
  if (notificationAfterBroadcast.pending !== true || notificationAfterBroadcast.priority !== true || notificationAfterBroadcast.latestKind !== "message") {
    throw new Error("chimera broadcast did not update priority notifications.json");
  }
  const chimeraBroadcastUnread = run(["chimera", "poll", "--id", "CH-0001", "--unread", "--agent"]);
  if (!chimeraBroadcastUnread.includes("Smoke shared chat message")) {
    throw new Error("chimera broadcast was not visible to the destination agent");
  }
  run(["chimera", "snapshot", "--id", "CH-0001", "--body", "Confirmed smoke snapshot"]);
  if (!fs.readFileSync(path.join(tmpRoot, ".vros/chimera/sessions/CH-0001/snapshot.md"), "utf8").includes("Confirmed smoke snapshot")) {
    throw new Error("chimera snapshot did not write snapshot.md");
  }
  const chimeraHeartbeat = run(["chimera", "heartbeat", "--id", "CH-0001"]);
  if (!chimeraHeartbeat.includes('"alive": true')) {
    throw new Error("chimera heartbeat did not report alive session");
  }
  const chimeraRun = run([
    "chimera",
    "start",
    "--role",
    "explorer",
    "--goal",
    "Run mock OpenCode once",
    "--run",
    "--timeout",
    "10"
  ]);
  if (!chimeraRun.includes('"publicId": "CH-0002"') || !chimeraRun.includes("mock-opencode") || !chimeraRun.includes('"provider": "high"') || !chimeraRun.includes('"opencodeSessionId": "ses_mock_CH-0002"')) {
    throw new Error("chimera --run did not capture mock OpenCode output");
  }
  const chimeraRunExisting = run(["chimera", "run", "--id", "CH-0002", "--timeout", "10"]);
  if (!chimeraRunExisting.includes('"ok": true') || !chimeraRunExisting.includes('"ses_mock_CH-0002"')) {
    throw new Error("chimera run did not reuse existing OpenCode session/lab");
  }
  const chimeraWorkflowSnapshot = JSON.parse(run(["chimera", "workflow-snapshot", "--id", "CH-0002", "--limit", "3", "--max-message-chars", "80"]));
  const workflowSnapshotText = JSON.stringify(chimeraWorkflowSnapshot);
  if (chimeraWorkflowSnapshot.messages.length !== 3 || !workflowSnapshotText.includes("First compact agent workflow message")) {
    throw new Error("chimera workflow-snapshot did not return compact agent messages");
  }
  for (const forbidden of ["User prompt that must not appear", "TOOL CALL THAT MUST NOT APPEAR", "TOOL RESULT THAT MUST NOT APPEAR", "COMMAND OUTPUT THAT MUST NOT APPEAR"]) {
    if (workflowSnapshotText.includes(forbidden)) {
      throw new Error(`chimera workflow-snapshot leaked non-agent/tool content: ${forbidden}`);
    }
  }
  if (!fs.existsSync(chimeraWorkflowSnapshot.files.jsonPath) || !fs.existsSync(chimeraWorkflowSnapshot.files.markdownPath)) {
    throw new Error("chimera workflow-snapshot did not write compact snapshot files");
  }
  const chimeraDirectSend = JSON.parse(run(["chimera", "send", "--id", "CH-0002", "--message", "Smoke direct steer", "--priority"]));
  if (chimeraDirectSend.directDelivery?.mode !== "steer" || chimeraDirectSend.directDelivery?.ok !== true) {
    throw new Error(`chimera priority send did not steer active OpenCode session: ${JSON.stringify(chimeraDirectSend.directDelivery)}`);
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
  if (chimeraCouncilTurnOne.nextCue.directDelivery?.mode !== "steer" || chimeraCouncilTurnOne.nextCue.directDelivery?.ok !== true) {
    throw new Error(`chimera council automatic next cue did not steer attached OpenCode session: ${JSON.stringify(chimeraCouncilTurnOne.nextCue.directDelivery)}`);
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
  const mergeDryRun = run(["merge", "--source", path.join(mergeRoot, ".vros", "memory.sqlite"), "--dry-run"]);
  if (!mergeDryRun.includes('"dryRun": true') || !mergeDryRun.includes('"evidence": 1')) {
    throw new Error("merge dry-run did not preview source evidence");
  }
  const mergeResult = run(["merge", "--source", path.join(mergeRoot, ".vros")]);
  if (!mergeResult.includes('"dryRun": false') || !mergeResult.includes('"surfaces": 1')) {
    throw new Error("merge did not copy source records into destination memory");
  }
  const mergedMemory = run(["query", "memory", "Stray merge evidence body"]);
  if (!mergedMemory.includes("evidence#")) {
    throw new Error("merged evidence was not searchable in destination memory");
  }
  run(["ingest", "docs"]);
  run(["observe"]);
  const roles = run(["roles"]);
  if (!roles.includes("Argus") || !roles.includes("Skeptic")) {
    throw new Error("roles did not list expected Proteus fronts");
  }
  const prompt = run(["prompt", "--role", "skeptic", "--surface", "Smoke request surface"]);
  if (!prompt.includes("Skeptic") || !prompt.includes("Smoke request surface")) {
    throw new Error("prompt did not render expected role instructions");
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
    "argus",
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
  try {
    run(["chimera", "stop-server"]);
  } catch {
    // Best-effort cleanup; the temp directory cleanup below is the final guard.
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
  fs.rmSync(legacyRoot, { recursive: true, force: true });
  fs.rmSync(helpRoot, { recursive: true, force: true });
  fs.rmSync(mergeRoot, { recursive: true, force: true });
}
