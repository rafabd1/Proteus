"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockedSqliteDatabase = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const emitWarning = process.emitWarning;
process.emitWarning = ((warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning.message;
    const warningType = typeof args[0] === "string" ? args[0] : undefined;
    if (warningType === "ExperimentalWarning" && message.includes("SQLite"))
        return;
    return emitWarning.call(process, warning, ...args);
});
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = emitWarning;
const LOCK_WAIT_MS = Number(process.env.PROTEUS_SQLITE_LOCK_WAIT_MS ?? 120000);
const LOCK_STALE_MS = Number(process.env.PROTEUS_SQLITE_LOCK_STALE_MS ?? 600000);
const RETRY_BASE_MS = 25;
const RETRY_MAX_MS = 250;
const heldLocks = new Map();
class LockedSqliteDatabase {
    inner;
    lock;
    transactionRelease = null;
    constructor(dbPath) {
        this.inner = new DatabaseSync(dbPath);
        this.lock = new SqliteFileLock(`${dbPath}.proteus-lock`);
    }
    prepare(sql) {
        return new LockedSqliteStatement(this.inner.prepare(sql), this);
    }
    exec(sql) {
        const kind = transactionBoundary(sql);
        if (kind === "begin") {
            if (this.transactionRelease)
                return withSqliteRetry(() => this.inner.exec(sql));
            this.transactionRelease = this.lock.acquire();
            try {
                return withSqliteRetry(() => this.inner.exec(sql));
            }
            catch (error) {
                this.releaseTransactionLock();
                throw error;
            }
        }
        if (kind === "end") {
            try {
                return withSqliteRetry(() => this.inner.exec(sql));
            }
            finally {
                this.releaseTransactionLock();
            }
        }
        return this.withWriteLock(() => withSqliteRetry(() => this.inner.exec(sql)));
    }
    close() {
        this.releaseTransactionLock();
        this.inner.close();
    }
    runStatement(fn) {
        if (this.transactionRelease)
            return withSqliteRetry(fn);
        return this.withWriteLock(() => withSqliteRetry(fn));
    }
    withWriteLock(fn) {
        const release = this.lock.acquire();
        try {
            return fn();
        }
        finally {
            release();
        }
    }
    releaseTransactionLock() {
        const release = this.transactionRelease;
        this.transactionRelease = null;
        if (release)
            release();
    }
}
exports.LockedSqliteDatabase = LockedSqliteDatabase;
class LockedSqliteStatement {
    inner;
    db;
    constructor(inner, db) {
        this.inner = inner;
        this.db = db;
    }
    run(...args) {
        return this.db.runStatement(() => this.inner.run(...args));
    }
    get(...args) {
        return withSqliteRetry(() => this.inner.get(...args));
    }
    all(...args) {
        return withSqliteRetry(() => this.inner.all(...args));
    }
}
class SqliteFileLock {
    lockDir;
    token = `${process.pid}-${Date.now()}-${node_crypto_1.default.randomBytes(4).toString("hex")}`;
    constructor(lockDir) {
        this.lockDir = lockDir;
    }
    acquire() {
        const held = heldLocks.get(this.lockDir);
        if (held) {
            held.depth += 1;
            let released = false;
            return () => {
                if (released)
                    return;
                released = true;
                const token = releaseHeldLock(this.lockDir);
                if (token)
                    this.release(token);
            };
        }
        const started = Date.now();
        let delay = RETRY_BASE_MS;
        while (true) {
            try {
                node_fs_1.default.mkdirSync(this.lockDir);
                this.writeOwner();
                heldLocks.set(this.lockDir, { depth: 1, token: this.token });
                let released = false;
                return () => {
                    if (released)
                        return;
                    released = true;
                    const token = releaseHeldLock(this.lockDir);
                    if (token)
                        this.release(token);
                };
            }
            catch (error) {
                if (!isLockContention(error))
                    throw error;
                this.removeReusableLock();
                if (Date.now() - started > LOCK_WAIT_MS) {
                    throw new Error(`Proteus SQLite lock timeout after ${LOCK_WAIT_MS}ms: ${this.lockDir}`);
                }
                sleepSync(delay);
                delay = Math.min(RETRY_MAX_MS, Math.floor(delay * 1.4));
            }
        }
    }
    writeOwner() {
        node_fs_1.default.writeFileSync(node_path_1.default.join(this.lockDir, "owner.json"), JSON.stringify({
            token: this.token,
            pid: process.pid,
            acquiredAt: new Date().toISOString()
        }, null, 2) + "\n");
    }
    release(token = this.token) {
        try {
            const owner = readLockOwner(this.lockDir);
            if (owner?.token && owner.token !== token)
                return;
            node_fs_1.default.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
        }
        catch { }
    }
    removeReusableLock() {
        const owner = readLockOwner(this.lockDir);
        if (!owner)
            return;
        if (owner.pid === process.pid) {
            try {
                node_fs_1.default.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
            }
            catch { }
            return;
        }
        const ageMs = Date.now() - owner.mtimeMs;
        if (ageMs < LOCK_STALE_MS)
            return;
        if (owner.pid && isProcessAlive(owner.pid))
            return;
        try {
            node_fs_1.default.rmSync(this.lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
        }
        catch { }
    }
}
function releaseHeldLock(lockDir) {
    const held = heldLocks.get(lockDir);
    if (!held)
        return null;
    held.depth -= 1;
    if (held.depth > 0)
        return null;
    heldLocks.delete(lockDir);
    return held.token;
}
function withSqliteRetry(fn) {
    const started = Date.now();
    let delay = RETRY_BASE_MS;
    while (true) {
        try {
            return fn();
        }
        catch (error) {
            if (!isSqliteBusy(error) || Date.now() - started > LOCK_WAIT_MS)
                throw error;
            sleepSync(delay);
            delay = Math.min(RETRY_MAX_MS, Math.floor(delay * 1.4));
        }
    }
}
function transactionBoundary(sql) {
    const first = sql.trim().split(/\s+/)[0]?.toUpperCase();
    if (first === "BEGIN")
        return "begin";
    if (first === "COMMIT" || first === "END" || first === "ROLLBACK")
        return "end";
    return null;
}
function readLockOwner(lockDir) {
    try {
        const ownerPath = node_path_1.default.join(lockDir, "owner.json");
        const stat = node_fs_1.default.statSync(ownerPath);
        const parsed = JSON.parse(node_fs_1.default.readFileSync(ownerPath, "utf8"));
        return { ...parsed, mtimeMs: stat.mtimeMs };
    }
    catch {
        try {
            const stat = node_fs_1.default.statSync(lockDir);
            return { mtimeMs: stat.mtimeMs };
        }
        catch {
            return null;
        }
    }
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function isLockContention(error) {
    if (typeof error !== "object" || error === null || !("code" in error))
        return false;
    const code = error.code;
    return code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
}
function isSqliteBusy(error) {
    if (!(error instanceof Error))
        return false;
    const code = error.code ?? "";
    const message = error.message.toLowerCase();
    return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || message.includes("database is locked") || message.includes("database is busy");
}
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
