"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTargetRoot = resolveTargetRoot;
exports.vrosDir = vrosDir;
exports.memoryPath = memoryPath;
exports.exportsDir = exportsDir;
exports.labsDir = labsDir;
exports.ensureDir = ensureDir;
exports.toRelative = toRelative;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
function resolveTargetRoot(input) {
    return node_path_1.default.resolve(input ?? process.cwd());
}
function vrosDir(targetRoot) {
    return node_path_1.default.join(targetRoot, ".vros");
}
function memoryPath(targetRoot) {
    return node_path_1.default.join(vrosDir(targetRoot), "memory.sqlite");
}
function exportsDir(targetRoot) {
    return node_path_1.default.join(vrosDir(targetRoot), "exports");
}
function labsDir(targetRoot) {
    return node_path_1.default.join(vrosDir(targetRoot), "labs");
}
function ensureDir(dir) {
    node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function toRelative(root, filePath) {
    const relative = node_path_1.default.relative(root, filePath);
    return relative.length === 0 ? "." : relative.replace(/\\/g, "/");
}
