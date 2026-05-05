"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_ORDER = exports.ROLES = void 0;
exports.ROLES = {
    argus: {
        codename: "argus",
        displayName: "Argus",
        family: "component-level-review",
        purpose: "Inspect components in detail and identify local security primitives with exact files, boundaries, and kill criteria.",
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
        purpose: "Connect separate components into emergent exploit chains involving authority, state, replay, runtime, or cache drift.",
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
        purpose: "Generate anomaly matrices and edge cases that stress parsers, canonicalization, headers, encodings, and format boundaries.",
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
        purpose: "Verify official docs, tests, advisories, issues, and public-known behavior to establish the contract a candidate may break.",
        startsWhen: "A hypothesis needs contract evidence, dedupe, expected-behavior review, or timeline context.",
        requiredOutput: [
            "contract matrix",
            "docs/tests evidence",
            "classes killed as expected behavior",
            "duplicate or public-known risk",
            "preliminary timeline"
        ]
    },
    mimic: {
        codename: "mimic",
        displayName: "Mimic",
        family: "runtime-adapter-environment-divergence",
        purpose: "Compare supported runtime, adapter, deployment, build, and environment modes for divergent security behavior.",
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
        purpose: "Build clean realistic PoCs and labs with documented configuration, attack steps, and negative controls.",
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
        purpose: "Try to refute or downgrade a candidate through expected-behavior, duplicate, misuse, missing-control, and negative-control arguments.",
        startsWhen: "Technical evidence exists and the coordinator needs adversarial validation before report-grade promotion.",
        requiredOutput: [
            "arguments against the finding",
            "outcome of each argument",
            "docs/intel found",
            "verdict: reportable, watchlist, or discarded"
        ]
    }
};
exports.ROLE_ORDER = [
    "argus",
    "loom",
    "chaos",
    "libris",
    "mimic",
    "artificer",
    "skeptic"
];
