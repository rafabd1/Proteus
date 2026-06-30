import type { AgentCodename } from "./types";

export interface RoleDefinition {
  codename: AgentCodename;
  displayName: string;
  family: string;
  purpose: string;
  startsWhen: string;
  requiredOutput: string[];
}

export const ROLES: Record<AgentCodename, RoleDefinition> = {
  generalist: {
    codename: "generalist",
    displayName: "Generalist",
    family: "generalist-triage",
    purpose:
      "Run a bounded general triage front when no specialist role fits cleanly, preserving useful coverage, killed paths, and next-step recommendations without inventing a new codename.",
    startsWhen: "The coordinator needs a broad but still bounded triage pass or a subagent result does not map cleanly to a specialist role.",
    requiredOutput: [
      "bounded scope reviewed",
      "relevant context recovered",
      "live candidates",
      "killed or duplicate paths",
      "watchlist items",
      "recommended specialist follow-up"
    ]
  },
  argus: {
    codename: "argus",
    displayName: "Argus",
    family: "component-level-review",
    purpose:
      "Inspect components in detail and identify local security primitives with exact files, boundaries, and kill criteria.",
    startsWhen: "The coordinator needs detailed coverage of a bounded component or module family.",
    requiredOutput: [
      "covered surface map",
      "live candidates",
      "below-bar watchlist",
      "killed hypotheses with evidence",
      "concrete probes",
      "uncovered areas",
      "recommended next split"
    ]
  },
  loom: {
    codename: "loom",
    displayName: "Loom",
    family: "macro-chaining-analysis",
    purpose:
      "Connect separate components into emergent exploit chains involving authority, state, replay, runtime, or cache drift.",
    startsWhen: "Local primitives exist or the target has complex feature composition.",
    requiredOutput: [
      "plausible chains",
      "connection points",
      "controls expected to stop the chain",
      "kill criteria",
      "validation probes"
    ]
  },
  chaos: {
    codename: "chaos",
    displayName: "Chaos",
    family: "fuzzing-edge-case-generation",
    purpose:
      "Generate anomaly matrices and edge cases that stress parsers, canonicalization, headers, encodings, and format boundaries.",
    startsWhen: "A parser, protocol, canonicalization, cache-key, or format boundary needs stress input.",
    requiredOutput: [
      "input matrix",
      "suggested harness or probe",
      "expected controls",
      "upgrade condition for becoming a candidate"
    ]
  },
  libris: {
    codename: "libris",
    displayName: "Libris",
    family: "docs-contract-verification",
    purpose:
      "Verify official docs, tests, advisories, issues, releases, changelogs, public-known behavior, and timeline to establish the contract a candidate may break.",
    startsWhen: "A hypothesis needs contract evidence, dedupe, expected-behavior review, or timeline context.",
    requiredOutput: [
      "contract matrix",
      "docs/tests evidence",
      "classes killed as expected behavior",
      "duplicate or public-known risk",
      "public intel search log with queries and sources",
      "affected version and likely introduction window",
      "known/not-known verdict with caveats"
    ]
  },
  mimic: {
    codename: "mimic",
    displayName: "Mimic",
    family: "runtime-adapter-environment-divergence",
    purpose:
      "Compare supported runtime, adapter, deployment, build, and environment modes for divergent security behavior.",
    startsWhen: "The target supports multiple runtimes, adapters, build outputs, deployment modes, or local lab profiles.",
    requiredOutput: [
      "modes compared",
      "divergences with potential impact",
      "documented/supported mode status",
      "probes per runtime"
    ]
  },
  artificer: {
    codename: "artificer",
    displayName: "Artificer",
    family: "poc-lab-builder",
    purpose:
      "Build clean realistic PoCs and labs with documented configuration, attack steps, and negative controls.",
    startsWhen: "A candidate passes initial gates and needs reproducible validation.",
    requiredOutput: [
      "clean PoC folder",
      "setup and attack steps",
      "negative controls",
      "configuration legitimacy",
      "limitations"
    ]
  },
  skeptic: {
    codename: "skeptic",
    displayName: "Skeptic",
    family: "devils-advocate",
    purpose:
      "Try to refute or downgrade a candidate through expected-behavior, duplicate, public-known, timeline, misuse, missing-control, impact, and negative-control arguments.",
    startsWhen: "Technical evidence exists and the coordinator needs adversarial validation before report-grade promotion.",
    requiredOutput: [
      "arguments against the finding",
      "outcome of each argument",
      "docs/intel found",
      "unresolved doubts",
      "required rebuttal evidence",
      "verdict: reportable, watchlist, or discarded"
    ]
  },
  cicada: {
    codename: "cicada",
    displayName: "Cicada",
    family: "exploit-development-bypass-chaining",
    purpose:
      "Strengthen promising signals into realistic exploit strategies by reducing blockers, designing bypass paths, and clarifying chain requirements without promoting unvalidated claims.",
    startsWhen:
      "A branch already has concrete signal but still needs bypass design, chaining, exploit reliability, impact proof, or a lab-grade PoC path.",
    requiredOutput: [
      "current primitive and blockers",
      "bypass candidates",
      "chain paths",
      "minimal reliable PoC plan",
      "impact preconditions",
      "evidence needed",
      "kill conditions",
      "contract signature"
    ]
  }
};

export const ROLE_ORDER: AgentCodename[] = [
  "generalist",
  "argus",
  "loom",
  "chaos",
  "libris",
  "mimic",
  "artificer",
  "skeptic",
  "cicada"
];

export function normalizeAgentCodename(value: string | undefined | null): AgentCodename | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^proteus[-_:]/, "")
    .replace(/\s+/g, "-");
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(ROLES, normalized)) return normalized as AgentCodename;
  for (const codename of ROLE_ORDER) {
    const role = ROLES[codename];
    const display = role.displayName.toLowerCase().replace(/\s+/g, "-");
    if (normalized === display) return codename;
  }
  return null;
}

export function validRoleList(): string {
  return ROLE_ORDER.join(", ");
}
