"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalMemoryDb = void 0;
exports.defaultGlobalScopeFromTarget = defaultGlobalScopeFromTarget;
exports.globalMemoryLocation = globalMemoryLocation;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
class GlobalMemoryDb {
    dbPath;
    db;
    constructor(dbPath = (0, paths_1.globalMemoryPath)()) {
        (0, paths_1.ensureDir)(node_path_1.default.dirname(dbPath));
        this.dbPath = dbPath;
        this.db = new DatabaseSync(dbPath);
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.migrate();
    }
    close() {
        this.db.close();
    }
    addLearning(input) {
        const learning = schemas_1.globalLearningInputSchema.parse(input);
        const now = nowIso();
        const result = this.db
            .prepare(`INSERT INTO global_learnings
          (category, scope, title, body, tags_json, source_target, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(learning.category, learning.scope, learning.title, learning.body, json(learning.tags), learning.sourceTarget ?? "", learning.confidence, now, now);
        const id = Number(result.lastInsertRowid);
        this.indexFts(id, renderSearchContent({ ...learning, sourceTarget: learning.sourceTarget ?? "" }));
        return id;
    }
    queryLearnings(query) {
        const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
        const rows = query.text?.trim()
            ? this.db
                .prepare(`SELECT gl.*
             FROM global_learning_fts fts
             JOIN global_learnings gl ON gl.id = fts.learning_id
             WHERE global_learning_fts MATCH ?
             ORDER BY rank
             LIMIT ?`)
                .all(ftsQuery(query.text), limit * 4)
            : this.db
                .prepare("SELECT * FROM global_learnings ORDER BY id DESC LIMIT ?")
                .all(limit * 4);
        return rows
            .map(toGlobalLearningRow)
            .filter((row) => matchesFilter(row, query))
            .slice(0, limit);
    }
    exportMarkdown(outPath) {
        const outDir = (0, paths_1.globalExportsDir)();
        (0, paths_1.ensureDir)(outDir);
        const fullPath = outPath ?? node_path_1.default.join(outDir, "global-learnings.md");
        (0, paths_1.ensureDir)(node_path_1.default.dirname(fullPath));
        const rows = this.queryLearnings({ limit: 100 });
        node_fs_1.default.writeFileSync(fullPath, renderGlobalLearnings(rows));
        return fullPath;
    }
    migrate() {
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
    indexFts(learningId, content) {
        this.db
            .prepare("INSERT INTO global_learning_fts (learning_id, content) VALUES (?, ?)")
            .run(learningId, content);
    }
}
exports.GlobalMemoryDb = GlobalMemoryDb;
function defaultGlobalScopeFromTarget(target) {
    return [target.name, ...target.contract.inScope, ...target.contract.primaryImpactClasses, ...target.contract.assumptions]
        .filter(Boolean)
        .join(", ");
}
function renderGlobalLearnings(rows) {
    const rendered = rows
        .map((row) => `## G${row.id}: ${row.title}\n\nCategory: ${row.category}\n\nScope: ${row.scope}\n\nTags: ${row.tags.join(", ") || "-"}\n\nConfidence: ${row.confidence.toFixed(2)}\n\nSource target: ${row.sourceTarget || "-"}\n\n${row.body}\n`)
        .join("\n");
    return `# Proteus Global Learnings\n\n${rendered || "No global learnings recorded yet.\n"}`;
}
function renderSearchContent(input) {
    return `${input.category}\n${input.scope}\n${input.title}\n${input.body}\n${input.tags.join("\n")}\n${input.sourceTarget}`;
}
function matchesFilter(row, query) {
    if (query.category && row.category !== query.category)
        return false;
    if (query.scope && !contains(row.scope, query.scope) && !contains(row.title, query.scope) && !contains(row.body, query.scope)) {
        return false;
    }
    for (const tag of query.tags ?? []) {
        if (!row.tags.some((item) => item.toLowerCase() === tag.toLowerCase()))
            return false;
    }
    return true;
}
function contains(value, needle) {
    return value.toLowerCase().includes(needle.toLowerCase());
}
function toGlobalLearningRow(row) {
    return {
        id: Number(row.id),
        category: String(row.category),
        scope: String(row.scope),
        title: String(row.title),
        body: String(row.body),
        tags: JSON.parse(String(row.tags_json)),
        sourceTarget: String(row.source_target ?? ""),
        confidence: Number(row.confidence),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function ftsQuery(query) {
    return query
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `"${part.replace(/"/g, '""')}"`)
        .join(" OR ");
}
function json(value) {
    return JSON.stringify(value);
}
function nowIso() {
    return new Date().toISOString();
}
function globalMemoryLocation() {
    (0, paths_1.ensureDir)((0, paths_1.globalVrosDir)());
    return (0, paths_1.globalMemoryPath)();
}
