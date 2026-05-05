"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureInitialSurfaces = ensureInitialSurfaces;
exports.planRound = planRound;
exports.renderRoundPlan = renderRoundPlan;
exports.surfaceFamilyForPath = surfaceFamilyForPath;
const node_path_1 = __importDefault(require("node:path"));
const global_memory_1 = require("./global-memory");
const observe_1 = require("./observe");
const roles_1 = require("./roles");
const SURFACE_FAMILIES = [
    {
        name: "Request lifecycle and routing identity",
        family: "request-lifecycle-routing-identity",
        description: "Entrypoints, route matching, request metadata, method dispatch, middleware handoff, and route identity.",
        patterns: [/route/i, /router/i, /middleware/i, /request/i, /handler/i, /controller/i, /server/i],
        trustBoundaries: ["external request", "routing identity", "middleware handoff"],
        roles: ["argus", "loom", "chaos"],
        base: { impactPotential: 8, externalReachability: 8, trustBoundaryDensity: 8 }
    },
    {
        name: "Auth, authorization, and session boundary",
        family: "auth-authz-session",
        description: "Authentication state, authorization decisions, session transport, roles, tenants, and identity binding.",
        patterns: [/auth/i, /session/i, /token/i, /permission/i, /policy/i, /tenant/i, /role/i, /acl/i],
        trustBoundaries: ["identity", "authority", "tenant/user boundary"],
        roles: ["argus", "loom", "libris", "skeptic"],
        base: { impactPotential: 10, externalReachability: 8, trustBoundaryDensity: 10 }
    },
    {
        name: "Cache and state authority",
        family: "cache-state-authority",
        description: "Cache keys, state stores, revalidation, persistence, replayed state, and stale authority.",
        patterns: [/cache/i, /state/i, /store/i, /revalid/i, /persist/i, /memo/i, /redis/i],
        trustBoundaries: ["state authority", "cache key", "tenant/user/request isolation"],
        roles: ["loom", "argus", "mimic"],
        base: { impactPotential: 9, externalReachability: 7, trustBoundaryDensity: 9 }
    },
    {
        name: "Parser, serializer, and canonicalization boundary",
        family: "parser-serializer-canonicalization",
        description: "Input parsers, deserializers, encoders, normalization, escaping, content-type and format compatibility.",
        patterns: [/parse/i, /serial/i, /decode/i, /encode/i, /normalize/i, /escape/i, /content-type/i, /schema/i],
        trustBoundaries: ["input format", "canonical representation", "validation/use split"],
        roles: ["chaos", "argus", "libris"],
        base: { impactPotential: 7, externalReachability: 7, trustBoundaryDensity: 8 }
    },
    {
        name: "URL, path, host, and origin normalization",
        family: "url-path-host-origin",
        description: "URL parsing, path joining, host/origin allowlists, redirects, fetch/proxy targets, and namespace boundaries.",
        patterns: [/url/i, /uri/i, /path/i, /origin/i, /host/i, /redirect/i, /proxy/i, /fetch/i],
        trustBoundaries: ["origin", "host", "filesystem/object namespace", "outbound request"],
        roles: ["argus", "chaos", "skeptic"],
        base: { impactPotential: 8, externalReachability: 8, trustBoundaryDensity: 8 }
    },
    {
        name: "Runtime, adapter, and environment divergence",
        family: "runtime-adapter-environment-divergence",
        description: "Differences between supported runtimes, adapters, build modes, generated output, Docker/WSL/native, and deployment profiles.",
        patterns: [/adapter/i, /runtime/i, /edge/i, /serverless/i, /build/i, /webpack/i, /turbo/i, /docker/i, /env/i],
        trustBoundaries: ["runtime mode", "adapter contract", "build/runtime handoff"],
        roles: ["mimic", "loom", "libris"],
        base: { impactPotential: 8, externalReachability: 6, trustBoundaryDensity: 8 }
    },
    {
        name: "Callback, webhook, retry, and replay",
        family: "callback-webhook-retry-replay",
        description: "Inbound callbacks, webhook verification, retry semantics, idempotency, nonce/timestamp handling, and replayed authority.",
        patterns: [/webhook/i, /callback/i, /retry/i, /replay/i, /nonce/i, /timestamp/i, /signature/i, /idempot/i],
        trustBoundaries: ["external callback", "signature freshness", "idempotency/replay"],
        roles: ["argus", "loom", "libris", "skeptic"],
        base: { impactPotential: 9, externalReachability: 8, trustBoundaryDensity: 9 }
    },
    {
        name: "Plugin, tool, sandbox, and execution boundary",
        family: "plugin-tool-sandbox-execution",
        description: "Plugin systems, tool execution, sandboxing, command/process boundaries, templates, and code generation.",
        patterns: [/plugin/i, /tool/i, /sandbox/i, /exec/i, /spawn/i, /template/i, /eval/i, /vm/i],
        trustBoundaries: ["tool input", "process execution", "sandbox escape"],
        roles: ["argus", "loom", "skeptic"],
        base: { impactPotential: 10, externalReachability: 6, trustBoundaryDensity: 9 }
    }
];
function ensureInitialSurfaces(db) {
    if (db.listSurfaces().length > 0)
        return 0;
    const files = (0, observe_1.discoverFiles)(db.targetRoot);
    let created = 0;
    for (const family of SURFACE_FAMILIES) {
        const matched = files.filter((file) => family.patterns.some((pattern) => pattern.test(file))).slice(0, 80);
        const roi = roiForFamily(family, matched.length);
        const input = {
            name: family.name,
            family: family.family,
            description: family.description,
            files: matched,
            symbols: [],
            entrypoints: matched.filter((file) => /route|handler|controller|server|middleware|main|index/i.test(file)).slice(0, 25),
            trustBoundaries: family.trustBoundaries,
            runtimeModes: [],
            status: matched.length > 0 ? "active" : "unmapped",
            roi,
            revisitCondition: "Reopen only on new code, new runtime mode, new chain dependency, invalidated kill reason, or explicit user override."
        };
        db.addSurface(input);
        created += 1;
    }
    return created;
}
function planRound(db, objective) {
    ensureInitialSurfaces(db);
    const surfaces = db.listSurfaces();
    const selected = surfaces
        .filter((surface) => !["exhausted", "low_roi", "blocked"].includes(surface.status))
        .slice(0, 4)
        .map((surface) => ({
        id: surface.id,
        name: surface.name,
        family: surface.family,
        roiScore: surface.roiScore,
        reason: selectionReason(surface.roiScore, surface.files.length, surface.status),
        files: surface.files.slice(0, 20),
        revisitCondition: surface.revisitCondition
    }));
    const selectedIds = new Set(selected.map((surface) => surface.id));
    const skipped = surfaces
        .filter((surface) => !selectedIds.has(surface.id))
        .slice(0, 12)
        .map((surface) => ({
        id: surface.id,
        name: surface.name,
        family: surface.family,
        roiScore: surface.roiScore,
        reason: skipReason(surface.status, surface.roiScore),
        files: surface.files.slice(0, 10),
        revisitCondition: surface.revisitCondition
    }));
    const agentFronts = buildAgentFronts(selected);
    const globalLearnings = loadGlobalLearnings(db, objective);
    const plan = {
        objective,
        currentUnderstanding: globalLearnings.length > 0
            ? "Initial round plan derived from target profile, attack-surface families, prior memory state, global learnings, and anti-revisit rules."
            : "Initial round plan derived from target profile, attack-surface families, prior memory state, and anti-revisit rules.",
        selectedSurfaces: selected,
        skippedSurfaces: skipped,
        agentFronts,
        validationGates: [
            "G1 root cause in target",
            "G2 realistic external attacker input",
            "G3 concrete security impact",
            "G4 documented/default/correct-practice configuration",
            "G5 negative controls pass",
            "G6 local dedupe clear",
            "G7 public-known and expected-behavior checks complete",
            "G8 affected version and timeline understood",
            "G9 old/obvious classes have exceptional impact or are killed",
            "G10 PoC does not depend on artificial lab help"
        ],
        stopConditions: [
            "report-grade candidate needs user decision",
            "selected surfaces are exhausted under assigned heuristics",
            "external blocker requires credentials or infrastructure",
            "all surviving hypotheses fail validation gates"
        ],
        replanTrigger: "After every agent front returns, integrate killed paths and evidence, update ROI, and select the next highest marginal-value surfaces.",
        globalLearnings
    };
    db.addRound({
        objective: plan.objective,
        currentUnderstanding: plan.currentUnderstanding,
        selectedSurfaces: plan.selectedSurfaces,
        skippedSurfaces: plan.skippedSurfaces,
        agentFronts: plan.agentFronts,
        validationGates: plan.validationGates,
        stopConditions: plan.stopConditions
    });
    return plan;
}
function renderRoundPlan(plan) {
    const selected = plan.selectedSurfaces
        .map((surface) => `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.roiScore.toFixed(1)} | ${surface.reason} |`)
        .join("\n");
    const skipped = plan.skippedSurfaces
        .map((surface) => `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.roiScore.toFixed(1)} | ${surface.reason} |`)
        .join("\n");
    const fronts = plan.agentFronts
        .map((front) => `### ${front.displayName}\n\nFamily: ${front.family}\n\nAssigned surfaces: ${front.assignedSurfaceIds.join(", ")}\n\nPurpose: ${front.purpose}\n\nRequired output:\n${front.requiredOutput.map((item) => `- ${item}`).join("\n")}`)
        .join("\n\n");
    const learnings = plan.globalLearnings
        .map((learning) => `| G${learning.id} | ${learning.category} | ${learning.title} | ${learning.scope} |`)
        .join("\n");
    return `# Proteus Round Plan\n\nObjective: ${plan.objective}\n\n## Current Understanding\n\n${plan.currentUnderstanding}\n\n## Global Learnings\n\n| ID | Category | Title | Scope |\n| --- | --- | --- | --- |\n${learnings || "| - | - | - | - |"}\n\n## Selected Surfaces\n\n| ID | Surface | Family | ROI | Reason |\n| --- | --- | --- | ---: | --- |\n${selected || "| - | - | - | - | - |"}\n\n## Skipped Surfaces\n\n| ID | Surface | Family | ROI | Reason |\n| --- | --- | --- | ---: | --- |\n${skipped || "| - | - | - | - | - |"}\n\n## Agent Fronts\n\n${fronts}\n\n## Validation Gates\n\n${plan.validationGates.map((gate) => `- ${gate}`).join("\n")}\n\n## Stop Conditions\n\n${plan.stopConditions.map((condition) => `- ${condition}`).join("\n")}\n\n## Replan Trigger\n\n${plan.replanTrigger}\n`;
}
function loadGlobalLearnings(db, objective) {
    const target = db.getTarget();
    const scope = target ? (0, global_memory_1.defaultGlobalScopeFromTarget)(target) : undefined;
    const globalDb = new global_memory_1.GlobalMemoryDb();
    try {
        return globalDb
            .queryLearnings({ text: [objective, scope].filter(Boolean).join(" "), limit: 5 })
            .map((learning) => ({
            id: learning.id,
            category: learning.category,
            title: learning.title,
            scope: learning.scope
        }));
    }
    finally {
        globalDb.close();
    }
}
function buildAgentFronts(selected) {
    const fronts = new Map();
    for (const surface of selected) {
        const family = SURFACE_FAMILIES.find((item) => item.family === surface.family);
        for (const role of family?.roles ?? ["argus"]) {
            if (!fronts.has(role))
                fronts.set(role, new Set());
            fronts.get(role)?.add(surface.id);
        }
    }
    return [...fronts.entries()].map(([codename, ids]) => ({
        codename,
        displayName: roles_1.ROLES[codename].displayName,
        family: roles_1.ROLES[codename].family,
        assignedSurfaceIds: [...ids],
        purpose: roles_1.ROLES[codename].purpose,
        requiredOutput: roles_1.ROLES[codename].requiredOutput
    }));
}
function roiForFamily(family, matchCount) {
    const density = Math.min(10, Math.ceil(matchCount / 5));
    const readiness = matchCount > 0 ? 7 : 3;
    return {
        impactPotential: family.base.impactPotential ?? 7,
        externalReachability: family.base.externalReachability ?? 6,
        trustBoundaryDensity: Math.max(family.base.trustBoundaryDensity ?? 6, density),
        recentChangeWeight: 4,
        unexploredInvariantWeight: 8,
        toolingReadiness: readiness,
        duplicateRisk: 2,
        expectedBehaviorLikelihood: 3,
        priorExhaustionWeight: 0,
        validationCost: matchCount > 80 ? 7 : 5,
        lowSignalHistory: 0
    };
}
function selectionReason(roiScore, fileCount, status) {
    return `Selected because status=${status}, ROI=${roiScore.toFixed(1)}, and ${fileCount} matching files suggest enough surface for a bounded offensive pass.`;
}
function skipReason(status, roiScore) {
    if (["exhausted", "low_roi", "blocked"].includes(status)) {
        return `Skipped by anti-revisit guard because status=${status}.`;
    }
    return `Skipped this round because ROI=${roiScore.toFixed(1)} was below selected surfaces.`;
}
function surfaceFamilyForPath(filePath) {
    const normalized = filePath.split(node_path_1.default.sep).join("/");
    return SURFACE_FAMILIES.find((family) => family.patterns.some((pattern) => pattern.test(normalized)))?.family ?? "general";
}
