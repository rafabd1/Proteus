import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { memoryPath, vrosDir, ensureDir } from "./paths";
import {
  decisionInputSchema,
  evidenceInputSchema,
  hypothesisInputSchema,
  surfaceInputSchema,
  targetContractSchema
} from "./schemas";
import type {
  DecisionInput,
  EvidenceInput,
  HypothesisInput,
  JsonValue,
  RoiFactors,
  SurfaceInput,
  TargetContract
} from "./types";

const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  const warningType = typeof args[0] === "string" ? args[0] : undefined;
  if (warningType === "ExperimentalWarning" && message.includes("SQLite")) return;
  return emitWarning.call(process, warning as never, ...(args as never[]));
}) as typeof process.emitWarning;
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
process.emitWarning = emitWarning;

export class ProteusDb {
  readonly targetRoot: string;
  readonly dbPath: string;
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(targetRoot: string) {
    this.targetRoot = targetRoot;
    ensureDir(vrosDir(targetRoot));
    this.dbPath = memoryPath(targetRoot);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  initTarget(contractInput: TargetContract): void {
    const contract = targetContractSchema.parse(contractInput);
    const now = nowIso();
    const existing = this.getTarget();
    if (existing) {
      this.db
        .prepare(
          `UPDATE targets
           SET name = ?, root_path = ?, contract_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(contract.target, contract.scopeRoot, json(contract), now, existing.id);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO targets (name, root_path, contract_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(contract.target, contract.scopeRoot, json(contract), now, now);
  }

  getTarget(): { id: number; name: string; rootPath: string; contract: TargetContract } | null {
    const row = this.db.prepare("SELECT * FROM targets ORDER BY id LIMIT 1").get() as Row | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      contract: parseJson(String(row.contract_json)) as unknown as TargetContract
    };
  }

  upsertProfile(profile: JsonValue): void {
    const target = requireTarget(this);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO target_profiles (target_id, profile_json, created_at)
         VALUES (?, ?, ?)`
      )
      .run(target.id, json(profile), now);
  }

  addSource(kind: string, pathOrUrl: string, title: string, body: string, summary = ""): number {
    const target = requireTarget(this);
    const hash = sha256(body);
    const now = nowIso();
    const existing = this.db
      .prepare("SELECT id FROM sources WHERE target_id = ? AND content_hash = ?")
      .get(target.id, hash) as Row | undefined;
    if (existing) return Number(existing.id);

    const result = this.db
      .prepare(
        `INSERT INTO sources
          (target_id, kind, path_or_url, title, content_hash, summary, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(target.id, kind, pathOrUrl, title, hash, summary, body, now);
    const id = Number(result.lastInsertRowid);
    this.indexFts("source", id, `${title}\n${summary}\n${pathOrUrl}\n${body}`);
    return id;
  }

  addSurface(input: SurfaceInput): number {
    const target = requireTarget(this);
    const surface = surfaceInputSchema.parse(input);
    const score = computeRoi(surface.roi);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO surfaces
          (target_id, name, family, description, files_json, symbols_json,
           entrypoints_json, trust_boundaries_json, runtime_modes_json, status,
           roi_json, roi_score, exhaustion_level, revisit_condition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        surface.name,
        surface.family,
        surface.description,
        json(surface.files),
        json(surface.symbols),
        json(surface.entrypoints),
        json(surface.trustBoundaries),
        json(surface.runtimeModes),
        surface.status,
        json(surface.roi),
        score,
        0,
        surface.revisitCondition,
        now,
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts(
      "surface",
      id,
      `${surface.name}\n${surface.family}\n${surface.description}\n${surface.files.join("\n")}`
    );
    return id;
  }

  listSurfaces(): SurfaceRow[] {
    return this.db
      .prepare("SELECT * FROM surfaces ORDER BY roi_score DESC, id ASC")
      .all()
      .map(toSurfaceRow);
  }

  updateSurface(input: {
    id: number;
    status?: string;
    revisitCondition?: string;
    exhaustionLevel?: number;
  }): void {
    const now = nowIso();
    const current = this.getSurface(input.id);
    if (!current) throw new Error(`Surface not found: ${input.id}`);
    this.db
      .prepare(
        `UPDATE surfaces
         SET status = ?, revisit_condition = ?, exhaustion_level = ?, last_reviewed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.status ?? current.status,
        input.revisitCondition ?? current.revisitCondition,
        input.exhaustionLevel ?? current.exhaustionLevel,
        now,
        now,
        input.id
      );
  }

  getSurface(id: number): SurfaceRow | null {
    const row = this.db.prepare("SELECT * FROM surfaces WHERE id = ?").get(id) as Row | undefined;
    return row ? toSurfaceRow(row) : null;
  }

  addHypothesis(input: HypothesisInput): number {
    const target = requireTarget(this);
    const hypothesis = hypothesisInputSchema.parse(input);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO hypotheses
          (target_id, surface_id, title, primitive, attacker_boundary, impact_claim,
           heuristic_family, status, score, duplicate_risk, expected_behavior_risk,
           validation_cost, kill_criteria, revisit_condition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        hypothesis.surfaceId ?? null,
        hypothesis.title,
        hypothesis.primitive,
        hypothesis.attackerBoundary,
        hypothesis.impactClaim,
        hypothesis.heuristicFamily,
        hypothesis.status,
        hypothesis.score,
        hypothesis.duplicateRisk,
        hypothesis.expectedBehaviorRisk,
        hypothesis.validationCost,
        hypothesis.killCriteria,
        hypothesis.revisitCondition,
        now,
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts(
      "hypothesis",
      id,
      `${hypothesis.title}\n${hypothesis.primitive}\n${hypothesis.attackerBoundary}\n${hypothesis.impactClaim}`
    );
    return id;
  }

  listHypotheses(): HypothesisRow[] {
    return this.db
      .prepare("SELECT * FROM hypotheses ORDER BY score DESC, id ASC")
      .all()
      .map(toHypothesisRow);
  }

  addEvidence(input: EvidenceInput): number {
    const target = requireTarget(this);
    const evidence = evidenceInputSchema.parse(input);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO evidence
          (target_id, kind, title, body, path_or_url, command, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        evidence.kind,
        evidence.title,
        evidence.body,
        evidence.pathOrUrl ?? null,
        evidence.command ?? null,
        sha256(`${evidence.kind}\n${evidence.title}\n${evidence.body}`),
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts("evidence", id, `${evidence.kind}\n${evidence.title}\n${evidence.body}`);
    return id;
  }

  addDecision(input: DecisionInput): number {
    const target = requireTarget(this);
    const decision = decisionInputSchema.parse(input);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO decisions
          (target_id, entity_type, entity_id, decision, reason, evidence_ids_json, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        decision.entityType,
        decision.entityId,
        decision.decision,
        decision.reason,
        json(decision.evidenceIds),
        decision.actor,
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts("decision", id, `${decision.entityType}\n${decision.decision}\n${decision.reason}`);
    return id;
  }

  addRound(round: {
    objective: string;
    currentUnderstanding: string;
    selectedSurfaces: JsonValue;
    skippedSurfaces: JsonValue;
    agentFronts: JsonValue;
    validationGates: JsonValue;
    stopConditions: JsonValue;
    outcome?: string;
  }): number {
    const target = requireTarget(this);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO rounds
          (target_id, objective, current_understanding, selected_surfaces_json,
           skipped_surfaces_json, agent_fronts_json, validation_gates_json,
           stop_conditions_json, outcome, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        round.objective,
        round.currentUnderstanding,
        json(round.selectedSurfaces),
        json(round.skippedSurfaces),
        json(round.agentFronts),
        json(round.validationGates),
        json(round.stopConditions),
        round.outcome ?? "planned",
        now
      );
    return Number(result.lastInsertRowid);
  }

  listRounds(): RoundRow[] {
    return this.db.prepare("SELECT * FROM rounds ORDER BY id DESC").all().map(toRoundRow);
  }

  addAgentOutput(output: {
    roundId: number;
    codename: string;
    roleFamily: string;
    assignedSurface: string;
    outputPath: string;
    coveredSurface: JsonValue;
    liveCandidates: JsonValue;
    killedHypotheses: JsonValue;
    probes: JsonValue;
    uncoveredAreas: JsonValue;
    validationStatus: string;
  }): number {
    const target = requireTarget(this);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO agent_outputs
          (target_id, round_id, agent_codename, agent_role_family, assigned_surface,
           output_path, covered_surface_json, live_candidates_json,
           killed_hypotheses_json, probes_json, uncovered_areas_json,
           validation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        target.id,
        output.roundId,
        output.codename,
        output.roleFamily,
        output.assignedSurface,
        output.outputPath,
        json(output.coveredSurface),
        json(output.liveCandidates),
        json(output.killedHypotheses),
        json(output.probes),
        json(output.uncoveredAreas),
        output.validationStatus,
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts(
      "agent_output",
      id,
      `${output.codename}\n${output.roleFamily}\n${output.assignedSurface}\n${output.validationStatus}\n${output.outputPath}`
    );
    return id;
  }

  addLab(candidateId: number, labPath: string, configLegitimacy: string): number {
    const target = requireTarget(this);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO labs
          (target_id, candidate_id, path, config_legitimacy, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(target.id, candidateId, labPath, configLegitimacy, "created", now, now);
    return Number(result.lastInsertRowid);
  }

  search(query: string, limit = 20): SearchRow[] {
    const escaped = query
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join(" OR ");
    if (!escaped) return [];
    return this.db
      .prepare(
        `SELECT entity_type, entity_id, snippet(proteus_fts, 2, '[', ']', ' ... ', 12) AS snippet
         FROM proteus_fts
         WHERE proteus_fts MATCH ?
         LIMIT ?`
      )
      .all(escaped, limit)
      .map((row: Row) => ({
        entityType: String(row.entity_type),
        entityId: Number(row.entity_id),
        snippet: String(row.snippet ?? "")
      }));
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS targets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS target_profiles (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path_or_url TEXT NOT NULL,
        title TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT,
        body TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(target_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS surfaces (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        family TEXT NOT NULL,
        description TEXT,
        files_json TEXT NOT NULL,
        symbols_json TEXT NOT NULL,
        entrypoints_json TEXT NOT NULL,
        trust_boundaries_json TEXT NOT NULL,
        runtime_modes_json TEXT NOT NULL,
        status TEXT NOT NULL,
        roi_json TEXT NOT NULL,
        roi_score REAL NOT NULL,
        exhaustion_level INTEGER NOT NULL DEFAULT 0,
        revisit_condition TEXT,
        last_reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hypotheses (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        surface_id INTEGER REFERENCES surfaces(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        primitive TEXT NOT NULL,
        attacker_boundary TEXT NOT NULL,
        impact_claim TEXT NOT NULL,
        heuristic_family TEXT NOT NULL,
        status TEXT NOT NULL,
        score REAL NOT NULL,
        duplicate_risk REAL NOT NULL,
        expected_behavior_risk REAL NOT NULL,
        validation_cost REAL NOT NULL,
        kill_criteria TEXT,
        revisit_condition TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        path_or_url TEXT,
        command TEXT,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        objective TEXT NOT NULL,
        current_understanding TEXT NOT NULL,
        selected_surfaces_json TEXT NOT NULL,
        skipped_surfaces_json TEXT NOT NULL,
        agent_fronts_json TEXT NOT NULL,
        validation_gates_json TEXT NOT NULL,
        stop_conditions_json TEXT NOT NULL,
        outcome TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS labs (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        candidate_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        config_legitimacy TEXT NOT NULL,
        status TEXT NOT NULL,
        limitations TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_outputs (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        agent_codename TEXT NOT NULL,
        agent_role_family TEXT NOT NULL,
        assigned_surface TEXT NOT NULL,
        output_path TEXT NOT NULL,
        covered_surface_json TEXT NOT NULL,
        live_candidates_json TEXT NOT NULL,
        killed_hypotheses_json TEXT NOT NULL,
        probes_json TEXT NOT NULL,
        uncovered_areas_json TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS proteus_fts USING fts5(
        entity_type,
        entity_id UNINDEXED,
        content
      );
    `);
  }

  private indexFts(entityType: string, entityId: number, content: string): void {
    this.db
      .prepare("INSERT INTO proteus_fts (entity_type, entity_id, content) VALUES (?, ?, ?)")
      .run(entityType, entityId, content);
  }
}

export interface SurfaceRow {
  id: number;
  name: string;
  family: string;
  description: string;
  files: string[];
  status: string;
  roi: RoiFactors;
  roiScore: number;
  exhaustionLevel: number;
  revisitCondition: string;
}

export interface HypothesisRow {
  id: number;
  surfaceId: number | null;
  title: string;
  primitive: string;
  attackerBoundary: string;
  impactClaim: string;
  heuristicFamily: string;
  status: string;
  score: number;
  killCriteria: string;
  revisitCondition: string;
}

export interface RoundRow {
  id: number;
  objective: string;
  currentUnderstanding: string;
  selectedSurfaces: JsonValue;
  skippedSurfaces: JsonValue;
  agentFronts: JsonValue;
  validationGates: JsonValue;
  stopConditions: JsonValue;
  outcome: string;
  createdAt: string;
}

export interface SearchRow {
  entityType: string;
  entityId: number;
  snippet: string;
}

type Row = Record<string, unknown>;

function toSurfaceRow(row: Row): SurfaceRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    family: String(row.family),
    description: String(row.description ?? ""),
    files: parseJson(String(row.files_json)) as string[],
    status: String(row.status),
    roi: parseJson(String(row.roi_json)) as unknown as RoiFactors,
    roiScore: Number(row.roi_score),
    exhaustionLevel: Number(row.exhaustion_level),
    revisitCondition: String(row.revisit_condition ?? "")
  };
}

function toHypothesisRow(row: Row): HypothesisRow {
  return {
    id: Number(row.id),
    surfaceId: row.surface_id === null ? null : Number(row.surface_id),
    title: String(row.title),
    primitive: String(row.primitive),
    attackerBoundary: String(row.attacker_boundary),
    impactClaim: String(row.impact_claim),
    heuristicFamily: String(row.heuristic_family),
    status: String(row.status),
    score: Number(row.score),
    killCriteria: String(row.kill_criteria ?? ""),
    revisitCondition: String(row.revisit_condition ?? "")
  };
}

function toRoundRow(row: Row): RoundRow {
  return {
    id: Number(row.id),
    objective: String(row.objective),
    currentUnderstanding: String(row.current_understanding),
    selectedSurfaces: parseJson(String(row.selected_surfaces_json)),
    skippedSurfaces: parseJson(String(row.skipped_surfaces_json)),
    agentFronts: parseJson(String(row.agent_fronts_json)),
    validationGates: parseJson(String(row.validation_gates_json)),
    stopConditions: parseJson(String(row.stop_conditions_json)),
    outcome: String(row.outcome ?? ""),
    createdAt: String(row.created_at)
  };
}

export function computeRoi(roi: RoiFactors): number {
  return (
    roi.impactPotential +
    roi.externalReachability +
    roi.trustBoundaryDensity +
    roi.recentChangeWeight +
    roi.unexploredInvariantWeight +
    roi.toolingReadiness -
    roi.duplicateRisk -
    roi.expectedBehaviorLikelihood -
    roi.priorExhaustionWeight -
    roi.validationCost -
    roi.lowSignalHistory
  );
}

function requireTarget(db: ProteusDb): { id: number } {
  const target = db.getTarget();
  if (!target) {
    throw new Error("Target is not initialized. Run `proteus init <target-root>` first.");
  }
  return { id: target.id };
}

function json(value: JsonValue | unknown): string {
  return JSON.stringify(value);
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createDefaultContract(targetRoot: string, name?: string): TargetContract {
  return {
    target: name ?? path.basename(targetRoot),
    scopeRoot: targetRoot,
    inScope: ["."],
    outOfScope: [],
    existingWork: ["findings", "REPORTS", "reports", ".vros/exports"],
    primaryImpactClasses: [
      "unauthorized read",
      "unauthorized action",
      "authn/authz failure",
      "security control bypass",
      "identity confusion",
      "cache/state leak",
      "SSRF",
      "RCE"
    ],
    hardExclusions: [
      "expected behavior",
      "duplicate findings",
      "integration-only issues outside target responsibility",
      "forced vulnerable configuration",
      "lab artifacts",
      "weak crash-only findings"
    ],
    assumptions: ["PoCs must use documented, default, or normal correct-practice configuration."],
    availableTooling: [],
    credentialsAvailable: "unknown",
    continuousMode: false,
    stopOnCandidate: true
  };
}
