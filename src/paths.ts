import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export function resolveTargetRoot(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

export function vrosDir(targetRoot: string): string {
  return path.join(targetRoot, ".vros");
}

export function memoryPath(targetRoot: string): string {
  return path.join(vrosDir(targetRoot), "memory.sqlite");
}

export function exportsDir(targetRoot: string): string {
  return path.join(vrosDir(targetRoot), "exports");
}

export function labsDir(targetRoot: string): string {
  return path.join(vrosDir(targetRoot), "labs");
}

export function globalVrosDir(): string {
  return path.join(os.homedir(), ".vros");
}

export function globalMemoryPath(): string {
  if (process.env.PROTEUS_GLOBAL_MEMORY_PATH) {
    return path.resolve(process.env.PROTEUS_GLOBAL_MEMORY_PATH);
  }
  return path.join(globalVrosDir(), "global.sqlite");
}

export function globalExportsDir(): string {
  if (process.env.PROTEUS_GLOBAL_EXPORTS_DIR) {
    return path.resolve(process.env.PROTEUS_GLOBAL_EXPORTS_DIR);
  }
  return path.join(globalVrosDir(), "exports");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function toRelative(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative.length === 0 ? "." : relative.replace(/\\/g, "/");
}
