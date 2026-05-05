import fs from "node:fs";
import path from "node:path";
import { ProteusDb } from "./db";
import { exportsDir, ensureDir } from "./paths";
import { renderRoundPlan } from "./planner";
import type { RoundPlan } from "./planner";

export function exportMarkdown(db: ProteusDb, latestPlan?: RoundPlan): string[] {
  const outDir = exportsDir(db.targetRoot);
  ensureDir(outDir);
  const written: string[] = [];

  const target = db.getTarget();
  const surfaces = db.listSurfaces();
  const hypotheses = db.listHypotheses();
  const rounds = db.listRounds();

  written.push(writeFile(outDir, "target-contract.md", renderTarget(target)));
  written.push(writeFile(outDir, "surface-map.md", renderSurfaces(surfaces)));
  written.push(writeFile(outDir, "candidate-register.md", renderCandidates(hypotheses)));
  written.push(writeFile(outDir, "research-log.md", renderResearchLog(rounds)));
  if (latestPlan) {
    written.push(writeFile(outDir, `round-plan-${rounds[0]?.id ?? "latest"}.md`, renderRoundPlan(latestPlan)));
  }
  return written;
}

function writeFile(dir: string, name: string, body: string): string {
  const fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, body);
  return fullPath;
}

function renderTarget(target: ReturnType<ProteusDb["getTarget"]>): string {
  if (!target) return "# Target Contract\n\nTarget not initialized.\n";
  return `# Target Contract\n\nTarget: ${target.name}\n\nScope root: ${target.rootPath}\n\n\`\`\`json\n${JSON.stringify(target.contract, null, 2)}\n\`\`\`\n`;
}

function renderSurfaces(surfaces: ReturnType<ProteusDb["listSurfaces"]>): string {
  const rows = surfaces
    .map(
      (surface) =>
        `| ${surface.id} | ${surface.name} | ${surface.family} | ${surface.status} | ${surface.roiScore.toFixed(1)} | ${surface.files.length} | ${surface.revisitCondition || "-"} |`
    )
    .join("\n");
  return `# Surface Map\n\n| ID | Name | Family | Status | ROI | Files | Revisit condition |\n| --- | --- | --- | --- | ---: | ---: | --- |\n${rows || "| - | - | - | - | - | - | - |"}\n`;
}

function renderCandidates(hypotheses: ReturnType<ProteusDb["listHypotheses"]>): string {
  const live = hypotheses
    .filter((hypothesis) => hypothesis.status !== "discarded")
    .map(
      (hypothesis) =>
        `| H${hypothesis.id} | ${hypothesis.title} | ${hypothesis.primitive} | ${hypothesis.attackerBoundary} | ${hypothesis.impactClaim} | ${hypothesis.status} | ${hypothesis.score.toFixed(1)} | ${hypothesis.killCriteria || "-"} |`
    )
    .join("\n");
  const discarded = hypotheses
    .filter((hypothesis) => hypothesis.status === "discarded")
    .map(
      (hypothesis) =>
        `| H${hypothesis.id} | ${hypothesis.title} | ${hypothesis.killCriteria || "discarded"} | ${hypothesis.revisitCondition || "-"} |`
    )
    .join("\n");
  return `# Candidate Register\n\n## Live / Watchlist / Candidate\n\n| ID | Name | Primitive | Attacker boundary | Impact | Status | Score | Kill criteria |\n| --- | --- | --- | --- | --- | --- | ---: | --- |\n${live || "| - | - | - | - | - | - | - | - |"}\n\n## Discarded\n\n| ID | Hypothesis | Reason discarded | Revisit only if |\n| --- | --- | --- | --- |\n${discarded || "| - | - | - | - |"}\n`;
}

function renderResearchLog(rounds: ReturnType<ProteusDb["listRounds"]>): string {
  const entries = rounds
    .map(
      (round) =>
        `## ${round.createdAt} - Round ${round.id}\n\nGoal:\n${round.objective}\n\nWhat changed in understanding:\n${round.currentUnderstanding}\n\nDecision:\n${round.outcome}\n`
    )
    .join("\n");
  return `# Research Log\n\n${entries || "No rounds recorded yet.\n"}`;
}

