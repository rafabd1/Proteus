import { z } from "zod";

export const agentCodenameSchema = z.enum([
  "argus",
  "loom",
  "chaos",
  "libris",
  "mimic",
  "artificer",
  "skeptic"
]);

export const targetContractSchema = z.object({
  target: z.string().min(1),
  scopeRoot: z.string().min(1),
  inScope: z.array(z.string()).default([]),
  outOfScope: z.array(z.string()).default([]),
  existingWork: z.array(z.string()).default([]),
  primaryImpactClasses: z.array(z.string()).default([]),
  hardExclusions: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  availableTooling: z.array(z.string()).default([]),
  credentialsAvailable: z.string().default("unknown"),
  continuousMode: z.boolean().default(false),
  stopOnCandidate: z.boolean().default(true)
});

export const roiFactorsSchema = z.object({
  impactPotential: z.number().min(0).max(10),
  externalReachability: z.number().min(0).max(10),
  trustBoundaryDensity: z.number().min(0).max(10),
  recentChangeWeight: z.number().min(0).max(10),
  unexploredInvariantWeight: z.number().min(0).max(10),
  toolingReadiness: z.number().min(0).max(10),
  duplicateRisk: z.number().min(0).max(10),
  expectedBehaviorLikelihood: z.number().min(0).max(10),
  priorExhaustionWeight: z.number().min(0).max(10),
  validationCost: z.number().min(0).max(10),
  lowSignalHistory: z.number().min(0).max(10)
});

export const surfaceInputSchema = z.object({
  name: z.string().min(1),
  family: z.string().min(1),
  description: z.string().default(""),
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  entrypoints: z.array(z.string()).default([]),
  trustBoundaries: z.array(z.string()).default([]),
  runtimeModes: z.array(z.string()).default([]),
  status: z
    .enum(["unmapped", "active", "covered", "exhausted", "low_roi", "blocked", "watch"])
    .default("unmapped"),
  roi: roiFactorsSchema,
  revisitCondition: z.string().default("")
});

export const hypothesisInputSchema = z.object({
  surfaceId: z.number().int().positive().optional(),
  title: z.string().min(1),
  primitive: z.string().default("unknown"),
  attackerBoundary: z.string().default("unknown"),
  impactClaim: z.string().default("unknown"),
  heuristicFamily: z.string().default("unknown"),
  status: z
    .enum(["live", "candidate", "watchlist", "discarded", "promoted_to_poc", "report_grade"])
    .default("live"),
  score: z.number().min(0).max(100).default(0),
  duplicateRisk: z.number().min(0).max(10).default(5),
  expectedBehaviorRisk: z.number().min(0).max(10).default(5),
  validationCost: z.number().min(0).max(10).default(5),
  killCriteria: z.string().default(""),
  revisitCondition: z.string().default("")
});

export const evidenceInputSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  pathOrUrl: z.string().optional(),
  command: z.string().optional()
});

export const decisionInputSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.number().int().nonnegative(),
  decision: z.string().min(1),
  reason: z.string().min(1),
  evidenceIds: z.array(z.number().int().positive()).default([]),
  actor: z.string().default("coordinator")
});

