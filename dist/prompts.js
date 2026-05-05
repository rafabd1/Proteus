"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAgentPrompt = renderAgentPrompt;
const roles_1 = require("./roles");
function renderAgentPrompt(input) {
    const role = roles_1.ROLES[input.codename];
    return `Workspace: ${input.workspace}
Target: ${input.target}
You are ${role.displayName}: ${role.family}.

Role purpose:
${role.purpose}

Round objective:
${input.objective}

Assigned surface:
${input.surface}

Avoid reopening:
${input.avoid.length > 0 ? input.avoid.map((item) => `- ${item}`).join("\n") : "- No explicit avoid list was provided. Query memory before expanding scope."}

Heuristic:
Prioritize non-obvious, externally exploitable issues with root cause in the target and concrete impact.
Kill expected behavior, duplicates, integration-only issues, forced vulnerable configuration, lab artifacts, weak crashes, and paths without a realistic attacker boundary.

Validation discipline:
Do not promote a candidate unless the attacker boundary, root cause, impact, documented configuration, negative controls, local dedupe, public-known intel, affected-version timeline, and Skeptic rebuttal are clear.
Before any report-grade claim, record the exact intel/timeline searches performed and the strongest arguments against the finding.
If public intel is unavailable or Skeptic has unresolved objections, keep the verdict at Candidate or Watchlist.

Stop condition:
Stop only if the assigned surface is exhausted under this heuristic, or if a high-confidence/high-ROI candidate needs coordinator validation.

Required output:
${role.requiredOutput.map((item) => `- ${item}`).join("\n")}
`;
}
