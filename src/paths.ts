import path from "node:path";
import fs from "node:fs";

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

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function toRelative(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative.length === 0 ? "." : relative.replace(/\\/g, "/");
}

