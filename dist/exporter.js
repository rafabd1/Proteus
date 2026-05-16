"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportMarkdown = exportMarkdown;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const planner_1 = require("./planner");
function exportMarkdown(db, latestPlan) {
    const outDir = (0, paths_1.exportsDir)(db.targetRoot);
    (0, paths_1.ensureDir)(outDir);
    const written = [];
    const target = db.getTarget();
    const surfaces = db.listSurfaces();
    const hypotheses = db.listHypotheses();
    const rounds = db.listRounds();
    written.push(writeFile(outDir, "target-contract.md", renderTarget(target)));
    written.push(writeFile(outDir, "surface-map.md", renderSurfaces(surfaces)));
    written.push(writeFile(outDir, "candidate-register.md", renderCandidates(hypotheses)));
    written.push(writeFile(outDir, "research-log.md", renderResearchLog(rounds)));
    if (latestPlan) {
        written.push(writeFile(outDir, `round-plan-${rounds[0]?.id ?? "latest"}.md`, (0, planner_1.renderRoundPlan)(latestPlan)));
    }
    return written;
}
function writeFile(dir, name, body) {
    const fullPath = node_path_1.default.join(dir, name);
    if (node_fs_1.default.existsSync(fullPath)) {
        const current = node_fs_1.default.readFileSync(fullPath, "utf8");
        if (current === body)
            return fullPath;
        const parsed = node_path_1.default.parse(name);
        const generatedPath = nextGeneratedPath(dir, parsed.name, parsed.ext);
        node_fs_1.default.writeFileSync(generatedPath, body);
        return generatedPath;
    }
    node_fs_1.default.writeFileSync(fullPath, body);
    return fullPath;
}
function nextGeneratedPath(dir, baseName, extension) {
    const stamp = Date.now();
    for (let index = 0;; index += 1) {
        const suffix = index === 0 ? "" : `-${index}`;
        const candidate = node_path_1.default.join(dir, `${baseName}.generated-${stamp}${suffix}${extension}`);
        if (!node_fs_1.default.existsSync(candidate))
            return candidate;
    }
}
function renderTarget(target) {
    if (!target)
        return "# Target Contract\n\nTarget not initialized.\n";
    return `# Target Contract\n\nTarget: ${target.name}\n\nScope root: ${target.rootPath}\n\n\`\`\`json\n${JSON.stringify(target.contract, null, 2)}\n\`\`\`\n`;
}
function renderSurfaces(surfaces) {
    const rows = surfaces
        .map((surface) => `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.status} | ${surface.roiScore.toFixed(1)} | ${surface.files.length} | ${surface.revisitCondition || "-"} |`)
        .join("\n");
    return `# Surface Map\n\n| ID | Name | Family | Status | ROI | Files | Revisit condition |\n| --- | --- | --- | --- | ---: | ---: | --- |\n${rows || "| - | - | - | - | - | - | - |"}\n`;
}
function renderCandidates(hypotheses) {
    const live = hypotheses
        .filter((hypothesis) => hypothesis.status !== "discarded")
        .map((hypothesis) => `| H${hypothesis.id} | ${hypothesis.title} | ${hypothesis.primitive} | ${hypothesis.attackerBoundary} | ${hypothesis.impactClaim} | ${hypothesis.status} | ${hypothesis.score.toFixed(1)} | ${hypothesis.killCriteria || "-"} |`)
        .join("\n");
    const discarded = hypotheses
        .filter((hypothesis) => hypothesis.status === "discarded")
        .map((hypothesis) => `| H${hypothesis.id} | ${hypothesis.title} | ${hypothesis.killCriteria || "discarded"} | ${hypothesis.revisitCondition || "-"} |`)
        .join("\n");
    return `# Candidate Register\n\n## Live / Watchlist / Candidate\n\n| ID | Name | Primitive | Attacker boundary | Impact | Status | Score | Kill criteria |\n| --- | --- | --- | --- | --- | --- | ---: | --- |\n${live || "| - | - | - | - | - | - | - | - |"}\n\n## Discarded\n\n| ID | Hypothesis | Reason discarded | Revisit only if |\n| --- | --- | --- | --- |\n${discarded || "| - | - | - | - |"}\n`;
}
function renderResearchLog(rounds) {
    const entries = rounds
        .map((round) => `## ${round.createdAt} - Round ${round.id}\n\nGoal:\n${round.objective}\n\nWhat changed in understanding:\n${round.currentUnderstanding}\n\nDecision:\n${round.outcome}\n`)
        .join("\n");
    return `# Research Log\n\n${entries || "No rounds recorded yet.\n"}`;
}
