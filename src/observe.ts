import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ProteusDb } from "./db";
import { toRelative } from "./paths";
import type { JsonValue } from "./types";

const EXT_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".c": "C",
  ".cpp": "C++",
  ".sol": "Solidity",
  ".move": "Move"
};

const SKIP_DIRS = new Set([".git", ".vros", "node_modules", "dist", "build", "coverage", ".next"]);

export function observeTarget(db: ProteusDb): JsonValue {
  const files = walk(db.targetRoot, 2500);
  const languageCounts = countLanguages(files);
  const profile = {
    root: db.targetRoot,
    git: gitProfile(db.targetRoot),
    languages: languageCounts,
    packageManagers: detectPackageManagers(db.targetRoot),
    frameworks: detectFrameworks(db.targetRoot, files),
    runtimeModes: detectRuntimeModes(db.targetRoot, files),
    testHints: detectTestHints(db.targetRoot),
    tools: detectTools(),
    observedAt: new Date().toISOString()
  };
  db.upsertProfile(profile);
  db.addEvidence({
    kind: "target-profile",
    title: "Proteus target observation",
    body: JSON.stringify(profile, null, 2)
  });
  return profile;
}

export function discoverFiles(root: string, limit = 2500): string[] {
  return walk(root, limit).map((file) => toRelative(root, file));
}

function walk(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

function countLanguages(files: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const language = EXT_LANGUAGE[path.extname(file).toLowerCase()];
    if (!language) continue;
    counts[language] = (counts[language] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function detectPackageManagers(root: string): string[] {
  const checks: Record<string, string> = {
    "package-lock.json": "npm",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "requirements.txt": "pip",
    "pyproject.toml": "python",
    "go.mod": "go",
    "Cargo.toml": "cargo",
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "foundry.toml": "foundry"
  };
  return Object.entries(checks)
    .filter(([file]) => fs.existsSync(path.join(root, file)))
    .map(([, manager]) => manager);
}

function detectFrameworks(root: string, files: string[]): string[] {
  const frameworks = new Set<string>();
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const key of Object.keys(deps)) {
        if (["next", "react", "express", "fastify", "hono", "koa", "nestjs"].includes(key)) frameworks.add(key);
        if (key.startsWith("@nestjs/")) frameworks.add("nestjs");
      }
    } catch {
      frameworks.add("package-json-unreadable");
    }
  }
  if (files.some((file) => file.endsWith("go.mod"))) frameworks.add("go-module");
  if (files.some((file) => file.endsWith("Cargo.toml"))) frameworks.add("rust-crate");
  if (files.some((file) => file.endsWith("Dockerfile"))) frameworks.add("docker");
  return [...frameworks].sort();
}

function detectRuntimeModes(root: string, files: string[]): string[] {
  const modes = new Set<string>(["local-native"]);
  if (fs.existsSync(path.join(root, "Dockerfile")) || files.some((file) => path.basename(file).startsWith("docker-compose"))) {
    modes.add("docker");
  }
  if (process.platform === "win32" && commandExists("wsl")) modes.add("wsl");
  if (files.some((file) => file.includes(`${path.sep}edge${path.sep}`) || file.toLowerCase().includes("edge"))) {
    modes.add("edge-like");
  }
  return [...modes].sort();
}

function detectTestHints(root: string): string[] {
  const hints: string[] = [];
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        if (name.includes("test") || name.includes("lint") || name.includes("check")) hints.push(`npm run ${name}: ${command}`);
      }
    } catch {
      hints.push("package.json scripts unreadable");
    }
  }
  for (const file of ["pytest.ini", "go.mod", "Cargo.toml", "foundry.toml"]) {
    if (fs.existsSync(path.join(root, file))) hints.push(file);
  }
  return hints;
}

function gitProfile(root: string): JsonValue {
  return {
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root),
    commit: run("git", ["rev-parse", "HEAD"], root),
    status: run("git", ["status", "--short"], root)
  };
}

function detectTools(): Record<string, string> {
  const tools = ["git", "node", "npm", "python", "docker", "wsl", "rg"];
  return Object.fromEntries(tools.map((tool) => [tool, commandVersion(tool)]));
}

function commandVersion(command: string): string {
  if (!commandExists(command)) return "missing";
  const args = command === "wsl" ? ["--version"] : ["--version"];
  return cleanCommandOutput(run(command, args, process.cwd())).split(/\r?\n/)[0] || "available";
}

function commandExists(command: string): boolean {
  const check = process.platform === "win32" ? "where.exe" : "which";
  return run(check, [command], process.cwd()) !== "";
}

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function cleanCommandOutput(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[^\S\r\n]+/g, " ").trim();
}
