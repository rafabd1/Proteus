import { ROLES } from "./roles";
import type { AgentCodename } from "./types";

export function renderAgentPrompt(input: {
  codename: AgentCodename;
  workspace: string;
  target: string;
  surface: string;
  avoid: string[];
  objective: string;
}): string {
  const role = ROLES[input.codename];
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
Do not promote a candidate unless the attacker boundary, root cause, impact, documented configuration, negative controls, and dedupe path are clear.

Stop condition:
Stop only if the assigned surface is exhausted under this heuristic, or if a high-confidence/high-ROI candidate needs coordinator validation.

Required output:
${role.requiredOutput.map((item) => `- ${item}`).join("\n")}
`;
}

