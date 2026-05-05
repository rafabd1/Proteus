export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentCodename =
  | "argus"
  | "loom"
  | "chaos"
  | "libris"
  | "mimic"
  | "artificer"
  | "skeptic";

export type SurfaceStatus =
  | "unmapped"
  | "active"
  | "covered"
  | "exhausted"
  | "low_roi"
  | "blocked"
  | "watch";

export type HypothesisStatus =
  | "live"
  | "candidate"
  | "watchlist"
  | "discarded"
  | "promoted_to_poc"
  | "report_grade";

export interface TargetContract {
  target: string;
  scopeRoot: string;
  inScope: string[];
  outOfScope: string[];
  existingWork: string[];
  primaryImpactClasses: string[];
  hardExclusions: string[];
  assumptions: string[];
  availableTooling: string[];
  credentialsAvailable: string;
  continuousMode: boolean;
  stopOnCandidate: boolean;
}

export interface RoiFactors {
  impactPotential: number;
  externalReachability: number;
  trustBoundaryDensity: number;
  recentChangeWeight: number;
  unexploredInvariantWeight: number;
  toolingReadiness: number;
  duplicateRisk: number;
  expectedBehaviorLikelihood: number;
  priorExhaustionWeight: number;
  validationCost: number;
  lowSignalHistory: number;
}

export interface SurfaceInput {
  name: string;
  family: string;
  description: string;
  files: string[];
  symbols: string[];
  entrypoints: string[];
  trustBoundaries: string[];
  runtimeModes: string[];
  status: SurfaceStatus;
  roi: RoiFactors;
  revisitCondition: string;
}

export interface HypothesisInput {
  surfaceId?: number;
  title: string;
  primitive: string;
  attackerBoundary: string;
  impactClaim: string;
  heuristicFamily: string;
  status: HypothesisStatus;
  score: number;
  duplicateRisk: number;
  expectedBehaviorRisk: number;
  validationCost: number;
  killCriteria: string;
  revisitCondition: string;
}

export interface EvidenceInput {
  kind: string;
  title: string;
  body: string;
  pathOrUrl?: string;
  command?: string;
}

export interface DecisionInput {
  entityType: string;
  entityId: number;
  decision: string;
  reason: string;
  evidenceIds: number[];
  actor: string;
}

