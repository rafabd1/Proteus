import path from "node:path";
import { ProteusDb } from "./db";
import { discoverFiles } from "./observe";
import { ROLES } from "./roles";
import type { AgentCodename, JsonValue, RoiFactors, SurfaceInput } from "./types";

interface SurfaceFamily {
  name: string;
  family: string;
  description: string;
  patterns: RegExp[];
  trustBoundaries: string[];
  roles: AgentCodename[];
  base: Partial<RoiFactors>;
}

const SURFACE_FAMILIES: SurfaceFamily[] = [
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

export interface RoundPlan {
  objective: string;
  planningMode: "coordinator_supplied" | "scaffold";
  currentUnderstanding: string;
  selectedSurfaces: PlannedSurface[];
  skippedSurfaces: PlannedSurface[];
  agentFronts: AgentFront[];
  validationGates: string[];
  stopConditions: string[];
  replanTrigger: string;
}

export interface PlanRoundInput {
  objective: string;
  coordinatorPlan?: CoordinatorPlanInput;
  currentUnderstanding?: string;
  selectedSurfaces?: CoordinatorSurfaceInput[];
  skippedSurfaces?: CoordinatorSurfaceInput[];
  agentFronts?: CoordinatorAgentFrontInput[];
  stopConditions?: string[];
  replanTrigger?: string;
}

export interface CoordinatorSurfaceInput {
  id?: number;
  name: string;
  family?: string;
  roiScore?: number;
  reason?: string;
  files?: string[];
  revisitCondition?: string;
}

export interface CoordinatorAgentFrontInput {
  codename: AgentCodename;
  assignedSurfaceIds?: number[];
  purpose?: string;
  requiredOutput?: string[];
}

export interface CoordinatorPlanInput {
  currentUnderstanding?: string;
  selectedSurfaces?: CoordinatorSurfaceInput[];
  skippedSurfaces?: CoordinatorSurfaceInput[];
  agentFronts?: CoordinatorAgentFrontInput[];
  stopConditions?: string[];
  replanTrigger?: string;
}

export interface PlannedSurface {
  id: number;
  name: string;
  family: string;
  roiScore: number;
  reason: string;
  files: string[];
  revisitCondition: string;
}

export interface AgentFront {
  codename: AgentCodename;
  displayName: string;
  family: string;
  assignedSurfaceIds: number[];
  purpose: string;
  requiredOutput: string[];
}

export function ensureInitialSurfaces(db: ProteusDb): number {
  if (db.listSurfaces().length > 0) return 0;
  const files = discoverFiles(db.targetRoot);
  let created = 0;
  for (const family of SURFACE_FAMILIES) {
    const matched = files.filter((file) => family.patterns.some((pattern) => pattern.test(file))).slice(0, 80);
    const roi = roiForFamily(family, matched.length);
    const input: SurfaceInput = {
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
      revisitCondition:
        "Reopen only on new code, new runtime mode, new chain dependency, invalidated kill reason, or explicit user override."
    };
    db.addSurface(input);
    created += 1;
  }
  return created;
}

export function planRound(db: ProteusDb, input: string | PlanRoundInput): RoundPlan {
  const planInput = typeof input === "string" ? { objective: input } : input;
  const objective = planInput.objective;
  const coordinatorPlan = planInput.coordinatorPlan;
  const selected =
    (coordinatorPlan?.selectedSurfaces ?? planInput.selectedSurfaces)?.map((surface) => plannedSurfaceFromCoordinator(surface)) ??
    [];
  const skipped =
    (coordinatorPlan?.skippedSurfaces ?? planInput.skippedSurfaces)?.map((surface) => plannedSurfaceFromCoordinator(surface)) ??
    [];

  const agentFronts =
    (coordinatorPlan?.agentFronts ?? planInput.agentFronts)?.map((front) => agentFrontFromCoordinator(front)) ??
    [];
  const hasCoordinatorInput = Boolean(
    coordinatorPlan ??
      planInput.currentUnderstanding ??
      planInput.selectedSurfaces ??
      planInput.skippedSurfaces ??
      planInput.agentFronts ??
      planInput.stopConditions ??
      planInput.replanTrigger
  );
  const plan: RoundPlan = {
    objective,
    planningMode: hasCoordinatorInput ? "coordinator_supplied" : "scaffold",
    currentUnderstanding: coordinatorPlan?.currentUnderstanding ?? planInput.currentUnderstanding ?? "",
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
      "G7 public-known, advisory, issue, changelog, and expected-behavior checks complete and documented",
      "G8 affected version, likely introduction point, and timeline understood",
      "G9 Skeptic refutation completed and rebutted",
      "G10 old/obvious classes have exceptional impact or are killed",
      "G11 PoC does not depend on artificial lab help"
    ],
    stopConditions:
      coordinatorPlan?.stopConditions && coordinatorPlan.stopConditions.length > 0
        ? coordinatorPlan.stopConditions
        : planInput.stopConditions && planInput.stopConditions.length > 0
          ? planInput.stopConditions
        : [],
    replanTrigger: coordinatorPlan?.replanTrigger ?? planInput.replanTrigger ?? ""
  };

  db.addRound({
    objective: plan.objective,
    currentUnderstanding: plan.currentUnderstanding,
    selectedSurfaces: plan.selectedSurfaces as unknown as JsonValue,
    skippedSurfaces: plan.skippedSurfaces as unknown as JsonValue,
    agentFronts: plan.agentFronts as unknown as JsonValue,
    validationGates: plan.validationGates,
    stopConditions: plan.stopConditions
  });

  return plan;
}

export function renderRoundPlan(plan: RoundPlan): string {
  const selected = plan.selectedSurfaces
    .map(
      (surface) =>
        `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.roiScore.toFixed(1)} | ${surface.reason} |`
    )
    .join("\n");
  const skipped = plan.skippedSurfaces
    .map(
      (surface) =>
        `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.roiScore.toFixed(1)} | ${surface.reason} |`
    )
    .join("\n");
  const fronts = plan.agentFronts
    .map(
      (front) =>
        `### ${front.displayName}\n\nFamily: ${front.family}\n\nAssigned surfaces: ${front.assignedSurfaceIds.join(", ")}\n\nPurpose: ${front.purpose}\n\nRequired output:\n${front.requiredOutput.map((item) => `- ${item}`).join("\n")}`
    )
    .join("\n\n");

  return `# Proteus Round Plan\n\nObjective: ${plan.objective}\n\nPlanning mode: ${plan.planningMode}\n\n## Current Understanding\n\n${plan.currentUnderstanding || "-"}\n\n## Selected Surfaces\n\n| ID | Surface | Family | ROI | Reason |\n| --- | --- | --- | ---: | --- |\n${selected || "| - | - | - | - | - |"}\n\n## Skipped Surfaces\n\n| ID | Surface | Family | ROI | Reason |\n| --- | --- | --- | ---: | --- |\n${skipped || "| - | - | - | - | - |"}\n\n## Agent Fronts\n\n${fronts || "-"}\n\n## Validation Gates\n\n${plan.validationGates.map((gate) => `- ${gate}`).join("\n")}\n\n## Stop Conditions\n\n${plan.stopConditions.length > 0 ? plan.stopConditions.map((condition) => `- ${condition}`).join("\n") : "-"}\n\n## Replan Trigger\n\n${plan.replanTrigger || "-"}\n`;
}

function plannedSurfaceFromCoordinator(surface: CoordinatorSurfaceInput): PlannedSurface {
  return {
    id: surface.id ?? 0,
    name: surface.name,
    family: surface.family ?? "coordinator-supplied",
    roiScore: surface.roiScore ?? 0,
    reason: surface.reason ?? "Coordinator-supplied target-specific surface.",
    files: surface.files ?? [],
    revisitCondition: surface.revisitCondition ?? ""
  };
}

function agentFrontFromCoordinator(front: CoordinatorAgentFrontInput): AgentFront {
  if (!(front.codename in ROLES)) {
    throw new Error(`Unknown Proteus role in agent front: ${String(front.codename)}`);
  }
  return {
    codename: front.codename,
    displayName: ROLES[front.codename].displayName,
    family: ROLES[front.codename].family,
    assignedSurfaceIds: front.assignedSurfaceIds ?? [],
    purpose: front.purpose ?? ROLES[front.codename].purpose,
    requiredOutput: front.requiredOutput ?? ROLES[front.codename].requiredOutput
  };
}

function roiForFamily(family: SurfaceFamily, matchCount: number): RoiFactors {
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

export function surfaceFamilyForPath(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/");
  return SURFACE_FAMILIES.find((family) => family.patterns.some((pattern) => pattern.test(normalized)))?.family ?? "general";
}
