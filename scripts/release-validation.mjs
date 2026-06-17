import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const newCli = path.join(repoRoot, "dist", "cli.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-release-validate-"));
const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-release-global-"));

try {
  const version = run("node", [newCli, "--version"]);
  assertIncludes(version, "@rafabd1/proteus 1.0.0", "new CLI version");

  const oldVersion = runOptional("proteus", ["--version"]);
  const hasOldProteus = oldVersion.ok && !oldVersion.output.includes("1.0.0");
  if (hasOldProteus) {
    createRecordsWithOldProteus(tmpRoot);
  } else {
    createRecordsWithNewProteus(tmpRoot);
  }

  const migrations = run("node", [newCli, "migrate", "--root", tmpRoot]);
  assertIncludes(migrations, "2026-06-17-campaigns-links-branches", "campaign migration");
  assertIncludes(migrations, "2026-06-17-campaign-checkpoints", "checkpoint migration");
  assertIncludes(migrations, "Proteus DB version: 1.0.0", "stored Proteus database version");

  const status = run("node", [newCli, "status", "--root", tmpRoot]);
  assertIncludes(status, "release-legacy-target", "migrated target status");
  assertIncludes(status, "Proteus DB version: 1.0.0", "status Proteus database version");
  const metadataUpdatedAt = readProteusMetadataUpdatedAt(tmpRoot);
  run("node", [newCli, "status", "--root", tmpRoot]);
  if (readProteusMetadataUpdatedAt(tmpRoot) !== metadataUpdatedAt) {
    throw new Error("status changed proteus_version metadata even though the stored version already matched");
  }

  run("node", [newCli, "campaign", "create", "--root", tmpRoot, "--title", "Release validation campaign", "--objective", "Validate migration and active state"]);
  run("node", [
    newCli,
    "branch",
    "add",
    "--root",
    tmpRoot,
    "--campaign-id",
    "1",
    "--title",
    "Release validation branch",
    "--primitive",
    "controlled transition",
    "--steps",
    "step one,step two",
    "--kill-conditions",
    "control fails"
  ]);
  run("node", [
    newCli,
    "campaign",
    "checkpoint",
    "--root",
    tmpRoot,
    "--id",
    "1",
    "--confirmed",
    "legacy records migrated",
    "--open",
    "release validation branch",
    "--next",
    "verify active-state links",
    "--contract-signature",
    "{\"status\":\"compliant\",\"agent\":\"release-validation\"}"
  ]);
  run("node", [newCli, "record", "hypothesis", "--root", tmpRoot, "--title", "Release validation hypothesis", "--primitive", "state transition"]);
  run("node", [newCli, "record", "evidence", "--root", tmpRoot, "--title", "Release validation evidence", "--body", "release validation evidence body"]);
  run("node", [
    newCli,
    "record",
    "decision",
    "--root",
    tmpRoot,
    "--entity-type",
    "hypothesis",
    "--entity-id",
    "2",
    "--decision",
    "candidate",
    "--reason",
    "release validation decision"
  ]);

  const digest = run("node", [newCli, "campaign", "resume", "--root", tmpRoot]);
  assertIncludes(digest, "recentCheckpoints", "campaign digest checkpoints");
  assertIncludes(digest, "verify active-state links", "campaign digest next move");

  const links = run("node", [newCli, "list", "links", "--root", tmpRoot, "--entity-type", "campaign", "--entity-id", "1"]);
  for (const expected of ["has_branch", "tracks_hypothesis", "has_evidence", "has_decision"]) {
    assertIncludes(links, expected, `campaign link ${expected}`);
  }

  const changelogPath = path.join(tmpRoot, "CHANGELOG.generated.md");
  const changelogOutput = run("node", [path.join(repoRoot, "scripts", "generate-changelog.mjs"), "--version", "v1.0.0", "--out", changelogPath]);
  assertIncludes(changelogOutput, changelogPath, "changelog output path");
  const generatedChangelog = fs.readFileSync(changelogPath, "utf8");
  assertIncludes(generatedChangelog, "## 1.0.0 - 2026-06-17", "generated changelog version section");
  assertIncludes(generatedChangelog, "### Added", "generated changelog body");
  if (generatedChangelog.includes("## Verification")) {
    throw new Error("generated changelog used commit fallback instead of CHANGELOG.md version notes");
  }

  if (process.platform === "win32") {
    const wrapperVersion = execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "plugins", "proteus", "scripts", "proteus.ps1"), "--version"],
      { cwd: repoRoot, encoding: "utf8", env: releaseEnv() }
    );
    assertIncludes(wrapperVersion, "@rafabd1/proteus 1.0.0", "PowerShell plugin wrapper");
  }

  console.log(`Proteus release validation passed: ${tmpRoot}`);
  if (hasOldProteus) {
    console.log(`Validated migration from installed ${oldVersion.output.trim()}`);
  } else {
    console.log("No older installed proteus CLI detected; validated with current CLI-created state.");
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
}

function createRecordsWithOldProteus(root) {
  run("proteus", ["init", "--root", root, "--name", "release-legacy-target"]);
  fs.writeFileSync(path.join(root, "legacy.ts"), "export const legacy = true;\n");
  run("proteus", [
    "record",
    "surface",
    "--root",
    root,
    "--name",
    "Legacy release surface",
    "--family",
    "legacy",
    "--description",
    "created with installed proteus",
    "--files",
    "legacy.ts"
  ]);
  run("proteus", ["record", "hypothesis", "--root", root, "--title", "Legacy release hypothesis", "--primitive", "legacy primitive"]);
  run("proteus", ["record", "evidence", "--root", root, "--title", "Legacy release evidence", "--body", "legacy evidence body"]);
}

function createRecordsWithNewProteus(root) {
  run("node", [newCli, "init", "--root", root, "--name", "release-legacy-target"]);
  run("node", [newCli, "record", "surface", "--root", root, "--name", "Legacy release surface"]);
  run("node", [newCli, "record", "hypothesis", "--root", root, "--title", "Legacy release hypothesis"]);
}

function run(command, args) {
  if (process.platform === "win32" && command !== "node") {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& ${psQuote(command)} ${args.map(psQuote).join(" ")}`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: releaseEnv(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  }
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: releaseEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runOptional(command, args) {
  try {
    return { ok: true, output: run(command, args) };
  } catch (error) {
    return { ok: false, output: String(error?.message ?? error) };
  }
}

function releaseEnv() {
  return {
    ...process.env,
    PROTEUS_GLOBAL_MEMORY_PATH: path.join(globalRoot, "global.sqlite"),
    PROTEUS_GLOBAL_EXPORTS_DIR: path.join(globalRoot, "exports")
  };
}

function assertIncludes(value, expected, label) {
  if (!String(value).includes(expected)) {
    throw new Error(`${label} missing ${expected}`);
  }
}

function readProteusMetadataUpdatedAt(root) {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning?.message;
    const warningType = typeof args[0] === "string" ? args[0] : undefined;
    if (warningType === "ExperimentalWarning" && String(message).includes("SQLite")) return;
    return emitWarning.call(process, warning, ...args);
  };
  const { DatabaseSync } = require("node:sqlite");
  process.emitWarning = emitWarning;
  const db = new DatabaseSync(path.join(root, ".vros", "memory.sqlite"));
  try {
    const row = db.prepare("SELECT updated_at FROM proteus_metadata WHERE key = 'proteus_version'").get();
    return String(row?.updated_at ?? "");
  } finally {
    db.close();
  }
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
