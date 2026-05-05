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
    db.addLab(candidateId, labPath, "unknown: Artificer must document why this configuration is default, documented, or normal correct practice.");
    return labPath;
}
function renderReadme(candidateId, name) {
    return `# Proteus Lab: C${candidateId} ${name}\n\n## Configuration Legitimacy\n\nDocument why this setup uses default, documented, or normal correct-practice configuration. Do not disable security controls or patch target code to create the bug.\n\n## Affected Version\n\n- Commit/version:\n- Runtime mode:\n- Deployment profile:\n\n## Attacker Model\n\n- Attacker capabilities:\n- Victim/tenant/user assumptions:\n- External input controlled:\n\n## Setup\n\n\`\`\`text\n# commands here\n\`\`\`\n\n## Attack Steps\n\n1. \n\n## Expected Vulnerable Result\n\n## Negative Controls\n\n| Control | Expected safe result | Observed result | Evidence |\n| --- | --- | --- | --- |\n\n## Limitations and Non-Claims\n\n## Evidence\n\nSee \`evidence.md\`.\n`;
}
function slug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}
