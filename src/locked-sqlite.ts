import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  const warningType = typeof args[0] === "string" ? args[0] : undefined;
  if (warningType === "ExperimentalWarning" && message.includes("SQLite")) return;
  return emitWarning.call(process, warning as never, ...(args as never[]));
}) as typeof process.emitWarning;
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
process.emitWarning = emitWarning;

type SQLiteStatement = {
  run: (...args: unknown[]) => any;
  get: (...args: unknown[]) => any;
  all: (...args: unknown[]) => any[];
};

const LOCK_WAIT_MS = Number(process.env.PROTEUS_SQLITE_LOCK_WAIT_MS ?? 120000);
const LOCK_STALE_MS = Number(process.env.PROTEUS_SQLITE_LOCK_STALE_MS ?? 600000);
const RETRY_BASE_MS = 25;
const RETRY_MAX_MS = 250;
const heldLocks = new Map<string, { depth: number; token: string }>();

export class LockedSqliteDatabase {
  private readonly inner: InstanceType<typeof DatabaseSync>;
  private readonly lock: SqliteFileLock;
  private transactionRelease: (() => void) | null = null;

  constructor(dbPath: string) {
    this.inner = new DatabaseSync(dbPath);
    this.lock = new SqliteFileLock(`${dbPath}.proteus-lock`);
  }

  prepare(sql: string): LockedSqliteStatement {
    return new LockedSqliteStatement(this.inner.prepare(sql) as unknown as SQLiteStatement, this);
  }

  exec(sql: string): any {
    const kind = transactionBoundary(sql);
    if (kind === "begin") {
      if (this.transactionRelease) return withSqliteRetry(() => this.inner.exec(sql));
      this.transactionRelease = this.lock.acquire();
      try {
        return withSqliteRetry(() => this.inner.exec(sql));
      } catch (error) {
        this.releaseTransactionLock();
        throw error;
      }
    }
    if (kind === "end") {
      try {
        return withSqliteRetry(() => this.inner.exec(sql));
      } finally {
        this.releaseTransactionLock();
      }
    }
    return this.withWriteLock(() => withSqliteRetry(() => this.inner.exec(sql)));
  }

  close(): void {
    this.releaseTransactionLock();
    this.inner.close();
  }

  runStatement<T>(fn: () => T): T {
    if (this.transactionRelease) return withSqliteRetry(fn);
    return this.withWriteLock(() => withSqliteRetry(fn));
  }

  private withWriteLock<T>(fn: () => T): T {
    const release = this.lock.acquire();
    try {
      return fn();
    } finally {
      release();
    }
  }

  private releaseTransactionLock(): void {
    const release = this.transactionRelease;
    this.transactionRelease = null;
    if (release) release();
  }
}

class LockedSqliteStatement {
  constructor(
    private readonly inner: SQLiteStatement,
    private readonly db: LockedSqliteDatabase
  ) {}

  run(...args: unknown[]): any {
    return this.db.runStatement(() => this.inner.run(...args));
  }

  get(...args: unknown[]): any {
    return withSqliteRetry(() => this.inner.get(...args));
  }

  all(...args: unknown[]): any[] {
    return withSqliteRetry(() => this.inner.all(...args));
  }
}

class SqliteFileLock {
  private readonly token = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  constructor(private readonly lockDir: string) {}

  acquire(): () => void {
    const held = heldLocks.get(this.lockDir);
    if (held) {
      held.depth += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const token = releaseHeldLock(this.lockDir);
        if (token) this.release(token);
      };
    }
    const started = Date.now();
    let delay = RETRY_BASE_MS;
    while (true) {
      try {
        fs.mkdirSync(this.lockDir);
        this.writeOwner();
        heldLocks.set(this.lockDir, { depth: 1, token: this.token });
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const token = releaseHeldLock(this.lockDir);
          if (token) this.release(token);
        };
      } catch (error) {
        if (!isLockContention(error)) throw error;
        this.removeReusableLock();
        if (Date.now() - started > LOCK_WAIT_MS) {
          throw new Error(`Proteus SQLite lock timeout after ${LOCK_WAIT_MS}ms: ${this.lockDir}`);
        }
        sleepSync(delay);
        delay = Math.min(RETRY_MAX_MS, Math.floor(delay * 1.4));
      }
    }
  }

  private writeOwner(): void {
    fs.writeFileSync(path.join(this.lockDir, "owner.json"), JSON.stringify({
      token: this.token,
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    }, null, 2) + "\n");
  }

  private release(token = this.token): void {
    try {
      const owner = readLockOwner(this.lockDir);
      if (owner?.token && owner.token !== token) return;
      fs.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    } catch {}
  }

  private removeReusableLock(): void {
    const owner = readLockOwner(this.lockDir);
    if (!owner) return;
    if (owner.pid === process.pid) {
      try {
        fs.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
      } catch {}
      return;
    }
    const ageMs = Date.now() - owner.mtimeMs;
    if (ageMs < LOCK_STALE_MS) return;
    if (owner.pid && isProcessAlive(owner.pid)) return;
    try {
      fs.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    } catch {}
  }
}

function releaseHeldLock(lockDir: string): string | null {
  const held = heldLocks.get(lockDir);
  if (!held) return null;
  held.depth -= 1;
  if (held.depth > 0) return null;
  heldLocks.delete(lockDir);
  return held.token;
}

function withSqliteRetry<T>(fn: () => T): T {
  const started = Date.now();
  let delay = RETRY_BASE_MS;
  while (true) {
    try {
      return fn();
    } catch (error) {
      if (!isSqliteBusy(error) || Date.now() - started > LOCK_WAIT_MS) throw error;
      sleepSync(delay);
      delay = Math.min(RETRY_MAX_MS, Math.floor(delay * 1.4));
    }
  }
}

function transactionBoundary(sql: string): "begin" | "end" | null {
  const first = sql.trim().split(/\s+/)[0]?.toUpperCase();
  if (first === "BEGIN") return "begin";
  if (first === "COMMIT" || first === "END" || first === "ROLLBACK") return "end";
  return null;
}

function readLockOwner(lockDir: string): { token?: string; pid?: number; mtimeMs: number } | null {
  try {
    const ownerPath = path.join(lockDir, "owner.json");
    const stat = fs.statSync(ownerPath);
    const parsed = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as { token?: string; pid?: number };
    return { ...parsed, mtimeMs: stat.mtimeMs };
  } catch {
    try {
      const stat = fs.statSync(lockDir);
      return { mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockContention(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  return code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
}

function isSqliteBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code ?? "";
  const message = error.message.toLowerCase();
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || message.includes("database is locked") || message.includes("database is busy");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
