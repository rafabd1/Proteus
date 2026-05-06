"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestPaths = ingestPaths;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const SKIP_DIRS = new Set([
    ".git",
    ".vros",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    ".venv",
    "venv",
    "__pycache__"
]);
const TEXT_EXTENSIONS = new Set([
    ".md",
    ".txt",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".rb",
    ".php",
    ".cs",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".swift",
    ".sol",
    ".move",
    ".sh",
    ".ps1",
    ".graphql",
    ".gql"
]);
function ingestPaths(db, inputs) {
    const result = { scanned: 0, indexed: 0, unchanged: 0, skipped: 0 };
    const roots = inputs.length > 0 ? inputs : ["findings", "REPORTS", "reports", "docs"];
    for (const input of roots) {
        const full = node_path_1.default.resolve(db.targetRoot, input);
        if (!node_fs_1.default.existsSync(full)) {
            result.skipped += 1;
            continue;
        }
        ingestOne(db, full, result);
    }
    return result;
}
function ingestOne(db, fullPath, result) {
    const stat = node_fs_1.default.statSync(fullPath);
    if (stat.isDirectory()) {
        const name = node_path_1.default.basename(fullPath);
        if (SKIP_DIRS.has(name)) {
            result.skipped += 1;
            return;
        }
        for (const child of node_fs_1.default.readdirSync(fullPath)) {
            ingestOne(db, node_path_1.default.join(fullPath, child), result);
        }
        return;
    }
    result.scanned += 1;
    if (!stat.isFile() || stat.size > 2_000_000 || !TEXT_EXTENSIONS.has(node_path_1.default.extname(fullPath).toLowerCase())) {
        result.skipped += 1;
        return;
    }
    const body = node_fs_1.default.readFileSync(fullPath, "utf8");
    const relative = (0, paths_1.toRelative)(db.targetRoot, fullPath);
    const title = node_path_1.default.basename(fullPath);
    const kind = classifyPath(relative);
    const source = db.addSourceWithResult(kind, relative, title, body, summarize(body));
    if (source.inserted)
        result.indexed += 1;
    else
        result.unchanged += 1;
}
function classifyPath(relative) {
    const normalized = relative.toLowerCase();
    if (normalized.includes("report"))
        return "report";
    if (normalized.includes("finding"))
        return "finding";
    if (normalized.includes("advis"))
        return "advisory";
    if (normalized.includes("docs") || normalized.endsWith("readme.md"))
        return "doc";
    return "source";
}
function summarize(body) {
    return body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12)
        .join("\n")
        .slice(0, 2000);
}
