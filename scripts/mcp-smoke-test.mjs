import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "dist", "mcp.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proteus-mcp-smoke-"));

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: repoRoot,
  stderr: "pipe"
});

const client = new Client({ name: "proteus-smoke-client", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (!tools.tools.some((tool) => tool.name === "proteus_init")) {
    throw new Error("proteus_init tool was not registered");
  }

  await client.callTool({
    name: "proteus_init",
    arguments: { root: tmpRoot, name: "mcp-smoke-target" }
  });

  const status = await client.callTool({
    name: "proteus_status",
    arguments: { root: tmpRoot }
  });
  const text = status.content?.[0]?.type === "text" ? status.content[0].text : "";
  if (!text.includes("mcp-smoke-target")) {
    throw new Error("proteus_status did not return initialized target");
  }

  console.log(`Proteus MCP smoke test passed: ${tmpRoot}`);
} finally {
  await client.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
