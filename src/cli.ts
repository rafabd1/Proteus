#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ProteusDb, createDefaultContract } from "./db";
import { exportMarkdown } from "./exporter";
import { ingestPaths } from "./ingest";
import { createLab } from "./lab";
import {
  broadcastChimeraMessage,
  chimeraDoctor,
  closeChimeraSession,
  closeChimeraCouncil,
  getChimeraConfig,
  getChimeraCouncil,
  heartbeatChimeraSession,
  initChimeraConfig,
  killChimeraSession,
  acceptChimeraCouncil,
  attachOpenCodeSession,
  cueChimeraCouncilTurn,
  openChimeraCouncilRound,
  pollChimeraMessages,
  postChimeraCouncilTurn,
  postChimeraMessage,
  runChimeraSession,
  saveChimeraConfig,
  sendChimeraMessage,
  snapshotChimeraSession,
  snapshotChimeraWorkflow,
  startChimeraSession,
  startChimeraCouncil,
  startChimeraSwarm,
  stopOpenCodeServer,
  DEFAULT_CHIMERA_CONFIG,
  type ChimeraSwarmPlan
} from "./chimera";
import { defaultGlobalScopeFromTarget, GlobalMemoryDb, globalMemoryLocation } from "./global-memory";
import { observeTarget } from "./observe";
import { planRound, renderRoundPlan } from "./planner";
import { renderAgentPrompt } from "./prompts";
import { ROLE_ORDER, ROLES } from "./roles";
import { ensureDir, exportsDir, resolveTargetRoot } from "./paths";
import type { AgentCodename, BranchStatus, CampaignStatus, ChimeraAccessMode, ChimeraMessageKind, HypothesisInput, JsonValue, RoiFactors, RoundStatus, SurfaceStatus } from "./types";

interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, subcommand] = parsed.command;
  if (parsed.flags.version === true || command === "-v" || command === "version") {
    printVersion();
    return;
  }
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printCommandHelp(command === "help" ? subcommand : undefined);
    return;
  }
  if (isHelpRequested(parsed)) {
    printCommandHelp(command);
    return;
  }

  const targetRoot = resolveTargetRoot(getString(parsed, "root") ?? process.cwd());
  const db = new ProteusDb(targetRoot);
  try {
    switch (command) {
      case "init":
        cmdInit(db, parsed);
        break;
      case "status":
        cmdStatus(db);
        break;
      case "migrate":
        cmdMigrate(db);
        break;
      case "merge":
        cmdMerge(db, parsed);
        break;
      case "chimera":
        cmdChimera(db, subcommand, parsed);
        break;
      case "ingest":
        cmdIngest(db, parsed.command.slice(1));
        break;
      case "observe":
        cmdObserve(db);
        break;
      case "plan-round":
        cmdPlanRound(db, parsed);
        break;
      case "campaign":
        cmdCampaign(db, subcommand, parsed);
        break;
      case "branch":
        cmdBranch(db, subcommand, parsed);
        break;
      case "link":
        cmdLink(db, parsed);
        break;
      case "roles":
        cmdRoles();
        break;
      case "prompt":
        cmdPrompt(db, parsed);
        break;
      case "record":
        cmdRecord(db, subcommand, parsed);
        break;
      case "list":
        cmdList(db, subcommand, parsed);
        break;
      case "update":
        cmdUpdate(db, subcommand, parsed);
        break;
      case "query":
        cmdQuery(db, subcommand, parsed);
        break;
      case "show":
        cmdShow(db, parsed);
        break;
      case "export":
        cmdExport(db);
        break;
      case "lab":
        cmdLab(db, subcommand, parsed);
        break;
      case "learn":
        cmdLearn(db, subcommand, parsed);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    db.close();
  }
}

function printVersion(): void {
  const packagePath = path.resolve(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name: string; version: string };
  console.log(`${pkg.name} ${pkg.version}`);
}

function cmdInit(db: ProteusDb, parsed: ParsedArgs): void {
  const name = getString(parsed, "name");
  const contract = createDefaultContract(db.targetRoot, name);
  db.initTarget(contract);
  ensureDir(exportsDir(db.targetRoot));
  console.log(`Initialized Proteus target: ${contract.target}`);
  console.log(`Memory: ${path.join(db.targetRoot, ".vros", "memory.sqlite")}`);
}

function cmdStatus(db: ProteusDb): void {
  const target = db.getTarget();
  if (!target) {
    console.log("Target not initialized.");
    return;
  }
  const stats = db.memoryStats();
  console.log(`Target: ${target.name}`);
  console.log(`Root: ${target.rootPath}`);
  console.log(`Memory: ${stats.dbPath} (${stats.dbSizeBytes} bytes)`);
  const versionRecord = db.getProteusVersionRecord();
  console.log(`Proteus DB version: ${versionRecord.storedVersion ?? "none"} (runtime ${versionRecord.currentVersion})`);
  console.log(`Sources: ${stats.sources}${stats.sourcesByKind.length > 0 ? ` (${stats.sourcesByKind.map((row) => `${row.kind}=${row.count}`).join(", ")})` : ""}`);
  console.log(`Surfaces: ${stats.surfaces}`);
  console.log(`Hypotheses: ${stats.hypotheses}`);
  console.log(`Evidence: ${stats.evidence}`);
  console.log(`Decisions: ${stats.decisions}`);
  console.log(`Gates: ${stats.gates}`);
  console.log(`Rounds: ${stats.rounds}`);
  console.log(`Campaigns: ${stats.campaigns}`);
  if (stats.activeRounds.length > 0) {
    console.log(`Active rounds: ${stats.activeRounds.map((round) => `R${round.id} ${round.objective}`).join(" | ")}`);
  } else {
    console.log("Active rounds: none");
  }
  console.log(`Agent outputs: ${stats.agentOutputs}`);
  console.log(`Labs: ${stats.labs}`);
  console.log(`Profiles: ${stats.profiles}`);
  if (stats.latestSource) {
    console.log(`Latest source: source#${stats.latestSource.id} [${stats.latestSource.kind}] ${stats.latestSource.pathOrUrl}`);
  }
  if (stats.latestDecision) {
    console.log(
      `Latest decision: decision#${stats.latestDecision.id} ${stats.latestDecision.decision} ${stats.latestDecision.entityType}#${stats.latestDecision.entityId}`
    );
  }
}

function cmdMigrate(db: ProteusDb): void {
  const versionRecord = db.runMigrations();
  const migrations = db.listMigrations();
  console.log(`Migration check complete: ${migrations.length} applied`);
  console.log(`Proteus DB version: ${versionRecord.storedVersion ?? "none"} (runtime ${versionRecord.currentVersion}, previous ${versionRecord.previousStoredVersion ?? "none"})`);
  for (const migration of migrations) {
    console.log(`- ${migration.version} @ ${migration.appliedAt}`);
  }
}

function cmdMerge(db: ProteusDb, parsed: ParsedArgs): void {
  requireInitialized(db);
  const sources = [
    ...splitList(getString(parsed, "sources") ?? ""),
    ...splitList(getString(parsed, "source") ?? ""),
    ...parsed.command.slice(1)
  ];
  const result = db.mergeMemoryBases(sources, { dryRun: getBoolean(parsed, "dry-run"), sourceBaseRoot: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
}

function cmdChimera(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  switch (subcommand) {
    case "config":
      cmdChimeraConfig(db, parsed.command[2], parsed);
      return;
    case "doctor":
      console.log(JSON.stringify(chimeraDoctor(db), null, 2));
      return;
    case "stop-server":
      console.log(JSON.stringify({ ok: true, ...stopOpenCodeServer(db) }, null, 2));
      return;
    case "start":
      console.log(JSON.stringify(startChimeraSession(db, {
        role: requiredString(parsed, "role"),
        goal: requiredString(parsed, "goal"),
        accessMode: chimeraAccessMode(parsed),
        accessNotes: getString(parsed, "access-notes"),
        campaignId: getNumber(parsed, "campaign-id"),
        roundId: getNumber(parsed, "round-id"),
        model: getString(parsed, "model"),
        provider: getString(parsed, "provider"),
        variant: getString(parsed, "variant"),
        timeoutSec: getNumber(parsed, "timeout"),
        run: getBoolean(parsed, "run")
      }), null, 2));
      return;
    case "swarm": {
      const planPath = requiredString(parsed, "plan");
      const plan = JSON.parse(fs.readFileSync(path.resolve(db.targetRoot, planPath), "utf8")) as ChimeraSwarmPlan;
      console.log(JSON.stringify(startChimeraSwarm(db, { ...plan, run: getBoolean(parsed, "run") || plan.run }), null, 2));
      return;
    }
    case "council":
      cmdChimeraCouncil(db, parsed.command[2], parsed);
      return;
    case "send":
      console.log(JSON.stringify({
        ok: true,
        ...sendChimeraMessage(
          db,
          requiredString(parsed, "id"),
          requiredString(parsed, "message"),
          chimeraMessageKind(parsed, "kind", "message"),
          { priority: getBoolean(parsed, "priority") }
        )
      }, null, 2));
      return;
    case "post":
      console.log(JSON.stringify({
        ok: true,
        message: postChimeraMessage(
          db,
          requiredString(parsed, "id"),
          chimeraMessageKind(parsed, "kind", "message"),
          requiredString(parsed, "body"),
          parseJsonFlag(getString(parsed, "metadata"))
        )
      }, null, 2));
      return;
    case "snapshot":
      console.log(JSON.stringify({
        ok: true,
        message: snapshotChimeraSession(db, requiredString(parsed, "id"), requiredString(parsed, "body"))
      }, null, 2));
      return;
    case "workflow-snapshot":
      console.log(JSON.stringify({
        ok: true,
        ...snapshotChimeraWorkflow(db, requiredString(parsed, "id"), {
          limit: getNumber(parsed, "limit"),
          maxMessageChars: getNumber(parsed, "max-message-chars"),
          sanitize: !getBoolean(parsed, "no-sanitize")
        })
      }, null, 2));
      return;
    case "heartbeat":
      console.log(JSON.stringify(heartbeatChimeraSession(db, requiredString(parsed, "id")), null, 2));
      return;
    case "run":
      {
        const id = requiredString(parsed, "id");
        const run = runChimeraSession(db, id, getNumber(parsed, "timeout"));
        console.log(JSON.stringify({ ok: true, run, session: db.getChimeraSession(id) }, null, 2));
      }
      return;
    case "attach-opencode":
      console.log(JSON.stringify({
        ok: true,
        session: attachOpenCodeSession(db, requiredString(parsed, "id"), {
          serverUrl: getString(parsed, "server-url"),
          opencodeSessionId: getString(parsed, "opencode-session-id")
        })
      }, null, 2));
      return;
    case "poll":
      console.log(JSON.stringify(pollChimeraMessages(db, {
        publicId: getString(parsed, "id"),
        unreadOnly: getBoolean(parsed, "unread"),
        forAgent: getBoolean(parsed, "agent"),
        peek: getBoolean(parsed, "peek"),
        limit: getNumber(parsed, "limit")
      }), null, 2));
      return;
    case "broadcast":
      console.log(JSON.stringify({
        ok: true,
        ...broadcastChimeraMessage(db, {
          body: requiredString(parsed, "message"),
          kind: chimeraMessageKind(parsed, "kind", "message"),
          fromId: getString(parsed, "from-id"),
          includeClosed: getBoolean(parsed, "include-closed"),
          priority: getBoolean(parsed, "priority")
        })
      }, null, 2));
      return;
    case "list":
      console.log(JSON.stringify(db.listChimeraSessions({ limit: getNumber(parsed, "limit") }), null, 2));
      return;
    case "kill":
      console.log(JSON.stringify(killChimeraSession(db, requiredString(parsed, "id"), requiredString(parsed, "reason")), null, 2));
      return;
    case "close":
      console.log(JSON.stringify(closeChimeraSession(
        db,
        requiredString(parsed, "id"),
        getString(parsed, "verdict") ?? "useful",
        requiredString(parsed, "summary")
      ), null, 2));
      return;
    default:
      throw new Error("Usage: proteus chimera <config|doctor|stop-server|start|swarm|council|send|broadcast|post|snapshot|workflow-snapshot|heartbeat|run|attach-opencode|poll|list|kill|close>");
  }
}

function cmdChimeraCouncil(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  switch (subcommand) {
    case "start":
      console.log(JSON.stringify(startChimeraCouncil(db, {
        topic: requiredString(parsed, "topic"),
        reason: getString(parsed, "reason"),
        sessionIds: splitList(getString(parsed, "ids") ?? getString(parsed, "sessions") ?? ""),
        maxRounds: getNumber(parsed, "max-rounds")
      }), null, 2));
      return;
    case "accept":
      console.log(JSON.stringify({
        ok: true,
        message: acceptChimeraCouncil(db, requiredString(parsed, "id"), requiredString(parsed, "council-id"), getString(parsed, "body"))
      }, null, 2));
      return;
    case "open-round":
      console.log(JSON.stringify({
        ok: true,
        ...openChimeraCouncilRound(
          db,
          requiredString(parsed, "council-id"),
          getNumber(parsed, "round"),
          requiredString(parsed, "message"),
          getString(parsed, "start-id"),
          !getBoolean(parsed, "no-cue")
        )
      }, null, 2));
      return;
    case "turn":
      console.log(JSON.stringify({
        ok: true,
        ...postChimeraCouncilTurn(
          db,
          requiredString(parsed, "id"),
          requiredString(parsed, "council-id"),
          requiredString(parsed, "body"),
          getNumber(parsed, "round"),
          !getBoolean(parsed, "no-advance")
        )
      }, null, 2));
      return;
    case "cue-turn":
      console.log(JSON.stringify({
        ok: true,
        ...cueChimeraCouncilTurn(
          db,
          requiredString(parsed, "id"),
          requiredString(parsed, "council-id"),
          getNumber(parsed, "round"),
          getString(parsed, "prompt"),
          getBoolean(parsed, "manual")
        )
      }, null, 2));
      return;
    case "status":
      console.log(JSON.stringify(getChimeraCouncil(db, requiredString(parsed, "council-id")), null, 2));
      return;
    case "close":
      console.log(JSON.stringify(closeChimeraCouncil(
        db,
        requiredString(parsed, "council-id"),
        requiredString(parsed, "summary"),
        getString(parsed, "instruction")
      ), null, 2));
      return;
    default:
      throw new Error("Usage: proteus chimera council <start|accept|open-round|cue-turn|turn|status|close>");
  }
}

function cmdChimeraConfig(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  switch (subcommand) {
    case "init": {
      const config = initChimeraConfig(db, {
        enabled: !getBoolean(parsed, "disabled"),
        runtime: "opencode",
        opencodeCommand: getString(parsed, "opencode-command") ?? DEFAULT_CHIMERA_CONFIG.opencodeCommand,
        opencodeServerUrl: getString(parsed, "server-url") ?? undefined,
        opencodeServerPid: getNumber(parsed, "server-pid") ?? undefined,
        defaultModel: getString(parsed, "model") ?? undefined,
        defaultVariant: getString(parsed, "variant") ?? getString(parsed, "provider") ?? undefined,
        defaultAgent: getString(parsed, "agent") ?? undefined,
        maxAgents: getNumber(parsed, "max-agents"),
        defaultTimeoutSec: getNumber(parsed, "timeout"),
        defaultNetwork: getBoolean(parsed, "network"),
        skipPermissions: !getBoolean(parsed, "no-skip-permissions")
      });
      console.log(JSON.stringify({ ok: true, config }, null, 2));
      return;
    }
    case "show":
      console.log(JSON.stringify(getChimeraConfig(db), null, 2));
      return;
    case "disable": {
      const current = getChimeraConfig(db);
      saveChimeraConfig(db, { ...current, enabled: false });
      console.log(JSON.stringify({ ok: true, config: getChimeraConfig(db) }, null, 2));
      return;
    }
    default:
      throw new Error("Usage: proteus chimera config <init|show|disable>");
  }
}

function cmdIngest(db: ProteusDb, inputs: string[]): void {
  requireInitialized(db);
  const result = ingestPaths(db, inputs);
  console.log(`Ingest scanned=${result.scanned} indexed=${result.indexed} unchanged=${result.unchanged} skipped=${result.skipped}`);
}

function cmdObserve(db: ProteusDb): void {
  requireInitialized(db);
  const profile = observeTarget(db);
  console.log(JSON.stringify(profile, null, 2));
}

function cmdPlanRound(db: ProteusDb, parsed: ParsedArgs): void {
  requireInitialized(db);
  const objective =
    getString(parsed, "objective") ??
    "Identify high-ROI, non-obvious vulnerability hypotheses with realistic exploitability.";
  const planInputPath = getString(parsed, "plan-json");
  const planInput = planInputPath
    ? { objective, status: roundStatus(parsed), coordinatorPlan: readPlanInput(planInputPath) }
    : {
        objective,
        status: roundStatus(parsed),
        currentUnderstanding: getString(parsed, "context")
      };
  const plan = planRound(db, planInput);
  db.linkActiveCampaignTo({
    toType: "round",
    toId: plan.id,
    relation: "has_round",
    eventType: "round_linked",
    eventSummary: `Round linked: ${plan.objective}`
  });
  const markdown = renderRoundPlan(plan);
  if (getBoolean(parsed, "write")) {
    const out = path.join(exportsDir(db.targetRoot), `round-plan-${plan.id}.md`);
    ensureDir(path.dirname(out));
    fs.writeFileSync(out, markdown);
    console.log(`Wrote ${out}`);
  } else {
    console.log(markdown);
  }
}

function cmdCampaign(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "create") {
    const id = db.addCampaign({
      title: requiredString(parsed, "title"),
      objective: getString(parsed, "objective") ?? requiredString(parsed, "title"),
      status: campaignStatus(parsed) ?? "active",
      currentStateSummary: getString(parsed, "state"),
      recentLearningSummary: getString(parsed, "learnings")
    });
    console.log(`Created campaign C${id}`);
    return;
  }

  if (subcommand === "resume" || subcommand === "digest") {
    const id = getNumber(parsed, "id") ?? db.listCampaigns("active")[0]?.id;
    if (!id) {
      console.log("No active campaign found.");
      return;
    }
    console.log(JSON.stringify(db.campaignDigest(id), null, 2));
    return;
  }

  if (subcommand === "checkpoint") {
    const id = requiredNumber(parsed, "id");
    const checkpointId = db.addCampaignCheckpoint({
      campaignId: id,
      confirmed: splitList(getString(parsed, "confirmed") ?? ""),
      killed: splitList(getString(parsed, "killed") ?? ""),
      open: splitList(getString(parsed, "open") ?? ""),
      pivots: splitList(getString(parsed, "pivots") ?? ""),
      scoreChanges: splitList(getString(parsed, "score-changes") ?? ""),
      contextToPersist: splitList(getString(parsed, "context") ?? ""),
      nextHighRoiMove: getString(parsed, "next") ?? "",
      contractSignature: parseJsonFlag(getString(parsed, "contract-signature")) ?? {},
      summary: getString(parsed, "summary") ?? ""
    });
    db.updateCampaign({
      id,
      status: campaignStatus(parsed),
      currentStateSummary: getString(parsed, "state"),
      recentLearningSummary: getString(parsed, "learnings"),
      eventSummary: getString(parsed, "summary") ?? "Campaign checkpoint recorded."
    });
    console.log(`Checkpointed campaign C${id} as K${checkpointId}`);
    return;
  }

  if (subcommand === "close") {
    const id = requiredNumber(parsed, "id");
    db.updateCampaign({
      id,
      status: campaignStatus(parsed) ?? "completed",
      eventSummary: getString(parsed, "summary") ?? "Campaign closed."
    });
    console.log(`Closed campaign C${id}`);
    return;
  }

  throw new Error("campaign requires one of: create, resume, digest, checkpoint, close");
}

function cmdBranch(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "add" || subcommand === "create") {
    const explicitCampaignId = getNumber(parsed, "campaign-id");
    const activeCampaigns = db.listCampaigns("active");
    const activeCampaignId = explicitCampaignId ?? (activeCampaigns.length === 1 ? activeCampaigns[0].id : undefined);
    const id = db.addHypothesisBranch({
      campaignId: activeCampaignId,
      roundId: getNumber(parsed, "round-id"),
      surfaceId: getNumber(parsed, "surface-id"),
      title: requiredString(parsed, "title"),
      hypothesis: getString(parsed, "hypothesis") ?? requiredString(parsed, "title"),
      attackPrimitive: getString(parsed, "primitive") ?? "unknown",
      whyNonObvious: getString(parsed, "why-non-obvious") ?? "",
      preconditions: splitList(getString(parsed, "preconditions") ?? ""),
      steps: splitList(getString(parsed, "steps") ?? ""),
      successCriteria: splitList(getString(parsed, "success") ?? ""),
      negativeControls: splitList(getString(parsed, "negative-controls") ?? ""),
      killConditions: splitList(getString(parsed, "kill-conditions") ?? ""),
      roi: {
        probability: getNumber(parsed, "probability") ?? 1,
        impact: getNumber(parsed, "impact") ?? 1,
        effort: getNumber(parsed, "effort") ?? 1,
        novelty: getNumber(parsed, "novelty") ?? 1
      },
      status: branchStatus(parsed) ?? "open"
    });
    if (activeCampaignId) {
      db.addEntityLink({
        fromType: "campaign",
        fromId: activeCampaignId,
        toType: "hypothesis_branch",
        toId: id,
        relation: "has_branch",
        confidence: 1,
        note: "Linked from branch add."
      });
    }
    console.log(`Recorded branch B${id}`);
    return;
  }

  if (subcommand === "list" || subcommand === "branches") {
    const rows = db.listHypothesisBranches({
      campaignId: getNumber(parsed, "campaign-id"),
      roundId: getNumber(parsed, "round-id"),
      status: branchStatus(parsed),
      limit: getNumber(parsed, "limit") ?? 50
    });
    for (const row of rows) {
      console.log(`B${row.id} [${row.status}] ${row.title}`);
      console.log(`  primitive=${row.attackPrimitive} campaign=${row.campaignId ?? "-"} round=${row.roundId ?? "-"} surface=${row.surfaceId ?? "-"}`);
      console.log(`  kill=${arrayLength(row.killConditions)} steps=${arrayLength(row.steps)} non-obvious=${truncateForCli(row.whyNonObvious || "-", 120)}`);
    }
    if (rows.length === 0) console.log("No branches recorded.");
    return;
  }

  throw new Error("branch requires one of: add, create, list");
}

function cmdLink(db: ProteusDb, parsed: ParsedArgs): void {
  requireInitialized(db);
  const id = db.addEntityLink({
    fromType: requiredString(parsed, "from-type"),
    fromId: requiredNumber(parsed, "from-id"),
    toType: requiredString(parsed, "to-type"),
    toId: requiredNumber(parsed, "to-id"),
    relation: requiredString(parsed, "relation"),
    confidence: getNumber(parsed, "confidence") ?? 1,
    note: getString(parsed, "note")
  });
  console.log(`Recorded link L${id}`);
}

function readPlanInput(filePath: string): Record<string, unknown> {
  const fullPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as Record<string, unknown>;
}

function cmdRoles(): void {
  for (const codename of ROLE_ORDER) {
    const role = ROLES[codename];
    console.log(`${role.displayName} (${role.family})`);
    console.log(`  ${role.purpose}`);
  }
}

function cmdPrompt(db: ProteusDb, parsed: ParsedArgs): void {
  const codename = getString(parsed, "role") as AgentCodename | undefined;
  if (!codename || !(codename in ROLES)) {
    throw new Error(`Use --role with one of: ${ROLE_ORDER.join(", ")}`);
  }
  const target = db.getTarget();
  const prompt = renderAgentPrompt({
    codename,
    workspace: db.targetRoot,
    target: target?.name ?? path.basename(db.targetRoot),
    surface: getString(parsed, "surface") ?? "No surface provided. Coordinator must assign a bounded surface.",
    avoid: splitList(getString(parsed, "avoid") ?? ""),
    objective: getString(parsed, "objective") ?? "Run a bounded Proteus research front."
  });
  console.log(prompt);
}

function cmdRecord(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "surface") {
    const id = db.addSurface({
      name: requiredString(parsed, "name"),
      family: getString(parsed, "family") ?? "coordinator-supplied",
      description: getString(parsed, "description") ?? "",
      files: splitList(getString(parsed, "files") ?? ""),
      symbols: splitList(getString(parsed, "symbols") ?? ""),
      entrypoints: splitList(getString(parsed, "entrypoints") ?? ""),
      trustBoundaries: splitList(getString(parsed, "trust-boundaries") ?? ""),
      runtimeModes: splitList(getString(parsed, "runtime-modes") ?? ""),
      status: (getString(parsed, "status") ?? "active") as SurfaceStatus,
      roi: roiFromFlags(parsed),
      revisitCondition: getString(parsed, "revisit") ?? ""
    });
    console.log(`Recorded surface S${id}`);
    return;
  }

  if (subcommand === "hypothesis") {
    const input: HypothesisInput = {
      surfaceId: getNumber(parsed, "surface-id"),
      title: requiredString(parsed, "title"),
      primitive: getString(parsed, "primitive") ?? "unknown",
      attackerBoundary: getString(parsed, "attacker-boundary") ?? "unknown",
      impactClaim: getString(parsed, "impact") ?? "unknown",
      heuristicFamily: getString(parsed, "heuristic") ?? "unknown",
      status: "live",
      score: getNumber(parsed, "score") ?? 0,
      duplicateRisk: getNumber(parsed, "duplicate-risk") ?? 5,
      expectedBehaviorRisk: getNumber(parsed, "expected-risk") ?? 5,
      validationCost: getNumber(parsed, "validation-cost") ?? 5,
      killCriteria: getString(parsed, "kill-criteria") ?? "",
      revisitCondition: getString(parsed, "revisit") ?? ""
    };
    const id = db.addHypothesis(input);
    autoLinkActiveCampaign(db, "hypothesis", id, "tracks_hypothesis", `Hypothesis H${id} recorded in active campaign.`);
    console.log(`Recorded hypothesis H${id}`);
    return;
  }

  if (subcommand === "evidence") {
    const id = db.addEvidence({
      kind: getString(parsed, "kind") ?? "note",
      title: requiredString(parsed, "title"),
      body: getString(parsed, "body") ?? "",
      pathOrUrl: getString(parsed, "path"),
      command: getString(parsed, "command")
    });
    autoLinkActiveCampaign(db, "evidence", id, "has_evidence", `Evidence E${id} recorded in active campaign.`);
    console.log(`Recorded evidence E${id}`);
    return;
  }

  if (subcommand === "decision") {
    const id = db.addDecision({
      entityType: requiredString(parsed, "entity-type"),
      entityId: requiredNumber(parsed, "entity-id"),
      decision: requiredString(parsed, "decision"),
      reason: requiredString(parsed, "reason"),
      evidenceIds: splitList(getString(parsed, "evidence-ids") ?? "").map((item) => Number(item)).filter(Boolean),
      actor: getString(parsed, "actor") ?? "coordinator"
    });
    autoLinkActiveCampaign(db, "decision", id, "has_decision", `Decision D${id} recorded in active campaign.`);
    console.log(`Recorded decision D${id}`);
    return;
  }

  if (subcommand === "gate") {
    const id = db.addValidationGate({
      entityType: requiredString(parsed, "entity-type"),
      entityId: requiredNumber(parsed, "entity-id"),
      gate: requiredString(parsed, "gate"),
      status: (getString(parsed, "status") ?? "pending") as never,
      summary: getString(parsed, "summary") ?? "",
      evidenceIds: splitList(getString(parsed, "evidence-ids") ?? "").map((item) => Number(item)).filter(Boolean),
      actor: getString(parsed, "actor") ?? "coordinator"
    });
    autoLinkActiveCampaign(db, "gate", id, "has_validation_gate", `Validation gate G${id} recorded in active campaign.`);
    console.log(`Recorded gate G${id}`);
    return;
  }

  if (subcommand === "agent-output") {
    const role = requiredString(parsed, "role") as AgentCodename;
    if (!(role in ROLES)) throw new Error(`Unknown role: ${role}`);
    const id = db.addAgentOutput({
      roundId: requiredNumber(parsed, "round-id"),
      codename: role,
      roleFamily: ROLES[role].family,
      assignedSurface: requiredString(parsed, "surface"),
      outputPath: getString(parsed, "output-path") ?? "",
      coveredSurface: splitList(getString(parsed, "covered") ?? ""),
      liveCandidates: splitList(getString(parsed, "candidates") ?? ""),
      killedHypotheses: splitList(getString(parsed, "killed") ?? ""),
      probes: splitList(getString(parsed, "probes") ?? ""),
      uncoveredAreas: splitList(getString(parsed, "uncovered") ?? ""),
      validationStatus: getString(parsed, "validation-status") ?? "unvalidated"
    });
    autoLinkActiveCampaign(db, "agent_output", id, "has_agent_output", `Agent output A${id} recorded in active campaign.`);
    console.log(`Recorded agent output A${id}`);
    return;
  }

  throw new Error("record requires one of: surface, hypothesis, evidence, decision, gate, agent-output");
}

function cmdList(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  const limit = getNumber(parsed, "limit") ?? 50;
  if (subcommand === "surfaces") {
    const text = (getString(parsed, "text") ?? "").toLowerCase();
    const status = getString(parsed, "status");
    const rows = db
      .listSurfaces()
      .filter((row) => !status || row.status === status)
      .filter((row) => !text || [row.name, row.family, row.description, row.revisitCondition].join(" ").toLowerCase().includes(text))
      .slice(0, limit);
    for (const row of rows) {
      console.log(`S${row.id} [${row.status}] ${row.name} family=${row.family} roi=${row.roiScore.toFixed(1)} exhaustion=${row.exhaustionLevel}`);
      console.log(`  files=${row.files.length} revisit=${row.revisitCondition || "-"}`);
      if (row.description) console.log(`  ${row.description}`);
    }
    if (rows.length === 0) console.log("No surfaces recorded.");
    return;
  }

  if (subcommand === "hypotheses") {
    const status = getString(parsed, "status");
    const rows = db.listHypotheses().filter((row) => !status || row.status === status).slice(0, limit);
    for (const row of rows) {
      console.log(`H${row.id} [${row.status}] score=${row.score.toFixed(1)} surface=${row.surfaceId ?? "-"} ${row.title}`);
      console.log(`  primitive=${row.primitive} impact=${row.impactClaim}`);
    }
    if (rows.length === 0) console.log("No hypotheses recorded.");
    return;
  }

  if (subcommand === "evidence") {
    const rows = db.listEvidence().slice(0, limit);
    for (const row of rows) {
      console.log(`E${row.id} [${row.kind}] ${row.title}`);
      console.log(`  ${truncateForCli(row.body || row.pathOrUrl || row.command || "-", 180)}`);
    }
    if (rows.length === 0) console.log("No evidence recorded.");
    return;
  }

  if (subcommand === "decisions") {
    const rows = db.listDecisions().slice(0, limit);
    for (const row of rows) {
      console.log(`D${row.id} ${row.decision} ${row.entityType}#${row.entityId} by=${row.actor}`);
      console.log(`  evidence=${row.evidenceIds.join(",") || "-"} reason=${truncateForCli(row.reason, 180)}`);
    }
    if (rows.length === 0) console.log("No decisions recorded.");
    return;
  }

  if (subcommand === "gates") {
    const entityType = getString(parsed, "entity-type");
    const entityId = getNumber(parsed, "entity-id");
    const rows = db
      .listValidationGates()
      .filter((row) => !entityType || row.entityType === entityType)
      .filter((row) => entityId === undefined || row.entityId === entityId)
      .slice(0, limit);
    for (const row of rows) {
      console.log(`G${row.id} [${row.status}] ${row.gate} for ${row.entityType}#${row.entityId} by=${row.actor}`);
      console.log(`  evidence=${row.evidenceIds.join(",") || "-"} ${truncateForCli(row.summary || "-", 180)}`);
    }
    if (rows.length === 0) console.log("No validation gates recorded.");
    return;
  }

  if (subcommand === "rounds" || subcommand === "plans") {
    const status = getString(parsed, "status");
    const rows = db
      .listRounds()
      .filter((row) => !status || row.status === status)
      .slice(0, limit);
    for (const row of rows) {
      console.log(`R${row.id} [${row.status}] ${row.objective}`);
      console.log(`  selected=${arrayLength(row.selectedSurfaces)} fronts=${arrayLength(row.agentFronts)} stop=${arrayLength(row.stopConditions)} created=${row.createdAt}`);
      console.log(`  understanding=${truncateForCli(row.currentUnderstanding || "-", 180)}`);
    }
    if (rows.length === 0) console.log("No rounds recorded.");
    return;
  }

  if (subcommand === "campaigns") {
    const status = campaignStatus(parsed);
    const rows = db.listCampaigns(status).slice(0, limit);
    for (const row of rows) {
      console.log(`C${row.id} [${row.status}] ${row.title}`);
      console.log(`  objective=${truncateForCli(row.objective, 180)}`);
      console.log(`  state=${truncateForCli(row.currentStateSummary || "-", 180)}`);
    }
    if (rows.length === 0) console.log("No campaigns recorded.");
    return;
  }

  if (subcommand === "branches") {
    const rows = db.listHypothesisBranches({
      campaignId: getNumber(parsed, "campaign-id"),
      roundId: getNumber(parsed, "round-id"),
      status: branchStatus(parsed),
      limit
    });
    for (const row of rows) {
      console.log(`B${row.id} [${row.status}] ${row.title}`);
      console.log(`  primitive=${row.attackPrimitive} campaign=${row.campaignId ?? "-"} round=${row.roundId ?? "-"}`);
    }
    if (rows.length === 0) console.log("No branches recorded.");
    return;
  }

  if (subcommand === "links") {
    const rows = db.listEntityLinks({
      entityType: getString(parsed, "entity-type"),
      entityId: getNumber(parsed, "entity-id"),
      limit
    });
    for (const row of rows) {
      console.log(`L${row.id} ${row.fromType}#${row.fromId} -[${row.relation}]-> ${row.toType}#${row.toId} confidence=${row.confidence}`);
      if (row.note) console.log(`  ${truncateForCli(row.note, 180)}`);
    }
    if (rows.length === 0) console.log("No entity links recorded.");
    return;
  }

  if (subcommand === "checkpoints") {
    const campaignId = requiredNumber(parsed, "campaign-id");
    const rows = db.listCampaignCheckpoints(campaignId, limit);
    for (const row of rows) {
      console.log(`K${row.id} campaign=C${row.campaignId} next=${truncateForCli(row.nextHighRoiMove || "-", 120)}`);
      console.log(`  confirmed=${arrayLength(row.confirmed)} killed=${arrayLength(row.killed)} open=${arrayLength(row.open)} summary=${truncateForCli(row.summary || "-", 120)}`);
    }
    if (rows.length === 0) console.log("No campaign checkpoints recorded.");
    return;
  }

  throw new Error("list requires one of: surfaces, hypotheses, evidence, decisions, gates, rounds, campaigns, branches, links, checkpoints");
}

function cmdUpdate(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "surface") {
    db.updateSurface({
      id: requiredNumber(parsed, "id"),
      status: getString(parsed, "status"),
      revisitCondition: getString(parsed, "revisit"),
      exhaustionLevel: getNumber(parsed, "exhaustion")
    });
    console.log(`Updated surface S${requiredNumber(parsed, "id")}`);
    return;
  }
  if (subcommand === "round" || subcommand === "plan") {
    const id = requiredNumber(parsed, "id");
    db.updateRound({
      id,
      status: roundStatus(parsed),
      outcome: getString(parsed, "outcome")
    });
    console.log(`Updated round R${id}`);
    return;
  }
  if (subcommand === "rounds" || subcommand === "plans") {
    const from = requiredRoundStatus(parsed, "from");
    const status = requiredRoundStatus(parsed, "status");
    const result = db.updateRoundsByStatus({
      from,
      status,
      keepLatest: getBoolean(parsed, "keep-latest")
    });
    console.log(`Updated ${result.updated} rounds from ${from} to ${status}${result.keptId ? `; kept R${result.keptId} as ${from}` : ""}`);
    return;
  }
  throw new Error("update requires one of: surface, round, rounds");
}

function cmdQuery(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "duplicates") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "text");
    const rows = db.queryCoverage(text, getNumber(parsed, "limit") ?? 10);
    if (rows.length === 0) {
      console.log("No prior coverage found.");
      return;
    }
    for (const row of rows) {
      console.log(`${row.entityType}#${row.entityId} score=${row.score} ${row.status ? `status=${row.status} ` : ""}${row.title}`);
      if (row.pathOrUrl) console.log(`  path=${row.pathOrUrl}`);
      console.log(`  matched=${row.matchedTerms.join(", ") || "-"}`);
      console.log(`  reason=${row.reason}`);
      console.log(`  summary=${row.summary || "-"}`);
    }
    return;
  }

  if (subcommand === "memory") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "text");
    const rows = db.search(text, getNumber(parsed, "limit") ?? 20);
    if (rows.length === 0) {
      console.log("No memory matches found.");
      return;
    }
    for (const row of rows) console.log(`${row.entityType}#${row.entityId}: ${row.snippet}`);
    return;
  }

  if (subcommand === "similar") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "text");
    const result = db.querySimilar(text, getNumber(parsed, "limit") ?? 10);
    console.log("Duplicate/report coverage:");
    if (result.duplicateCoverage.length === 0) {
      console.log("  none");
    } else {
      for (const row of result.duplicateCoverage) {
        console.log(`  ${row.entityType}#${row.entityId} score=${row.score} ${row.status ? `status=${row.status} ` : ""}${row.title}`);
      }
    }
    console.log("Memory matches:");
    if (result.memoryMatches.length === 0) {
      console.log("  none");
    } else {
      for (const row of result.memoryMatches) console.log(`  ${row.entityType}#${row.entityId}: ${row.snippet}`);
    }
    return;
  }

  if (subcommand === "revisit") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "surface");
    const rows = db
      .listSurfaces()
      .filter(
        (surface) =>
          surface.name.toLowerCase().includes(text.toLowerCase()) ||
          surface.family.toLowerCase().includes(text.toLowerCase())
      );
    for (const surface of rows) {
      console.log(
        `S${surface.id} ${surface.name}: status=${surface.status}, ROI=${surface.roiScore.toFixed(1)}, revisit=${surface.revisitCondition || "-"}`
      );
    }
    if (rows.length === 0) console.log("No matching surfaces found.");
    return;
  }

  if (subcommand === "surfaces") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "text");
    const query = text.toLowerCase();
    const rows = db
      .listSurfaces()
      .filter((surface) => [surface.name, surface.family, surface.description, surface.revisitCondition, surface.files.join(" ")].join(" ").toLowerCase().includes(query));
    for (const surface of rows) {
      console.log(`S${surface.id} [${surface.status}] ${surface.name}: family=${surface.family}, ROI=${surface.roiScore.toFixed(1)}, files=${surface.files.length}`);
      console.log(`  revisit=${surface.revisitCondition || "-"}`);
    }
    if (rows.length === 0) console.log("No matching surfaces found.");
    return;
  }

  throw new Error("query requires one of: duplicates, memory, similar, revisit, surfaces");
}

function cmdShow(db: ProteusDb, parsed: ParsedArgs): void {
  requireInitialized(db);
  const entityType = parsed.command[1] ?? requiredString(parsed, "entity-type");
  const entityId = Number(parsed.command[2] ?? requiredString(parsed, "id"));
  if (!Number.isFinite(entityId)) throw new Error("show requires a numeric id");
  const record = db.getRecord(entityType, entityId);
  if (!record) {
    console.log(`No record found for ${entityType}#${entityId}.`);
    return;
  }
  console.log(JSON.stringify(record, null, 2));
}

function cmdExport(db: ProteusDb): void {
  requireInitialized(db);
  const files = exportMarkdown(db);
  for (const file of files) console.log(`Wrote ${file}`);
}

function cmdLab(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand !== "create") throw new Error("lab requires: create");
  const candidateId = requiredNumber(parsed, "candidate-id");
  const labPath = createLab(db, candidateId, getString(parsed, "name"));
  console.log(`Created lab: ${labPath}`);
}

function cmdLearn(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  const globalDb = new GlobalMemoryDb();
  try {
    if (subcommand === "add") {
      const target = db.getTarget();
      const id = globalDb.addLearning({
        category: (getString(parsed, "category") ?? "research_heuristic") as never,
        scope: getString(parsed, "scope") ?? (target ? defaultGlobalScopeFromTarget(target) : "global"),
        title: requiredString(parsed, "title"),
        body: getString(parsed, "body") ?? "",
        tags: splitList(getString(parsed, "tags") ?? ""),
        sourceTarget: getString(parsed, "source-target") ?? target?.name,
        confidence: getNumber(parsed, "confidence") ?? 0.7
      });
      console.log(`Recorded global learning G${id}`);
      console.log(`Memory: ${globalMemoryLocation()}`);
      return;
    }

    if (subcommand === "query") {
      const target = db.getTarget();
      const targetScope = getBoolean(parsed, "target-scope") && target ? defaultGlobalScopeFromTarget(target) : "";
      const text = [parsed.command.slice(2).join(" ") || getString(parsed, "text") || "", targetScope].filter(Boolean).join(" ");
      const rows = globalDb.queryLearnings({
        text,
        scope: getString(parsed, "scope"),
        category: getString(parsed, "category"),
        tags: splitList(getString(parsed, "tags") ?? ""),
        limit: getNumber(parsed, "limit") ?? 20
      });
      if (rows.length === 0) {
        console.log("No global learnings found.");
        return;
      }
      for (const row of rows) {
        console.log(`G${row.id} [${row.category}] ${row.title}`);
        console.log(`  scope=${row.scope}`);
        console.log(`  tags=${row.tags.join(", ") || "-"}`);
        console.log(`  ${row.body}`);
      }
      return;
    }

    if (subcommand === "export") {
      console.log(`Wrote ${globalDb.exportMarkdown(getString(parsed, "out"))}`);
      return;
    }
  } finally {
    globalDb.close();
  }

  throw new Error("learn requires one of: add, query, export");
}

function requireInitialized(db: ProteusDb): void {
  if (!db.getTarget()) {
    throw new Error("Target not initialized. Run `proteus init --name <target>` first.");
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [rawKey, rawValue] = arg.slice(2).split("=", 2);
      const key = rawKey.trim();
      if (rawValue !== undefined) {
        flags[key] = rawValue;
      } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      command.push(arg);
    }
  }
  return { command, flags };
}

function getString(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(parsed: ParsedArgs, key: string): string {
  const value = getString(parsed, key);
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function getNumber(parsed: ParsedArgs, key: string): number | undefined {
  const value = getString(parsed, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${key} must be a number`);
  return number;
}

function requiredNumber(parsed: ParsedArgs, key: string): number {
  const value = getNumber(parsed, key);
  if (value === undefined) throw new Error(`Missing --${key}`);
  return value;
}

function getBoolean(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags[key] === true || parsed.flags[key] === "true";
}

function autoLinkActiveCampaign(db: ProteusDb, entityType: string, entityId: number, relation: string, eventSummary: string): void {
  db.linkActiveCampaignTo({
    toType: entityType,
    toId: entityId,
    relation,
    eventType: "record_auto_linked",
    eventSummary
  });
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonFlag(value: string | undefined): JsonValue | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    parsed = parseLooseObjectFlag(value);
    if (parsed === undefined) {
      throw new Error("Flag value must be valid JSON or comma-separated key=value pairs.");
    }
  }
  if (!isJsonValue(parsed)) {
    throw new Error("Flag value must be valid JSON.");
  }
  return parsed;
}

function parseLooseObjectFlag(value: string): JsonValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const body = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  const pairs = body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (pairs.length === 0) return {};
  const result: Record<string, JsonValue> = {};
  for (const pair of pairs) {
    const separatorIndex = pair.includes("=") ? pair.indexOf("=") : pair.indexOf(":");
    if (separatorIndex <= 0) return undefined;
    const key = stripLooseQuotes(pair.slice(0, separatorIndex).trim());
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return undefined;
    result[key] = parseLooseScalar(pair.slice(separatorIndex + 1).trim());
  }
  return result;
}

function parseLooseScalar(value: string): JsonValue {
  const unquoted = stripLooseQuotes(value);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (unquoted === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function stripLooseQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

function roiFromFlags(parsed: ParsedArgs): RoiFactors {
  return {
    impactPotential: getNumber(parsed, "impact-potential") ?? 0,
    externalReachability: getNumber(parsed, "external-reachability") ?? 0,
    trustBoundaryDensity: getNumber(parsed, "trust-boundary-density") ?? 0,
    recentChangeWeight: getNumber(parsed, "recent-change") ?? 0,
    unexploredInvariantWeight: getNumber(parsed, "unexplored-invariant") ?? 0,
    toolingReadiness: getNumber(parsed, "tooling-readiness") ?? 0,
    duplicateRisk: getNumber(parsed, "duplicate-risk") ?? 0,
    expectedBehaviorLikelihood: getNumber(parsed, "expected-risk") ?? 0,
    priorExhaustionWeight: getNumber(parsed, "prior-exhaustion") ?? 0,
    validationCost: getNumber(parsed, "validation-cost") ?? 0,
    lowSignalHistory: getNumber(parsed, "low-signal-history") ?? 0
  };
}

function truncateForCli(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function roundStatus(parsed: ParsedArgs): RoundStatus | undefined {
  const status = getString(parsed, "status");
  if (status === undefined) return undefined;
  return parseRoundStatus(status);
}

function requiredRoundStatus(parsed: ParsedArgs, key: string): RoundStatus {
  return parseRoundStatus(requiredString(parsed, key));
}

function parseRoundStatus(status: string): RoundStatus {
  if (
    status === "active" ||
    status === "paused" ||
    status === "completed" ||
    status === "blocked" ||
    status === "planned" ||
    status === "superseded"
  ) {
    return status;
  }
  throw new Error("Round status must be one of: active, paused, completed, blocked, planned, superseded");
}

function campaignStatus(parsed: ParsedArgs): CampaignStatus | undefined {
  const status = getString(parsed, "status");
  if (status === undefined) return undefined;
  return parseCampaignStatus(status);
}

function parseCampaignStatus(status: string): CampaignStatus {
  if (
    status === "active" ||
    status === "paused" ||
    status === "completed" ||
    status === "blocked" ||
    status === "superseded"
  ) {
    return status;
  }
  throw new Error("Campaign status must be one of: active, paused, completed, blocked, superseded");
}

function branchStatus(parsed: ParsedArgs): BranchStatus | undefined {
  const status = getString(parsed, "status");
  if (status === undefined) return undefined;
  return parseBranchStatus(status);
}

function parseBranchStatus(status: string): BranchStatus {
  if (status === "open" || status === "testing" || status === "killed" || status === "promoted" || status === "blocked") {
    return status;
  }
  throw new Error("Branch status must be one of: open, testing, killed, promoted, blocked");
}

function chimeraAccessMode(parsed: ParsedArgs): ChimeraAccessMode {
  const access = getString(parsed, "access") ?? "explorer";
  if (access === "explorer" || access === "editor") return access;
  throw new Error("Chimera access must be one of: explorer, editor");
}

function chimeraMessageKind(parsed: ParsedArgs, key: string, fallback: ChimeraMessageKind): ChimeraMessageKind {
  const kind = getString(parsed, key) ?? fallback;
  if (
    kind === "message" ||
    kind === "redirect" ||
    kind === "finding" ||
    kind === "blocker" ||
    kind === "snapshot" ||
    kind === "heartbeat" ||
    kind === "council" ||
    kind === "kill" ||
    kind === "close" ||
    kind === "error"
  ) {
    return kind;
  }
  throw new Error("Chimera message kind must be one of: message, redirect, finding, blocker, snapshot, heartbeat, council, kill, close, error");
}

function isHelpRequested(parsed: ParsedArgs): boolean {
  return (
    parsed.flags.help === true ||
    parsed.flags.h === true ||
    parsed.command.includes("--help") ||
    parsed.command.includes("-h")
  );
}

function printCommandHelp(command: string | undefined): void {
  if (command === "plan-round") {
    console.log(`Proteus plan-round

Usage:
  proteus plan-round [--root <path>] [--objective <text>] [--context <text>] [--plan-json <path>] [--status active|paused|completed|blocked|planned|superseded] [--write]

Records a coordinator-authored round plan as an operational research goal.
It never chooses targets or generates strategic understanding by itself.

Options:
  --root <path>       Target workspace root.
  --objective <text>  Round objective.
  --context <text>    Coordinator-written current understanding for simple scaffolds.
  --plan-json <path>  JSON plan written by the coordinator.
  --status <status>   active, paused, completed, blocked, planned, or superseded. Defaults to active.
  --write             Write a Markdown view under .vros/exports/.
`);
    return;
  }
  printHelp();
}

function printHelp(): void {
  console.log(`Proteus CLI

Usage:
  proteus init [--root <path>] [--name <target>]
  proteus status [--root <path>]
  proteus migrate [--root <path>]
  proteus merge --root <dest-root> --source <source-root|.vros|memory.sqlite> [--sources a,b] [--dry-run]
  proteus ingest [--root <path>] [paths...]
  proteus observe [--root <path>]
  proteus plan-round [--root <path>] [--objective <text>] [--context <text>] [--plan-json <path>] [--status active|paused|completed|blocked|planned|superseded] [--write]
  proteus campaign create --title <text> [--objective <text>] [--status active|paused|completed|blocked|superseded]
  proteus campaign resume [--id <id>]
  proteus campaign checkpoint --id <id> [--confirmed a,b] [--killed a,b] [--open a,b] [--next <text>]
  proteus branch add --title <text> [--campaign-id <id>] [--round-id <id>] [--primitive <text>]
  proteus branch list [--campaign-id <id>] [--status open|testing|killed|promoted|blocked]
  proteus link --from-type <type> --from-id <id> --relation <text> --to-type <type> --to-id <id>
  proteus roles
  proteus prompt --role <argus|loom|chaos|libris|mimic|artificer|skeptic|cicada> --surface <text>
  proteus record surface --name <text> [--family <text>] [--files a,b] [--status active|covered|exhausted|low_roi|blocked|watch]
  proteus record hypothesis --title <text> [--surface-id <id>] [--impact <text>]
  proteus record evidence --title <text> [--kind <kind>] [--body <text>]
  proteus record decision --entity-type <type> --entity-id <id> --decision <text> --reason <text>
  proteus record gate --entity-type <type> --entity-id <id> --gate <G1|...> [--status pending|pass|fail|blocked|not_applicable]
  proteus record agent-output --round-id <id> --role <codename> --surface <text>
  proteus list surfaces|hypotheses|evidence|decisions|gates|rounds|campaigns|branches|links|checkpoints [--status <status>] [--limit <n>]
  proteus update surface --id <id> [--status exhausted|low_roi|covered|blocked|watch] [--revisit <text>]
  proteus update round --id <id> --status active|paused|completed|blocked|planned|superseded
  proteus update rounds --from planned --status superseded [--keep-latest]
  proteus query duplicates <text>
  proteus query memory <text>
  proteus query similar <text>
  proteus query revisit <surface>
  proteus query surfaces <text>
  proteus show <source|surface|hypothesis|evidence|decision|gate|round|campaign|branch|checkpoint|entity_link|agent_output|lab> <id>
  proteus export [--root <path>]
  proteus lab create --candidate-id <id> [--name <name>]
  proteus learn add --title <text> [--category <category>] [--scope <scope>] [--body <text>] [--tags a,b]
  proteus learn query [text] [--scope <scope>] [--category <category>] [--target-scope]
  proteus learn export [--out <path>]
`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
