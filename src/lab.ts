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
  fs.writeFileSync(path.join(labPath, "report-draft.md"), renderReportDraft(candidateId, safeName));
  db.addLab(candidateId, labPath, "unknown: Artificer must document why this configuration is default, documented, or normal correct practice.");
  return labPath;
}

function renderReadme(candidateId: number, name: string): string {
  return `# Proteus Lab: C${candidateId} ${name}\n\n## Configuration Legitimacy\n\nDocument why this setup uses default, documented, or normal correct-practice configuration. Do not disable security controls or patch target code to create the bug.\n\n## Affected Version and Timeline\n\n- Commit/version tested:\n- Runtime mode:\n- Deployment profile:\n- Earliest affected version or introduction window:\n- Likely introducing commit/PR/release:\n- Fixed version or patch status, if any:\n\n## Public Intel and Known-Issue Search\n\nRecord exact searches before any claim.\n\n| Source | Query or URL | Date checked | Result | Evidence |\n| --- | --- | --- | --- | --- |\n| Local findings/reports |  |  |  |  |\n| Advisories/CVE/GHSA |  |  |  |  |\n| Issues/PRs/discussions |  |  |  |  |\n| Changelog/releases |  |  |  |  |\n| Docs/tests |  |  |  |  |\n| Public writeups/search |  |  |  |  |\n\nKnown/not-known verdict:\n\n## Skeptic Review\n\nSkeptic must try to kill or downgrade the candidate before report-grade status.\n\n| Refutation argument | Evidence checked | Rebuttal | Status |\n| --- | --- | --- | --- |\n| Expected behavior |  |  | unresolved |\n| Duplicate or public-known |  |  | unresolved |\n| Integration-only or misuse |  |  | unresolved |\n| Lab-created behavior |  |  | unresolved |\n| Missing attacker boundary |  |  | unresolved |\n| Weak or non-security impact |  |  | unresolved |\n\nSkeptic verdict:\n\n## Attacker Model\n\n- Attacker capabilities:\n- Victim/tenant/user assumptions:\n- External input controlled:\n\n## Setup\n\n\`\`\`text\n# commands here\n\`\`\`\n\n## Attack Steps\n\n1. \n\n## Expected Vulnerable Result\n\n## Negative Controls\n\n| Control | Expected safe result | Observed result | Evidence |\n| --- | --- | --- | --- |\n\n## Limitations and Non-Claims\n\n## Evidence\n\nSee \`evidence.md\`.\n`;
}

function renderReportDraft(candidateId: number, name: string): string {
  return `# Report Draft: C${candidateId} ${name}\n\nWrite this for the triager, not for Proteus. Do not mention internal workspace paths, agent roles, memory files, or research workflow. Use natural, concise language. Avoid em dashes, filler, and phrases such as "this is not about X, it is about Y".\n\n## Title\n\nUse a concrete title that names the affected boundary and impact.\n\n## Summary\n\nExplain the issue in plain language. A reader with no prior context should understand what breaks, who can trigger it, and why it matters.\n\n## Affected Component and Version\n\n- Component:\n- Tested version/commit:\n- Likely introduced in:\n- Fixed version or patch status, if known:\n\n## Root Cause\n\nExplain the bug simply first, then add the relevant technical detail. Focus on the target-owned mistake, not the lab.\n\n## Impact\n\nDescribe a realistic high-impact attacker scenario. Name attacker capabilities, victim resources, and the security consequence.\n\n## Attack Scenario\n\nWrite the scenario as a plausible blackbox attack flow using normal users, tenants, projects, tokens, requests, or resources.\n\n## Steps to Reproduce\n\nPrefer manual reproduction with browser actions, HTTP requests, curl, or normal CLI commands. If a helper script is needed, explain the manual flow it automates.\n\n1. \n\n## PoC Details\n\nInclude only snippets that help triage trust the reproduction. Explain what each snippet does and which output proves the issue.\n\n\`\`\`bash\n# curl or manual command here\n\`\`\`\n\n## Expected Result\n\nDescribe the safe behavior.\n\n## Actual Result\n\nDescribe the vulnerable behavior and point to evidence.\n\n## Negative Controls\n\nShow at least one control that proves the result is not caused by lab setup, unsafe configuration, or excessive privileges.\n\n## Why This Is Not Expected Or Known\n\nSummarize local dedupe, public intel, advisories, issues, changelog, docs/tests, and timeline checks. Do not claim novelty unless those checks were actually performed.\n\n## Suggested Fix Or Mitigation\n\nKeep it practical and tied to the root cause.\n\n## Limitations\n\nState any uncertainty, version limits, environmental assumptions, or untested variants.\n`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
