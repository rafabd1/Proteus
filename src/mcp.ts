#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ProteusDb, createDefaultContract } from "./db";
import { ingestPaths } from "./ingest";
import { observeTarget } from "./observe";
import { planRound, renderRoundPlan } from "./planner";
import { exportMarkdown } from "./exporter";
import { createLab } from "./lab";
import { resolveTargetRoot } from "./paths";

const server = new McpServer({
  name: "proteus",
  version: "0.1.0"
});

server.registerTool(
  "proteus_init",
  {
    title: "Initialize Proteus Memory",
    description: "Initialize .vros/memory.sqlite for a target codebase.",
    inputSchema: {
      root: z.string().describe("Target root path."),
      name: z.string().optional().describe("Human-readable target name.")
    }
  },
  async ({ root, name }) =>
    withDb(root, (db) => {
      const contract = createDefaultContract(db.targetRoot, name);
      db.initTarget(contract);
      return textJson({ ok: true, target: contract.target, root: db.targetRoot });
    })
);

server.registerTool(
  "proteus_status",
  {
    title: "Read Proteus Status",
    description: "Return target, surface, hypothesis, and round counts.",
    inputSchema: {
      root: z.string().describe("Target root path.")
    },
    annotations: { readOnlyHint: true }
  },
  async ({ root }) =>
    withDb(root, (db) => {
      const target = db.getTarget();
      return textJson({
        initialized: Boolean(target),
        target,
        surfaces: db.listSurfaces().length,
        hypotheses: db.listHypotheses().length,
        rounds: db.listRounds().length
      });
    })
);

server.registerTool(
  "proteus_ingest",
  {
    title: "Ingest Prior Research",
    description: "Index local docs, findings, reports, and notes into Proteus memory.",
    inputSchema: {
      root: z.string().describe("Target root path."),
      paths: z.array(z.string()).default([]).describe("Paths relative to root.")
    }
  },
  async ({ root, paths }) => withDb(root, (db) => textJson(ingestPaths(db, paths)))
);

server.registerTool(
  "proteus_observe",
  {
    title: "Observe Target",
    description: "Inspect local target environment and store a profile as evidence.",
    inputSchema: {
      root: z.string().describe("Target root path.")
    }
  },
  async ({ root }) => withDb(root, (db) => textJson(observeTarget(db)))
);

server.registerTool(
  "proteus_plan_round",
  {
    title: "Plan Research Round",
    description: "Create a high-ROI Proteus research round with selected surfaces and agent fronts.",
    inputSchema: {
      root: z.string().describe("Target root path."),
      objective: z.string().describe("Round objective."),
      markdown: z.boolean().default(false).describe("Return Markdown instead of JSON.")
    }
  },
  async ({ root, objective, markdown }) =>
    withDb(root, (db) => {
      const plan = planRound(db, objective);
      return markdown ? text(renderRoundPlan(plan)) : textJson(plan);
    })
);

server.registerTool(
  "proteus_query_duplicates",
  {
    title: "Query Possible Duplicates",
    description: "Full-text search Proteus memory for duplicate or related prior work.",
    inputSchema: {
      root: z.string().describe("Target root path."),
      text: z.string().describe("Candidate text, primitive, or impact to search."),
      limit: z.number().int().positive().max(50).default(20)
    },
    annotations: { readOnlyHint: true }
  },
  async ({ root, text: query, limit }) => withDb(root, (db) => textJson(db.search(query, limit)))
);

server.registerTool(
  "proteus_record_hypothesis",
  {
    title: "Record Hypothesis",
    description: "Record a hypothesis, candidate, watchlist item, or discard into structured memory.",
    inputSchema: {
      root: z.string(),
      title: z.string(),
      primitive: z.string().default("unknown"),
      attackerBoundary: z.string().default("unknown"),
      impactClaim: z.string().default("unknown"),
      heuristicFamily: z.string().default("unknown"),
      surfaceId: z.number().int().positive().optional(),
      score: z.number().min(0).max(100).default(0),
      status: z
        .enum(["live", "candidate", "watchlist", "discarded", "promoted_to_poc", "report_grade"])
        .default("live"),
      killCriteria: z.string().default(""),
      revisitCondition: z.string().default("")
    }
  },
  async (input) =>
    withDb(input.root, (db) => {
      const id = db.addHypothesis({
        surfaceId: input.surfaceId,
        title: input.title,
        primitive: input.primitive,
        attackerBoundary: input.attackerBoundary,
        impactClaim: input.impactClaim,
        heuristicFamily: input.heuristicFamily,
        status: input.status,
        score: input.score,
        duplicateRisk: 5,
        expectedBehaviorRisk: 5,
        validationCost: 5,
        killCriteria: input.killCriteria,
        revisitCondition: input.revisitCondition
      });
      return textJson({ ok: true, id });
    })
);

server.registerTool(
  "proteus_record_decision",
  {
    title: "Record Decision",
    description: "Append a coordinator decision with reason and evidence references.",
    inputSchema: {
      root: z.string(),
      entityType: z.string(),
      entityId: z.number().int().nonnegative(),
      decision: z.string(),
      reason: z.string(),
      evidenceIds: z.array(z.number().int().positive()).default([]),
      actor: z.string().default("coordinator")
    }
  },
  async (input) =>
    withDb(input.root, (db) => {
      const id = db.addDecision(input);
      return textJson({ ok: true, id });
    })
);

server.registerTool(
  "proteus_record_agent_output",
  {
    title: "Record Agent Output",
    description: "Record structured output from Argus, Loom, Chaos, Libris, Mimic, Artificer, or Skeptic.",
    inputSchema: {
      root: z.string(),
      roundId: z.number().int().positive(),
      codename: z.enum(["argus", "loom", "chaos", "libris", "mimic", "artificer", "skeptic"]),
      roleFamily: z.string(),
      assignedSurface: z.string(),
      outputPath: z.string().default(""),
      coveredSurface: z.array(z.string()).default([]),
      liveCandidates: z.array(z.string()).default([]),
      killedHypotheses: z.array(z.string()).default([]),
      probes: z.array(z.string()).default([]),
      uncoveredAreas: z.array(z.string()).default([]),
      validationStatus: z.string().default("unvalidated")
    }
  },
  async (input) =>
    withDb(input.root, (db) => {
      const id = db.addAgentOutput(input);
      return textJson({ ok: true, id });
    })
);

server.registerTool(
  "proteus_update_surface",
  {
    title: "Update Surface Status",
    description: "Update a surface status, exhaustion level, and revisit condition for anti-revisit planning.",
    inputSchema: {
      root: z.string(),
      id: z.number().int().positive(),
      status: z.enum(["unmapped", "active", "covered", "exhausted", "low_roi", "blocked", "watch"]).optional(),
      revisitCondition: z.string().optional(),
      exhaustionLevel: z.number().int().min(0).max(10).optional()
    }
  },
  async (input) =>
    withDb(input.root, (db) => {
      db.updateSurface(input);
      return textJson({ ok: true, id: input.id });
    })
);

server.registerTool(
  "proteus_export",
  {
    title: "Export Markdown",
    description: "Export target contract, surface map, candidate register, and research log from memory.",
    inputSchema: {
      root: z.string()
    }
  },
  async ({ root }) => withDb(root, (db) => textJson({ files: exportMarkdown(db) }))
);

server.registerTool(
  "proteus_lab_create",
  {
    title: "Create PoC Lab",
    description: "Create a realistic Artificer lab skeleton for a candidate.",
    inputSchema: {
      root: z.string(),
      candidateId: z.number().int().positive(),
      name: z.string().optional()
    }
  },
  async ({ root, candidateId, name }) =>
    withDb(root, (db) => textJson({ path: createLab(db, candidateId, name) }))
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function withDb(root: string, fn: (db: ProteusDb) => ReturnType<typeof text> | ReturnType<typeof textJson>) {
  const db = new ProteusDb(resolveTargetRoot(root));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function textJson(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
