"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProteusDb = void 0;
exports.computeRoi = computeRoi;
exports.createDefaultContract = createDefaultContract;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const paths_1 = require("./paths");
const schemas_1 = require("./schemas");
const emitWarning = process.emitWarning;
process.emitWarning = ((warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning.message;
    const warningType = typeof args[0] === "string" ? args[0] : undefined;
    if (warningType === "ExperimentalWarning" && message.includes("SQLite"))
        return;
    return emitWarning.call(process, warning, ...args);
});
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = emitWarning;
class ProteusDb {
    targetRoot;
    dbPath;
    db;
    constructor(targetRoot) {
        this.targetRoot = targetRoot;
        (0, paths_1.ensureDir)((0, paths_1.vrosDir)(targetRoot));
        this.dbPath = (0, paths_1.memoryPath)(targetRoot);
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec("PRAGMA foreign_keys = ON;");
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.migrate();
    }
    close() {
        this.db.close();
    }
    initTarget(contractInput) {
        const contract = schemas_1.targetContractSchema.parse(contractInput);
        const now = nowIso();
        const existing = this.getTarget();
        if (existing) {
            this.db
                .prepare(`UPDATE targets
           SET name = ?, root_path = ?, contract_json = ?, updated_at = ?
           WHERE id = ?`)
                .run(contract.target, contract.scopeRoot, json(contract), now, existing.id);
            return;
        }
        this.db
            .prepare(`INSERT INTO targets (name, root_path, contract_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`)
            .run(contract.target, contract.scopeRoot, json(contract), now, now);
    }
    getTarget() {
        const row = this.db.prepare("SELECT * FROM targets ORDER BY id LIMIT 1").get();
        if (!row)
            return null;
        return {
            id: Number(row.id),
            name: String(row.name),
            rootPath: String(row.root_path),
            contract: parseJson(String(row.contract_json))
        };
    }
    upsertProfile(profile) {
        const target = requireTarget(this);
        const now = nowIso();
        this.db
            .prepare(`INSERT INTO target_profiles (target_id, profile_json, created_at)
         VALUES (?, ?, ?)`)
            .run(target.id, json(profile), now);
    }
    addSource(kind, pathOrUrl, title, body, summary = "") {
        return this.addSourceWithResult(kind, pathOrUrl, title, body, summary).id;
    }
    addSourceWithResult(kind, pathOrUrl, title, body, summary = "") {
        const target = requireTarget(this);
        const hash = sha256(body);
        const now = nowIso();
        const existing = this.db
            .prepare("SELECT id FROM sources WHERE target_id = ? AND content_hash = ?")
            .get(target.id, hash);
        if (existing)
            return { id: Number(existing.id), inserted: false };
        const result = this.db
            .prepare(`INSERT INTO sources
          (target_id, kind, path_or_url, title, content_hash, summary, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, kind, pathOrUrl, title, hash, summary, body, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("source", id, `${title}\n${summary}\n${pathOrUrl}\n${body}`);
        return { id, inserted: true };
    }
    listSources() {
        return this.db
            .prepare("SELECT * FROM sources ORDER BY id ASC")
            .all()
            .map(toSourceRow);
    }
    addSurface(input) {
        const target = requireTarget(this);
        const surface = schemas_1.surfaceInputSchema.parse(input);
        const score = computeRoi(surface.roi);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO surfaces
          (target_id, name, family, description, files_json, symbols_json,
           entrypoints_json, trust_boundaries_json, runtime_modes_json, status,
           roi_json, roi_score, exhaustion_level, revisit_condition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, surface.name, surface.family, surface.description, json(surface.files), json(surface.symbols), json(surface.entrypoints), json(surface.trustBoundaries), json(surface.runtimeModes), surface.status, json(surface.roi), score, 0, surface.revisitCondition, now, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("surface", id, `${surface.name}\n${surface.family}\n${surface.description}\n${surface.files.join("\n")}`);
        return id;
    }
    listSurfaces() {
        return this.db
            .prepare("SELECT * FROM surfaces ORDER BY roi_score DESC, id ASC")
            .all()
            .map(toSurfaceRow);
    }
    updateSurface(input) {
        const now = nowIso();
        const current = this.getSurface(input.id);
        if (!current)
            throw new Error(`Surface not found: ${input.id}`);
        this.db
            .prepare(`UPDATE surfaces
         SET status = ?, revisit_condition = ?, exhaustion_level = ?, last_reviewed_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(input.status ?? current.status, input.revisitCondition ?? current.revisitCondition, input.exhaustionLevel ?? current.exhaustionLevel, now, now, input.id);
    }
    getSurface(id) {
        const row = this.db.prepare("SELECT * FROM surfaces WHERE id = ?").get(id);
        return row ? toSurfaceRow(row) : null;
    }
    addHypothesis(input) {
        const target = requireTarget(this);
        const hypothesis = schemas_1.hypothesisInputSchema.parse(input);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO hypotheses
          (target_id, surface_id, title, primitive, attacker_boundary, impact_claim,
           heuristic_family, status, score, duplicate_risk, expected_behavior_risk,
           validation_cost, kill_criteria, revisit_condition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, hypothesis.surfaceId ?? null, hypothesis.title, hypothesis.primitive, hypothesis.attackerBoundary, hypothesis.impactClaim, hypothesis.heuristicFamily, hypothesis.status, hypothesis.score, hypothesis.duplicateRisk, hypothesis.expectedBehaviorRisk, hypothesis.validationCost, hypothesis.killCriteria, hypothesis.revisitCondition, now, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("hypothesis", id, `${hypothesis.title}\n${hypothesis.primitive}\n${hypothesis.attackerBoundary}\n${hypothesis.impactClaim}`);
        return id;
    }
    listHypotheses() {
        return this.db
            .prepare("SELECT * FROM hypotheses ORDER BY score DESC, id ASC")
            .all()
            .map(toHypothesisRow);
    }
    listEvidence() {
        return this.db.prepare("SELECT * FROM evidence ORDER BY id DESC").all().map(toEvidenceRow);
    }
    addEvidence(input) {
        const target = requireTarget(this);
        const evidence = schemas_1.evidenceInputSchema.parse(input);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO evidence
          (target_id, kind, title, body, path_or_url, command, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, evidence.kind, evidence.title, evidence.body, evidence.pathOrUrl ?? null, evidence.command ?? null, sha256(`${evidence.kind}\n${evidence.title}\n${evidence.body}`), now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("evidence", id, `${evidence.kind}\n${evidence.title}\n${evidence.body}`);
        return id;
    }
    listDecisions() {
        return this.db.prepare("SELECT * FROM decisions ORDER BY id DESC").all().map(toDecisionRow);
    }
    addDecision(input) {
        const target = requireTarget(this);
        const decision = schemas_1.decisionInputSchema.parse(input);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO decisions
          (target_id, entity_type, entity_id, decision, reason, evidence_ids_json, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, decision.entityType, decision.entityId, decision.decision, decision.reason, json(decision.evidenceIds), decision.actor, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("decision", id, `${decision.entityType}\n${decision.decision}\n${decision.reason}`);
        return id;
    }
    addValidationGate(input) {
        const target = requireTarget(this);
        const gate = schemas_1.validationGateInputSchema.parse(input);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO validation_gates
          (target_id, entity_type, entity_id, gate, status, summary, evidence_ids_json, actor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, gate.entityType, gate.entityId, gate.gate, gate.status, gate.summary, json(gate.evidenceIds), gate.actor, now, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("gate", id, `${gate.entityType}\n${gate.entityId}\n${gate.gate}\n${gate.status}\n${gate.summary}`);
        return id;
    }
    listValidationGates() {
        return this.db.prepare("SELECT * FROM validation_gates ORDER BY id DESC").all().map(toValidationGateRow);
    }
    addCampaign(input) {
        const target = requireTarget(this);
        const now = nowIso();
        const status = input.status ?? "active";
        const result = this.db
            .prepare(`INSERT INTO campaigns
          (target_id, title, objective, status, current_state_summary,
           recent_learning_summary, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, input.title, input.objective, status, input.currentStateSummary ?? "", input.recentLearningSummary ?? "", now, now, null);
        const id = Number(result.lastInsertRowid);
        this.indexFts("campaign", id, `${status}\n${input.title}\n${input.objective}\n${input.currentStateSummary ?? ""}`);
        this.addCampaignEvent({
            campaignId: id,
            eventType: "campaign_created",
            entityType: "campaign",
            entityId: id,
            summary: `Campaign created: ${input.title}`
        });
        return id;
    }
    listCampaigns(status) {
        return this.db
            .prepare("SELECT * FROM campaigns ORDER BY id DESC")
            .all()
            .map(toCampaignRow)
            .filter((campaign) => !status || campaign.status === status);
    }
    getCampaign(id) {
        const row = this.db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
        return row ? toCampaignRow(row) : null;
    }
    updateCampaign(input) {
        const current = this.getCampaign(input.id);
        if (!current)
            throw new Error(`Campaign not found: ${input.id}`);
        const status = input.status ?? current.status;
        const now = nowIso();
        const closedAt = status === "completed" || status === "superseded" ? now : current.closedAt || null;
        const currentStateSummary = input.currentStateSummary ?? current.currentStateSummary;
        const recentLearningSummary = input.recentLearningSummary ?? current.recentLearningSummary;
        this.db
            .prepare(`UPDATE campaigns
         SET status = ?, current_state_summary = ?, recent_learning_summary = ?,
             updated_at = ?, closed_at = ?
         WHERE id = ?`)
            .run(status, currentStateSummary, recentLearningSummary, now, closedAt, input.id);
        this.indexFts("campaign", input.id, `${status}\n${current.title}\n${current.objective}\n${currentStateSummary}\n${recentLearningSummary}`);
        if (input.eventSummary) {
            this.addCampaignEvent({
                campaignId: input.id,
                eventType: "campaign_checkpoint",
                entityType: "campaign",
                entityId: input.id,
                summary: input.eventSummary
            });
        }
    }
    addEntityLink(input) {
        const target = requireTarget(this);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO entity_links
          (target_id, from_type, from_id, to_type, to_id, relation,
           confidence, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, input.fromType, input.fromId, input.toType, input.toId, input.relation, input.confidence ?? 1, input.note ?? "", now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("entity_link", id, `${input.fromType}#${input.fromId}\n${input.relation}\n${input.toType}#${input.toId}\n${input.note ?? ""}`);
        return id;
    }
    listEntityLinks(input = {}) {
        const rows = this.db
            .prepare("SELECT * FROM entity_links ORDER BY id DESC")
            .all()
            .map(toEntityLinkRow)
            .filter((link) => !input.entityType ||
            input.entityId === undefined ||
            (link.fromType === input.entityType && link.fromId === input.entityId) ||
            (link.toType === input.entityType && link.toId === input.entityId));
        return rows.slice(0, input.limit ?? 50);
    }
    addCampaignEvent(input) {
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO campaign_events
          (campaign_id, event_type, entity_type, entity_id, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(input.campaignId, input.eventType, input.entityType ?? null, input.entityId ?? null, input.summary, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("campaign_event", id, `${input.eventType}\n${input.entityType ?? ""}\n${input.entityId ?? ""}\n${input.summary}`);
        return id;
    }
    listCampaignEvents(campaignId, limit = 25) {
        return this.db
            .prepare("SELECT * FROM campaign_events WHERE campaign_id = ? ORDER BY id DESC LIMIT ?")
            .all(campaignId, limit)
            .map(toCampaignEventRow);
    }
    addHypothesisBranch(input) {
        const target = requireTarget(this);
        const now = nowIso();
        const status = input.status ?? "open";
        const result = this.db
            .prepare(`INSERT INTO hypothesis_branches
          (target_id, campaign_id, round_id, surface_id, title, hypothesis,
           attack_primitive, why_non_obvious, preconditions_json, steps_json,
           success_criteria_json, negative_controls_json, kill_conditions_json,
           roi_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, input.campaignId ?? null, input.roundId ?? null, input.surfaceId ?? null, input.title, input.hypothesis, input.attackPrimitive, input.whyNonObvious, json(input.preconditions), json(input.steps), json(input.successCriteria), json(input.negativeControls), json(input.killConditions), json(input.roi), status, now, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("hypothesis_branch", id, `${status}\n${input.title}\n${input.hypothesis}\n${input.attackPrimitive}\n${input.whyNonObvious}`);
        if (input.campaignId) {
            this.addCampaignEvent({
                campaignId: input.campaignId,
                eventType: "branch_created",
                entityType: "hypothesis_branch",
                entityId: id,
                summary: `Branch created: ${input.title}`
            });
        }
        return id;
    }
    listHypothesisBranches(input = {}) {
        const rows = this.db
            .prepare("SELECT * FROM hypothesis_branches ORDER BY id DESC")
            .all()
            .map(toHypothesisBranchRow)
            .filter((branch) => input.campaignId === undefined || branch.campaignId === input.campaignId)
            .filter((branch) => input.roundId === undefined || branch.roundId === input.roundId)
            .filter((branch) => !input.status || branch.status === input.status);
        return rows.slice(0, input.limit ?? 50);
    }
    campaignDigest(campaignId) {
        const campaign = this.getCampaign(campaignId);
        if (!campaign)
            throw new Error(`Campaign not found: ${campaignId}`);
        const links = this.listEntityLinks({ entityType: "campaign", entityId: campaignId, limit: 50 });
        const linkedRoundIds = links
            .filter((link) => link.relation === "has_round" && link.toType === "round")
            .map((link) => link.toId);
        const rounds = this.listRounds().filter((round) => linkedRoundIds.includes(round.id) || round.status === "active").slice(0, 10);
        const branches = this.listHypothesisBranches({ campaignId, limit: 20 });
        const events = this.listCampaignEvents(campaignId, 15);
        return {
            campaign,
            activeRounds: rounds.filter((round) => round.status === "active"),
            openBranches: branches.filter((branch) => branch.status === "open" || branch.status === "testing"),
            killedBranches: branches.filter((branch) => branch.status === "killed").slice(0, 10),
            recentEvents: events,
            links
        };
    }
    addRound(round) {
        const target = requireTarget(this);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO rounds
          (target_id, objective, current_understanding, selected_surfaces_json,
           skipped_surfaces_json, agent_fronts_json, validation_gates_json,
           stop_conditions_json, outcome, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, round.objective, round.currentUnderstanding, json(round.selectedSurfaces), json(round.skippedSurfaces), json(round.agentFronts), json(round.validationGates), json(round.stopConditions), round.status ?? "active", now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("round", id, `${round.status ?? "active"}\n${round.objective}\n${round.currentUnderstanding}\n${json(round.selectedSurfaces)}\n${json(round.agentFronts)}`);
        return id;
    }
    listRounds() {
        return this.db.prepare("SELECT * FROM rounds ORDER BY id DESC").all().map(toRoundRow);
    }
    updateRound(input) {
        const current = this.getRound(input.id);
        if (!current)
            throw new Error(`Round not found: ${input.id}`);
        const status = input.status ?? normalizeRoundStatus(input.outcome ?? current.status);
        const completedAt = status === "completed" || status === "superseded" ? nowIso() : null;
        this.db
            .prepare("UPDATE rounds SET outcome = ?, completed_at = ? WHERE id = ?")
            .run(status, completedAt, input.id);
        this.indexFts("round", input.id, `${status}\n${current.objective}\n${current.currentUnderstanding}`);
    }
    updateRoundsByStatus(input) {
        const matches = this.listRounds()
            .filter((round) => round.status === input.from)
            .sort((a, b) => b.id - a.id);
        const keptId = input.keepLatest && matches.length > 0 ? matches[0].id : null;
        let updated = 0;
        for (const round of matches) {
            if (round.id === keptId)
                continue;
            this.updateRound({ id: round.id, status: input.status });
            updated += 1;
        }
        return { updated, keptId };
    }
    getRound(id) {
        const row = this.db.prepare("SELECT * FROM rounds WHERE id = ?").get(id);
        return row ? toRoundRow(row) : null;
    }
    addAgentOutput(output) {
        const target = requireTarget(this);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO agent_outputs
          (target_id, round_id, agent_codename, agent_role_family, assigned_surface,
           output_path, covered_surface_json, live_candidates_json,
           killed_hypotheses_json, probes_json, uncovered_areas_json,
           validation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, output.roundId, output.codename, output.roleFamily, output.assignedSurface, output.outputPath, json(output.coveredSurface), json(output.liveCandidates), json(output.killedHypotheses), json(output.probes), json(output.uncoveredAreas), output.validationStatus, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("agent_output", id, `${output.codename}\n${output.roleFamily}\n${output.assignedSurface}\n${output.validationStatus}\n${output.outputPath}`);
        return id;
    }
    addLab(candidateId, labPath, configLegitimacy) {
        const target = requireTarget(this);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO labs
          (target_id, candidate_id, path, config_legitimacy, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(target.id, candidateId, labPath, configLegitimacy, "created", now, now);
        return Number(result.lastInsertRowid);
    }
    search(query, limit = 20) {
        const escaped = query
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => `"${part.replace(/"/g, '""')}"`)
            .join(" OR ");
        if (!escaped)
            return [];
        return this.db
            .prepare(`SELECT entity_type, entity_id, snippet(proteus_fts, 2, '[', ']', ' ... ', 12) AS snippet
         FROM proteus_fts
         WHERE proteus_fts MATCH ?
         LIMIT ?`)
            .all(escaped, limit)
            .map((row) => ({
            entityType: String(row.entity_type),
            entityId: Number(row.entity_id),
            snippet: String(row.snippet ?? "")
        }));
    }
    queryCoverage(query, limit = 10) {
        const queryTerms = tokenize(query);
        if (queryTerms.length === 0)
            return [];
        const requiredOverlap = queryTerms.length <= 2 ? queryTerms.length : Math.min(4, Math.ceil(queryTerms.length * 0.35));
        const rows = this.coverageCandidates()
            .map((candidate) => scoreCoverageCandidate(candidate, query, queryTerms))
            .filter((candidate) => candidate.matchedTerms.length >= requiredOverlap || candidate.phraseMatched)
            .filter(isActionableCoverageResult)
            .sort((a, b) => b.score - a.score || entityRank(a.entityType) - entityRank(b.entityType))
            .slice(0, limit);
        return rows.map(({ searchText: _searchText, phraseMatched: _phraseMatched, ...row }) => row);
    }
    getRecord(entityType, entityId) {
        const table = tableForEntity(entityType);
        if (!table)
            throw new Error(`Unsupported entity type: ${entityType}`);
        const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId);
        if (!row)
            return null;
        return materializeRecord(entityType, row);
    }
    memoryStats() {
        const sourcesByKind = this.db
            .prepare("SELECT kind, COUNT(*) AS count FROM sources GROUP BY kind ORDER BY kind")
            .all()
            .map((row) => ({ kind: String(row.kind), count: Number(row.count) }));
        const latestSource = this.db
            .prepare("SELECT id, kind, path_or_url, title, created_at FROM sources ORDER BY id DESC LIMIT 1")
            .get();
        const latestDecision = this.db
            .prepare("SELECT id, entity_type, entity_id, decision, created_at FROM decisions ORDER BY id DESC LIMIT 1")
            .get();
        const activeRounds = this.db
            .prepare("SELECT * FROM rounds WHERE outcome = 'active' ORDER BY id DESC")
            .all()
            .map(toRoundRow);
        return {
            dbPath: this.dbPath,
            dbSizeBytes: node_fs_1.default.existsSync(this.dbPath) ? node_fs_1.default.statSync(this.dbPath).size : 0,
            targets: this.count("targets"),
            profiles: this.count("target_profiles"),
            sources: this.count("sources"),
            sourcesByKind,
            surfaces: this.count("surfaces"),
            hypotheses: this.count("hypotheses"),
            evidence: this.count("evidence"),
            decisions: this.count("decisions"),
            gates: this.count("validation_gates"),
            rounds: this.count("rounds"),
            campaigns: this.count("campaigns"),
            activeRounds,
            agentOutputs: this.count("agent_outputs"),
            labs: this.count("labs"),
            latestSource: latestSource
                ? {
                    id: Number(latestSource.id),
                    kind: String(latestSource.kind),
                    pathOrUrl: String(latestSource.path_or_url),
                    title: String(latestSource.title),
                    createdAt: String(latestSource.created_at)
                }
                : null,
            latestDecision: latestDecision
                ? {
                    id: Number(latestDecision.id),
                    entityType: String(latestDecision.entity_type),
                    entityId: Number(latestDecision.entity_id),
                    decision: String(latestDecision.decision),
                    createdAt: String(latestDecision.created_at)
                }
                : null
        };
    }
    count(table) {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
        return Number(row.count);
    }
    coverageCandidates() {
        const candidates = [];
        for (const row of this.db.prepare("SELECT * FROM sources").all()) {
            const kind = String(row.kind);
            if (!duplicateSourceKinds.has(kind))
                continue;
            candidates.push({
                entityType: "source",
                entityId: Number(row.id),
                kind,
                title: String(row.title),
                pathOrUrl: String(row.path_or_url),
                status: kind,
                summary: compactSummary([row.summary]),
                searchText: compactSummary([row.kind, row.path_or_url, row.title, row.summary, row.body]),
                baseScore: sourceCoverageWeight(kind)
            });
        }
        return candidates;
    }
    migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS validation_gates (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        gate TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        current_state_summary TEXT,
        recent_learning_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS entity_links (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        from_type TEXT NOT NULL,
        from_id INTEGER NOT NULL,
        to_type TEXT NOT NULL,
        to_id INTEGER NOT NULL,
        relation TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        note TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaign_events (
        id INTEGER PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hypothesis_branches (
        id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
        round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
        surface_id INTEGER REFERENCES surfaces(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        attack_primitive TEXT NOT NULL,
        why_non_obvious TEXT NOT NULL,
        preconditions_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        negative_controls_json TEXT NOT NULL,
        kill_conditions_json TEXT NOT NULL,
        roi_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES ('2026-05-17-validation-gates-surfaces-and-focused-duplicates', CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES ('2026-06-17-campaigns-links-branches', CURRENT_TIMESTAMP);
    `);
    }
    indexFts(entityType, entityId, content) {
        this.db
            .prepare("INSERT INTO proteus_fts (entity_type, entity_id, content) VALUES (?, ?, ?)")
            .run(entityType, entityId, content);
    }
}
exports.ProteusDb = ProteusDb;
const duplicateSourceKinds = new Set(["finding", "report"]);
function toSourceRow(row) {
    return {
        id: Number(row.id),
        kind: String(row.kind),
        pathOrUrl: String(row.path_or_url),
        title: String(row.title),
        summary: String(row.summary ?? ""),
        createdAt: String(row.created_at)
    };
}
function toSurfaceRow(row) {
    return {
        id: Number(row.id),
        name: String(row.name),
        family: String(row.family),
        description: String(row.description ?? ""),
        files: parseJson(String(row.files_json)),
        status: String(row.status),
        roi: parseJson(String(row.roi_json)),
        roiScore: Number(row.roi_score),
        exhaustionLevel: Number(row.exhaustion_level),
        revisitCondition: String(row.revisit_condition ?? "")
    };
}
function toHypothesisRow(row) {
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
function toEvidenceRow(row) {
    return {
        id: Number(row.id),
        kind: String(row.kind),
        title: String(row.title),
        body: String(row.body ?? ""),
        pathOrUrl: String(row.path_or_url ?? ""),
        command: String(row.command ?? ""),
        createdAt: String(row.created_at)
    };
}
function toDecisionRow(row) {
    return {
        id: Number(row.id),
        entityType: String(row.entity_type),
        entityId: Number(row.entity_id),
        decision: String(row.decision),
        reason: String(row.reason),
        evidenceIds: parseJson(String(row.evidence_ids_json)),
        actor: String(row.actor),
        createdAt: String(row.created_at)
    };
}
function toValidationGateRow(row) {
    return {
        id: Number(row.id),
        entityType: String(row.entity_type),
        entityId: Number(row.entity_id),
        gate: String(row.gate),
        status: String(row.status),
        summary: String(row.summary ?? ""),
        evidenceIds: parseJson(String(row.evidence_ids_json)),
        actor: String(row.actor),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function toRoundRow(row) {
    const status = normalizeRoundStatus(String(row.outcome ?? ""));
    return {
        id: Number(row.id),
        objective: String(row.objective),
        currentUnderstanding: String(row.current_understanding),
        selectedSurfaces: parseJson(String(row.selected_surfaces_json)),
        skippedSurfaces: parseJson(String(row.skipped_surfaces_json)),
        agentFronts: parseJson(String(row.agent_fronts_json)),
        validationGates: parseJson(String(row.validation_gates_json)),
        stopConditions: parseJson(String(row.stop_conditions_json)),
        status,
        outcome: status,
        createdAt: String(row.created_at),
        completedAt: String(row.completed_at ?? "")
    };
}
function toCampaignRow(row) {
    return {
        id: Number(row.id),
        title: String(row.title),
        objective: String(row.objective),
        status: normalizeCampaignStatus(String(row.status ?? "")),
        currentStateSummary: String(row.current_state_summary ?? ""),
        recentLearningSummary: String(row.recent_learning_summary ?? ""),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        closedAt: String(row.closed_at ?? "")
    };
}
function toEntityLinkRow(row) {
    return {
        id: Number(row.id),
        fromType: String(row.from_type),
        fromId: Number(row.from_id),
        toType: String(row.to_type),
        toId: Number(row.to_id),
        relation: String(row.relation),
        confidence: Number(row.confidence),
        note: String(row.note ?? ""),
        createdAt: String(row.created_at)
    };
}
function toCampaignEventRow(row) {
    return {
        id: Number(row.id),
        campaignId: Number(row.campaign_id),
        eventType: String(row.event_type),
        entityType: String(row.entity_type ?? ""),
        entityId: row.entity_id === null || row.entity_id === undefined ? null : Number(row.entity_id),
        summary: String(row.summary),
        createdAt: String(row.created_at)
    };
}
function toHypothesisBranchRow(row) {
    return {
        id: Number(row.id),
        campaignId: row.campaign_id === null ? null : Number(row.campaign_id),
        roundId: row.round_id === null ? null : Number(row.round_id),
        surfaceId: row.surface_id === null ? null : Number(row.surface_id),
        title: String(row.title),
        hypothesis: String(row.hypothesis),
        attackPrimitive: String(row.attack_primitive),
        whyNonObvious: String(row.why_non_obvious),
        preconditions: parseJson(String(row.preconditions_json)),
        steps: parseJson(String(row.steps_json)),
        successCriteria: parseJson(String(row.success_criteria_json)),
        negativeControls: parseJson(String(row.negative_controls_json)),
        killConditions: parseJson(String(row.kill_conditions_json)),
        roi: parseJson(String(row.roi_json)),
        status: normalizeBranchStatus(String(row.status ?? "")),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function normalizeRoundStatus(value) {
    if (value === "active" ||
        value === "paused" ||
        value === "completed" ||
        value === "blocked" ||
        value === "planned" ||
        value === "superseded") {
        return value;
    }
    return value.length > 0 ? "superseded" : "active";
}
function normalizeCampaignStatus(value) {
    if (value === "active" ||
        value === "paused" ||
        value === "completed" ||
        value === "blocked" ||
        value === "superseded") {
        return value;
    }
    return value.length > 0 ? "superseded" : "active";
}
function normalizeBranchStatus(value) {
    if (value === "open" ||
        value === "testing" ||
        value === "killed" ||
        value === "promoted" ||
        value === "blocked") {
        return value;
    }
    return value.length > 0 ? "blocked" : "open";
}
function scoreCoverageCandidate(candidate, query, queryTerms) {
    const normalizedSearch = normalizeText(candidate.searchText);
    const normalizedQuery = normalizeText(query);
    const matchedTerms = queryTerms.filter((term) => normalizedSearch.includes(term));
    const phraseMatched = normalizedQuery.length > 0 && normalizedSearch.includes(normalizedQuery);
    const statusBoost = candidate.status && ["discarded", "covered", "exhausted", "low_roi", "watch", "report_grade", "candidate"].includes(candidate.status)
        ? 8
        : 0;
    const score = candidate.baseScore + matchedTerms.length * 12 + (phraseMatched ? 30 : 0) + statusBoost;
    const reasonParts = [
        phraseMatched ? "phrase match" : `${matchedTerms.length}/${queryTerms.length} terms matched`,
        candidate.status ? `status=${candidate.status}` : "",
        candidate.pathOrUrl ? `path=${candidate.pathOrUrl}` : ""
    ].filter(Boolean);
    return {
        ...candidate,
        score,
        matchedTerms,
        phraseMatched,
        reason: reasonParts.join("; "),
        summary: truncateText(candidate.summary || candidate.searchText, 280)
    };
}
function tokenize(value) {
    const stopwords = new Set([
        "the",
        "and",
        "for",
        "with",
        "from",
        "that",
        "this",
        "uma",
        "com",
        "para",
        "por",
        "que",
        "dos",
        "das",
        "the",
        "area",
        "surface",
        "bug",
        "vulnerability",
        "finding"
    ]);
    return Array.from(new Set(normalizeText(value)
        .split(/\s+/)
        .filter((term) => term.length >= 3 && !stopwords.has(term))));
}
function normalizeText(value) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9_./:-]+/g, " ")
        .trim();
}
function compactSummary(values) {
    return values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value).trim())
        .filter(Boolean)
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
}
function truncateText(value, limit) {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}
function entityRank(entityType) {
    return [
        "hypothesis",
        "hypothesis_branch",
        "decision",
        "agent_output",
        "surface",
        "campaign",
        "source",
        "evidence",
        "round",
        "campaign_event",
        "entity_link",
        "lab"
    ].indexOf(entityType);
}
function sourceCoverageWeight(kind) {
    if (kind === "discarded" || kind === "watchlist" || kind === "candidate_register" || kind === "research_log")
        return 30;
    if (kind === "finding")
        return 32;
    if (kind === "report")
        return 30;
    if (kind === "advisory")
        return 28;
    if (kind === "doc")
        return 18;
    return 16;
}
function isActionableCoverageResult(candidate) {
    if (candidate.entityType !== "source")
        return true;
    if (candidate.kind && duplicateSourceKinds.has(candidate.kind))
        return true;
    return false;
}
function surfaceCoverageWeight(status) {
    if (["covered", "exhausted", "low_roi", "blocked", "watch"].includes(status))
        return 30;
    return 18;
}
function tableForEntity(entityType) {
    const tables = {
        source: "sources",
        surface: "surfaces",
        hypothesis: "hypotheses",
        evidence: "evidence",
        decision: "decisions",
        gate: "validation_gates",
        validation_gate: "validation_gates",
        round: "rounds",
        campaign: "campaigns",
        entity_link: "entity_links",
        campaign_event: "campaign_events",
        hypothesis_branch: "hypothesis_branches",
        branch: "hypothesis_branches",
        agent_output: "agent_outputs",
        lab: "labs"
    };
    return tables[entityType] ?? null;
}
function materializeRecord(entityType, row) {
    if (entityType === "source") {
        return {
            entityType,
            id: Number(row.id),
            kind: row.kind,
            pathOrUrl: row.path_or_url,
            title: row.title,
            summary: row.summary,
            body: row.body,
            createdAt: row.created_at
        };
    }
    if (entityType === "surface")
        return { entityType, ...toSurfaceRow(row) };
    if (entityType === "hypothesis")
        return { entityType, ...toHypothesisRow(row) };
    if (entityType === "evidence")
        return { entityType, ...toEvidenceRow(row) };
    if (entityType === "decision")
        return { ...toDecisionRow(row), entityType };
    if (entityType === "gate" || entityType === "validation_gate")
        return { ...toValidationGateRow(row), entityType: "gate" };
    if (entityType === "round")
        return { entityType, ...toRoundRow(row) };
    if (entityType === "campaign")
        return { entityType, ...toCampaignRow(row) };
    if (entityType === "entity_link")
        return { entityType, ...toEntityLinkRow(row) };
    if (entityType === "campaign_event") {
        const event = toCampaignEventRow(row);
        return {
            entityType,
            id: event.id,
            campaignId: event.campaignId,
            eventType: event.eventType,
            linkedEntityType: event.entityType,
            entityId: event.entityId,
            summary: event.summary,
            createdAt: event.createdAt
        };
    }
    if (entityType === "hypothesis_branch" || entityType === "branch") {
        return { entityType: "hypothesis_branch", ...toHypothesisBranchRow(row) };
    }
    return { entityType, ...row };
}
function computeRoi(roi) {
    return (roi.impactPotential +
        roi.externalReachability +
        roi.trustBoundaryDensity +
        roi.recentChangeWeight +
        roi.unexploredInvariantWeight +
        roi.toolingReadiness -
        roi.duplicateRisk -
        roi.expectedBehaviorLikelihood -
        roi.priorExhaustionWeight -
        roi.validationCost -
        roi.lowSignalHistory);
}
function requireTarget(db) {
    const target = db.getTarget();
    if (!target) {
        throw new Error("Target is not initialized. Run `proteus init <target-root>` first.");
    }
    return { id: target.id };
}
function json(value) {
    return JSON.stringify(value);
}
function parseJson(value) {
    return JSON.parse(value);
}
function sha256(value) {
    return node_crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function nowIso() {
    return new Date().toISOString();
}
function createDefaultContract(targetRoot, name) {
    return {
        target: name ?? node_path_1.default.basename(targetRoot),
        scopeRoot: targetRoot,
        inScope: [],
        outOfScope: [],
        existingWork: [],
        primaryImpactClasses: [],
        hardExclusions: [],
        assumptions: [],
        availableTooling: [],
        credentialsAvailable: "unknown",
        continuousMode: false,
        stopOnCandidate: true
    };
}
