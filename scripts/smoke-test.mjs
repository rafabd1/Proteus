import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-smoke-"));
const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-global-smoke-"));

function run(args, cwd = tmpRoot) {
  return execFileSync("node", [cli, ...args], {
    cwd,
    env: {
      ...process.env,
      PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
      PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports")
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

try {
  fs.mkdirSync(path.join(tmpRoot, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "docs", "prior-finding.md"),
    "# Prior Finding\n\nValidation gate duplicate text for smoke testing.\n"
  );
  fs.writeFileSync(
    path.join(tmpRoot, "server.ts"),
    "export function handler(request: Request) { return request.url; }\n"
  );

  run(["init", "--name", "smoke-target"]);
  run(["ingest", "docs"]);
  run(["observe"]);
  run([
    "learn",
    "add",
    "--category",
    "user_preference",
    "--scope",
    "smoke,bug-bounty",
    "--title",
    "Prefer smoke exploitability",
    "--body",
    "Smoke global learning body",
    "--tags",
    "smoke,impact"
  ]);
  const learnings = run(["learn", "query", "exploitability", "--scope", "smoke"]);
  if (!learnings.includes("Prefer smoke exploitability")) {
    throw new Error("global learning query did not return expected record");
  }
  run(["plan-round", "--objective", "Smoke high-ROI round", "--write"]);
  run([
    "record",
    "agent-output",
    "--round-id",
    "1",
    "--role",
    "argus",
    "--surface",
    "Smoke request surface",
    "--covered",
    "server.ts",
    "--killed",
    "smoke-only duplicate"
  ]);
  run(["update", "surface", "--id", "1", "--status", "covered", "--revisit", "smoke revisit condition"]);
  run([
    "record",
    "hypothesis",
    "--title",
    "Smoke validation candidate",
    "--primitive",
    "validation gate",
    "--attacker-boundary",
    "external request",
    "--impact",
    "test impact",
    "--score",
    "10"
  ]);
  const duplicates = run(["query", "duplicates", "validation gate"]);
  if (!duplicates.includes("source#") && !duplicates.includes("hypothesis#")) {
    throw new Error("duplicate query did not return indexed records");
  }
  run(["lab", "create", "--candidate-id", "1", "--name", "smoke-lab"]);
  run(["export"]);
  run(["learn", "export"]);

  for (const required of [
    ".vros/memory.sqlite",
    ".vros/exports/target-contract.md",
    ".vros/exports/surface-map.md",
    ".vros/exports/candidate-register.md",
    ".vros/exports/research-log.md",
    ".vros/labs/C1-smoke-lab/README.md"
  ]) {
    if (!fs.existsSync(path.join(tmpRoot, required))) {
      throw new Error(`missing expected artifact: ${required}`);
    }
  }
  if (!fs.existsSync(path.join(globalRoot, "global.sqlite"))) {
    throw new Error("missing global memory sqlite");
  }
  if (!fs.existsSync(path.join(globalRoot, "exports", "global-learnings.md"))) {
    throw new Error("missing global learning export");
  }

  console.log(`Proteus smoke test passed: ${tmpRoot}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
}
