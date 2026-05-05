#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_process_1 = __importDefault(require("node:process"));
const db_1 = require("./db");
const ingest_1 = require("./ingest");
const observe_1 = require("./observe");
const planner_1 = require("./planner");
const exporter_1 = require("./exporter");
const lab_1 = require("./lab");
const paths_1 = require("./paths");
const tools = [
    {
        name: "proteus_init",
        title: "Initialize Proteus Memory",
        description: "Initialize .vros/memory.sqlite for a target codebase.",
        inputSchema: schema({ root: stringProp("Target root path."), name: optionalStringProp("Human-readable target name.") }, ["root"]),
        handler: ({ root, name }) => withDb(str(root), (db) => {
            const contract = (0, db_1.createDefaultContract)(db.targetRoot, maybeStr(name));
            db.initTarget(contract);
            return { ok: true, target: contract.target, root: db.targetRoot };
        })
    },
    {
        name: "proteus_status",
        title: "Read Proteus Status",
        description: "Return target, surface, hypothesis, and round counts.",
        inputSchema: schema({ root: stringProp("Target root path.") }, ["root"]),
        handler: ({ root }) => withDb(str(root), (db) => {
            const target = db.getTarget();
            return {
                initialized: Boolean(target),
                target,
                surfaces: db.listSurfaces().length,
                hypotheses: db.listHypotheses().length,
                rounds: db.listRounds().length
            };
        })
    },
    {
        name: "proteus_ingest",
        title: "Ingest Prior Research",
        description: "Index local docs, findings, reports, and notes into Proteus memory.",
        inputSchema: schema({ root: stringProp("Target root path."), paths: arrayProp("Paths relative to root.") }, ["root"]),
        handler: ({ root, paths }) => withDb(str(root), (db) => (0, ingest_1.ingestPaths)(db, stringArray(paths)))
    },
    {
        name: "proteus_observe",
        title: "Observe Target",
        description: "Inspect local target environment and store a profile as evidence.",
        inputSchema: schema({ root: stringProp("Target root path.") }, ["root"]),
        handler: ({ root }) => withDb(str(root), (db) => (0, observe_1.observeTarget)(db))
    },
    {
        name: "proteus_plan_round",
        title: "Plan Research Round",
        description: "Create a high-ROI Proteus research round with selected surfaces and agent fronts.",
        inputSchema: schema({ root: stringProp("Target root path."), objective: stringProp("Round objective."), markdown: booleanProp("Return Markdown instead of JSON.") }, ["root", "objective"]),
        handler: ({ root, objective, markdown }) => withDb(str(root), (db) => {
            const plan = (0, planner_1.planRound)(db, str(objective));
            return markdown === true ? (0, planner_1.renderRoundPlan)(plan) : plan;
        })
    },
    {
        name: "proteus_query_duplicates",
        title: "Query Possible Duplicates",
        description: "Full-text search Proteus memory for duplicate or related prior work.",
        inputSchema: schema({ root: stringProp("Target root path."), text: stringProp("Candidate text, primitive, or impact to search."), limit: numberProp("Max rows.") }, ["root", "text"]),
        handler: ({ root, text, limit }) => withDb(str(root), (db) => db.search(str(text), num(limit, 20)))
    },
    {
        name: "proteus_record_hypothesis",
        title: "Record Hypothesis",
        description: "Record a hypothesis, candidate, watchlist item, or discard into structured memory.",
        inputSchema: schema({
            root: stringProp(),
            title: stringProp(),
            primitive: stringProp(),
            attackerBoundary: stringProp(),
            impactClaim: stringProp(),
            heuristicFamily: stringProp(),
            surfaceId: numberProp(),
            score: numberProp(),
            status: stringProp(),
            killCriteria: stringProp(),
            revisitCondition: stringProp()
        }, ["root", "title"]),
        handler: (input) => withDb(str(input.root), (db) => ({
            ok: true,
            id: db.addHypothesis({
                surfaceId: maybeNum(input.surfaceId),
                title: str(input.title),
                primitive: maybeStr(input.primitive) ?? "unknown",
                attackerBoundary: maybeStr(input.attackerBoundary) ?? "unknown",
                impactClaim: maybeStr(input.impactClaim) ?? "unknown",
                heuristicFamily: maybeStr(input.heuristicFamily) ?? "unknown",
                status: maybeStr(input.status) === undefined ? "live" : maybeStr(input.status),
                score: num(input.score, 0),
                duplicateRisk: 5,
                expectedBehaviorRisk: 5,
                validationCost: 5,
                killCriteria: maybeStr(input.killCriteria) ?? "",
                revisitCondition: maybeStr(input.revisitCondition) ?? ""
            })
        }))
    },
    {
        name: "proteus_record_decision",
        title: "Record Decision",
        description: "Append a coordinator decision with reason and evidence references.",
        inputSchema: schema({
            root: stringProp(),
            entityType: stringProp(),
            entityId: numberProp(),
            decision: stringProp(),
            reason: stringProp(),
            evidenceIds: arrayProp(),
            actor: stringProp()
        }, ["root", "entityType", "entityId", "decision", "reason"]),
        handler: (input) => withDb(str(input.root), (db) => ({
            ok: true,
            id: db.addDecision({
                entityType: str(input.entityType),
                entityId: num(input.entityId, 0),
                decision: str(input.decision),
                reason: str(input.reason),
                evidenceIds: numberArray(input.evidenceIds),
                actor: maybeStr(input.actor) ?? "coordinator"
            })
        }))
    },
    {
        name: "proteus_record_agent_output",
        title: "Record Agent Output",
        description: "Record structured output from a Proteus specialist agent.",
        inputSchema: schema({
            root: stringProp(),
            roundId: numberProp(),
            codename: stringProp(),
            roleFamily: stringProp(),
            assignedSurface: stringProp(),
            outputPath: stringProp(),
            coveredSurface: arrayProp(),
            liveCandidates: arrayProp(),
            killedHypotheses: arrayProp(),
            probes: arrayProp(),
            uncoveredAreas: arrayProp(),
            validationStatus: stringProp()
        }, ["root", "roundId", "codename", "roleFamily", "assignedSurface"]),
        handler: (input) => withDb(str(input.root), (db) => ({
            ok: true,
            id: db.addAgentOutput({
                roundId: num(input.roundId, 0),
                codename: str(input.codename),
                roleFamily: str(input.roleFamily),
                assignedSurface: str(input.assignedSurface),
                outputPath: maybeStr(input.outputPath) ?? "",
                coveredSurface: stringArray(input.coveredSurface),
                liveCandidates: stringArray(input.liveCandidates),
                killedHypotheses: stringArray(input.killedHypotheses),
                probes: stringArray(input.probes),
                uncoveredAreas: stringArray(input.uncoveredAreas),
                validationStatus: maybeStr(input.validationStatus) ?? "unvalidated"
            })
        }))
    },
    {
        name: "proteus_update_surface",
        title: "Update Surface Status",
        description: "Update surface status, exhaustion level, and revisit condition.",
        inputSchema: schema({ root: stringProp(), id: numberProp(), status: stringProp(), revisitCondition: stringProp(), exhaustionLevel: numberProp() }, ["root", "id"]),
        handler: (input) => withDb(str(input.root), (db) => {
            db.updateSurface({
                id: num(input.id, 0),
                status: maybeStr(input.status),
                revisitCondition: maybeStr(input.revisitCondition),
                exhaustionLevel: maybeNum(input.exhaustionLevel)
            });
            return { ok: true, id: input.id };
        })
    },
    {
        name: "proteus_export",
        title: "Export Markdown",
        description: "Export Markdown views from memory.",
        inputSchema: schema({ root: stringProp() }, ["root"]),
        handler: ({ root }) => withDb(str(root), (db) => ({ files: (0, exporter_1.exportMarkdown)(db) }))
    },
    {
        name: "proteus_lab_create",
        title: "Create PoC Lab",
        description: "Create a realistic Artificer lab skeleton for a candidate.",
        inputSchema: schema({ root: stringProp(), candidateId: numberProp(), name: stringProp() }, ["root", "candidateId"]),
        handler: ({ root, candidateId, name }) => withDb(str(root), (db) => ({ path: (0, lab_1.createLab)(db, num(candidateId, 0), maybeStr(name)) }))
    }
];
let buffer = "";
node_process_1.default.stdin.setEncoding("utf8");
node_process_1.default.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
        const index = buffer.indexOf("\n");
        if (index === -1)
            break;
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.trim().length > 0)
            handleLine(line);
    }
});
function handleLine(line) {
    let request;
    try {
        request = JSON.parse(line);
    }
    catch (error) {
        sendError(null, -32700, `Parse error: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (request.id === undefined)
        return;
    try {
        if (request.method === "initialize") {
            sendResult(request.id, {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "proteus", version: "0.1.4" }
            });
            return;
        }
        if (request.method === "tools/list") {
            sendResult(request.id, {
                tools: tools.map((tool) => ({
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                    inputSchema: tool.inputSchema
                }))
            });
            return;
        }
        if (request.method === "tools/call") {
            const params = request.params ?? {};
            const name = str(params.name);
            const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {});
            const tool = tools.find((item) => item.name === name);
            if (!tool)
                throw new Error(`Unknown tool: ${name}`);
            const result = tool.handler(args);
            sendResult(request.id, toToolResult(result));
            return;
        }
        sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
    catch (error) {
        sendError(request.id, -32000, error instanceof Error ? error.message : String(error));
    }
}
function toToolResult(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return { content: [{ type: "text", text }] };
}
function sendResult(id, result) {
    node_process_1.default.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function sendError(id, code, message) {
    node_process_1.default.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}
function withDb(root, fn) {
    const db = new db_1.ProteusDb((0, paths_1.resolveTargetRoot)(root));
    try {
        return fn(db);
    }
    finally {
        db.close();
    }
}
function schema(properties, required = []) {
    return { type: "object", properties, required, additionalProperties: true };
}
function stringProp(description) {
    return { type: "string", ...(description ? { description } : {}) };
}
function optionalStringProp(description) {
    return stringProp(description);
}
function numberProp(description) {
    return { type: "number", ...(description ? { description } : {}) };
}
function booleanProp(description) {
    return { type: "boolean", ...(description ? { description } : {}) };
}
function arrayProp(description) {
    return { type: "array", items: { type: "string" }, ...(description ? { description } : {}) };
}
function str(value) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error("Expected non-empty string");
    return value;
}
function maybeStr(value) {
    return typeof value === "string" ? value : undefined;
}
function num(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function maybeNum(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function numberArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "number" && Number.isFinite(item)) : [];
}
