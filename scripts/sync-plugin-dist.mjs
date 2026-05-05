import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "dist");
const destination = path.join(repoRoot, "plugins", "proteus", "dist");

if (!fs.existsSync(source)) {
  throw new Error(`missing build output: ${source}`);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
