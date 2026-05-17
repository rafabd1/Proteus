#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("./db");
const exporter_1 = require("./exporter");
const ingest_1 = require("./ingest");
const lab_1 = require("./lab");
const global_memory_1 = require("./global-memory");
const observe_1 = require("./observe");
const planner_1 = require("./planner");
const prompts_1 = require("./prompts");
const roles_1 = require("./roles");
const paths_1 = require("./paths");
function main() {
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
    const targetRoot = (0, paths_1.resolveTargetRoot)(getString(parsed, "root") ?? process.cwd());
    const db = new db_1.ProteusDb(targetRoot);
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
    }
    finally {
        db.close();
    }
}
function printVersion() {
    const packagePath = node_path_1.default.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(node_fs_1.default.readFileSync(packagePath, "utf8"));
    console.log(`${pkg.name} ${pkg.version}`);
}
function cmdInit(db, parsed) {
    const name = getString(parsed, "name");
    const contract = (0, db_1.createDefaultContract)(db.targetRoot, name);
    db.initTarget(contract);
    (0, paths_1.ensureDir)((0, paths_1.exportsDir)(db.targetRoot));
    console.log(`Initialized Proteus target: ${contract.target}`);
    console.log(`Memory: ${node_path_1.default.join(db.targetRoot, ".vros", "memory.sqlite")}`);
}
function cmdStatus(db) {
    const target = db.getTarget();
    if (!target) {
        console.log("Target not initialized.");
        return;
    }
    const stats = db.memoryStats();
    console.log(`Target: ${target.name}`);
    console.log(`Root: ${target.rootPath}`);
    console.log(`Memory: ${stats.dbPath} (${stats.dbSizeBytes} bytes)`);
    console.log(`Sources: ${stats.sources}${stats.sourcesByKind.length > 0 ? ` (${stats.sourcesByKind.map((row) => `${row.kind}=${row.count}`).join(", ")})` : ""}`);
    console.log(`Surfaces: ${stats.surfaces}`);
    console.log(`Hypotheses: ${stats.hypotheses}`);
    console.log(`Evidence: ${stats.evidence}`);
    console.log(`Decisions: ${stats.decisions}`);
    console.log(`Gates: ${stats.gates}`);
    console.log(`Rounds: ${stats.rounds}`);
    if (stats.activeRounds.length > 0) {
        console.log(`Active rounds: ${stats.activeRounds.map((round) => `R${round.id} ${round.objective}`).join(" | ")}`);
    }
    else {
        console.log("Active rounds: none");
    }
    console.log(`Agent outputs: ${stats.agentOutputs}`);
    console.log(`Labs: ${stats.labs}`);
    console.log(`Profiles: ${stats.profiles}`);
    if (stats.latestSource) {
        console.log(`Latest source: source#${stats.latestSource.id} [${stats.latestSource.kind}] ${stats.latestSource.pathOrUrl}`);
    }
    if (stats.latestDecision) {
        console.log(`Latest decision: decision#${stats.latestDecision.id} ${stats.latestDecision.decision} ${stats.latestDecision.entityType}#${stats.latestDecision.entityId}`);
    }
}
function cmdIngest(db, inputs) {
    requireInitialized(db);
    const result = (0, ingest_1.ingestPaths)(db, inputs);
    console.log(`Ingest scanned=${result.scanned} indexed=${result.indexed} unchanged=${result.unchanged} skipped=${result.skipped}`);
}
function cmdObserve(db) {
    requireInitialized(db);
    const profile = (0, observe_1.observeTarget)(db);
    console.log(JSON.stringify(profile, null, 2));
}
function cmdPlanRound(db, parsed) {
    requireInitialized(db);
    const objective = getString(parsed, "objective") ??
        "Identify high-ROI, non-obvious vulnerability hypotheses with realistic exploitability.";
    const planInputPath = getString(parsed, "plan-json");
    const planInput = planInputPath
        ? { objective, status: roundStatus(parsed), coordinatorPlan: readPlanInput(planInputPath) }
        : {
            objective,
            status: roundStatus(parsed),
            currentUnderstanding: getString(parsed, "context")
        };
    const plan = (0, planner_1.planRound)(db, planInput);
    const markdown = (0, planner_1.renderRoundPlan)(plan);
    if (getBoolean(parsed, "write")) {
        const out = node_path_1.default.join((0, paths_1.exportsDir)(db.targetRoot), `round-plan-${plan.id}.md`);
        (0, paths_1.ensureDir)(node_path_1.default.dirname(out));
        node_fs_1.default.writeFileSync(out, markdown);
        console.log(`Wrote ${out}`);
    }
    else {
        console.log(markdown);
    }
}
function readPlanInput(filePath) {
    const fullPath = node_path_1.default.resolve(filePath);
    return JSON.parse(node_fs_1.default.readFileSync(fullPath, "utf8"));
}
function cmdRoles() {
    for (const codename of roles_1.ROLE_ORDER) {
        const role = roles_1.ROLES[codename];
        console.log(`${role.displayName} (${role.family})`);
        console.log(`  ${role.purpose}`);
    }
}
function cmdPrompt(db, parsed) {
    const codename = getString(parsed, "role");
    if (!codename || !(codename in roles_1.ROLES)) {
        throw new Error(`Use --role with one of: ${roles_1.ROLE_ORDER.join(", ")}`);
    }
    const target = db.getTarget();
    const prompt = (0, prompts_1.renderAgentPrompt)({
        codename,
        workspace: db.targetRoot,
        target: target?.name ?? node_path_1.default.basename(db.targetRoot),
        surface: getString(parsed, "surface") ?? "No surface provided. Coordinator must assign a bounded surface.",
        avoid: splitList(getString(parsed, "avoid") ?? ""),
        objective: getString(parsed, "objective") ?? "Run a bounded Proteus research front."
    });
    console.log(prompt);
}
function cmdRecord(db, subcommand, parsed) {
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
            status: (getString(parsed, "status") ?? "active"),
            roi: roiFromFlags(parsed),
            revisitCondition: getString(parsed, "revisit") ?? ""
        });
        console.log(`Recorded surface S${id}`);
        return;
    }
    if (subcommand === "hypothesis") {
        const input = {
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
    if (subcommand === "gate") {
        const id = db.addValidationGate({
            entityType: requiredString(parsed, "entity-type"),
            entityId: requiredNumber(parsed, "entity-id"),
            gate: requiredString(parsed, "gate"),
            status: (getString(parsed, "status") ?? "pending"),
            summary: getString(parsed, "summary") ?? "",
            evidenceIds: splitList(getString(parsed, "evidence-ids") ?? "").map((item) => Number(item)).filter(Boolean),
            actor: getString(parsed, "actor") ?? "coordinator"
        });
        console.log(`Recorded gate G${id}`);
        return;
    }
    if (subcommand === "agent-output") {
        const role = requiredString(parsed, "role");
        if (!(role in roles_1.ROLES))
            throw new Error(`Unknown role: ${role}`);
        const id = db.addAgentOutput({
            roundId: requiredNumber(parsed, "round-id"),
            codename: role,
            roleFamily: roles_1.ROLES[role].family,
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
    throw new Error("record requires one of: surface, hypothesis, evidence, decision, gate, agent-output");
}
function cmdList(db, subcommand, parsed) {
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
            if (row.description)
                console.log(`  ${row.description}`);
        }
        if (rows.length === 0)
            console.log("No surfaces recorded.");
        return;
    }
    if (subcommand === "hypotheses") {
        const status = getString(parsed, "status");
        const rows = db.listHypotheses().filter((row) => !status || row.status === status).slice(0, limit);
        for (const row of rows) {
            console.log(`H${row.id} [${row.status}] score=${row.score.toFixed(1)} surface=${row.surfaceId ?? "-"} ${row.title}`);
            console.log(`  primitive=${row.primitive} impact=${row.impactClaim}`);
        }
        if (rows.length === 0)
            console.log("No hypotheses recorded.");
        return;
    }
    if (subcommand === "evidence") {
        const rows = db.listEvidence().slice(0, limit);
        for (const row of rows) {
            console.log(`E${row.id} [${row.kind}] ${row.title}`);
            console.log(`  ${truncateForCli(row.body || row.pathOrUrl || row.command || "-", 180)}`);
        }
        if (rows.length === 0)
            console.log("No evidence recorded.");
        return;
    }
    if (subcommand === "decisions") {
        const rows = db.listDecisions().slice(0, limit);
        for (const row of rows) {
            console.log(`D${row.id} ${row.decision} ${row.entityType}#${row.entityId} by=${row.actor}`);
            console.log(`  evidence=${row.evidenceIds.join(",") || "-"} reason=${truncateForCli(row.reason, 180)}`);
        }
        if (rows.length === 0)
            console.log("No decisions recorded.");
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
        if (rows.length === 0)
            console.log("No validation gates recorded.");
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
        if (rows.length === 0)
            console.log("No rounds recorded.");
        return;
    }
    throw new Error("list requires one of: surfaces, hypotheses, evidence, decisions, gates, rounds");
}
function cmdUpdate(db, subcommand, parsed) {
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
    throw new Error("update requires one of: surface, round");
}
function cmdQuery(db, subcommand, parsed) {
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
            if (row.pathOrUrl)
                console.log(`  path=${row.pathOrUrl}`);
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
        for (const row of rows)
            console.log(`${row.entityType}#${row.entityId}: ${row.snippet}`);
        return;
    }
    if (subcommand === "revisit") {
        const text = parsed.command.slice(2).join(" ") || requiredString(parsed, "surface");
        const rows = db
            .listSurfaces()
            .filter((surface) => surface.name.toLowerCase().includes(text.toLowerCase()) ||
            surface.family.toLowerCase().includes(text.toLowerCase()));
        for (const surface of rows) {
            console.log(`S${surface.id} ${surface.name}: status=${surface.status}, ROI=${surface.roiScore.toFixed(1)}, revisit=${surface.revisitCondition || "-"}`);
        }
        if (rows.length === 0)
            console.log("No matching surfaces found.");
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
        if (rows.length === 0)
            console.log("No matching surfaces found.");
        return;
    }
    throw new Error("query requires one of: duplicates, memory, revisit, surfaces");
}
function cmdShow(db, parsed) {
    requireInitialized(db);
    const entityType = parsed.command[1] ?? requiredString(parsed, "entity-type");
    const entityId = Number(parsed.command[2] ?? requiredString(parsed, "id"));
    if (!Number.isFinite(entityId))
        throw new Error("show requires a numeric id");
    const record = db.getRecord(entityType, entityId);
    if (!record) {
        console.log(`No record found for ${entityType}#${entityId}.`);
        return;
    }
    console.log(JSON.stringify(record, null, 2));
}
function cmdExport(db) {
    requireInitialized(db);
    const files = (0, exporter_1.exportMarkdown)(db);
    for (const file of files)
        console.log(`Wrote ${file}`);
}
function cmdLab(db, subcommand, parsed) {
    requireInitialized(db);
    if (subcommand !== "create")
        throw new Error("lab requires: create");
    const candidateId = requiredNumber(parsed, "candidate-id");
    const labPath = (0, lab_1.createLab)(db, candidateId, getString(parsed, "name"));
    console.log(`Created lab: ${labPath}`);
}
function cmdLearn(db, subcommand, parsed) {
    const globalDb = new global_memory_1.GlobalMemoryDb();
    try {
        if (subcommand === "add") {
            const target = db.getTarget();
            const id = globalDb.addLearning({
                category: (getString(parsed, "category") ?? "research_heuristic"),
                scope: getString(parsed, "scope") ?? (target ? (0, global_memory_1.defaultGlobalScopeFromTarget)(target) : "global"),
                title: requiredString(parsed, "title"),
                body: getString(parsed, "body") ?? "",
                tags: splitList(getString(parsed, "tags") ?? ""),
                sourceTarget: getString(parsed, "source-target") ?? target?.name,
                confidence: getNumber(parsed, "confidence") ?? 0.7
            });
            console.log(`Recorded global learning G${id}`);
            console.log(`Memory: ${(0, global_memory_1.globalMemoryLocation)()}`);
            return;
        }
        if (subcommand === "query") {
            const target = db.getTarget();
            const targetScope = getBoolean(parsed, "target-scope") && target ? (0, global_memory_1.defaultGlobalScopeFromTarget)(target) : "";
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
    }
    finally {
        globalDb.close();
    }
    throw new Error("learn requires one of: add, query, export");
}
function requireInitialized(db) {
    if (!db.getTarget()) {
        throw new Error("Target not initialized. Run `proteus init --name <target>` first.");
    }
}
function parseArgs(args) {
    const command = [];
    const flags = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const [rawKey, rawValue] = arg.slice(2).split("=", 2);
            const key = rawKey.trim();
            if (rawValue !== undefined) {
                flags[key] = rawValue;
            }
            else if (args[i + 1] && !args[i + 1].startsWith("--")) {
                flags[key] = args[i + 1];
                i += 1;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            command.push(arg);
        }
    }
    return { command, flags };
}
function getString(parsed, key) {
    const value = parsed.flags[key];
    return typeof value === "string" ? value : undefined;
}
function requiredString(parsed, key) {
    const value = getString(parsed, key);
    if (!value)
        throw new Error(`Missing --${key}`);
    return value;
}
function getNumber(parsed, key) {
    const value = getString(parsed, key);
    if (value === undefined)
        return undefined;
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new Error(`--${key} must be a number`);
    return number;
}
function requiredNumber(parsed, key) {
    const value = getNumber(parsed, key);
    if (value === undefined)
        throw new Error(`Missing --${key}`);
    return value;
}
function getBoolean(parsed, key) {
    return parsed.flags[key] === true || parsed.flags[key] === "true";
}
function splitList(value) {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function roiFromFlags(parsed) {
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
function truncateForCli(value, limit) {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}
function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
}
function roundStatus(parsed) {
    const status = getString(parsed, "status");
    if (status === undefined)
        return undefined;
    if (status === "active" || status === "paused" || status === "completed" || status === "blocked" || status === "planned")
        return status;
    throw new Error("Round status must be one of: active, paused, completed, blocked, planned");
}
function isHelpRequested(parsed) {
    return (parsed.flags.help === true ||
        parsed.flags.h === true ||
        parsed.command.includes("--help") ||
        parsed.command.includes("-h"));
}
function printCommandHelp(command) {
    if (command === "plan-round") {
        console.log(`Proteus plan-round

Usage:
  proteus plan-round [--root <path>] [--objective <text>] [--context <text>] [--plan-json <path>] [--status active|paused|completed|blocked|planned] [--write]

Records a coordinator-authored round plan as an operational research goal.
It never chooses targets or generates strategic understanding by itself.

Options:
  --root <path>       Target workspace root.
  --objective <text>  Round objective.
  --context <text>    Coordinator-written current understanding for simple scaffolds.
  --plan-json <path>  JSON plan written by the coordinator.
  --status <status>   active, paused, completed, blocked, or planned. Defaults to active.
  --write             Write a Markdown view under .vros/exports/.
`);
        return;
    }
    printHelp();
}
function printHelp() {
    console.log(`Proteus CLI

Usage:
  proteus init [--root <path>] [--name <target>]
  proteus status [--root <path>]
  proteus ingest [--root <path>] [paths...]
  proteus observe [--root <path>]
  proteus plan-round [--root <path>] [--objective <text>] [--context <text>] [--plan-json <path>] [--status active|paused|completed|blocked|planned] [--write]
  proteus roles
  proteus prompt --role <argus|loom|chaos|libris|mimic|artificer|skeptic> --surface <text>
  proteus record surface --name <text> [--family <text>] [--files a,b] [--status active|covered|exhausted|low_roi|blocked|watch]
  proteus record hypothesis --title <text> [--surface-id <id>] [--impact <text>]
  proteus record evidence --title <text> [--kind <kind>] [--body <text>]
  proteus record decision --entity-type <type> --entity-id <id> --decision <text> --reason <text>
  proteus record gate --entity-type <type> --entity-id <id> --gate <G1|...> [--status pending|pass|fail|blocked|not_applicable]
  proteus record agent-output --round-id <id> --role <codename> --surface <text>
  proteus list surfaces|hypotheses|evidence|decisions|gates|rounds [--status <status>] [--limit <n>]
  proteus update surface --id <id> [--status exhausted|low_roi|covered|blocked|watch] [--revisit <text>]
  proteus update round --id <id> --status active|paused|completed|blocked|planned
  proteus query duplicates <text>
  proteus query memory <text>
  proteus query revisit <surface>
  proteus query surfaces <text>
  proteus show <source|surface|hypothesis|evidence|decision|gate|round|agent_output|lab> <id>
  proteus export [--root <path>]
  proteus lab create --candidate-id <id> [--name <name>]
  proteus learn add --title <text> [--category <category>] [--scope <scope>] [--body <text>] [--tags a,b]
  proteus learn query [text] [--scope <scope>] [--category <category>] [--target-scope]
  proteus learn export [--out <path>]
`);
}
try {
    main();
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
