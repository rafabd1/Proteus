#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ProteusDb, createDefaultContract } from "./db";
import { ingestPaths } from "./ingest";
import { defaultGlobalScopeFromTarget, GlobalMemoryDb } from "./global-memory";
import { observeTarget } from "./observe";
import { planRound, renderRoundPlan } from "./planner";
import { renderAgentPrompt } from "./prompts";
import { ROLE_ORDER, ROLES } from "./roles";
import { exportMarkdown } from "./exporter";
import { createLab } from "./lab";
import { resolveTargetRoot } from "./paths";
import type { AgentCodename, BranchStatus, CampaignStatus, RoiFactors, RoundStatus } from "./types";

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonObject;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  handler(args: JsonObject): unknown;
}

const tools: ToolDefinition[] = [
  {
    name: "proteus_init",
    title: "Initialize Proteus Memory",
    description: "Initialize .vros/memory.sqlite for a target codebase.",
    inputSchema: schema({ root: stringProp("Target root path."), name: optionalStringProp("Human-readable target name.") }, ["root"]),
    handler: ({ root, name }) =>
      withDb(str(root), (db) => {
        const contract = createDefaultContract(db.targetRoot, maybeStr(name));
        db.initTarget(contract);
        return { ok: true, target: contract.target, root: db.targetRoot };
      })
  },
  {
    name: "proteus_status",
    title: "Read Proteus Status",
    description: "Return target and SQL memory counts.",
    inputSchema: schema({ root: stringProp("Target root path.") }, ["root"]),
    handler: ({ root }) =>
      withDb(str(root), (db) => {
        const target = db.getTarget();
        return {
          initialized: Boolean(target),
          target,
          memory: db.memoryStats()
        };
      })
  },
  {
    name: "proteus_ingest",
    title: "Ingest Prior Research",
    description: "Index local docs, findings, reports, and notes into Proteus memory.",
    inputSchema: schema({ root: stringProp("Target root path."), paths: arrayProp("Paths relative to root.") }, ["root"]),
    handler: ({ root, paths }) => withDb(str(root), (db) => ingestPaths(db, stringArray(paths)))
  },
  {
    name: "proteus_observe",
    title: "Observe Target",
    description: "Inspect local target environment and store a profile as evidence.",
    inputSchema: schema({ root: stringProp("Target root path.") }, ["root"]),
    handler: ({ root }) =>
      withDb(str(root), (db) => {
        return observeTarget(db);
      })
  },
  {
    name: "proteus_plan_round",
    title: "Plan Research Round",
    description:
      "Create an empty Proteus research-round scaffold or record a coordinator-authored plan. It does not choose targets, rank surfaces, or generate strategic understanding.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        objective: stringProp("Round objective."),
        coordinatorPlan: objectProp("Primary input: coordinator-authored plan to persist and render."),
        currentUnderstanding: stringProp("Coordinator-supplied target understanding."),
        selectedSurfaces: objectArrayProp("Coordinator-selected high-ROI surfaces."),
        skippedSurfaces: objectArrayProp("Coordinator-supplied skipped surfaces or non-goals."),
        agentFronts: objectArrayProp("Coordinator-supplied bounded agent fronts."),
        stopConditions: arrayProp("Coordinator-supplied stop conditions."),
        replanTrigger: stringProp("Coordinator-supplied replan trigger."),
        status: stringProp("Plan status: active, paused, completed, blocked, planned, or superseded. Defaults to active."),
        markdown: booleanProp("Return Markdown instead of JSON.")
      },
      ["root", "objective"]
    ),
    handler: ({ root, objective, coordinatorPlan, currentUnderstanding, selectedSurfaces, skippedSurfaces, agentFronts, stopConditions, replanTrigger, status, markdown }) =>
      withDb(str(root), (db) => {
        const plan = planRound(db, {
          objective: str(objective),
          status: maybeRoundStatus(status),
          coordinatorPlan: objectValue(coordinatorPlan) as never,
          currentUnderstanding: maybeStr(currentUnderstanding),
          selectedSurfaces: objectArray(selectedSurfaces) as never,
          skippedSurfaces: objectArray(skippedSurfaces) as never,
          agentFronts: objectArray(agentFronts) as never,
          stopConditions: Array.isArray(stopConditions) ? stringArray(stopConditions) : undefined,
          replanTrigger: maybeStr(replanTrigger)
        });
        return markdown === true ? renderRoundPlan(plan) : plan;
      })
  },
  {
    name: "proteus_campaign_create",
    title: "Create Campaign",
    description: "Create a campaign as the durable container above rounds, surfaces, branches, evidence, decisions, and agent outputs.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        title: stringProp("Campaign title."),
        objective: stringProp("Campaign objective."),
        status: stringProp("active, paused, completed, blocked, or superseded."),
        currentStateSummary: stringProp("Short current-state summary."),
        recentLearningSummary: stringProp("Short recent-learning summary.")
      },
      ["root", "title"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => {
        const id = db.addCampaign({
          title: str(input.title),
          objective: maybeStr(input.objective) ?? str(input.title),
          status: maybeCampaignStatus(input.status),
          currentStateSummary: maybeStr(input.currentStateSummary),
          recentLearningSummary: maybeStr(input.recentLearningSummary)
        });
        return { ok: true, id, campaign: db.getCampaign(id) };
      })
  },
  {
    name: "proteus_campaign_resume",
    title: "Resume Campaign",
    description: "Return a compact campaign digest with active rounds, open branches, recent events, and links.",
    inputSchema: schema({ root: stringProp("Target root path."), id: numberProp("Campaign id. Defaults to latest active campaign.") }, ["root"]),
    handler: (input) =>
      withDb(str(input.root), (db) => {
        const id = maybeNum(input.id) ?? db.listCampaigns("active")[0]?.id;
        if (!id) return { ok: true, campaign: null, message: "No active campaign found." };
        return { ok: true, ...db.campaignDigest(id) };
      })
  },
  {
    name: "proteus_campaign_checkpoint",
    title: "Checkpoint Campaign",
    description: "Update campaign summaries and append a timeline checkpoint event.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        id: numberProp("Campaign id."),
        status: stringProp("active, paused, completed, blocked, or superseded."),
        currentStateSummary: stringProp("Updated current-state summary."),
        recentLearningSummary: stringProp("Updated recent-learning summary."),
        summary: stringProp("Timeline event summary.")
      },
      ["root", "id"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => {
        const id = num(input.id, 0);
        db.updateCampaign({
          id,
          status: maybeCampaignStatus(input.status),
          currentStateSummary: maybeStr(input.currentStateSummary),
          recentLearningSummary: maybeStr(input.recentLearningSummary),
          eventSummary: maybeStr(input.summary) ?? "Campaign checkpoint recorded."
        });
        return { ok: true, id, campaign: db.getCampaign(id) };
      })
  },
  {
    name: "proteus_campaign_close",
    title: "Close Campaign",
    description: "Close a campaign as completed, blocked, or superseded while preserving the timeline.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        id: numberProp("Campaign id."),
        status: stringProp("completed, blocked, or superseded. Defaults to completed."),
        summary: stringProp("Timeline event summary.")
      },
      ["root", "id"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => {
        const id = num(input.id, 0);
        db.updateCampaign({
          id,
          status: maybeCampaignStatus(input.status) ?? "completed",
          eventSummary: maybeStr(input.summary) ?? "Campaign closed."
        });
        return { ok: true, id, campaign: db.getCampaign(id) };
      })
  },
  {
    name: "proteus_record_branch",
    title: "Record Hypothesis Branch",
    description: "Record an explicit hypothesis-tree branch with attack primitive, steps, controls, kill conditions, ROI, and status.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        campaignId: numberProp("Campaign id."),
        roundId: numberProp("Round id."),
        surfaceId: numberProp("Surface id."),
        title: stringProp("Branch title."),
        hypothesis: stringProp("Hypothesis text."),
        attackPrimitive: stringProp("Attack primitive."),
        whyNonObvious: stringProp("Why this branch is non-obvious."),
        preconditions: arrayProp("Preconditions."),
        steps: arrayProp("Steps."),
        successCriteria: arrayProp("Success criteria."),
        negativeControls: arrayProp("Negative controls."),
        killConditions: arrayProp("Kill conditions."),
        roi: objectProp("Branch ROI object."),
        status: stringProp("open, testing, killed, promoted, or blocked.")
      },
      ["root", "title"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addHypothesisBranch({
          campaignId: maybeNum(input.campaignId),
          roundId: maybeNum(input.roundId),
          surfaceId: maybeNum(input.surfaceId),
          title: str(input.title),
          hypothesis: maybeStr(input.hypothesis) ?? str(input.title),
          attackPrimitive: maybeStr(input.attackPrimitive) ?? "unknown",
          whyNonObvious: maybeStr(input.whyNonObvious) ?? "",
          preconditions: stringArray(input.preconditions),
          steps: stringArray(input.steps),
          successCriteria: stringArray(input.successCriteria),
          negativeControls: stringArray(input.negativeControls),
          killConditions: stringArray(input.killConditions),
          roi: (objectValue(input.roi) ?? {}) as never,
          status: maybeBranchStatus(input.status) ?? "open"
        })
      }))
  },
  {
    name: "proteus_link_entities",
    title: "Link Entities",
    description: "Create a durable relation between two Proteus records, such as campaign has_round round or branch supported_by evidence.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        fromType: stringProp("Source entity type."),
        fromId: numberProp("Source entity id."),
        toType: stringProp("Target entity type."),
        toId: numberProp("Target entity id."),
        relation: stringProp("Relation label."),
        confidence: numberProp("Confidence 0-1."),
        note: stringProp("Short note.")
      },
      ["root", "fromType", "fromId", "toType", "toId", "relation"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addEntityLink({
          fromType: str(input.fromType),
          fromId: num(input.fromId, 0),
          toType: str(input.toType),
          toId: num(input.toId, 0),
          relation: str(input.relation),
          confidence: num(input.confidence, 1),
          note: maybeStr(input.note)
        })
      }))
  },
  {
    name: "proteus_roles",
    title: "List Proteus Roles",
    description: "Return Proteus specialist roles and their output contracts.",
    inputSchema: schema({}, []),
    handler: () =>
      ROLE_ORDER.map((codename) => ({
        ...ROLES[codename]
      }))
  },
  {
    name: "proteus_prompt",
    title: "Render Agent Prompt",
    description: "Render a Proteus specialist-agent prompt for a bounded surface.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        role: stringProp("Role codename: argus, loom, chaos, libris, mimic, artificer, or skeptic."),
        surface: stringProp("Bounded surface assigned by the coordinator."),
        objective: stringProp("Round or front objective."),
        avoid: arrayProp("Known paths, claims, or surfaces to avoid.")
      },
      ["root", "role", "surface"]
    ),
    handler: ({ root, role, surface, objective, avoid }) =>
      withDb(str(root), (db) => {
        const codename = str(role) as AgentCodename;
        if (!(codename in ROLES)) throw new Error(`Unknown Proteus role: ${codename}`);
        const target = db.getTarget();
        return renderAgentPrompt({
          codename,
          workspace: db.targetRoot,
          target: target?.name ?? path.basename(db.targetRoot),
          surface: str(surface),
          objective: maybeStr(objective) ?? "Run a bounded Proteus research front.",
          avoid: stringArray(avoid)
        });
      })
  },
  {
    name: "proteus_query_duplicates",
    title: "Query Possible Duplicates",
    description: "Search ingested findings and reports for possible duplicate prior coverage. Use proteus_query_memory for broad memory search.",
    inputSchema: schema(
      { root: stringProp("Target root path."), text: stringProp("Candidate text, primitive, or impact to search."), limit: numberProp("Max rows.") },
      ["root", "text"]
    ),
    handler: ({ root, text, limit }) => withDb(str(root), (db) => db.queryCoverage(str(text), num(limit, 10)))
  },
  {
    name: "proteus_query_memory",
    title: "Query Memory",
    description: "Run a broad full-text search over Proteus memory.",
    inputSchema: schema(
      { root: stringProp("Target root path."), text: stringProp("Search text."), limit: numberProp("Max rows.") },
      ["root", "text"]
    ),
    handler: ({ root, text, limit }) => withDb(str(root), (db) => db.search(str(text), num(limit, 20)))
  },
  {
    name: "proteus_get_record",
    title: "Get Memory Record",
    description: "Return the full SQL memory record for an entityType/entityId pair returned by Proteus queries.",
    inputSchema: schema(
      { root: stringProp("Target root path."), entityType: stringProp("Entity type."), entityId: numberProp("Entity id.") },
      ["root", "entityType", "entityId"]
    ),
    handler: ({ root, entityType, entityId }) => withDb(str(root), (db) => db.getRecord(str(entityType), num(entityId, 0)))
  },
  {
    name: "proteus_list_records",
    title: "List Memory Records",
    description: "List structured Proteus records by type: surfaces, hypotheses, evidence, decisions, gates, rounds, campaigns, branches, or links.",
    inputSchema: schema(
      {
        root: stringProp("Target root path."),
        recordType: stringProp("surfaces, hypotheses, evidence, decisions, gates, rounds, campaigns, branches, or links."),
        status: stringProp("Optional status filter for surfaces, hypotheses, rounds, campaigns, or branches."),
        text: stringProp("Optional text filter for surfaces."),
        entityType: stringProp("Optional entity type filter for gates."),
        entityId: numberProp("Optional entity id filter for gates."),
        limit: numberProp("Max rows.")
      },
      ["root", "recordType"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => listRecords(db, str(input.recordType), {
        status: maybeStr(input.status),
        text: maybeStr(input.text),
        entityType: maybeStr(input.entityType),
        entityId: maybeNum(input.entityId),
        limit: num(input.limit, 50)
      }))
  },
  {
    name: "proteus_record_surface",
    title: "Record Surface",
    description: "Record a target-specific component, area, or attack surface with files, boundaries, status, and ROI factors.",
    inputSchema: schema(
      {
        root: stringProp(),
        name: stringProp(),
        family: stringProp(),
        description: stringProp(),
        files: arrayProp(),
        symbols: arrayProp(),
        entrypoints: arrayProp(),
        trustBoundaries: arrayProp(),
        runtimeModes: arrayProp(),
        status: stringProp(),
        revisitCondition: stringProp(),
        roi: objectProp("Optional ROI factor object.")
      },
      ["root", "name"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addSurface({
          name: str(input.name),
          family: maybeStr(input.family) ?? "coordinator-supplied",
          description: maybeStr(input.description) ?? "",
          files: stringArray(input.files),
          symbols: stringArray(input.symbols),
          entrypoints: stringArray(input.entrypoints),
          trustBoundaries: stringArray(input.trustBoundaries),
          runtimeModes: stringArray(input.runtimeModes),
          status: (maybeStr(input.status) ?? "active") as never,
          roi: roiFromInput(objectValue(input.roi)),
          revisitCondition: maybeStr(input.revisitCondition) ?? ""
        })
      }))
  },
  {
    name: "proteus_record_hypothesis",
    title: "Record Hypothesis",
    description: "Record a hypothesis, candidate, watchlist item, or discard into structured memory.",
    inputSchema: schema(
      {
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
      },
      ["root", "title"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addHypothesis({
          surfaceId: maybeNum(input.surfaceId),
          title: str(input.title),
          primitive: maybeStr(input.primitive) ?? "unknown",
          attackerBoundary: maybeStr(input.attackerBoundary) ?? "unknown",
          impactClaim: maybeStr(input.impactClaim) ?? "unknown",
          heuristicFamily: maybeStr(input.heuristicFamily) ?? "unknown",
          status: maybeStr(input.status) === undefined ? "live" : (maybeStr(input.status) as never),
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
    name: "proteus_record_evidence",
    title: "Record Evidence",
    description: "Record evidence such as command output, PoC result, negative control, docs/intel note, or code-reading fact.",
    inputSchema: schema(
      {
        root: stringProp(),
        title: stringProp(),
        kind: stringProp(),
        body: stringProp(),
        pathOrUrl: stringProp(),
        command: stringProp()
      },
      ["root", "title"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addEvidence({
          title: str(input.title),
          kind: maybeStr(input.kind) ?? "note",
          body: maybeStr(input.body) ?? "",
          pathOrUrl: maybeStr(input.pathOrUrl),
          command: maybeStr(input.command)
        })
      }))
  },
  {
    name: "proteus_record_decision",
    title: "Record Decision",
    description: "Append a coordinator decision with reason and evidence references.",
    inputSchema: schema(
      {
        root: stringProp(),
        entityType: stringProp(),
        entityId: numberProp(),
        decision: stringProp(),
        reason: stringProp(),
        evidenceIds: arrayProp(),
        actor: stringProp()
      },
      ["root", "entityType", "entityId", "decision", "reason"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
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
    name: "proteus_record_gate",
    title: "Record Validation Gate",
    description: "Record the status of a validation gate for a hypothesis, candidate, report, or other memory entity.",
    inputSchema: schema(
      {
        root: stringProp(),
        entityType: stringProp(),
        entityId: numberProp(),
        gate: stringProp(),
        status: stringProp(),
        summary: stringProp(),
        evidenceIds: arrayProp(),
        actor: stringProp()
      },
      ["root", "entityType", "entityId", "gate"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        id: db.addValidationGate({
          entityType: str(input.entityType),
          entityId: num(input.entityId, 0),
          gate: str(input.gate),
          status: (maybeStr(input.status) ?? "pending") as never,
          summary: maybeStr(input.summary) ?? "",
          evidenceIds: numberArray(input.evidenceIds),
          actor: maybeStr(input.actor) ?? "coordinator"
        })
      }))
  },
  {
    name: "proteus_record_agent_output",
    title: "Record Agent Output",
    description: "Record structured output from a Proteus specialist agent.",
    inputSchema: schema(
      {
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
      },
      ["root", "roundId", "codename", "roleFamily", "assignedSurface"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
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
    inputSchema: schema(
      { root: stringProp(), id: numberProp(), status: stringProp(), revisitCondition: stringProp(), exhaustionLevel: numberProp() },
      ["root", "id"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => {
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
    name: "proteus_update_round",
    title: "Update Round Status",
    description: "Update a Proteus round/plan status so active, paused, completed, blocked, planned, and superseded work can be used as real goals.",
    inputSchema: schema(
      { root: stringProp(), id: numberProp(), status: stringProp("active, paused, completed, blocked, planned, or superseded.") },
      ["root", "id", "status"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => {
        const status = maybeRoundStatus(input.status);
        db.updateRound({
          id: num(input.id, 0),
          status
        });
        return { ok: true, id: input.id, status };
      })
  },
  {
    name: "proteus_update_rounds",
    title: "Bulk Update Round Status",
    description: "Bulk-update rounds by status, useful for moving legacy planned rounds to superseded while optionally keeping the newest planned round.",
    inputSchema: schema(
      {
        root: stringProp(),
        fromStatus: stringProp("Existing status to match."),
        status: stringProp("New status to set."),
        keepLatest: booleanProp("Keep the newest matching round unchanged.")
      },
      ["root", "fromStatus", "status"]
    ),
    handler: (input) =>
      withDb(str(input.root), (db) => ({
        ok: true,
        ...db.updateRoundsByStatus({
          from: parseRoundStatus(str(input.fromStatus)),
          status: parseRoundStatus(str(input.status)),
          keepLatest: input.keepLatest === true
        })
      }))
  },
  {
    name: "proteus_query_revisit",
    title: "Query Surface Revisit State",
    description: "Search surfaces by name or family and return current status, ROI, and revisit conditions.",
    inputSchema: schema({ root: stringProp(), surface: stringProp("Surface search text.") }, ["root", "surface"]),
    handler: ({ root, surface }) =>
      withDb(str(root), (db) => {
        const query = str(surface).toLowerCase();
        return db
          .listSurfaces()
          .filter((item) => item.name.toLowerCase().includes(query) || item.family.toLowerCase().includes(query))
          .map((item) => ({
            entityType: "surface",
            entityId: item.id,
            name: item.name,
            family: item.family,
            status: item.status,
            roiScore: item.roiScore,
            exhaustionLevel: item.exhaustionLevel,
            revisitCondition: item.revisitCondition
          }));
      })
  },
  {
    name: "proteus_query_surfaces",
    title: "Query Surfaces",
    description: "Search target-specific surfaces/components by name, family, description, files, or revisit condition.",
    inputSchema: schema({ root: stringProp(), text: stringProp("Surface search text."), limit: numberProp("Max rows.") }, ["root", "text"]),
    handler: ({ root, text, limit }) =>
      withDb(str(root), (db) => {
        const query = str(text).toLowerCase();
        return db
          .listSurfaces()
          .filter((item) => [item.name, item.family, item.description, item.revisitCondition, item.files.join(" ")].join(" ").toLowerCase().includes(query))
          .slice(0, num(limit, 20));
      })
  },
  {
    name: "proteus_export",
    title: "Export Markdown",
    description: "Export Markdown views from memory.",
    inputSchema: schema({ root: stringProp() }, ["root"]),
    handler: ({ root }) => withDb(str(root), (db) => ({ files: exportMarkdown(db) }))
  },
  {
    name: "proteus_lab_create",
    title: "Create PoC Lab",
    description: "Create a realistic Artificer lab skeleton for a candidate.",
    inputSchema: schema({ root: stringProp(), candidateId: numberProp(), name: stringProp() }, ["root", "candidateId"]),
    handler: ({ root, candidateId, name }) => withDb(str(root), (db) => ({ path: createLab(db, num(candidateId, 0), maybeStr(name)) }))
  },
  {
    name: "proteus_record_global_learning",
    title: "Record Global Learning",
    description: "Record reusable cross-target learning such as user preferences, validation patterns, tooling notes, and playbook material.",
    inputSchema: schema(
      {
        root: stringProp("Optional target root used to infer scope and source target."),
        category: stringProp("Learning category."),
        scope: stringProp("Reusable scope tags or scope text."),
        title: stringProp("Learning title."),
        body: stringProp("Learning body."),
        tags: arrayProp("Tags."),
        sourceTarget: stringProp("Source target name."),
        confidence: numberProp("Confidence from 0 to 1.")
      },
      ["title"]
    ),
    handler: (input) => {
      const target = maybeStr(input.root) ? readTargetMaybe(str(input.root)) : null;
      return withGlobalDb((globalDb) => ({
        ok: true,
        id: globalDb.addLearning({
          category: (maybeStr(input.category) ?? "research_heuristic") as never,
          scope: maybeStr(input.scope) ?? (target ? defaultGlobalScopeFromTarget(target) : "global"),
          title: str(input.title),
          body: maybeStr(input.body) ?? "",
          tags: stringArray(input.tags),
          sourceTarget: maybeStr(input.sourceTarget) ?? target?.name,
          confidence: num(input.confidence, 0.7)
        })
      }));
    }
  },
  {
    name: "proteus_query_global_learnings",
    title: "Query Global Learnings",
    description: "Search reusable cross-target Proteus memory by text, scope, category, or tags.",
    inputSchema: schema(
      {
        root: stringProp("Optional target root used to infer target scope."),
        text: stringProp("Search text."),
        scope: stringProp("Scope filter."),
        category: stringProp("Category filter."),
        tags: arrayProp("Required tags."),
        targetScope: booleanProp("Infer scope from target root."),
        limit: numberProp("Max rows.")
      },
      []
    ),
    handler: (input) => {
      const target = maybeStr(input.root) ? readTargetMaybe(str(input.root)) : null;
      const targetScope = input.targetScope === true && target ? defaultGlobalScopeFromTarget(target) : "";
      return withGlobalDb((globalDb) =>
        globalDb.queryLearnings({
          text: [maybeStr(input.text) ?? "", targetScope].filter(Boolean).join(" "),
          scope: maybeStr(input.scope),
          category: maybeStr(input.category),
          tags: stringArray(input.tags),
          limit: num(input.limit, 20)
        })
      );
    }
  },
  {
    name: "proteus_export_global_learnings",
    title: "Export Global Learnings",
    description: "Export reusable global learnings to Markdown.",
    inputSchema: schema({ outPath: stringProp("Optional output path.") }, []),
    handler: ({ outPath }) => withGlobalDb((globalDb) => ({ path: globalDb.exportMarkdown(maybeStr(outPath)) }))
  }
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const index = buffer.indexOf("\n");
    if (index === -1) break;
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.trim().length > 0) handleLine(line);
  }
});

function handleLine(line: string): void {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    sendError(null, -32700, `Parse error: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (request.id === undefined) return;

  try {
    if (request.method === "initialize") {
      sendResult(request.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "proteus", version: packageVersion() }
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
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as JsonObject;
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      const result = tool.handler(args);
      sendResult(request.id, toToolResult(result));
      return;
    }
    sendError(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    sendError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function toToolResult(value: unknown): JsonObject {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function sendResult(id: JsonRpcId, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id: JsonRpcId, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function withDb(root: string, fn: (db: ProteusDb) => unknown): unknown {
  const db = new ProteusDb(resolveTargetRoot(root));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function packageVersion(): string {
  for (const candidate of [
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(__dirname, "..", "..", "..", "package.json")
  ]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      continue;
    }
  }
  return "unknown";
}

function withGlobalDb(fn: (db: GlobalMemoryDb) => unknown): unknown {
  const db = new GlobalMemoryDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function readTargetMaybe(root: string): ReturnType<ProteusDb["getTarget"]> {
  const db = new ProteusDb(resolveTargetRoot(root));
  try {
    return db.getTarget();
  } finally {
    db.close();
  }
}

function listRecords(
  db: ProteusDb,
  recordType: string,
  options: { status?: string; text?: string; entityType?: string; entityId?: number; limit: number }
): unknown[] {
  if (recordType === "surfaces") {
    const text = options.text?.toLowerCase() ?? "";
    return db
      .listSurfaces()
      .filter((row) => !options.status || row.status === options.status)
      .filter((row) => !text || [row.name, row.family, row.description, row.revisitCondition].join(" ").toLowerCase().includes(text))
      .slice(0, options.limit);
  }
  if (recordType === "hypotheses") {
    return db
      .listHypotheses()
      .filter((row) => !options.status || row.status === options.status)
      .slice(0, options.limit);
  }
  if (recordType === "evidence") return db.listEvidence().slice(0, options.limit);
  if (recordType === "decisions") return db.listDecisions().slice(0, options.limit);
  if (recordType === "gates") {
    return db
      .listValidationGates()
      .filter((row) => !options.entityType || row.entityType === options.entityType)
      .filter((row) => options.entityId === undefined || row.entityId === options.entityId)
      .slice(0, options.limit);
  }
  if (recordType === "rounds" || recordType === "plans") {
    return db
      .listRounds()
      .filter((row) => !options.status || row.status === options.status)
      .slice(0, options.limit);
  }
  if (recordType === "campaigns") {
    return db.listCampaigns(options.status ? parseCampaignStatus(options.status) : undefined).slice(0, options.limit);
  }
  if (recordType === "branches" || recordType === "hypothesis_branches") {
    return db
      .listHypothesisBranches({
        campaignId: options.entityType === "campaign" ? options.entityId : undefined,
        roundId: options.entityType === "round" ? options.entityId : undefined,
        status: options.status ? parseBranchStatus(options.status) : undefined,
        limit: options.limit
      })
      .slice(0, options.limit);
  }
  if (recordType === "links" || recordType === "entity_links") {
    return db.listEntityLinks({
      entityType: options.entityType,
      entityId: options.entityId,
      limit: options.limit
    });
  }
  throw new Error("recordType must be one of: surfaces, hypotheses, evidence, decisions, gates, rounds, campaigns, branches, links");
}

function schema(properties: JsonObject, required: string[] = []): JsonObject {
  return { type: "object", properties, required, additionalProperties: true };
}

function stringProp(description?: string): JsonObject {
  return { type: "string", ...(description ? { description } : {}) };
}

function optionalStringProp(description?: string): JsonObject {
  return stringProp(description);
}

function numberProp(description?: string): JsonObject {
  return { type: "number", ...(description ? { description } : {}) };
}

function booleanProp(description?: string): JsonObject {
  return { type: "boolean", ...(description ? { description } : {}) };
}

function arrayProp(description?: string): JsonObject {
  return { type: "array", items: { type: "string" }, ...(description ? { description } : {}) };
}

function objectArrayProp(description?: string): JsonObject {
  return { type: "array", items: { type: "object", additionalProperties: true }, ...(description ? { description } : {}) };
}

function objectProp(description?: string): JsonObject {
  return { type: "object", additionalProperties: true, ...(description ? { description } : {}) };
}

function str(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected non-empty string");
  return value;
}

function maybeStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function maybeNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function maybeRoundStatus(value: unknown): RoundStatus | undefined {
  if (value === undefined || value === null) return undefined;
  return parseRoundStatus(str(value));
}

function parseRoundStatus(status: string): RoundStatus {
  if (
    status === "active" ||
    status === "paused" ||
    status === "completed" ||
    status === "blocked" ||
    status === "planned" ||
    status === "superseded"
  ) {
    return status;
  }
  throw new Error("Round status must be one of: active, paused, completed, blocked, planned, superseded");
}

function maybeCampaignStatus(value: unknown): CampaignStatus | undefined {
  if (value === undefined || value === null) return undefined;
  return parseCampaignStatus(str(value));
}

function parseCampaignStatus(status: string): CampaignStatus {
  if (
    status === "active" ||
    status === "paused" ||
    status === "completed" ||
    status === "blocked" ||
    status === "superseded"
  ) {
    return status;
  }
  throw new Error("Campaign status must be one of: active, paused, completed, blocked, superseded");
}

function maybeBranchStatus(value: unknown): BranchStatus | undefined {
  if (value === undefined || value === null) return undefined;
  return parseBranchStatus(str(value));
}

function parseBranchStatus(status: string): BranchStatus {
  if (status === "open" || status === "testing" || status === "killed" || status === "promoted" || status === "blocked") {
    return status;
  }
  throw new Error("Branch status must be one of: open, testing, killed, promoted, blocked");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function objectArray(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)) : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function roiFromInput(input: Record<string, unknown> | undefined): RoiFactors {
  return {
    impactPotential: num(input?.impactPotential, 0),
    externalReachability: num(input?.externalReachability, 0),
    trustBoundaryDensity: num(input?.trustBoundaryDensity, 0),
    recentChangeWeight: num(input?.recentChangeWeight, 0),
    unexploredInvariantWeight: num(input?.unexploredInvariantWeight, 0),
    toolingReadiness: num(input?.toolingReadiness, 0),
    duplicateRisk: num(input?.duplicateRisk, 0),
    expectedBehaviorLikelihood: num(input?.expectedBehaviorLikelihood, 0),
    priorExhaustionWeight: num(input?.priorExhaustionWeight, 0),
    validationCost: num(input?.validationCost, 0),
    lowSignalHistory: num(input?.lowSignalHistory, 0)
  };
}
