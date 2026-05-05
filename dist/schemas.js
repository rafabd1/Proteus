"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decisionInputSchema = exports.evidenceInputSchema = exports.hypothesisInputSchema = exports.surfaceInputSchema = exports.roiFactorsSchema = exports.targetContractSchema = exports.agentCodenameSchema = void 0;
const zod_1 = require("zod");
exports.agentCodenameSchema = zod_1.z.enum([
    "argus",
    "loom",
    "chaos",
    "libris",
    "mimic",
    "artificer",
    "skeptic"
]);
exports.targetContractSchema = zod_1.z.object({
    target: zod_1.z.string().min(1),
    scopeRoot: zod_1.z.string().min(1),
    inScope: zod_1.z.array(zod_1.z.string()).default([]),
    outOfScope: zod_1.z.array(zod_1.z.string()).default([]),
    existingWork: zod_1.z.array(zod_1.z.string()).default([]),
    primaryImpactClasses: zod_1.z.array(zod_1.z.string()).default([]),
    hardExclusions: zod_1.z.array(zod_1.z.string()).default([]),
    assumptions: zod_1.z.array(zod_1.z.string()).default([]),
    availableTooling: zod_1.z.array(zod_1.z.string()).default([]),
    credentialsAvailable: zod_1.z.string().default("unknown"),
    continuousMode: zod_1.z.boolean().default(false),
    stopOnCandidate: zod_1.z.boolean().default(true)
});
exports.roiFactorsSchema = zod_1.z.object({
    impactPotential: zod_1.z.number().min(0).max(10),
    externalReachability: zod_1.z.number().min(0).max(10),
    trustBoundaryDensity: zod_1.z.number().min(0).max(10),
    recentChangeWeight: zod_1.z.number().min(0).max(10),
    unexploredInvariantWeight: zod_1.z.number().min(0).max(10),
    toolingReadiness: zod_1.z.number().min(0).max(10),
    duplicateRisk: zod_1.z.number().min(0).max(10),
    expectedBehaviorLikelihood: zod_1.z.number().min(0).max(10),
    priorExhaustionWeight: zod_1.z.number().min(0).max(10),
    validationCost: zod_1.z.number().min(0).max(10),
    lowSignalHistory: zod_1.z.number().min(0).max(10)
});
exports.surfaceInputSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    family: zod_1.z.string().min(1),
    description: zod_1.z.string().default(""),
    files: zod_1.z.array(zod_1.z.string()).default([]),
    symbols: zod_1.z.array(zod_1.z.string()).default([]),
    entrypoints: zod_1.z.array(zod_1.z.string()).default([]),
    trustBoundaries: zod_1.z.array(zod_1.z.string()).default([]),
    runtimeModes: zod_1.z.array(zod_1.z.string()).default([]),
    status: zod_1.z
        .enum(["unmapped", "active", "covered", "exhausted", "low_roi", "blocked", "watch"])
        .default("unmapped"),
    roi: exports.roiFactorsSchema,
    revisitCondition: zod_1.z.string().default("")
});
exports.hypothesisInputSchema = zod_1.z.object({
    surfaceId: zod_1.z.number().int().positive().optional(),
    title: zod_1.z.string().min(1),
    primitive: zod_1.z.string().default("unknown"),
    attackerBoundary: zod_1.z.string().default("unknown"),
    impactClaim: zod_1.z.string().default("unknown"),
    heuristicFamily: zod_1.z.string().default("unknown"),
    status: zod_1.z
        .enum(["live", "candidate", "watchlist", "discarded", "promoted_to_poc", "report_grade"])
        .default("live"),
    score: zod_1.z.number().min(0).max(100).default(0),
    duplicateRisk: zod_1.z.number().min(0).max(10).default(5),
    expectedBehaviorRisk: zod_1.z.number().min(0).max(10).default(5),
    validationCost: zod_1.z.number().min(0).max(10).default(5),
    killCriteria: zod_1.z.string().default(""),
    revisitCondition: zod_1.z.string().default("")
});
exports.evidenceInputSchema = zod_1.z.object({
    kind: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().default(""),
    pathOrUrl: zod_1.z.string().optional(),
    command: zod_1.z.string().optional()
});
exports.decisionInputSchema = zod_1.z.object({
    entityType: zod_1.z.string().min(1),
    entityId: zod_1.z.number().int().nonnegative(),
    decision: zod_1.z.string().min(1),
    reason: zod_1.z.string().min(1),
    evidenceIds: zod_1.z.array(zod_1.z.number().int().positive()).default([]),
    actor: zod_1.z.string().default("coordinator")
});
