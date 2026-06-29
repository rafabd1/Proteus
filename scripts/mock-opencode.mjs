#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("mock-opencode 0.0.0");
  process.exit(0);
}

if (args[0] === "serve") {
  const portIndex = args.indexOf("--port");
  const hostnameIndex = args.indexOf("--hostname");
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4096;
  const hostname = hostnameIndex >= 0 ? args[hostnameIndex + 1] : "127.0.0.1";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${hostname}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/session") {
      writeJson(response, readSessions());
      return;
    }
    if (request.method === "POST" && /^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        fs.mkdirSync(path.join(process.cwd(), ".vros", "chimera"), { recursive: true });
        fs.appendFileSync(path.join(process.cwd(), ".vros", "chimera", "mock-opencode-steer.jsonl"), JSON.stringify({
          path: url.pathname,
          body: body ? JSON.parse(body) : null
        }) + "\n");
        writeJson(response, { ok: true });
      });
      return;
    }
    writeJson(response, { error: "not found" }, 404);
  });
  server.listen(port, hostname, () => {
    console.log(`mock-opencode server listening on http://${hostname}:${port}`);
  });
  await new Promise(() => {});
}

if (args[0] === "export") {
  const sessionID = args[1] ?? "ses_mock_unknown";
  if (process.env.MOCK_OPENCODE_EXPORT_FAIL_ONCE === "1") {
    const markerPath = path.join(process.cwd(), "opencode", "mock-export-failed-once.marker");
    if (!fs.existsSync(markerPath)) {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, new Date().toISOString() + "\n");
      console.error(`Exporting session: ${sessionID}`);
      process.exit(1);
    }
  }
  console.log(JSON.stringify({
    info: {
      id: sessionID,
      title: `proteus-${sessionID}`,
      model: { id: "mock-model", providerID: "mock", variant: "high" },
      time: { created: 1760000000000, updated: 1760000003000 }
    },
    messages: [
      {
        info: {
          id: "msg_user_1",
          role: "user",
          time: { created: 1760000000000 }
        },
        parts: [
          { type: "text", text: "User prompt that must not appear." }
        ]
      },
      {
        info: {
          id: "msg_assistant_1",
          role: "assistant",
          time: { created: 1760000001000 }
        },
        parts: [
          { type: "text", text: "First compact agent workflow message." },
          { type: "tool_call", text: "TOOL CALL THAT MUST NOT APPEAR" },
          { type: "tool_result", text: "TOOL RESULT THAT MUST NOT APPEAR" }
        ]
      },
      {
        info: {
          id: "msg_assistant_2",
          role: "assistant",
          time: { created: 1760000002000 }
        },
        content: [
          { type: "text", text: "Second agent workflow message with enough length to truncate in smoke testing." },
          { type: "command", text: "COMMAND OUTPUT THAT MUST NOT APPEAR" }
        ]
      },
      {
        info: {
          id: "msg_assistant_3",
          role: "assistant",
          time: { created: 1760000003000 }
        },
        parts: [
          { type: "text", synthetic: true, text: "Synthetic assistant text that must not appear." },
          { type: "text", text: "Third event-style assistant text." }
        ]
      }
    ]
  }));
  process.exit(0);
}

if (args[0] !== "run") {
  console.error(`mock-opencode expected run or serve, got ${args[0] ?? "none"}`);
  process.exit(2);
}

const fileIndex = args.indexOf("--file");
const promptPath = fileIndex >= 0 ? args[fileIndex + 1] : null;
const prompt = promptPath && fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, "utf8")
  : "";

const modelIndex = args.indexOf("--model");
const variantIndex = args.indexOf("--variant");
const agentIndex = args.indexOf("--agent");

const sessionID = `ses_mock_${process.env.PROTEUS_CHIMERA_SESSION_ID ?? "unknown"}`;
recordSession(sessionID, args);
const sleepMs = Number(process.env.MOCK_OPENCODE_SLEEP_MS || "0");
if (Number.isFinite(sleepMs) && sleepMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}
const text = JSON.stringify({
  ok: true,
  runtime: "mock-opencode",
  sessionId: process.env.PROTEUS_CHIMERA_SESSION_ID ?? null,
  accessMode: process.env.PROTEUS_CHIMERA_ACCESS_MODE ?? null,
  model: modelIndex >= 0 ? args[modelIndex + 1] : null,
  variant: variantIndex >= 0 ? args[variantIndex + 1] : null,
  agent: agentIndex >= 0 ? args[agentIndex + 1] : null,
  sawDossier: prompt.includes("Chimera Dossier"),
  sawContract: prompt.includes("Chimera Contract"),
  sawChat: prompt.includes("Shared Chimera chat")
});

console.log(JSON.stringify({
  type: "step_start",
  timestamp: Date.now(),
  sessionID,
  part: { type: "step-start" }
}));
console.log(JSON.stringify({
  type: "text",
  timestamp: Date.now(),
  sessionID,
  part: { type: "text", text }
}));
console.log(JSON.stringify({
  type: "step_finish",
  timestamp: Date.now(),
  sessionID,
  part: {
    type: "step-finish",
    reason: "stop",
    tokens: { total: 1, input: 1, output: 1, reasoning: 0 },
    cost: 0
  }
}));

function writeJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function sessionRegistryPath() {
  return path.join(process.cwd(), ".vros", "chimera", "mock-opencode-sessions.json");
}

function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(sessionRegistryPath(), "utf8"));
  } catch {
    return [];
  }
}

function recordSession(sessionID, runArgs) {
  const targetRoot = process.env.PROTEUS_TARGET_ROOT ?? process.cwd();
  const registry = path.join(targetRoot, ".vros", "chimera", "mock-opencode-sessions.json");
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  const titleIndex = runArgs.indexOf("--title");
  const dirIndex = runArgs.indexOf("--dir");
  const agentIndex = runArgs.indexOf("--agent");
  const modelIndex = runArgs.indexOf("--model");
  const variantIndex = runArgs.indexOf("--variant");
  const sessions = fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry, "utf8")) : [];
  const now = Date.now();
  const title = titleIndex >= 0 ? runArgs[titleIndex + 1] : `proteus-${process.env.PROTEUS_CHIMERA_SESSION_ID ?? "unknown"}`;
  const next = {
    id: sessionID,
    title,
    directory: dirIndex >= 0 ? runArgs[dirIndex + 1] : process.cwd(),
    agent: agentIndex >= 0 ? runArgs[agentIndex + 1] : null,
    model: {
      id: modelIndex >= 0 ? runArgs[modelIndex + 1] : null,
      providerID: "mock",
      variant: variantIndex >= 0 ? runArgs[variantIndex + 1] : null
    },
    time: { created: now, updated: now }
  };
  const filtered = sessions.filter((session) => session.id !== sessionID);
  fs.writeFileSync(registry, JSON.stringify([...filtered, next], null, 2) + "\n");
}
