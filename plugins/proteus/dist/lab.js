"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLab = createLab;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
function createLab(db, candidateId, name) {
    const safeName = slug(name ?? `candidate-${candidateId}`);
    const labPath = node_path_1.default.join((0, paths_1.labsDir)(db.targetRoot), `C${candidateId}-${safeName}`);
    (0, paths_1.ensureDir)(labPath);
    const readme = renderReadme(candidateId, safeName);
    node_fs_1.default.writeFileSync(node_path_1.default.join(labPath, "README.md"), readme);
    node_fs_1.default.writeFileSync(node_path_1.default.join(labPath, "evidence.md"), "# Evidence\n\n");
    node_fs_1.default.writeFileSync(node_path_1.default.join(labPath, "report-draft.md"), renderReportDraft(candidateId, safeName));
    db.addLab(candidateId, labPath, "unknown: Artificer must document why this configuration is default, documented, or normal correct practice.");
    return labPath;
}
function renderReadme(candidateId, name) {
    return `# Proteus Lab: C${candidateId} ${name}\n\n## Configuration Legitimacy\n\nDocument why this setup uses default, documented, or normal correct-practice configuration. Do not disable security controls or patch target code to create the bug.\n\n## Affected Version and Timeline\n\n- Commit/version tested:\n- Runtime mode:\n- Deployment profile:\n- Earliest affected version or introduction window:\n- Likely introducing commit/PR/release:\n- Fixed version or patch status, if any:\n\n## Public Intel and Known-Issue Search\n\nRecord exact searches before any claim.\n\n| Source | Query or URL | Date checked | Result | Evidence |\n| --- | --- | --- | --- | --- |\n| Local findings/reports |  |  |  |  |\n| Advisories/CVE/GHSA |  |  |  |  |\n| Issues/PRs/discussions |  |  |  |  |\n| Changelog/releases |  |  |  |  |\n| Docs/tests |  |  |  |  |\n| Public writeups/search |  |  |  |  |\n\nKnown/not-known verdict:\n\n## Skeptic Review\n\nSkeptic must try to kill or downgrade the candidate before report-grade status.\n\n| Refutation argument | Evidence checked | Rebuttal | Status |\n| --- | --- | --- | --- |\n| Expected behavior |  |  | unresolved |\n| Duplicate or public-known |  |  | unresolved |\n| Integration-only or misuse |  |  | unresolved |\n| Lab-created behavior |  |  | unresolved |\n| Missing attacker boundary |  |  | unresolved |\n| Weak or non-security impact |  |  | unresolved |\n\nSkeptic verdict:\n\n## Attacker Model\n\n- Attacker capabilities:\n- Victim/tenant/user assumptions:\n- External input controlled:\n\n## Setup\n\n\`\`\`text\n# commands here\n\`\`\`\n\n## Attack Steps\n\n1. \n\n## Expected Vulnerable Result\n\n## Negative Controls\n\n| Control | Expected safe result | Observed result | Evidence |\n| --- | --- | --- | --- |\n\n## Limitations and Non-Claims\n\n## Evidence\n\nSee \`evidence.md\`.\n`;
}
function renderReportDraft(candidateId, name) {
    return `# Report Draft: C${candidateId} ${name}\n\nWrite this for the triager, not for Proteus. Do not mention internal workspace paths, agent roles, memory files, or research workflow. Use natural, concise language. Avoid em dashes, filler, and phrases such as "this is not about X, it is about Y".\n\n## Title\n\nUse one concrete sentence that names the affected boundary and impact.\n\n## CWE\n\nUse the most accurate CWE. If uncertain, write the best candidate and keep the uncertainty explicit.\n\n## Summary\n\nStart directly. In one or two short paragraphs, explain what breaks, who can trigger it, the root cause at a high level, and the realistic security impact. A reader with no prior context should understand the issue from this section.\n\n## Root Cause\n\nInclude when it helps triage. Explain the target-owned mistake simply first, then add only the technical detail needed to understand why the vulnerability exists.\n\n## PoC Details\n\nInclude when there is PoC material beyond the reproduction steps. Prefer manual, blackbox-style proof using browser actions, HTTP requests, \`curl\`, or normal CLI commands. If a helper script is necessary, explain the manual flow it automates. Include short snippets only when they make the proof easier to trust, and explain what each snippet does and what output proves the issue.\n\n\`\`\`bash\n# curl or manual command here, if useful\n\`\`\`\n\n## Steps To Reproduce\n\n1. \n\n## Impact\n\nDescribe the realistic attacker scenario, the victim resources affected, and the security consequence. Avoid abstract severity language unless the program asks for it.\n\nAdd other sections only when the program template requires them or when the triage context specifically needs them.\n`;
}
function slug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}
