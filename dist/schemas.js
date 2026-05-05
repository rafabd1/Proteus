"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decisionInputSchema = exports.evidenceInputSchema = exports.hypothesisInputSchema = exports.surfaceInputSchema = exports.targetContractSchema = void 0;
exports.targetContractSchema = {
    parse(input) {
        const value = object(input, "target contract");
        return {
            target: requiredString(value.target, "target"),
            scopeRoot: requiredString(value.scopeRoot, "scopeRoot"),
            inScope: stringArray(value.inScope),
            outOfScope: stringArray(value.outOfScope),
            existingWork: stringArray(value.existingWork),
            primaryImpactClasses: stringArray(value.primaryImpactClasses),
            hardExclusions: stringArray(value.hardExclusions),
            assumptions: stringArray(value.assumptions),
            availableTooling: stringArray(value.availableTooling),
            credentialsAvailable: optionalString(value.credentialsAvailable, "unknown"),
            continuousMode: optionalBoolean(value.continuousMode, false),
            stopOnCandidate: optionalBoolean(value.stopOnCandidate, true)
        };
    }
};
exports.surfaceInputSchema = {
    parse(input) {
        const value = object(input, "surface");
        return {
            name: requiredString(value.name, "name"),
            family: requiredString(value.family, "family"),
            description: optionalString(value.description, ""),
            files: stringArray(value.files),
            symbols: stringArray(value.symbols),
            entrypoints: stringArray(value.entrypoints),
            trustBoundaries: stringArray(value.trustBoundaries),
            runtimeModes: stringArray(value.runtimeModes),
            status: enumValue(value.status, ["unmapped", "active", "covered", "exhausted", "low_roi", "blocked", "watch"], "unmapped"),
            roi: parseRoi(value.roi),
            revisitCondition: optionalString(value.revisitCondition, "")
        };
    }
};
exports.hypothesisInputSchema = {
    parse(input) {
        const value = object(input, "hypothesis");
        const surfaceId = optionalNumber(value.surfaceId);
        return {
            ...(surfaceId === undefined ? {} : { surfaceId }),
            title: requiredString(value.title, "title"),
            primitive: optionalString(value.primitive, "unknown"),
            attackerBoundary: optionalString(value.attackerBoundary, "unknown"),
            impactClaim: optionalString(value.impactClaim, "unknown"),
            heuristicFamily: optionalString(value.heuristicFamily, "unknown"),
            status: enumValue(value.status, ["live", "candidate", "watchlist", "discarded", "promoted_to_poc", "report_grade"], "live"),
            score: clampNumber(value.score, 0, 100, 0),
            duplicateRisk: clampNumber(value.duplicateRisk, 0, 10, 5),
            expectedBehaviorRisk: clampNumber(value.expectedBehaviorRisk, 0, 10, 5),
            validationCost: clampNumber(value.validationCost, 0, 10, 5),
            killCriteria: optionalString(value.killCriteria, ""),
            revisitCondition: optionalString(value.revisitCondition, "")
        };
    }
};
exports.evidenceInputSchema = {
    parse(input) {
        const value = object(input, "evidence");
        return {
            kind: requiredString(value.kind, "kind"),
            title: requiredString(value.title, "title"),
            body: optionalString(value.body, ""),
            pathOrUrl: optionalMaybeString(value.pathOrUrl),
            command: optionalMaybeString(value.command)
        };
    }
};
exports.decisionInputSchema = {
    parse(input) {
        const value = object(input, "decision");
        return {
            entityType: requiredString(value.entityType, "entityType"),
            entityId: requiredNumber(value.entityId, "entityId"),
            decision: requiredString(value.decision, "decision"),
            reason: requiredString(value.reason, "reason"),
            evidenceIds: numberArray(value.evidenceIds),
            actor: optionalString(value.actor, "coordinator")
        };
    }
};
function parseRoi(input) {
    const value = object(input, "roi");
    return {
        impactPotential: clampNumber(value.impactPotential, 0, 10, 0),
        externalReachability: clampNumber(value.externalReachability, 0, 10, 0),
        trustBoundaryDensity: clampNumber(value.trustBoundaryDensity, 0, 10, 0),
        recentChangeWeight: clampNumber(value.recentChangeWeight, 0, 10, 0),
        unexploredInvariantWeight: clampNumber(value.unexploredInvariantWeight, 0, 10, 0),
        toolingReadiness: clampNumber(value.toolingReadiness, 0, 10, 0),
        duplicateRisk: clampNumber(value.duplicateRisk, 0, 10, 0),
        expectedBehaviorLikelihood: clampNumber(value.expectedBehaviorLikelihood, 0, 10, 0),
        priorExhaustionWeight: clampNumber(value.priorExhaustionWeight, 0, 10, 0),
        validationCost: clampNumber(value.validationCost, 0, 10, 0),
        lowSignalHistory: clampNumber(value.lowSignalHistory, 0, 10, 0)
    };
}
function object(input, name) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`Invalid ${name}: expected object`);
    }
    return input;
}
function requiredString(input, name) {
    if (typeof input !== "string" || input.length === 0)
        throw new Error(`Missing ${name}`);
    return input;
}
function optionalString(input, fallback) {
    return typeof input === "string" ? input : fallback;
}
function optionalMaybeString(input) {
    return typeof input === "string" ? input : undefined;
}
function optionalBoolean(input, fallback) {
    return typeof input === "boolean" ? input : fallback;
}
function requiredNumber(input, name) {
    if (typeof input !== "number" || !Number.isFinite(input))
        throw new Error(`Missing numeric ${name}`);
    return input;
}
function optionalNumber(input) {
    return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}
function clampNumber(input, min, max, fallback) {
    const value = optionalNumber(input) ?? fallback;
    return Math.max(min, Math.min(max, value));
}
function stringArray(input) {
    return Array.isArray(input) ? input.filter((item) => typeof item === "string") : [];
}
function numberArray(input) {
    return Array.isArray(input) ? input.filter((item) => typeof item === "number" && Number.isFinite(item)) : [];
}
function enumValue(input, allowed, fallback) {
    return typeof input === "string" && allowed.includes(input) ? input : fallback;
}
