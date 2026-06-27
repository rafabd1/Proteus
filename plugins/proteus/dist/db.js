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
const CURRENT_PROTEUS_VERSION = packageVersion();
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
        this.db.exec("PRAGMA busy_timeout = 10000;");
        this.migrateIfNeeded();
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
        const existing = this.db
            .prepare(`SELECT id FROM entity_links
         WHERE target_id = ? AND from_type = ? AND from_id = ?
           AND to_type = ? AND to_id = ? AND relation = ?
         LIMIT 1`)
            .get(target.id, input.fromType, input.fromId, input.toType, input.toId, input.relation);
        if (existing)
            return Number(existing.id);
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
    linkActiveCampaignTo(input) {
        const campaigns = this.listCampaigns("active");
        if (campaigns.length !== 1)
            return null;
        const campaign = campaigns[0];
        const linkId = this.addEntityLink({
            fromType: "campaign",
            fromId: campaign.id,
            toType: input.toType,
            toId: input.toId,
            relation: input.relation,
            confidence: 1,
            note: input.note ?? "Auto-linked to the single active campaign."
        });
        if (input.eventSummary) {
            this.addCampaignEvent({
                campaignId: campaign.id,
                eventType: input.eventType ?? "entity_linked",
                entityType: input.toType,
                entityId: input.toId,
                summary: input.eventSummary
            });
        }
        return { campaignId: campaign.id, linkId };
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
    addCampaignCheckpoint(input) {
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO campaign_checkpoints
          (campaign_id, confirmed_json, killed_json, open_json, pivots_json,
           score_changes_json, context_to_persist_json, next_high_roi_move,
           contract_signature_json, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(input.campaignId, json(input.confirmed), json(input.killed), json(input.open), json(input.pivots), json(input.scoreChanges), json(input.contextToPersist), input.nextHighRoiMove, json(input.contractSignature), input.summary ?? "", now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("campaign_checkpoint", id, `${input.summary ?? ""}\n${input.nextHighRoiMove}\n${json(input.confirmed)}\n${json(input.killed)}\n${json(input.open)}`);
        this.addCampaignEvent({
            campaignId: input.campaignId,
            eventType: "campaign_checkpoint_recorded",
            entityType: "campaign_checkpoint",
            entityId: id,
            summary: input.summary ?? `Checkpoint recorded; next move: ${input.nextHighRoiMove || "unspecified"}`
        });
        return id;
    }
    listCampaignCheckpoints(campaignId, limit = 10) {
        return this.db
            .prepare("SELECT * FROM campaign_checkpoints WHERE campaign_id = ? ORDER BY id DESC LIMIT ?")
            .all(campaignId, limit)
            .map(toCampaignCheckpointRow);
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
        const checkpoints = this.listCampaignCheckpoints(campaignId, 5);
        return {
            campaign,
            activeRounds: rounds.filter((round) => round.status === "active"),
            openBranches: branches.filter((branch) => branch.status === "open" || branch.status === "testing"),
            killedBranches: branches.filter((branch) => branch.status === "killed").slice(0, 10),
            recentEvents: events,
            recentCheckpoints: checkpoints,
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
    querySimilar(query, limit = 10) {
        return {
            duplicateCoverage: this.queryCoverage(query, Math.max(3, Math.ceil(limit / 2))),
            memoryMatches: this.search(query, limit)
        };
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
    listMigrations() {
        return this.db
            .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY applied_at ASC, version ASC")
            .all()
            .map((row) => ({
            version: String(row.version),
            appliedAt: String(row.applied_at)
        }));
    }
    getProteusVersionRecord() {
        const storedVersion = this.getMetadata("proteus_version");
        return {
            currentVersion: CURRENT_PROTEUS_VERSION,
            storedVersion,
            migrationRequired: storedVersion !== CURRENT_PROTEUS_VERSION
        };
    }
    runMigrations() {
        const before = this.getProteusVersionRecord();
        this.migrate(true);
        const after = this.getProteusVersionRecord();
        return {
            ...after,
            previousStoredVersion: before.storedVersion
        };
    }
    getChimeraConfig() {
        const raw = this.getMetadata("chimera_config_json");
        if (!raw)
            return null;
        const parsed = parseJson(raw);
        return normalizeChimeraConfig(parsed);
    }
    saveChimeraConfig(config) {
        this.setMetadata("chimera_config_json", json(config));
    }
    createChimeraSession(input) {
        const target = requireTarget(this);
        const now = nowIso();
        const publicId = input.publicId ?? this.nextChimeraPublicId();
        const result = this.db
            .prepare(`INSERT INTO chimera_sessions
          (public_id, target_id, campaign_id, round_id, role, goal, status,
           access_mode, access_notes, model, provider, session_dir, lab_dir, opencode_command, opencode_pid,
           opencode_server_url, opencode_session_id, created_at, updated_at, closed_at, close_verdict, close_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(publicId, target.id, input.campaignId ?? null, input.roundId ?? null, input.role, input.goal, "starting", input.accessMode ?? "explorer", input.accessNotes ?? null, input.model ?? null, input.provider ?? null, input.sessionDir, input.labDir, input.opencodeCommand ?? null, null, input.opencodeServerUrl ?? null, input.opencodeSessionId ?? null, now, now, null, null, null);
        const id = Number(result.lastInsertRowid);
        this.indexFts("chimera_session", id, `${publicId}\n${input.role}\n${input.goal}\n${input.model ?? ""}`);
        return this.getChimeraSession(publicId);
    }
    getChimeraSession(publicId) {
        const row = this.db.prepare("SELECT * FROM chimera_sessions WHERE public_id = ?").get(publicId);
        return row ? toChimeraSessionRow(row) : null;
    }
    listChimeraSessions(input = {}) {
        const rows = this.db
            .prepare("SELECT * FROM chimera_sessions ORDER BY id DESC")
            .all()
            .map(toChimeraSessionRow)
            .filter((session) => !input.status || session.status === input.status);
        return rows.slice(0, input.limit ?? 50);
    }
    updateChimeraSession(input) {
        const current = this.getChimeraSession(input.publicId);
        if (!current)
            throw new Error(`Chimera session not found: ${input.publicId}`);
        const status = input.status ?? current.status;
        const now = nowIso();
        const closedAt = status === "closed" || status === "killed" || status === "failed" || status === "timeout"
            ? now
            : current.closedAt || null;
        this.db
            .prepare(`UPDATE chimera_sessions
         SET status = ?, opencode_pid = ?, updated_at = ?, closed_at = ?,
             close_verdict = ?, close_summary = ?,
             opencode_server_url = ?, opencode_session_id = ?
         WHERE public_id = ?`)
            .run(status, input.opencodePid === undefined ? current.opencodePid : input.opencodePid, now, closedAt, input.closeVerdict === undefined ? current.closeVerdict : input.closeVerdict, input.closeSummary === undefined ? current.closeSummary : input.closeSummary, input.opencodeServerUrl === undefined ? current.opencodeServerUrl : input.opencodeServerUrl, input.opencodeSessionId === undefined ? current.opencodeSessionId : input.opencodeSessionId, input.publicId);
        this.indexFts("chimera_session", current.id, `${current.publicId}\n${status}\n${current.role}\n${current.goal}\n${input.closeVerdict ?? ""}\n${input.closeSummary ?? ""}`);
        return this.getChimeraSession(input.publicId);
    }
    addChimeraMessage(input) {
        const session = this.getChimeraSession(input.publicId);
        if (!session)
            throw new Error(`Chimera session not found: ${input.publicId}`);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO chimera_messages
          (session_id, direction, kind, body, metadata_json,
           read_by_coordinator, read_by_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(session.id, input.direction, input.kind, input.body, json(input.metadata ?? {}), input.readByCoordinator ? 1 : 0, input.readByAgent ? 1 : 0, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts("chimera_message", id, `${session.publicId}\n${input.direction}\n${input.kind}\n${input.body}`);
        return this.getChimeraMessage(id);
    }
    getChimeraMessage(id) {
        const row = this.db
            .prepare(`SELECT m.*, s.public_id
         FROM chimera_messages m
         JOIN chimera_sessions s ON s.id = m.session_id
         WHERE m.id = ?`)
            .get(id);
        return row ? toChimeraMessageRow(row) : null;
    }
    listChimeraMessages(input = {}) {
        const rows = this.db
            .prepare(`SELECT m.*, s.public_id
         FROM chimera_messages m
         JOIN chimera_sessions s ON s.id = m.session_id
         ORDER BY m.id DESC`)
            .all()
            .map(toChimeraMessageRow)
            .filter((message) => !input.publicId || message.publicId === input.publicId)
            .filter((message) => {
            if (input.unreadFor === "coordinator")
                return message.direction === "agent_to_coordinator" && !message.readByCoordinator;
            if (input.unreadFor === "agent")
                return message.direction === "coordinator_to_agent" && !message.readByAgent;
            return true;
        });
        return rows.slice(0, input.limit ?? 50).reverse();
    }
    markChimeraMessagesRead(ids, side) {
        if (ids.length === 0)
            return;
        const column = side === "coordinator" ? "read_by_coordinator" : "read_by_agent";
        const statement = this.db.prepare(`UPDATE chimera_messages SET ${column} = 1 WHERE id = ?`);
        for (const id of ids)
            statement.run(id);
    }
    latestChimeraSnapshot(publicId) {
        const row = this.db
            .prepare(`SELECT m.*, s.public_id
         FROM chimera_messages m
         JOIN chimera_sessions s ON s.id = m.session_id
         WHERE s.public_id = ? AND m.kind = 'snapshot'
         ORDER BY m.id DESC
         LIMIT 1`)
            .get(publicId);
        return row ? toChimeraMessageRow(row) : null;
    }
    mergeMemoryBases(sources, options = {}) {
        const destinationTarget = requireTarget(this);
        const sourceInputs = sources.map((source) => source.trim()).filter(Boolean);
        if (sourceInputs.length === 0)
            throw new Error("At least one source base is required.");
        const result = {
            ok: true,
            dryRun: options.dryRun === true,
            destinationRoot: this.targetRoot,
            destinationDbPath: this.dbPath,
            sources: [],
            totals: emptyMergeCounts()
        };
        if (!options.dryRun)
            this.db.exec("BEGIN");
        try {
            for (const sourceInput of sourceInputs) {
                const sourceRoot = resolveProteusSourceRoot(sourceInput, options.sourceBaseRoot ?? this.targetRoot);
                const source = new ProteusDb(sourceRoot);
                try {
                    if (node_path_1.default.resolve(source.dbPath) === node_path_1.default.resolve(this.dbPath)) {
                        result.sources.push({
                            input: sourceInput,
                            root: source.targetRoot,
                            dbPath: source.dbPath,
                            skipped: true,
                            reason: "source and destination are the same database",
                            counts: emptyMergeCounts()
                        });
                        continue;
                    }
                    const sourceResult = this.mergeOneSource(source, destinationTarget.id, options.dryRun === true);
                    result.sources.push({
                        input: sourceInput,
                        root: source.targetRoot,
                        dbPath: source.dbPath,
                        skipped: false,
                        counts: sourceResult.counts,
                        sourceTarget: source.getTarget()?.name ?? null
                    });
                    addMergeCounts(result.totals, sourceResult.counts);
                }
                finally {
                    source.close();
                }
            }
            if (!options.dryRun)
                this.db.exec("COMMIT");
        }
        catch (error) {
            if (!options.dryRun)
                this.db.exec("ROLLBACK");
            throw error;
        }
        return result;
    }
    count(table) {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
        return Number(row.count);
    }
    mergeOneSource(source, destinationTargetId, dryRun) {
        const counts = emptyMergeCounts();
        const maps = {};
        const countOnly = (key, table) => {
            counts[key] += source.count(table);
        };
        if (dryRun) {
            countOnly("targetProfiles", "target_profiles");
            countOnly("sources", "sources");
            countOnly("surfaces", "surfaces");
            countOnly("hypotheses", "hypotheses");
            countOnly("evidence", "evidence");
            countOnly("rounds", "rounds");
            countOnly("campaigns", "campaigns");
            countOnly("decisions", "decisions");
            countOnly("validationGates", "validation_gates");
            countOnly("labs", "labs");
            countOnly("agentOutputs", "agent_outputs");
            countOnly("hypothesisBranches", "hypothesis_branches");
            countOnly("campaignCheckpoints", "campaign_checkpoints");
            countOnly("entityLinks", "entity_links");
            countOnly("campaignEvents", "campaign_events");
            return { counts };
        }
        for (const row of source.rows("target_profiles")) {
            const newId = this.insertRow(`INSERT INTO target_profiles (target_id, profile_json, created_at)
         VALUES (?, ?, ?)`, [destinationTargetId, row.profile_json, row.created_at]);
            mapId(maps, "target_profile", Number(row.id), newId);
            counts.targetProfiles += 1;
        }
        for (const row of source.rows("sources")) {
            const existing = this.db
                .prepare("SELECT id FROM sources WHERE target_id = ? AND content_hash = ?")
                .get(destinationTargetId, String(row.content_hash));
            if (existing) {
                mapId(maps, "source", Number(row.id), Number(existing.id));
                counts.duplicateSources += 1;
                continue;
            }
            const newId = this.insertRow(`INSERT INTO sources
          (target_id, kind, path_or_url, title, content_hash, summary, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [destinationTargetId, row.kind, row.path_or_url, row.title, row.content_hash, row.summary, row.body, row.created_at]);
            mapId(maps, "source", Number(row.id), newId);
            this.copyFtsRows(source, "source", Number(row.id), newId);
            counts.sources += 1;
        }
        for (const row of source.rows("surfaces")) {
            const newId = this.insertRow(`INSERT INTO surfaces
          (target_id, name, family, description, files_json, symbols_json,
           entrypoints_json, trust_boundaries_json, runtime_modes_json, status,
           roi_json, roi_score, exhaustion_level, revisit_condition, last_reviewed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                row.name,
                row.family,
                row.description,
                row.files_json,
                row.symbols_json,
                row.entrypoints_json,
                row.trust_boundaries_json,
                row.runtime_modes_json,
                row.status,
                row.roi_json,
                row.roi_score,
                row.exhaustion_level,
                row.revisit_condition,
                row.last_reviewed_at,
                row.created_at,
                row.updated_at
            ]);
            mapId(maps, "surface", Number(row.id), newId);
            this.copyFtsRows(source, "surface", Number(row.id), newId);
            counts.surfaces += 1;
        }
        for (const row of source.rows("hypotheses")) {
            const newId = this.insertRow(`INSERT INTO hypotheses
          (target_id, surface_id, title, primitive, attacker_boundary, impact_claim,
           heuristic_family, status, score, duplicate_risk, expected_behavior_risk,
           validation_cost, kill_criteria, revisit_condition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                remapNullableId(maps, "surface", row.surface_id),
                row.title,
                row.primitive,
                row.attacker_boundary,
                row.impact_claim,
                row.heuristic_family,
                row.status,
                row.score,
                row.duplicate_risk,
                row.expected_behavior_risk,
                row.validation_cost,
                row.kill_criteria,
                row.revisit_condition,
                row.created_at,
                row.updated_at
            ]);
            mapId(maps, "hypothesis", Number(row.id), newId);
            this.copyFtsRows(source, "hypothesis", Number(row.id), newId);
            counts.hypotheses += 1;
        }
        for (const row of source.rows("evidence")) {
            const newId = this.insertRow(`INSERT INTO evidence (target_id, kind, title, body, path_or_url, command, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [destinationTargetId, row.kind, row.title, row.body, row.path_or_url, row.command, row.hash, row.created_at]);
            mapId(maps, "evidence", Number(row.id), newId);
            this.copyFtsRows(source, "evidence", Number(row.id), newId);
            counts.evidence += 1;
        }
        for (const row of source.rows("rounds")) {
            const newId = this.insertRow(`INSERT INTO rounds
          (target_id, objective, current_understanding, selected_surfaces_json,
           skipped_surfaces_json, agent_fronts_json, validation_gates_json,
           stop_conditions_json, outcome, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                row.objective,
                row.current_understanding,
                row.selected_surfaces_json,
                row.skipped_surfaces_json,
                row.agent_fronts_json,
                row.validation_gates_json,
                row.stop_conditions_json,
                row.outcome,
                row.created_at,
                row.completed_at
            ]);
            mapId(maps, "round", Number(row.id), newId);
            this.copyFtsRows(source, "round", Number(row.id), newId);
            counts.rounds += 1;
        }
        for (const row of source.rows("campaigns")) {
            const newId = this.insertRow(`INSERT INTO campaigns
          (target_id, title, objective, status, current_state_summary,
           recent_learning_summary, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                row.title,
                row.objective,
                row.status,
                row.current_state_summary,
                row.recent_learning_summary,
                row.created_at,
                row.updated_at,
                row.closed_at
            ]);
            mapId(maps, "campaign", Number(row.id), newId);
            this.copyFtsRows(source, "campaign", Number(row.id), newId);
            counts.campaigns += 1;
        }
        for (const row of source.rows("decisions")) {
            const ref = remapReference(maps, String(row.entity_type), Number(row.entity_id));
            const newId = this.insertRow(`INSERT INTO decisions
          (target_id, entity_type, entity_id, decision, reason, evidence_ids_json, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                ref.entityType,
                ref.entityId,
                row.decision,
                row.reason,
                remapEvidenceIdsJson(maps, row.evidence_ids_json),
                row.actor,
                row.created_at
            ]);
            mapId(maps, "decision", Number(row.id), newId);
            this.copyFtsRows(source, "decision", Number(row.id), newId);
            counts.decisions += 1;
        }
        for (const row of source.rows("validation_gates")) {
            const ref = remapReference(maps, String(row.entity_type), Number(row.entity_id));
            const newId = this.insertRow(`INSERT INTO validation_gates
          (target_id, entity_type, entity_id, gate, status, summary, evidence_ids_json, actor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                ref.entityType,
                ref.entityId,
                row.gate,
                row.status,
                row.summary,
                remapEvidenceIdsJson(maps, row.evidence_ids_json),
                row.actor,
                row.created_at,
                row.updated_at
            ]);
            mapId(maps, "gate", Number(row.id), newId);
            this.copyFtsRows(source, "gate", Number(row.id), newId);
            counts.validationGates += 1;
        }
        for (const row of source.rows("labs")) {
            const newId = this.insertRow(`INSERT INTO labs
          (target_id, candidate_id, path, config_legitimacy, status, limitations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                remapNullableId(maps, "hypothesis", row.candidate_id) ?? remapNullableId(maps, "hypothesis_branch", row.candidate_id) ?? row.candidate_id,
                row.path,
                row.config_legitimacy,
                row.status,
                row.limitations,
                row.created_at,
                row.updated_at
            ]);
            mapId(maps, "lab", Number(row.id), newId);
            counts.labs += 1;
        }
        for (const row of source.rows("agent_outputs")) {
            const roundId = remapNullableId(maps, "round", row.round_id);
            if (roundId === null) {
                counts.skippedAgentOutputs += 1;
                continue;
            }
            const newId = this.insertRow(`INSERT INTO agent_outputs
          (target_id, round_id, agent_codename, agent_role_family, assigned_surface,
           output_path, covered_surface_json, live_candidates_json, killed_hypotheses_json,
           probes_json, uncovered_areas_json, validation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                roundId,
                row.agent_codename,
                row.agent_role_family,
                row.assigned_surface,
                row.output_path,
                row.covered_surface_json,
                row.live_candidates_json,
                row.killed_hypotheses_json,
                row.probes_json,
                row.uncovered_areas_json,
                row.validation_status,
                row.created_at
            ]);
            mapId(maps, "agent_output", Number(row.id), newId);
            this.copyFtsRows(source, "agent_output", Number(row.id), newId);
            counts.agentOutputs += 1;
        }
        for (const row of source.rows("hypothesis_branches")) {
            const newId = this.insertRow(`INSERT INTO hypothesis_branches
          (target_id, campaign_id, round_id, surface_id, title, hypothesis,
           attack_primitive, why_non_obvious, preconditions_json, steps_json,
           success_criteria_json, negative_controls_json, kill_conditions_json,
           roi_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                destinationTargetId,
                remapNullableId(maps, "campaign", row.campaign_id),
                remapNullableId(maps, "round", row.round_id),
                remapNullableId(maps, "surface", row.surface_id),
                row.title,
                row.hypothesis,
                row.attack_primitive,
                row.why_non_obvious,
                row.preconditions_json,
                row.steps_json,
                row.success_criteria_json,
                row.negative_controls_json,
                row.kill_conditions_json,
                row.roi_json,
                row.status,
                row.created_at,
                row.updated_at
            ]);
            mapId(maps, "hypothesis_branch", Number(row.id), newId);
            this.copyFtsRows(source, "hypothesis_branch", Number(row.id), newId);
            counts.hypothesisBranches += 1;
        }
        for (const row of source.rows("campaign_checkpoints")) {
            const campaignId = remapNullableId(maps, "campaign", row.campaign_id);
            if (campaignId === null) {
                counts.skippedCampaignCheckpoints += 1;
                continue;
            }
            const newId = this.insertRow(`INSERT INTO campaign_checkpoints
          (campaign_id, confirmed_json, killed_json, open_json, pivots_json,
           score_changes_json, context_to_persist_json, next_high_roi_move,
           contract_signature_json, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                campaignId,
                row.confirmed_json,
                row.killed_json,
                row.open_json,
                row.pivots_json,
                row.score_changes_json,
                row.context_to_persist_json,
                row.next_high_roi_move,
                row.contract_signature_json,
                row.summary,
                row.created_at
            ]);
            mapId(maps, "campaign_checkpoint", Number(row.id), newId);
            this.copyFtsRows(source, "campaign_checkpoint", Number(row.id), newId);
            counts.campaignCheckpoints += 1;
        }
        for (const row of source.rows("entity_links")) {
            const from = remapReference(maps, String(row.from_type), Number(row.from_id));
            const to = remapReference(maps, String(row.to_type), Number(row.to_id));
            if (!from.mapped || !to.mapped) {
                counts.skippedEntityLinks += 1;
                continue;
            }
            const newId = this.addEntityLink({
                fromType: from.entityType,
                fromId: from.entityId,
                toType: to.entityType,
                toId: to.entityId,
                relation: String(row.relation),
                confidence: Number(row.confidence ?? 1),
                note: String(row.note ?? "")
            });
            mapId(maps, "entity_link", Number(row.id), newId);
            this.copyFtsRows(source, "entity_link", Number(row.id), newId);
            counts.entityLinks += 1;
        }
        for (const row of source.rows("campaign_events")) {
            const campaignId = remapNullableId(maps, "campaign", row.campaign_id);
            if (campaignId === null) {
                counts.skippedCampaignEvents += 1;
                continue;
            }
            const ref = row.entity_type === null || row.entity_id === null
                ? { entityType: null, entityId: null }
                : remapReference(maps, String(row.entity_type), Number(row.entity_id));
            const newId = this.insertRow(`INSERT INTO campaign_events
          (campaign_id, event_type, entity_type, entity_id, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`, [
                campaignId,
                row.event_type,
                ref.entityType,
                ref.entityId,
                row.summary,
                row.created_at
            ]);
            mapId(maps, "campaign_event", Number(row.id), newId);
            this.copyFtsRows(source, "campaign_event", Number(row.id), newId);
            counts.campaignEvents += 1;
        }
        return { counts };
    }
    rows(table) {
        return this.db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
    }
    insertRow(sql, values) {
        const result = this.db.prepare(sql).run(...values.map(toSqlValue));
        return Number(result.lastInsertRowid);
    }
    copyFtsRows(source, entityType, oldId, newId) {
        const rows = source.db
            .prepare("SELECT content FROM proteus_fts WHERE entity_type = ? AND entity_id = ?")
            .all(entityType, oldId);
        for (const row of rows) {
            this.indexFts(entityType, newId, String(row.content ?? ""));
        }
    }
    nextChimeraPublicId() {
        const row = this.db.prepare("SELECT id FROM chimera_sessions ORDER BY id DESC LIMIT 1").get();
        const nextId = Number(row?.id ?? 0) + 1;
        return `CH-${String(nextId).padStart(4, "0")}`;
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
    migrateIfNeeded() {
        this.ensureMetadataTable();
        if (this.getMetadata("proteus_version") === CURRENT_PROTEUS_VERSION)
            return;
        this.migrate(false);
    }
    migrate(force) {
        this.ensureMetadataTable();
        if (!force && this.getMetadata("proteus_version") === CURRENT_PROTEUS_VERSION)
            return;
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
        this.applyMigration("2026-05-17-validation-gates-surfaces-and-focused-duplicates", BASE_SCHEMA_SQL);
        this.applyMigration("2026-06-17-campaigns-links-branches", CAMPAIGN_SCHEMA_SQL);
        this.applyMigration("2026-06-17-campaign-checkpoints", CAMPAIGN_CHECKPOINT_SCHEMA_SQL);
        this.applyMigration("2026-06-27-chimera-mode", CHIMERA_SCHEMA_SQL);
        this.applyMigration("2026-06-27-chimera-opencode-control", CHIMERA_OPENCODE_CONTROL_SCHEMA_SQL);
        this.setMetadata("proteus_version", CURRENT_PROTEUS_VERSION);
    }
    ensureMetadataTable() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS proteus_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    }
    getMetadata(key) {
        this.ensureMetadataTable();
        const row = this.db.prepare("SELECT value FROM proteus_metadata WHERE key = ?").get(key);
        return row ? String(row.value) : null;
    }
    setMetadata(key, value) {
        this.ensureMetadataTable();
        this.db
            .prepare(`INSERT INTO proteus_metadata (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
            .run(key, value, nowIso());
    }
    applyMigration(version, sql) {
        const existing = this.db
            .prepare("SELECT version FROM schema_migrations WHERE version = ?")
            .get(version);
        if (existing)
            return;
        this.db.exec("BEGIN");
        try {
            this.db.exec(sql);
            this.db
                .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
                .run(version, nowIso());
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    indexFts(entityType, entityId, content) {
        this.db
            .prepare("INSERT INTO proteus_fts (entity_type, entity_id, content) VALUES (?, ?, ?)")
            .run(entityType, entityId, content);
    }
}
exports.ProteusDb = ProteusDb;
const BASE_SCHEMA_SQL = `
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
`;
const CAMPAIGN_SCHEMA_SQL = `
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
`;
const CAMPAIGN_CHECKPOINT_SCHEMA_SQL = `
      CREATE TABLE IF NOT EXISTS campaign_checkpoints (
        id INTEGER PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        confirmed_json TEXT NOT NULL,
        killed_json TEXT NOT NULL,
        open_json TEXT NOT NULL,
        pivots_json TEXT NOT NULL,
        score_changes_json TEXT NOT NULL,
        context_to_persist_json TEXT NOT NULL,
        next_high_roi_move TEXT NOT NULL,
        contract_signature_json TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      );
`;
const CHIMERA_SCHEMA_SQL = `
      CREATE TABLE IF NOT EXISTS chimera_sessions (
        id INTEGER PRIMARY KEY,
        public_id TEXT NOT NULL UNIQUE,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
        round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        access_mode TEXT NOT NULL DEFAULT 'lab',
        access_notes TEXT,
        model TEXT,
        provider TEXT,
        session_dir TEXT NOT NULL,
        lab_dir TEXT NOT NULL,
        opencode_command TEXT,
        opencode_pid INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        close_verdict TEXT,
        close_summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_chimera_sessions_target_status
        ON chimera_sessions(target_id, status);

      CREATE TABLE IF NOT EXISTS chimera_messages (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chimera_sessions(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        read_by_coordinator INTEGER NOT NULL DEFAULT 0,
        read_by_agent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chimera_messages_session_created
        ON chimera_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chimera_messages_unread_coordinator
        ON chimera_messages(read_by_coordinator, direction);
      CREATE INDEX IF NOT EXISTS idx_chimera_messages_unread_agent
        ON chimera_messages(read_by_agent, direction);
`;
const CHIMERA_OPENCODE_CONTROL_SCHEMA_SQL = `
      ALTER TABLE chimera_sessions ADD COLUMN opencode_server_url TEXT;
      ALTER TABLE chimera_sessions ADD COLUMN opencode_session_id TEXT;
`;
function emptyMergeCounts() {
    return {
        targetProfiles: 0,
        sources: 0,
        duplicateSources: 0,
        surfaces: 0,
        hypotheses: 0,
        evidence: 0,
        decisions: 0,
        validationGates: 0,
        rounds: 0,
        campaigns: 0,
        labs: 0,
        agentOutputs: 0,
        skippedAgentOutputs: 0,
        hypothesisBranches: 0,
        campaignCheckpoints: 0,
        skippedCampaignCheckpoints: 0,
        entityLinks: 0,
        skippedEntityLinks: 0,
        campaignEvents: 0,
        skippedCampaignEvents: 0
    };
}
function addMergeCounts(target, source) {
    for (const key of Object.keys(target)) {
        target[key] += source[key];
    }
}
function resolveProteusSourceRoot(input, baseRoot) {
    const resolved = node_path_1.default.resolve(baseRoot, input);
    const base = node_path_1.default.basename(resolved).toLowerCase();
    const parent = node_path_1.default.basename(node_path_1.default.dirname(resolved)).toLowerCase();
    if (base === "memory.sqlite" && parent === ".vros") {
        return node_path_1.default.dirname(node_path_1.default.dirname(resolved));
    }
    if (base === ".vros") {
        return node_path_1.default.dirname(resolved);
    }
    if (node_fs_1.default.existsSync(resolved)) {
        const stat = node_fs_1.default.statSync(resolved);
        if (stat.isFile()) {
            throw new Error(`Source file must be a .vros/memory.sqlite database: ${resolved}`);
        }
    }
    return resolved;
}
function mapId(maps, entityType, oldId, newId) {
    const key = mergeMapKey(entityType);
    maps[key] ??= new Map();
    maps[key]?.set(oldId, newId);
}
function remapNullableId(maps, entityType, value) {
    if (value === null || value === undefined)
        return null;
    const oldId = Number(value);
    if (!Number.isFinite(oldId))
        return null;
    return maps[mergeMapKey(entityType)]?.get(oldId) ?? null;
}
function remapReference(maps, entityType, entityId) {
    const key = mergeMapKey(entityType);
    const mapped = maps[key]?.get(entityId);
    return {
        entityType: key,
        entityId: mapped ?? entityId,
        mapped: mapped !== undefined
    };
}
function remapEvidenceIdsJson(maps, value) {
    try {
        const ids = JSON.parse(String(value));
        if (!Array.isArray(ids))
            return String(value ?? "[]");
        return json(ids.map((id) => remapNullableId(maps, "evidence", id)).filter((id) => id !== null));
    }
    catch {
        return String(value ?? "[]");
    }
}
function toSqlValue(value) {
    if (value === undefined)
        return null;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === "boolean")
        return value ? 1 : 0;
    return String(value);
}
function mergeMapKey(entityType) {
    const normalized = entityType.trim().toLowerCase();
    const aliases = {
        validation_gate: "gate",
        gates: "gate",
        branch: "hypothesis_branch",
        checkpoint: "campaign_checkpoint",
        profile: "target_profile"
    };
    return aliases[normalized] ?? normalized;
}
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
function toChimeraSessionRow(row) {
    return {
        id: Number(row.id),
        publicId: String(row.public_id),
        campaignId: row.campaign_id === null || row.campaign_id === undefined ? null : Number(row.campaign_id),
        roundId: row.round_id === null || row.round_id === undefined ? null : Number(row.round_id),
        role: String(row.role),
        goal: String(row.goal),
        status: normalizeChimeraStatus(String(row.status)),
        accessMode: normalizeChimeraAccessMode(String(row.access_mode ?? "")),
        accessNotes: String(row.access_notes ?? ""),
        model: row.model === null || row.model === undefined ? null : String(row.model),
        provider: row.provider === null || row.provider === undefined ? null : String(row.provider),
        sessionDir: String(row.session_dir),
        labDir: String(row.lab_dir),
        opencodeCommand: row.opencode_command === null || row.opencode_command === undefined ? null : String(row.opencode_command),
        opencodePid: row.opencode_pid === null || row.opencode_pid === undefined ? null : Number(row.opencode_pid),
        opencodeServerUrl: row.opencode_server_url === null || row.opencode_server_url === undefined ? null : String(row.opencode_server_url),
        opencodeSessionId: row.opencode_session_id === null || row.opencode_session_id === undefined ? null : String(row.opencode_session_id),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        closedAt: row.closed_at === null || row.closed_at === undefined ? null : String(row.closed_at),
        closeVerdict: row.close_verdict === null || row.close_verdict === undefined ? null : String(row.close_verdict),
        closeSummary: row.close_summary === null || row.close_summary === undefined ? null : String(row.close_summary)
    };
}
function toChimeraMessageRow(row) {
    return {
        id: Number(row.id),
        publicId: String(row.public_id),
        sessionId: Number(row.session_id),
        direction: normalizeChimeraMessageDirection(String(row.direction)),
        kind: normalizeChimeraMessageKind(String(row.kind)),
        body: String(row.body ?? ""),
        metadata: parseJson(String(row.metadata_json ?? "{}")),
        readByCoordinator: Boolean(row.read_by_coordinator),
        readByAgent: Boolean(row.read_by_agent),
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
function toCampaignCheckpointRow(row) {
    return {
        id: Number(row.id),
        campaignId: Number(row.campaign_id),
        confirmed: parseJson(String(row.confirmed_json)),
        killed: parseJson(String(row.killed_json)),
        open: parseJson(String(row.open_json)),
        pivots: parseJson(String(row.pivots_json)),
        scoreChanges: parseJson(String(row.score_changes_json)),
        contextToPersist: parseJson(String(row.context_to_persist_json)),
        nextHighRoiMove: String(row.next_high_roi_move),
        contractSignature: parseJson(String(row.contract_signature_json)),
        summary: String(row.summary ?? ""),
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
function normalizeChimeraConfig(input) {
    return {
        enabled: input.enabled === true,
        runtime: "opencode",
        opencodeCommand: typeof input.opencodeCommand === "string" && input.opencodeCommand.trim()
            ? input.opencodeCommand.trim()
            : "opencode",
        opencodeServerUrl: typeof input.opencodeServerUrl === "string" && input.opencodeServerUrl.trim()
            ? input.opencodeServerUrl.trim()
            : null,
        opencodeServerPid: Number.isFinite(input.opencodeServerPid) && Number(input.opencodeServerPid) > 0
            ? Math.floor(Number(input.opencodeServerPid))
            : null,
        defaultModel: typeof input.defaultModel === "string" && input.defaultModel.trim() ? input.defaultModel.trim() : null,
        defaultVariant: typeof input.defaultVariant === "string" && input.defaultVariant.trim() ? input.defaultVariant.trim() : null,
        defaultAgent: typeof input.defaultAgent === "string" && input.defaultAgent.trim() ? input.defaultAgent.trim() : null,
        maxAgents: Number.isFinite(input.maxAgents) && Number(input.maxAgents) > 0 ? Math.floor(Number(input.maxAgents)) : 5,
        defaultTimeoutSec: Number.isFinite(input.defaultTimeoutSec) && Number(input.defaultTimeoutSec) > 0
            ? Math.floor(Number(input.defaultTimeoutSec))
            : 900,
        defaultNetwork: input.defaultNetwork === true,
        skipPermissions: input.skipPermissions !== false
    };
}
function normalizeChimeraStatus(value) {
    if (value === "starting" ||
        value === "running" ||
        value === "waiting" ||
        value === "killed" ||
        value === "closed" ||
        value === "failed" ||
        value === "timeout") {
        return value;
    }
    return value.length > 0 ? "failed" : "starting";
}
function normalizeChimeraAccessMode(value) {
    if (value === "editor")
        return "editor";
    return "explorer";
}
function normalizeChimeraMessageDirection(value) {
    if (value === "coordinator_to_agent" || value === "agent_to_coordinator" || value === "system")
        return value;
    return "system";
}
function normalizeChimeraMessageKind(value) {
    if (value === "message" ||
        value === "redirect" ||
        value === "finding" ||
        value === "blocker" ||
        value === "snapshot" ||
        value === "heartbeat" ||
        value === "council" ||
        value === "kill" ||
        value === "close" ||
        value === "error") {
        return value;
    }
    return "message";
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
        "campaign_checkpoint",
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
        campaign_checkpoint: "campaign_checkpoints",
        checkpoint: "campaign_checkpoints",
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
    if (entityType === "campaign_checkpoint" || entityType === "checkpoint") {
        return { entityType: "campaign_checkpoint", ...toCampaignCheckpointRow(row) };
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
function packageVersion() {
    for (const candidate of [
        node_path_1.default.resolve(__dirname, "..", "package.json"),
        node_path_1.default.resolve(__dirname, "..", "..", "..", "package.json")
    ]) {
        if (!node_fs_1.default.existsSync(candidate))
            continue;
        try {
            const pkg = JSON.parse(node_fs_1.default.readFileSync(candidate, "utf8"));
            if (pkg.version)
                return pkg.version;
        }
        catch {
            continue;
        }
    }
    return "unknown";
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
