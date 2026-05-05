import fs from "node:fs";
import path from "node:path";
import { ProteusDb } from "./db";
import { toRelative } from "./paths";

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

export interface IngestResult {
  scanned: number;
  indexed: number;
  skipped: number;
}

export function ingestPaths(db: ProteusDb, inputs: string[]): IngestResult {
  const result: IngestResult = { scanned: 0, indexed: 0, skipped: 0 };
  const roots = inputs.length > 0 ? inputs : ["findings", "REPORTS", "reports", "docs"];
  for (const input of roots) {
    const full = path.resolve(db.targetRoot, input);
    if (!fs.existsSync(full)) {
      result.skipped += 1;
      continue;
    }
    ingestOne(db, full, result);
  }
  return result;
}

function ingestOne(db: ProteusDb, fullPath: string, result: IngestResult): void {
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    const name = path.basename(fullPath);
    if (SKIP_DIRS.has(name)) {
      result.skipped += 1;
      return;
    }
    for (const child of fs.readdirSync(fullPath)) {
      ingestOne(db, path.join(fullPath, child), result);
    }
    return;
  }

  result.scanned += 1;
  if (!stat.isFile() || stat.size > 2_000_000 || !TEXT_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) {
    result.skipped += 1;
    return;
  }

  const body = fs.readFileSync(fullPath, "utf8");
  const relative = toRelative(db.targetRoot, fullPath);
  const title = path.basename(fullPath);
  const kind = classifyPath(relative);
  db.addSource(kind, relative, title, body, summarize(body));
  result.indexed += 1;
}

function classifyPath(relative: string): string {
  const normalized = relative.toLowerCase();
  if (normalized.includes("report")) return "report";
  if (normalized.includes("finding")) return "finding";
  if (normalized.includes("advis")) return "advisory";
  if (normalized.includes("docs") || normalized.endsWith("readme.md")) return "doc";
  return "source";
}

function summarize(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n")
    .slice(0, 2000);
}

