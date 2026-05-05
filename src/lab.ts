import fs from "node:fs";
import path from "node:path";
import { ProteusDb } from "./db";
import { ensureDir, labsDir } from "./paths";

export function createLab(db: ProteusDb, candidateId: number, name?: string): string {
  const safeName = slug(name ?? `candidate-${candidateId}`);
  const labPath = path.join(labsDir(db.targetRoot), `C${candidateId}-${safeName}`);
  ensureDir(labPath);
  const readme = renderReadme(candidateId, safeName);
  fs.writeFileSync(path.join(labPath, "README.md"), readme);
  fs.writeFileSync(path.join(labPath, "evidence.md"), "# Evidence\n\n");
  db.addLab(candidateId, labPath, "unknown: Artificer must document why this configuration is default, documented, or normal correct practice.");
  return labPath;
}

function renderReadme(candidateId: number, name: string): string {
  return `# Proteus Lab: C${candidateId} ${name}\n\n## Configuration Legitimacy\n\nDocument why this setup uses default, documented, or normal correct-practice configuration. Do not disable security controls or patch target code to create the bug.\n\n## Affected Version\n\n- Commit/version:\n- Runtime mode:\n- Deployment profile:\n\n## Attacker Model\n\n- Attacker capabilities:\n- Victim/tenant/user assumptions:\n- External input controlled:\n\n## Setup\n\n\`\`\`text\n# commands here\n\`\`\`\n\n## Attack Steps\n\n1. \n\n## Expected Vulnerable Result\n\n## Negative Controls\n\n| Control | Expected safe result | Observed result | Evidence |\n| --- | --- | --- | --- |\n\n## Limitations and Non-Claims\n\n## Evidence\n\nSee \`evidence.md\`.\n`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

