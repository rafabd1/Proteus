"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeTarget = observeTarget;
exports.discoverFiles = discoverFiles;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const paths_1 = require("./paths");
const EXT_LANGUAGE = {
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
function observeTarget(db) {
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
function discoverFiles(root, limit = 2500) {
    return walk(root, limit).map((file) => (0, paths_1.toRelative)(root, file));
}
function walk(root, limit) {
    const out = [];
    const stack = [root];
    while (stack.length > 0 && out.length < limit) {
        const current = stack.pop();
        let entries;
        try {
            entries = node_fs_1.default.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = node_path_1.default.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name))
                    stack.push(full);
            }
            else if (entry.isFile()) {
                out.push(full);
                if (out.length >= limit)
                    break;
            }
        }
    }
    return out;
}
function countLanguages(files) {
    const counts = {};
    for (const file of files) {
        const language = EXT_LANGUAGE[node_path_1.default.extname(file).toLowerCase()];
        if (!language)
            continue;
        counts[language] = (counts[language] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}
function detectPackageManagers(root) {
    const checks = {
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
        .filter(([file]) => node_fs_1.default.existsSync(node_path_1.default.join(root, file)))
        .map(([, manager]) => manager);
}
function detectFrameworks(root, files) {
    const frameworks = new Set();
    const pkgPath = node_path_1.default.join(root, "package.json");
    if (node_fs_1.default.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(node_fs_1.default.readFileSync(pkgPath, "utf8"));
            const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
            for (const key of Object.keys(deps)) {
                if (["next", "react", "express", "fastify", "hono", "koa", "nestjs"].includes(key))
                    frameworks.add(key);
                if (key.startsWith("@nestjs/"))
                    frameworks.add("nestjs");
            }
        }
        catch {
            frameworks.add("package-json-unreadable");
        }
    }
    if (files.some((file) => file.endsWith("go.mod")))
        frameworks.add("go-module");
    if (files.some((file) => file.endsWith("Cargo.toml")))
        frameworks.add("rust-crate");
    if (files.some((file) => file.endsWith("Dockerfile")))
        frameworks.add("docker");
    return [...frameworks].sort();
}
function detectRuntimeModes(root, files) {
    const modes = new Set(["local-native"]);
    if (node_fs_1.default.existsSync(node_path_1.default.join(root, "Dockerfile")) || files.some((file) => node_path_1.default.basename(file).startsWith("docker-compose"))) {
        modes.add("docker");
    }
    if (process.platform === "win32" && commandExists("wsl"))
        modes.add("wsl");
    if (files.some((file) => file.includes(`${node_path_1.default.sep}edge${node_path_1.default.sep}`) || file.toLowerCase().includes("edge"))) {
        modes.add("edge-like");
    }
    return [...modes].sort();
}
function detectTestHints(root) {
    const hints = [];
    const pkgPath = node_path_1.default.join(root, "package.json");
    if (node_fs_1.default.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(node_fs_1.default.readFileSync(pkgPath, "utf8"));
            for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
                if (name.includes("test") || name.includes("lint") || name.includes("check"))
                    hints.push(`npm run ${name}: ${command}`);
            }
        }
        catch {
            hints.push("package.json scripts unreadable");
        }
    }
    for (const file of ["pytest.ini", "go.mod", "Cargo.toml", "foundry.toml"]) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(root, file)))
            hints.push(file);
    }
    return hints;
}
function gitProfile(root) {
    return {
        branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root),
        commit: run("git", ["rev-parse", "HEAD"], root),
        status: run("git", ["status", "--short"], root)
    };
}
function detectTools() {
    const tools = ["git", "node", "npm", "python", "docker", "wsl", "rg"];
    return Object.fromEntries(tools.map((tool) => [tool, commandVersion(tool)]));
}
function commandVersion(command) {
    if (!commandExists(command))
        return "missing";
    const args = command === "wsl" ? ["--version"] : ["--version"];
    return cleanCommandOutput(run(command, args, process.cwd())).split(/\r?\n/)[0] || "available";
}
function commandExists(command) {
    const check = process.platform === "win32" ? "where.exe" : "which";
    return run(check, [command], process.cwd()) !== "";
}
function run(command, args, cwd) {
    try {
        return (0, node_child_process_1.execFileSync)(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return "";
    }
}
function cleanCommandOutput(value) {
    return value.replace(/\u0000/g, "").replace(/[^\S\r\n]+/g, " ").trim();
}
