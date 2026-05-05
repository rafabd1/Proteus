import fs from "node:fs";
import path from "node:path";
import { ensureDir, globalExportsDir, globalMemoryPath, globalVrosDir } from "./paths";
import { globalLearningInputSchema } from "./schemas";
import type { GlobalLearningInput } from "./types";

const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  const warningType = typeof args[0] === "string" ? args[0] : undefined;
  if (warningType === "ExperimentalWarning" && message.includes("SQLite")) return;
  return emitWarning.call(process, warning as never, ...(args as never[]));
}) as typeof process.emitWarning;
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
process.emitWarning = emitWarning;

export interface GlobalLearningRow {
  id: number;
  category: string;
  scope: string;
  title: string;
  body: string;
  tags: string[];
  sourceTarget: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalLearningQuery {
  text?: string;
  scope?: string;
  category?: string;
  tags?: string[];
  limit?: number;
}

export class GlobalMemoryDb {
  readonly dbPath: string;
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(dbPath = globalMemoryPath()) {
    ensureDir(path.dirname(dbPath));
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  addLearning(input: GlobalLearningInput): number {
    const learning = globalLearningInputSchema.parse(input);
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO global_learnings
          (category, scope, title, body, tags_json, source_target, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        learning.category,
        learning.scope,
        learning.title,
        learning.body,
        json(learning.tags),
        learning.sourceTarget ?? "",
        learning.confidence,
        now,
        now
      );
    const id = Number(result.lastInsertRowid);
    this.indexFts(id, renderSearchContent({ ...learning, sourceTarget: learning.sourceTarget ?? "" }));
    return id;
  }

  queryLearnings(query: GlobalLearningQuery): GlobalLearningRow[] {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const rows = query.text?.trim()
      ? this.db
          .prepare(
            `SELECT gl.*
             FROM global_learning_fts fts
             JOIN global_learnings gl ON gl.id = fts.learning_id
             WHERE global_learning_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .all(ftsQuery(query.text), limit * 4)
      : this.db
          .prepare("SELECT * FROM global_learnings ORDER BY id DESC LIMIT ?")
          .all(limit * 4);

    return rows
      .map(toGlobalLearningRow)
      .filter((row) => matchesFilter(row, query))
      .slice(0, limit);
  }

  exportMarkdown(outPath?: string): string {
    const outDir = globalExportsDir();
    ensureDir(outDir);
    const fullPath = outPath ?? path.join(outDir, "global-learnings.md");
    ensureDir(path.dirname(fullPath));
    const rows = this.queryLearnings({ limit: 100 });
    fs.writeFileSync(fullPath, renderGlobalLearnings(rows));
    return fullPath;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_learnings (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        source_target TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS global_learning_fts USING fts5(
        learning_id UNINDEXED,
        content
      );
    `);
  }

  private indexFts(learningId: number, content: string): void {
    this.db
      .prepare("INSERT INTO global_learning_fts (learning_id, content) VALUES (?, ?)")
      .run(learningId, content);
  }
}

export function defaultGlobalScopeFromTarget(target: {
  name: string;
  contract: { inScope: string[]; primaryImpactClasses: string[]; assumptions: string[] };
}): string {
  return [target.name, ...target.contract.inScope, ...target.contract.primaryImpactClasses, ...target.contract.assumptions]
    .filter(Boolean)
    .join(", ");
}

function renderGlobalLearnings(rows: GlobalLearningRow[]): string {
  const rendered = rows
    .map(
      (row) =>
        `## G${row.id}: ${row.title}\n\nCategory: ${row.category}\n\nScope: ${row.scope}\n\nTags: ${row.tags.join(", ") || "-"}\n\nConfidence: ${row.confidence.toFixed(2)}\n\nSource target: ${row.sourceTarget || "-"}\n\n${row.body}\n`
    )
    .join("\n");
  return `# Proteus Global Learnings\n\n${rendered || "No global learnings recorded yet.\n"}`;
}

function renderSearchContent(input: GlobalLearningInput & { sourceTarget: string }): string {
  return `${input.category}\n${input.scope}\n${input.title}\n${input.body}\n${input.tags.join("\n")}\n${input.sourceTarget}`;
}

function matchesFilter(row: GlobalLearningRow, query: GlobalLearningQuery): boolean {
  if (query.category && row.category !== query.category) return false;
  if (query.scope && !contains(row.scope, query.scope) && !contains(row.title, query.scope) && !contains(row.body, query.scope)) {
    return false;
  }
  for (const tag of query.tags ?? []) {
    if (!row.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return false;
  }
  return true;
}

function contains(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle.toLowerCase());
}

function toGlobalLearningRow(row: Record<string, unknown>): GlobalLearningRow {
  return {
    id: Number(row.id),
    category: String(row.category),
    scope: String(row.scope),
    title: String(row.title),
    body: String(row.body),
    tags: JSON.parse(String(row.tags_json)) as string[],
    sourceTarget: String(row.source_target ?? ""),
    confidence: Number(row.confidence),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function globalMemoryLocation(): string {
  ensureDir(globalVrosDir());
  return globalMemoryPath();
}
