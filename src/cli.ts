#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ProteusDb, createDefaultContract } from "./db";
import { exportMarkdown } from "./exporter";
import { ingestPaths } from "./ingest";
import { createLab } from "./lab";
import { observeTarget } from "./observe";
import { ensureInitialSurfaces, planRound, renderRoundPlan } from "./planner";
import { renderAgentPrompt } from "./prompts";
import { ROLE_ORDER, ROLES } from "./roles";
import { ensureDir, exportsDir, resolveTargetRoot } from "./paths";
import type { AgentCodename, HypothesisInput } from "./types";

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
    printHelp();
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
      case "ingest":
        cmdIngest(db, parsed.command.slice(1));
        break;
      case "observe":
        cmdObserve(db);
        break;
      case "plan-round":
        cmdPlanRound(db, parsed);
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
      case "update":
        cmdUpdate(db, subcommand, parsed);
        break;
      case "query":
        cmdQuery(db, subcommand, parsed);
        break;
      case "export":
        cmdExport(db);
        break;
      case "lab":
        cmdLab(db, subcommand, parsed);
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
  const surfaces = db.listSurfaces();
  const hypotheses = db.listHypotheses();
  const rounds = db.listRounds();
  console.log(`Target: ${target.name}`);
  console.log(`Root: ${target.rootPath}`);
  console.log(`Surfaces: ${surfaces.length}`);
  console.log(`Hypotheses: ${hypotheses.length}`);
  console.log(`Rounds: ${rounds.length}`);
  if (rounds[0]) console.log(`Latest round: ${rounds[0].id} (${rounds[0].outcome})`);
}

function cmdIngest(db: ProteusDb, inputs: string[]): void {
  requireInitialized(db);
  const result = ingestPaths(db, inputs);
  console.log(`Ingest scanned=${result.scanned} indexed=${result.indexed} skipped=${result.skipped}`);
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
  const plan = planRound(db, objective);
  const markdown = renderRoundPlan(plan);
  if (getBoolean(parsed, "write")) {
    const out = path.join(exportsDir(db.targetRoot), `round-plan-${Date.now()}.md`);
    ensureDir(path.dirname(out));
    fs.writeFileSync(out, markdown);
    console.log(`Wrote ${out}`);
  } else {
    console.log(markdown);
  }
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
    console.log(`Recorded decision D${id}`);
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
    console.log(`Recorded agent output A${id}`);
    return;
  }

  throw new Error("record requires one of: hypothesis, evidence, decision, agent-output");
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
  throw new Error("update requires one of: surface");
}

function cmdQuery(db: ProteusDb, subcommand: string | undefined, parsed: ParsedArgs): void {
  requireInitialized(db);
  if (subcommand === "duplicates") {
    const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "text");
    const rows = db.search(text);
    if (rows.length === 0) {
      console.log("No possible duplicates found.");
      return;
    }
    for (const row of rows) {
      console.log(`${row.entityType}#${row.entityId}: ${row.snippet}`);
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

  throw new Error("query requires one of: duplicates, revisit");
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

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp(): void {
  console.log(`Proteus CLI

Usage:
  proteus init [--root <path>] [--name <target>]
  proteus status [--root <path>]
  proteus ingest [--root <path>] [paths...]
  proteus observe [--root <path>]
  proteus plan-round [--root <path>] [--objective <text>] [--write]
  proteus roles
  proteus prompt --role <argus|loom|chaos|libris|mimic|artificer|skeptic> --surface <text>
  proteus record hypothesis --title <text> [--surface-id <id>] [--impact <text>]
  proteus record evidence --title <text> [--kind <kind>] [--body <text>]
  proteus record decision --entity-type <type> --entity-id <id> --decision <text> --reason <text>
  proteus record agent-output --round-id <id> --role <codename> --surface <text>
  proteus update surface --id <id> [--status exhausted|low_roi|covered|blocked|watch] [--revisit <text>]
  proteus query duplicates <text>
  proteus query revisit <surface>
  proteus export [--root <path>]
  proteus lab create --candidate-id <id> [--name <name>]
`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
