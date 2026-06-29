import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ProteusDb, type CampaignRow, type ChimeraMessageRow, type ChimeraSessionRow } from "./db";
import { chimeraDir, chimeraSessionDir, chimeraSessionsDir, ensureDir, globalChimeraConfigPath, toRelative } from "./paths";
import type {
  ChimeraConfig,
  ChimeraAccessMode,
  ChimeraMessageKind,
  ChimeraStatus,
  JsonValue
} from "./types";

export const DEFAULT_CHIMERA_CONFIG: ChimeraConfig = {
  enabled: false,
  runtime: "opencode",
  opencodeCommand: "opencode",
  opencodeServerUrl: null,
  opencodeServerPid: null,
  defaultModel: null,
  defaultVariant: null,
  defaultAgent: "proteus-chimera",
  maxAgents: 5,
  defaultTimeoutSec: 0,
  defaultNetwork: false,
  skipPermissions: true
};

const LEGACY_DEFAULT_TIMEOUT_SEC = 900;

export interface ChimeraStartInput {
  role: string;
  goal: string;
  accessMode?: ChimeraAccessMode;
  accessNotes?: string;
  campaignId?: number;
  roundId?: number;
  model?: string;
  provider?: string;
  variant?: string;
  timeoutSec?: number;
  run?: boolean;
}

export interface ChimeraDirectDeliveryResult {
  attempted: boolean;
  ok: boolean;
  mode: "steer" | "queue" | "none";
  serverUrl?: string;
  opencodeSessionId?: string;
  status?: number;
  autoWake?: {
    attempted: boolean;
    started: boolean;
    pid: number | null;
    reason: string;
    logPath?: string;
  };
  detail: string;
}

export interface ChimeraBackgroundRunResult {
  publicId: string;
  started: boolean;
  pid: number | null;
  logPath: string;
  stderrPath: string;
  pidPath: string;
  timeoutSec: number | null;
  instruction: boolean;
  detail: string;
}

export interface ChimeraSendResult {
  message: ChimeraMessageRow;
  directDelivery: ChimeraDirectDeliveryResult;
}

export interface ChimeraControlStatus {
  publicId: string;
  status: ChimeraStatus;
  opencodeSessionId: string | null;
  unreadForAgent: number;
  priorityPending: boolean;
  deliveryState: "live" | "starting" | "queued";
  recommendedNextCommand: string | null;
}

export interface ChimeraRecoveryResult {
  session: ChimeraSessionRow;
  actions: string[];
  controlStatus: ChimeraControlStatus;
}

export type ChimeraListStatusFilter = ChimeraStatus | "active";

export type ChimeraSessionListItem = ChimeraSessionRow & {
  campaigns: Array<{ id: number; title: string; status: string }>;
  campaignLabel: string;
  resumeHint: string;
};

export type ChimeraMessagePollView = ChimeraMessageRow & {
  bodyLength: number;
  bodyTruncated: boolean;
  fullBodyPath: string | null;
};

export interface ChimeraSessionListResult {
  sessions: ChimeraSessionListItem[];
  scope: {
    activeOnly: boolean;
    all: boolean;
    status: ChimeraListStatusFilter | null;
    campaignIds: number[];
    reason: string;
  };
  activeCampaigns: Array<{ id: number; title: string; status: string }>;
  advisories: string[];
  limit: number;
}

export interface ChimeraSwarmPlan {
  campaignId?: number;
  roundId?: number;
  run?: boolean;
  agents: Array<{
    role: string;
    goal: string;
    accessMode?: ChimeraAccessMode;
    accessNotes?: string;
    model?: string;
    provider?: string;
    variant?: string;
  }>;
}

export interface ChimeraCouncilStartInput {
  topic: string;
  reason?: string;
  sessionIds?: string[];
  maxRounds?: number;
}

export interface ChimeraCouncilStatus {
  councilId: string;
  topic: string | null;
  maxRounds: number | null;
  participants: Array<{
    publicId: string;
    role: string;
    goal: string;
    status: ChimeraStatus;
    accepted: boolean;
    acceptedAt: string | null;
  }>;
  readyCount: number;
  invitedCount: number;
  closed: boolean;
  messages: ChimeraMessageRow[];
  turns: ChimeraMessageRow[];
}

export function initChimeraConfig(input: Partial<ChimeraConfig> = {}): ChimeraConfig {
  const current = getChimeraConfig();
  const next: ChimeraConfig = {
    enabled: input.enabled ?? true,
    runtime: "opencode",
    opencodeCommand: stringOr(input.opencodeCommand, current.opencodeCommand),
    opencodeServerUrl: nullableString(input.opencodeServerUrl, current.opencodeServerUrl),
    opencodeServerPid: nullableNumber(input.opencodeServerPid, current.opencodeServerPid),
    defaultModel: nullableString(input.defaultModel, current.defaultModel),
    defaultVariant: nullableString(input.defaultVariant, current.defaultVariant),
    defaultAgent: nullableString(input.defaultAgent, current.defaultAgent),
    maxAgents: positiveInteger(input.maxAgents, current.maxAgents),
    defaultTimeoutSec: input.defaultTimeoutSec === undefined
      ? current.defaultTimeoutSec
      : normalizeTimeoutConfig(input.defaultTimeoutSec),
    defaultNetwork: input.defaultNetwork ?? current.defaultNetwork,
    skipPermissions: input.skipPermissions ?? current.skipPermissions
  };
  saveChimeraConfig(next);
  return next;
}

export function saveChimeraConfig(config: ChimeraConfig): void {
  const configPath = globalChimeraConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(normalizeChimeraConfig(config), null, 2) + "\n");
}

export function getChimeraConfig(): ChimeraConfig {
  const configPath = globalChimeraConfigPath();
  if (!fs.existsSync(configPath)) return DEFAULT_CHIMERA_CONFIG;
  try {
    return normalizeChimeraConfig(JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<ChimeraConfig>);
  } catch {
    return DEFAULT_CHIMERA_CONFIG;
  }
}

export function chimeraDoctor(db: ProteusDb): {
  ok: boolean;
  config: ChimeraConfig;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
} {
  const config = getChimeraConfig();
  ensureDir(chimeraDir(db.targetRoot));
  const checks = [
    {
      name: "enabled",
      ok: config.enabled,
      detail: config.enabled ? "Chimera is enabled globally." : "Run proteus chimera config init before starting agents."
    },
    {
      name: "chimera_dir",
      ok: canWriteDir(chimeraDir(db.targetRoot)),
      detail: chimeraDir(db.targetRoot)
    },
    {
      name: "skills",
      ok: resolveSkillsDir() !== null,
      detail: resolveSkillsDir() ?? "Could not resolve plugins/proteus/skills."
    },
    commandCheck("opencode", config.opencodeCommand, ["--version"]),
    commandCheck("proteus_cli", process.execPath, [resolveProteusCliPath(), "--version"])
  ];
  return { ok: checks.every((check) => check.ok), config, checks };
}

export function stopOpenCodeServer(): { stopped: boolean; pid: number | null; url: string | null; detail: string } {
  const config = getChimeraConfig();
  let stopped = false;
  let detail = "no managed OpenCode server PID is recorded";
  if (config.opencodeServerPid) {
    try {
      terminateProcessTree(config.opencodeServerPid);
      stopped = true;
      detail = "managed OpenCode server process was signaled";
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
  }
  saveChimeraConfig({ ...config, opencodeServerUrl: null, opencodeServerPid: null });
  return { stopped, pid: config.opencodeServerPid, url: config.opencodeServerUrl, detail };
}

export function startChimeraSession(db: ProteusDb, input: ChimeraStartInput): {
  session: ChimeraSessionRow;
  config: ChimeraConfig;
  paths: ChimeraPaths;
  run?: ChimeraRunResult;
  backgroundRun?: ChimeraBackgroundRunResult;
  nextSuggestedReads: string[];
} {
  if (!input.role?.trim()) throw new Error("Missing Chimera role.");
  if (!input.goal?.trim()) throw new Error("Missing Chimera goal.");
  const config = getChimeraConfig();
  if (!config.enabled) {
    throw new Error("Chimera is disabled. Run `proteus chimera config init` once for the user first.");
  }
  const accessMode = input.accessMode ?? "explorer";
  const accessNotes = input.accessNotes?.trim() ?? "";
  if (accessMode === "editor" && !accessNotes) {
    throw new Error("Chimera editor access requires --access-notes with explicit shell/edit restrictions.");
  }
  const publicId = nextPublicId(db);
  const sessionDir = chimeraSessionDir(db.targetRoot, publicId);
  const labDir = path.join(sessionDir, "lab");
  const resolvedCampaignId = input.campaignId ?? singleActiveCampaignId(db);
  const resolvedRoundId = input.roundId ?? singleActiveRoundId(db, resolvedCampaignId);
  const session = db.createChimeraSession({
    publicId,
    campaignId: resolvedCampaignId,
    roundId: resolvedRoundId,
    role: input.role.trim(),
    goal: input.goal.trim(),
    accessMode,
    accessNotes: accessNotes || null,
    model: input.model ?? config.defaultModel,
    provider: normalizeOpenCodeVariant(input.variant, input.provider, config.defaultVariant),
    sessionDir,
    labDir,
    opencodeCommand: config.opencodeCommand,
    opencodeServerUrl: config.opencodeServerUrl
  });
  const paths = createSessionFiles(db, session, config);
  db.addChimeraMessage({
    publicId: session.publicId,
    direction: "system",
    kind: "message",
    body: `Chimera session started for role ${session.role}.`,
    metadata: { sessionDir: toRelative(db.targetRoot, session.sessionDir) },
    readByAgent: true,
    readByCoordinator: true
  });
  const linked = linkChimeraSession(db, session);
  const shouldRunSynchronously = input.run === true && typeof input.timeoutSec === "number" && input.timeoutSec > 0;
  let updated = db.updateChimeraSession({ publicId: session.publicId, status: shouldRunSynchronously ? "running" : "stopped" });
  writeStatusFile(db, updated, { linked });
  let run: ChimeraRunResult | undefined;
  let backgroundRun: ChimeraBackgroundRunResult | undefined;
  if (shouldRunSynchronously) {
    run = runChimeraSession(db, updated.publicId, input.timeoutSec ?? config.defaultTimeoutSec);
    updated = db.updateChimeraSession({
      publicId: session.publicId,
      status: chimeraStatusAfterRun(run, db.getChimeraSession(session.publicId)),
      opencodePid: null
    });
    writeStatusFile(db, updated, { linked, lastRun: run });
  } else {
    backgroundRun = startChimeraRunBackground(db, updated.publicId, input.timeoutSec ?? config.defaultTimeoutSec);
    updated = db.getChimeraSession(updated.publicId) ?? updated;
  }
  return {
    session: updated,
    config,
    paths,
    run,
    backgroundRun,
    nextSuggestedReads: [
      `proteus chimera poll --root "${db.targetRoot}" --id ${session.publicId} --unread`,
      `proteus chimera send --root "${db.targetRoot}" --id ${session.publicId} --message "..."`
    ]
  };
}

export function sendChimeraMessage(
  db: ProteusDb,
  publicId: string,
  body: string,
  kind: ChimeraMessageKind = "message",
  options: { priority?: boolean; metadata?: Record<string, JsonValue>; fromId?: string } = {}
): ChimeraSendResult {
  const fromId = options.fromId?.trim();
  if (fromId) {
    const from = requireChimeraSession(db, fromId);
    if (from.publicId === publicId) throw new Error("Chimera message source and destination must differ.");
  }
  const session = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
  const message = db.addChimeraMessage({
    publicId,
    direction: "coordinator_to_agent",
    kind,
    body,
    metadata: { ...(options.metadata ?? {}), ...(fromId ? { direct: true, fromId } : {}), priority: options.priority === true },
    readByCoordinator: true,
    readByAgent: false
  });
  appendJsonl(inboxPath(db, publicId), message);
  writeNotificationFile(db, publicId, message);
  const directDelivery = options.priority === true
    ? deliverPriorityChimeraMessage(db, session, message)
    : { attempted: false, ok: false, mode: "none" as const, detail: "priority is false; stored in Proteus inbox only" };
  return { message, directDelivery };
}

export function broadcastChimeraMessage(db: ProteusDb, input: {
  body: string;
  kind?: ChimeraMessageKind;
  fromId?: string;
  priority?: boolean;
}): {
  delivered: ChimeraMessageRow[];
  directDeliveries: Array<{ publicId: string; result: ChimeraDirectDeliveryResult }>;
  skipped: Array<{ publicId: string; reason: string }>;
} {
  const fromId = input.fromId?.trim();
  const sessions = db.listChimeraSessions({ limit: 500 });
  const delivered: ChimeraMessageRow[] = [];
  const directDeliveries: Array<{ publicId: string; result: ChimeraDirectDeliveryResult }> = [];
  const skipped: Array<{ publicId: string; reason: string }> = [];
  for (const session of sessions.reverse()) {
    if (fromId && session.publicId === fromId) {
      skipped.push({ publicId: session.publicId, reason: "source session" });
      continue;
    }
    if (!isActiveChimeraStatus(session)) {
      skipped.push({ publicId: session.publicId, reason: `status ${session.status}` });
      continue;
    }
    const message = db.addChimeraMessage({
      publicId: session.publicId,
      direction: "coordinator_to_agent",
      kind: input.kind ?? "message",
      body: input.body,
      metadata: { broadcast: true, fromId: fromId ?? "coordinator", priority: input.priority === true },
      readByCoordinator: true,
      readByAgent: false
    });
    appendJsonl(inboxPath(db, session.publicId), message);
    writeNotificationFile(db, session.publicId, message);
    if (input.priority === true) {
      directDeliveries.push({ publicId: session.publicId, result: deliverPriorityChimeraMessage(db, session, message) });
    }
    delivered.push(message);
  }
  if (fromId) {
    postChimeraMessage(db, fromId, "message", `Broadcast delivered to ${delivered.length} Chimera session(s).`, {
      broadcast: true,
      deliveredTo: delivered.map((message) => message.publicId),
      skipped
    });
  }
  return { delivered, directDeliveries, skipped };
}

export function startChimeraCouncil(db: ProteusDb, input: ChimeraCouncilStartInput): {
  councilId: string;
  topic: string;
  maxRounds: number;
  participants: Array<{ publicId: string; role: string; goal: string; status: ChimeraStatus }>;
  invitations: ChimeraSendResult[];
  nextSuggestedReads: string[];
} {
  const topic = input.topic.trim();
  if (!topic) throw new Error("Council topic is required.");
  const participants = resolveCouncilParticipants(db, input.sessionIds);
  if (participants.length === 0) throw new Error("No active Chimera sessions are available for council.");
  const maxRounds = Math.max(1, Math.min(5, positiveInteger(input.maxRounds, 1)));
  const councilId = nextCouncilId();
  const participantBrief = participants.map((session) => `${session.publicId} (${session.role})`).join(", ");
  const body = [
    `Brainstorm council invite ${councilId}.`,
    `Topic: ${topic}`,
    input.reason ? `Reason: ${input.reason.trim()}` : null,
    `Participants: ${participantBrief}`,
    `Default limit: ${maxRounds} ordered round${maxRounds === 1 ? "" : "s"}, with one separated turn per agent per round.`,
    "",
    "Accept when you are free or at a safe pause point. If you are in the middle of important evidence capture, finish that safe point first.",
    `When ready from your Chimera lab: proteus chimera council accept --council-id ${councilId} --body "ready"`,
    `During the council, wait for your turn and send exactly one concise observation for the current round from your Chimera lab: proteus chimera council turn --council-id ${councilId} --round 1 --body "...".`,
    "Do not reply to every other agent. Do not start a debate loop. The coordinator owns the order, any extension, and the final decision."
  ].filter(Boolean).join("\n");
  const commonMetadata = {
    councilId,
    councilState: "invited",
    topic,
    reason: input.reason?.trim() ?? null,
    maxRounds,
    participants: participants.map((session) => ({
      publicId: session.publicId,
      role: session.role,
      goal: session.goal,
      status: session.status
    }))
  } satisfies Record<string, JsonValue>;
  const invitations = participants.map((session) =>
    sendChimeraMessage(db, session.publicId, body, "council", {
      priority: true,
      metadata: {
        ...commonMetadata,
        participantId: session.publicId,
        participantRole: session.role
      }
    })
  );
  return {
    councilId,
    topic,
    maxRounds,
    participants: participants.map((session) => ({
      publicId: session.publicId,
      role: session.role,
      goal: session.goal,
      status: session.status
    })),
    invitations,
    nextSuggestedReads: [
      `proteus chimera council status --root "${db.targetRoot}" --council-id ${councilId}`,
      `proteus chimera poll --root "${db.targetRoot}" --unread`
    ]
  };
}

export function acceptChimeraCouncil(db: ProteusDb, publicId: string, councilId: string, body?: string): ChimeraMessageRow {
  requireOpenCouncilParticipation(db, publicId, councilId);
  return postChimeraMessage(db, publicId, "council", body?.trim() || `Ready for council ${councilId}.`, {
    councilId,
    councilState: "accepted"
  });
}

export function postChimeraCouncilTurn(db: ProteusDb, publicId: string, councilId: string, body: string, round?: number, advance?: boolean): {
  message: ChimeraMessageRow;
  nextCue: ChimeraSendResult | null;
  roundComplete: boolean;
  council: ChimeraCouncilStatus;
} {
  const council = requireOpenCouncilParticipation(db, publicId, councilId);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Council turn body is required.");
  const roundNumber = positiveInteger(round, 1);
  if (!councilRoundOpened(council, roundNumber)) {
    throw new Error(`Council ${councilId} round ${roundNumber} has not been opened by the coordinator yet.`);
  }
  if (council.turns.some((message) => message.publicId === publicId && councilMetadata(message).round === roundNumber)) {
    throw new Error(`${publicId} already posted a council turn for ${councilId} round ${roundNumber}. Use the next round only if the coordinator extends the council.`);
  }
  const expected = nextCouncilParticipant(council, roundNumber);
  if (!expected || expected.publicId !== publicId) {
    throw new Error(`It is not ${publicId}'s council turn for ${councilId} round ${roundNumber}. Expected ${expected?.publicId ?? "coordinator"}.`);
  }
  const message = postChimeraMessage(db, publicId, "council", trimmed, {
    councilId,
    councilState: "turn",
    round: roundNumber
  });
  const updatedCouncil = getChimeraCouncil(db, councilId);
  if (advance === false) {
    return { message, nextCue: null, roundComplete: isCouncilRoundComplete(updatedCouncil, roundNumber), council: updatedCouncil };
  }
  const next = nextCouncilParticipant(updatedCouncil, roundNumber);
  if (!next) {
    return { message, nextCue: null, roundComplete: true, council: updatedCouncil };
  }
  const nextCue = cueChimeraCouncilTurnInternal(db, next.publicId, councilId, roundNumber, "Previous agent posted their council turn. It is now your ordered turn.");
  return { message, nextCue, roundComplete: false, council: getChimeraCouncil(db, councilId) };
}

export function cueChimeraCouncilTurn(db: ProteusDb, publicId: string, councilId: string, round?: number, prompt?: string, manual?: boolean): ChimeraSendResult {
  if (manual !== true) {
    throw new Error("Manual cue-turn is disabled in the normal council flow. Use open-round to cue the first participant, or pass --manual only for recovery/troubleshooting.");
  }
  return cueChimeraCouncilTurnInternal(db, publicId, councilId, round, prompt);
}

function cueChimeraCouncilTurnInternal(db: ProteusDb, publicId: string, councilId: string, round?: number, prompt?: string): ChimeraSendResult {
  const council = requireOpenCouncilParticipation(db, publicId, councilId);
  const participant = council.participants.find((item) => item.publicId === publicId);
  if (!participant?.accepted) {
    throw new Error(`${publicId} has not accepted council ${councilId} yet.`);
  }
  const roundNumber = positiveInteger(round, 1);
  if (!councilRoundOpened(council, roundNumber)) {
    throw new Error(`Council ${councilId} round ${roundNumber} has not been opened by the coordinator yet.`);
  }
  if (council.turns.some((message) => message.publicId === publicId && councilMetadata(message).round === roundNumber)) {
    throw new Error(`${publicId} already posted a council turn for ${councilId} round ${roundNumber}.`);
  }
  const body = [
    `Brainstorm council ${councilId}: it is your ordered turn now.`,
    `You are ${publicId}${participant ? ` (${participant.role})` : ""}.`,
    council.topic ? `Topic: ${council.topic}` : null,
    `Round: ${roundNumber}`,
    "",
    "Read the council transcript below, then post exactly one concise observation/opinion with the required command. Do not answer this steer notification directly.",
    "",
    "Required command:",
    `${proteusCliCommand()} --root "${db.targetRoot}" chimera council turn --council-id ${councilId} --round ${roundNumber} --body "..."`,
    "",
    "Your turn should include non-obvious pivots, side effects, evidence gaps, downgrade risks, and one recommended next high-ROI move. Do not debate every prior message or create a loop.",
    prompt?.trim() ? `\nCoordinator prompt:\n${prompt.trim()}` : null,
    "",
    "Council transcript so far:",
    renderCouncilTranscript(council)
  ].filter(Boolean).join("\n");
  return sendChimeraMessage(db, publicId, body, "council", {
    priority: true,
    metadata: {
      councilId,
      councilState: "turn_cued",
      round: roundNumber,
      participantId: publicId,
      prompt: prompt?.trim() || null
    }
  });
}

export function openChimeraCouncilRound(db: ProteusDb, councilId: string, round: number | undefined, body: string, startId?: string | null, autoCue = true): {
  message: ChimeraMessageRow;
  firstCue: ChimeraSendResult | null;
  council: ChimeraCouncilStatus;
} {
  const council = getChimeraCouncil(db, councilId);
  if (council.closed) throw new Error(`Council is already closed: ${councilId}`);
  const roundNumber = positiveInteger(round, 1);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Council round opening body is required.");
  if (councilRoundOpened(council, roundNumber)) {
    throw new Error(`Council ${councilId} round ${roundNumber} is already open.`);
  }
  const coordinatorSession = council.participants[0];
  if (!coordinatorSession) throw new Error(`Council has no participants: ${councilId}`);
  let firstParticipantId: string | null = null;
  if (autoCue) {
    const next = startId ? council.participants.find((participant) => participant.publicId === startId) : nextCouncilParticipant(council, roundNumber);
    if (startId && !next) throw new Error(`Council participant not found for startId: ${startId}`);
    if (startId && next && !next.accepted) throw new Error(`Council participant has not accepted yet: ${startId}`);
    firstParticipantId = next?.publicId ?? null;
  }
  const message = db.addChimeraMessage({
    publicId: coordinatorSession.publicId,
    direction: "system",
    kind: "council",
    body: trimmed,
    metadata: {
      councilId,
      councilState: "round_opened",
      round: roundNumber,
      fromId: "coordinator"
    },
    readByAgent: true,
    readByCoordinator: true
  });
  appendJsonl(path.join(requireChimeraSession(db, coordinatorSession.publicId).sessionDir, "transcript.jsonl"), message);
  let firstCue: ChimeraSendResult | null = null;
  if (firstParticipantId) {
    firstCue = cueChimeraCouncilTurnInternal(db, firstParticipantId, councilId, roundNumber, "The coordinator opened this council round. It is now your ordered turn.");
  }
  return { message, firstCue, council: getChimeraCouncil(db, councilId) };
}

export function getChimeraCouncil(db: ProteusDb, councilId: string): ChimeraCouncilStatus {
  const messages = councilMessages(db, councilId);
  if (messages.length === 0) throw new Error(`Council not found: ${councilId}`);
  const invite = messages.find((message) => councilMetadata(message).councilState === "invited");
  const inviteMetadata = invite ? councilMetadata(invite) : {};
  const invitedIds = new Set<string>();
  const participantIdsFromInvite = Array.isArray(inviteMetadata.participants)
    ? inviteMetadata.participants
        .map((item) => metadataObject(item)?.publicId)
        .filter((value): value is string => typeof value === "string")
    : [];
  for (const id of participantIdsFromInvite) invitedIds.add(id);
  for (const message of messages) invitedIds.add(message.publicId);
  const acceptedBy = new Map<string, ChimeraMessageRow>();
  const turns: ChimeraMessageRow[] = [];
  let closed = false;
  for (const message of messages) {
    const metadata = councilMetadata(message);
    if (metadata.councilState === "accepted") acceptedBy.set(message.publicId, message);
    if (metadata.councilState === "turn") turns.push(message);
    if (metadata.councilState === "closed") closed = true;
  }
  const participants = [...invitedIds]
    .map((publicId) => db.getChimeraSession(publicId))
    .filter((session): session is ChimeraSessionRow => session !== null)
    .map((session) => {
      const accepted = acceptedBy.get(session.publicId);
      return {
        publicId: session.publicId,
        role: session.role,
        goal: session.goal,
        status: session.status,
        accepted: Boolean(accepted),
        acceptedAt: accepted?.createdAt ?? null
      };
    });
  return {
    councilId,
    topic: typeof inviteMetadata.topic === "string" ? inviteMetadata.topic : null,
    maxRounds: typeof inviteMetadata.maxRounds === "number" ? inviteMetadata.maxRounds : null,
    participants,
    readyCount: participants.filter((participant) => participant.accepted).length,
    invitedCount: participants.length,
    closed,
    messages,
    turns
  };
}

export function closeChimeraCouncil(db: ProteusDb, councilId: string, summary: string, instruction?: string): {
  council: ChimeraCouncilStatus;
  deliveries: ChimeraSendResult[];
} {
  const council = getChimeraCouncil(db, councilId);
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) throw new Error("Council close summary is required.");
  const body = [
    `Brainstorm council ${councilId} closed.`,
    `Final coordinator decision: ${trimmedSummary}`,
    instruction?.trim() ? `Next instruction: ${instruction.trim()}` : null,
    "Resume your previous work if it is still valid, or follow the coordinator's updated instruction. Do not continue the council unless explicitly reopened."
  ].filter(Boolean).join("\n");
  const deliveries = council.participants.map((participant) =>
    sendChimeraMessage(db, participant.publicId, body, "council", {
      priority: true,
      metadata: {
        councilId,
        councilState: "closed",
        summary: trimmedSummary,
        instruction: instruction?.trim() || null
      }
    })
  );
  return { council: getChimeraCouncil(db, councilId), deliveries };
}

export function postChimeraMessage(db: ProteusDb, publicId: string, kind: ChimeraMessageKind, body: string, metadata?: JsonValue): ChimeraMessageRow {
  const message = db.addChimeraMessage({
    publicId,
    direction: "agent_to_coordinator",
    kind,
    body,
    metadata,
    readByCoordinator: false,
    readByAgent: true
  });
  appendJsonl(outboxPath(db, publicId), message);
  return message;
}

export function snapshotChimeraSession(db: ProteusDb, publicId: string, body: string): ChimeraMessageRow {
  const session = requireChimeraSession(db, publicId);
  const snapshotPath = path.join(session.sessionDir, "snapshot.md");
  fs.writeFileSync(snapshotPath, body.trimEnd() + "\n");
  const message = postChimeraMessage(db, publicId, "snapshot", body, {
    snapshotPath: toRelative(db.targetRoot, snapshotPath),
    bodyLength: body.length
  });
  writeStatusFile(db, session, { latestSnapshotAt: message.createdAt });
  return message;
}

export function heartbeatChimeraSession(db: ProteusDb, publicId: string): {
  alive: boolean;
  killed: boolean;
  session: ChimeraSessionRow;
  killReason?: string;
} {
  const current = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
  const killPath = path.join(current.sessionDir, "kill.flag");
  const killed = fs.existsSync(killPath);
  const session = db.updateChimeraSession({ publicId, status: killed ? "stopped" : current.status === "starting" ? "running" : current.status });
  if (!killed) {
    db.addChimeraMessage({
      publicId,
      direction: "agent_to_coordinator",
      kind: "heartbeat",
      body: "Agent heartbeat.",
      readByAgent: true
    });
  }
  writeStatusFile(db, session);
  return {
    alive: !killed && session.status !== "stopped",
    killed,
    session,
    killReason: killed ? fs.readFileSync(killPath, "utf8") : undefined
  };
}

export function pollChimeraMessages(db: ProteusDb, input: {
  publicId?: string;
  unreadOnly?: boolean;
  forAgent?: boolean;
  peek?: boolean;
  limit?: number;
}): {
  sessions: ChimeraSessionRow[];
  messages: ChimeraMessagePollView[];
  latestSnapshots: Array<{ publicId: string; body: string; bodyLength: number; bodyTruncated: boolean; fullBodyPath: string | null; createdAt: string }>;
  controlStatus: ChimeraControlStatus[];
} {
  const unreadFor = input.unreadOnly ? (input.forAgent ? "agent" : "coordinator") : undefined;
  let messages = db.listChimeraMessages({
    publicId: input.publicId,
    unreadFor,
    limit: input.limit
  });
  if (input.unreadOnly && input.forAgent && input.publicId && messages.length === 0 && notificationPendingForAgent(db, input.publicId)) {
    for (let attempt = 0; attempt < 3 && messages.length === 0; attempt++) {
      sleepMs(150);
      messages = db.listChimeraMessages({
        publicId: input.publicId,
        unreadFor,
        limit: input.limit
      });
    }
  }
  if (input.unreadOnly && !input.peek) {
    db.markChimeraMessagesRead(messages.map((message) => message.id), input.forAgent ? "agent" : "coordinator");
    if (input.forAgent) {
      const publicIds = new Set(messages.map((message) => message.publicId));
      for (const publicId of publicIds) refreshNotificationFile(db, publicId);
    }
  }
  const sessions = input.publicId
    ? [refreshChimeraRuntime(db, requireChimeraSession(db, input.publicId))]
    : listChimeraSessions(db, { limit: 50 });
  const latestSnapshots = sessions
    .map((session) => db.latestChimeraSnapshot(session.publicId))
    .filter((message): message is ChimeraMessageRow => message !== null)
    .map((message) => {
      const view = chimeraMessagePollView(db, message);
      return {
        publicId: view.publicId,
        body: view.body,
        bodyLength: view.bodyLength,
        bodyTruncated: view.bodyTruncated,
        fullBodyPath: view.fullBodyPath,
        createdAt: view.createdAt
      };
    });
  const controlStatus = sessions.map((session) => chimeraControlStatus(db, session));
  return { sessions, messages: messages.map((message) => chimeraMessagePollView(db, message)), latestSnapshots, controlStatus };
}

export function listChimeraSessions(db: ProteusDb, input: { status?: ChimeraStatus | "active"; limit?: number } = {}): ChimeraSessionRow[] {
  const activeOnly = input.status === "active";
  const status: ChimeraStatus | undefined = input.status && input.status !== "active" ? input.status : undefined;
  const limit = input.limit ?? 50;
  const rawLimit = activeOnly ? Math.max(limit * 4, 200) : limit;
  const sessions = db
    .listChimeraSessions({ status, limit: rawLimit })
    .map((session) => refreshChimeraRuntime(db, session));
  return activeOnly ? sessions.filter(isActiveChimeraStatus).slice(0, limit) : sessions;
}

export function listChimeraSessionView(
  db: ProteusDb,
  input: { status?: ChimeraListStatusFilter; limit?: number; all?: boolean } = {}
): ChimeraSessionListResult {
  const limit = input.limit ?? 50;
  const status = input.status ?? null;
  const activeOnly = status === "active";
  const all = input.all === true;
  const activeCampaigns = db.listCampaigns("active");
  const activeCampaignIds = new Set(activeCampaigns.map((campaign) => campaign.id));
  const rawLimit = all || activeCampaignIds.size === 0 ? limit : Math.max(limit * 6, 300);
  let sessions = listChimeraSessions(db, { status: status ?? undefined, limit: rawLimit });
  const campaignMap = new Map(db.listCampaigns().map((campaign) => [campaign.id, campaign]));
  if (!all && activeCampaignIds.size > 0) {
    sessions = sessions.filter((session) =>
      campaignIdsForChimeraSession(db, session).some((id) => activeCampaignIds.has(id))
    );
  }
  const items = sessions.slice(0, limit).map((session) => enrichChimeraSessionForList(db, session, campaignMap));
  const campaignScope = activeCampaigns.map(publicCampaignSummary);
  const reason = all
    ? "all sessions requested"
    : activeCampaigns.length > 0
      ? "filtered to sessions linked to active campaigns"
      : "no active campaigns; showing recent sessions";
  return {
    sessions: items,
    scope: {
      activeOnly,
      all,
      status,
      campaignIds: all ? [] : campaignScope.map((campaign) => campaign.id),
      reason
    },
    activeCampaigns: campaignScope,
    advisories: chimeraListAdvisories(activeOnly, all, activeCampaigns.length),
    limit
  };
}

export function recoverChimeraSession(db: ProteusDb, publicId: string): ChimeraRecoveryResult {
  const recovered = recoverChimeraRuntime(db, requireChimeraSession(db, publicId));
  return {
    session: recovered.session,
    actions: recovered.actions,
    controlStatus: chimeraControlStatus(db, recovered.session)
  };
}

export function killChimeraSession(db: ProteusDb, publicId: string, reason: string): { session: ChimeraSessionRow; advisories: string[] } {
  const session = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
  fs.writeFileSync(path.join(session.sessionDir, "kill.flag"), reason.trimEnd() + "\n");
  const message = db.addChimeraMessage({
    publicId,
    direction: "coordinator_to_agent",
    kind: "kill",
    body: reason,
    metadata: { priority: true },
    readByCoordinator: true,
    readByAgent: false
  });
  appendJsonl(inboxPath(db, publicId), message);
  writeNotificationFile(db, publicId, message);
  const pid = session.opencodePid ?? readPidFile(path.join(session.sessionDir, "opencode", "opencode.pid"));
  if (pid) terminateProcess(pid);
  const updated = db.updateChimeraSession({ publicId, status: "stopped", closeVerdict: "kill", closeSummary: reason });
  writeStatusFile(db, updated, { killReason: reason });
  return {
    session: updated,
    advisories: [chimeraResumeHint()]
  };
}

export function closeChimeraSession(db: ProteusDb, publicId: string, verdict: string, summary: string): {
  session: ChimeraSessionRow;
  agentOutputId: number | null;
} {
  const current = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
  const updated = db.updateChimeraSession({ publicId, status: "stopped", closeVerdict: verdict, closeSummary: summary });
  db.addChimeraMessage({
    publicId,
    direction: "system",
    kind: "close",
    body: summary,
    metadata: { verdict },
    readByAgent: true,
    readByCoordinator: true
  });
  let agentOutputId: number | null = null;
  if (current.roundId) {
    agentOutputId = db.addAgentOutput({
      roundId: current.roundId,
      codename: "cicada",
      roleFamily: `chimera:${current.role}`,
      assignedSurface: current.goal,
      outputPath: toRelative(db.targetRoot, path.join(current.sessionDir, "snapshot.md")),
      coveredSurface: [],
      liveCandidates: verdict === "useful" || verdict === "lab-needed" ? [summary] : [],
      killedHypotheses: verdict === "kill" ? [summary] : [],
      probes: [],
      uncoveredAreas: [],
      validationStatus: verdict
    });
  }
  writeStatusFile(db, updated, { verdict, summary, agentOutputId });
  return { session: updated, agentOutputId };
}

export function startChimeraSwarm(db: ProteusDb, plan: ChimeraSwarmPlan): {
  sessions: Array<ReturnType<typeof startChimeraSession>>;
  maxAgents: number;
} {
  const config = getChimeraConfig();
  if (!Array.isArray(plan.agents) || plan.agents.length === 0) throw new Error("Swarm plan must include at least one agent.");
  if (plan.agents.length > config.maxAgents) {
    throw new Error(`Swarm plan has ${plan.agents.length} agents, but config maxAgents is ${config.maxAgents}.`);
  }
  const sessions = plan.agents.map((agent) =>
    startChimeraSession(db, {
      role: agent.role,
      goal: agent.goal,
      accessMode: agent.accessMode,
      accessNotes: agent.accessNotes,
      campaignId: plan.campaignId,
      roundId: plan.roundId,
      model: agent.model,
      provider: agent.provider,
      variant: agent.variant,
      run: plan.run
    })
  );
  return { sessions, maxAgents: config.maxAgents };
}

export function runChimeraSession(
  db: ProteusDb,
  publicId: string,
  timeoutSec?: number,
  options: { internalRun?: boolean; instruction?: string } = {}
): ChimeraRunResult {
  const config = getChimeraConfig();
  const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
  if (!options.internalRun && (session.status === "running" || session.status === "starting")) {
    throw new Error(`Chimera session ${publicId} is already ${session.status}. Use poll, workflow-snapshot, send --priority, kill, or close instead of run.`);
  }
  const promptPath = path.join(session.sessionDir, "opencode", "prompt.md");
  if (!fs.existsSync(promptPath)) throw new Error(`Missing Chimera prompt: ${promptPath}`);
  clearKillFlag(session);
  const running = db.updateChimeraSession({ publicId, status: "running", closeVerdict: null, closeSummary: null });
  writeStatusFile(db, running, { runStartedAt: new Date().toISOString() });
  const instruction = renderRunInstruction(running, options.instruction);
  if (options.instruction?.trim()) {
    db.addChimeraMessage({
      publicId: running.publicId,
      direction: "coordinator_to_agent",
      kind: "message",
      body: options.instruction.trim(),
      metadata: { source: "chimera_run_instruction" },
      readByAgent: false
    });
  }
  const run = runOpenCodeOnce(db, running, promptPath, config, resolveRunTimeoutSec(config, timeoutSec), instruction);
  const updated = db.updateChimeraSession({
    publicId,
    status: chimeraStatusAfterRun(run, db.getChimeraSession(publicId)),
    opencodePid: null
  });
  writeStatusFile(db, updated, { lastRun: run });
  return run;
}

export function startChimeraRunBackground(
  db: ProteusDb,
  publicId: string,
  timeoutSec?: number,
  options: { instruction?: string } = {}
): ChimeraBackgroundRunResult {
  const config = getChimeraConfig();
  const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
  if (session.status === "running" || session.status === "starting") {
    throw new Error(`Chimera session ${publicId} is already ${session.status}. Use priority steer only.`);
  }
  const opencodeDir = path.join(session.sessionDir, "opencode");
  ensureDir(opencodeDir);
  clearKillFlag(session);
  const backgroundLogPath = path.join(opencodeDir, "background-run.log");
  const backgroundErrPath = path.join(opencodeDir, "background-run.err.log");
  const backgroundPidPath = path.join(opencodeDir, "background-run.pid");
  const resolvedTimeout = resolveRunTimeoutSec(config, timeoutSec);
  const starting = db.updateChimeraSession({
    publicId: session.publicId,
    status: "starting",
    opencodePid: null,
    closeVerdict: null,
    closeSummary: null
  });
  writeStatusFile(db, starting, { backgroundRunStartedAt: new Date().toISOString() });
  const args = [
    resolveProteusCliPath(),
    "--root",
    db.targetRoot,
    "chimera",
    "run",
    "--id",
    session.publicId,
    "--internal-run"
  ];
  if (resolvedTimeout !== null) args.push("--timeout", String(resolvedTimeout));
  if (options.instruction?.trim()) args.push("--message", options.instruction.trim());
  const child = spawnHiddenBackground(process.execPath, args, {
    cwd: session.sessionDir,
    stdoutPath: backgroundLogPath,
    stderrPath: backgroundErrPath,
    pidPath: backgroundPidPath
  });
  child.unref();
  appendJsonl(path.join(session.sessionDir, "transcript.jsonl"), {
    type: "chimera_background_run",
    publicId: starting.publicId,
    pid: child.pid ?? null,
    timeoutSec: resolvedTimeout,
    instruction: options.instruction?.trim() ? true : false,
    logPath: toRelative(db.targetRoot, backgroundLogPath),
    stderrPath: toRelative(db.targetRoot, backgroundErrPath),
    createdAt: new Date().toISOString()
  });
  return {
    publicId: starting.publicId,
    started: true,
    pid: child.pid ?? null,
    logPath: backgroundLogPath,
    stderrPath: backgroundErrPath,
    pidPath: backgroundPidPath,
    timeoutSec: resolvedTimeout,
    instruction: options.instruction?.trim() ? true : false,
    detail: resolvedTimeout === null
      ? "started Chimera run in the background with no wall-clock timeout"
      : `started Chimera run in the background with timeout ${resolvedTimeout}s`
  };
}

export function wakeChimeraSession(db: ProteusDb, publicId: string, input: { messageId?: number; timeoutSec?: number } = {}): ChimeraRunResult {
  const config = getChimeraConfig();
  const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
  if (session.status === "running" || session.status === "starting") {
    throw new Error(`Chimera session ${publicId} is already ${session.status}. Use priority steer only.`);
  }
  const opencodeDir = path.join(session.sessionDir, "opencode");
  ensureDir(opencodeDir);
  const promptPath = path.join(opencodeDir, `wake-${input.messageId ?? "latest"}.md`);
  fs.writeFileSync(promptPath, renderWakePrompt(db, session, input.messageId));
  clearKillFlag(session);
  const running = db.updateChimeraSession({ publicId, status: "running", closeVerdict: null, closeSummary: null });
  writeStatusFile(db, running, { wakeStartedAt: new Date().toISOString(), wakeMessageId: input.messageId ?? null });
  const run = runOpenCodeOnce(
    db,
    running,
    promptPath,
    config,
    resolveRunTimeoutSec(config, input.timeoutSec),
    `Priority Proteus wake for ${session.publicId}. Read the attached wake instructions, poll Proteus unread messages immediately, perform only the requested communication/control action, then stop.`
  );
  const updated = db.updateChimeraSession({
    publicId,
    status: chimeraStatusAfterRun(run, db.getChimeraSession(publicId)),
    opencodePid: null
  });
  writeStatusFile(db, updated, { lastWakeRun: run, wakeMessageId: input.messageId ?? null });
  return run;
}

export function attachOpenCodeSession(db: ProteusDb, publicId: string, input: { serverUrl?: string | null; opencodeSessionId?: string | null }): ChimeraSessionRow {
  const current = requireChimeraSession(db, publicId);
  const config = getChimeraConfig();
  const serverUrl = nullableString(input.serverUrl, current.opencodeServerUrl ?? config.opencodeServerUrl);
  const opencodeSessionId = nullableString(input.opencodeSessionId, current.opencodeSessionId);
  if (!serverUrl) throw new Error(`OpenCode server URL is required to attach Chimera session ${publicId}.`);
  if (!opencodeSessionId) throw new Error(`OpenCode session id is required to attach Chimera session ${publicId}.`);
  if (!openCodeServerHealthy(serverUrl)) throw new Error(`OpenCode server is not reachable or healthy: ${serverUrl}`);
  const updated = db.updateChimeraSession({
    publicId,
    opencodeServerUrl: serverUrl,
    opencodeSessionId
  });
  if (serverUrl && serverUrl !== config.opencodeServerUrl) {
    saveChimeraConfig({ ...config, opencodeServerUrl: serverUrl });
  }
  writeStatusFile(db, updated, { opencodeAttached: true });
  return updated;
}

export function snapshotChimeraWorkflow(db: ProteusDb, publicId: string, input: {
  limit?: number;
  maxMessageChars?: number;
} = {}): ChimeraWorkflowSnapshotResult {
  let session = reconcileOpenCodeSession(db, requireChimeraSession(db, publicId));
  if (!session.opencodeSessionId) {
    throw new Error(`Chimera session ${publicId} has no attached OpenCode session id. Run or attach OpenCode first.`);
  }
  const limit = Math.max(1, Math.min(50, positiveInteger(input.limit, 8)));
  const maxMessageChars = Math.max(80, Math.min(8000, positiveInteger(input.maxMessageChars, 1200)));
  const command = commandParts(session.opencodeCommand || getChimeraConfig().opencodeCommand);
  const attempts: ChimeraWorkflowSnapshotResult["export"]["attempts"] = [];
  let result: ReturnType<typeof spawnExternalSync> | null = null;
  let stdout = "";
  let stderr = "";
  let exported: unknown = undefined;
  let exportedSessionId: string | null = session.opencodeSessionId;
  let parseError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = exportOpenCodeSession(command, session);
    stdout = String(result.stdout ?? "");
    stderr = String(result.stderr ?? "");
    try {
      exported = JSON.parse(extractJsonObject(stdout));
      parseError = "";
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    if (exported !== undefined) exportedSessionId = session.opencodeSessionId;
    attempts.push({
      attempt,
      opencodeSessionId: session.opencodeSessionId,
      exitCode: result.status,
      parsed: exported !== undefined,
      stdoutPreview: openCodeExportStdoutPreview(stdout, exported !== undefined),
      stderrPreview: truncate(stderr.trim(), 1000),
      errorPreview: truncate(String(result.error?.message ?? parseError ?? ""), 1000)
    });
    if (exported !== undefined) break;
    if (attempt < 3) {
      sleepMs(250 * attempt);
      session = reconcileOpenCodeSession(db, requireChimeraSession(db, publicId));
    }
  }
  if (exported === undefined || !result) {
    const last = attempts[attempts.length - 1];
    throw new Error(`OpenCode export failed for ${session.opencodeSessionId}: exit=${last?.exitCode ?? "unknown"}; parse=${parseError || "no JSON"}; stderr=${last?.stderrPreview || "-"}; stdout=${last?.stdoutPreview || "-"}; error=${last?.errorPreview || "-"}`);
  }
  const extracted = extractWorkflowMessages(exported);
  const generatedAt = new Date().toISOString();
  const messages = extracted
    .slice(-limit)
    .map((message, index) => {
      const text = compactWhitespace(message.text);
      const truncated = text.length > maxMessageChars;
      return {
        ordinal: index + 1,
        createdAt: message.createdAt,
        text: truncated ? `${text.slice(0, maxMessageChars - 3)}...` : text,
        truncated
      };
    });
  const outDir = path.join(session.sessionDir, "opencode", "workflow-snapshots");
  ensureDir(outDir);
  const stamp = generatedAt.replace(/\D/g, "").slice(0, 14);
  const jsonPath = path.join(outDir, `${stamp}.json`);
  const markdownPath = path.join(outDir, `${stamp}.md`);
  const snapshot: ChimeraWorkflowSnapshotResult = {
    publicId,
    opencodeSessionId: exportedSessionId ?? String(session.opencodeSessionId),
    generatedAt,
    limit,
    maxMessageChars,
    messages,
    files: { jsonPath, markdownPath },
    export: {
      exitCode: result.status,
      stdoutPreview: openCodeExportStdoutPreview(stdout, true),
      stderrPreview: truncate(stderr.trim(), 1000),
      attempts
    }
  };
  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + "\n");
  fs.writeFileSync(markdownPath, renderWorkflowSnapshotMarkdown(snapshot));
  appendJsonl(path.join(session.sessionDir, "transcript.jsonl"), {
    type: "workflow_snapshot",
    generatedAt,
    opencodeSessionId: session.opencodeSessionId,
    messageCount: messages.length,
    jsonPath: toRelative(db.targetRoot, jsonPath),
    markdownPath: toRelative(db.targetRoot, markdownPath)
  });
  return snapshot;
}

interface ChimeraPaths {
  sessionDir: string;
  labDir: string;
  dossierPath: string;
  promptPath: string;
  contractPath: string;
  instructionsPath: string;
}

export interface ChimeraRunResult {
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  stdoutPath: string;
  stderrPath: string;
  runPath: string;
  stdoutPreview: string;
  stderrPreview: string;
}

export interface ChimeraWorkflowSnapshotResult {
  publicId: string;
  opencodeSessionId: string;
  generatedAt: string;
  limit: number;
  maxMessageChars: number;
  messages: Array<{
    ordinal: number;
    createdAt: string | null;
    text: string;
    truncated: boolean;
  }>;
  files: {
    jsonPath: string;
    markdownPath: string;
  };
  export: {
    exitCode: number | null;
    stdoutPreview: string;
    stderrPreview: string;
    attempts: Array<{
      attempt: number;
      opencodeSessionId: string | null;
      exitCode: number | null;
      parsed: boolean;
      stdoutPreview: string;
      stderrPreview: string;
      errorPreview: string;
    }>;
  };
}

function exportOpenCodeSession(command: { file: string; args: string[] }, session: ChimeraSessionRow): ReturnType<typeof spawnExternalSync> {
  return spawnExternalSync(command, ["export", String(session.opencodeSessionId)], {
    cwd: session.sessionDir,
    encoding: "utf8",
    timeout: 30000
  });
}

interface OpenCodeServerState {
  url: string;
  pid: number | null;
  started: boolean;
}

interface ControlledRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number | null;
  killPath: string;
  pidPath: string;
  sessionIdPath: string;
  serverUrl: string;
  sessionTitle: string;
  sessionDir: string;
  stdoutPath: string;
  stderrPath: string;
}

interface ControlledRunResult {
  status: number | null;
  signal: NodeJS.Signals | string | null;
  timedOut: boolean;
  killed: boolean;
  pid: number | null;
  discoveredSessionId?: string | null;
  error: string | null;
}

function createSessionFiles(db: ProteusDb, session: ChimeraSessionRow, config: ChimeraConfig): ChimeraPaths {
  ensureDir(chimeraSessionsDir(db.targetRoot));
  ensureDir(session.sessionDir);
  ensureDir(session.labDir);
  for (const dir of ["poc", "scripts", "evidence"]) ensureDir(path.join(session.labDir, dir));
  const opencodeDir = path.join(session.sessionDir, "opencode");
  ensureDir(opencodeDir);
  ensureDir(path.join(session.sessionDir, "skills"));
  ensureDir(path.join(session.sessionDir, ".opencode", "agents"));
  ensureDir(path.join(session.sessionDir, ".opencode", "skills"));
  const target = db.getTarget();
  const contract = renderContract(db, session, config);
  const instructions = renderAgentInstructions(db, session);
  const dossier = renderDossier(db, session, target?.name ?? "unknown target");
  const prompt = [dossier, contract, instructions].join("\n\n");
  const paths = {
    sessionDir: session.sessionDir,
    labDir: session.labDir,
    dossierPath: path.join(session.sessionDir, "dossier.md"),
    promptPath: path.join(opencodeDir, "prompt.md"),
    contractPath: path.join(session.sessionDir, "contract.md"),
    instructionsPath: path.join(session.sessionDir, "agent-instructions.md")
  };
  fs.writeFileSync(paths.dossierPath, dossier);
  fs.writeFileSync(paths.contractPath, contract);
  fs.writeFileSync(paths.instructionsPath, instructions);
  fs.writeFileSync(paths.promptPath, prompt);
  fs.writeFileSync(path.join(session.labDir, "README.md"), renderLabReadme(session));
  fs.writeFileSync(path.join(session.labDir, "notes.md"), `# ${session.publicId} Notes\n\n`);
  for (const jsonl of ["inbox.jsonl", "outbox.jsonl", "transcript.jsonl"]) fs.writeFileSync(path.join(session.sessionDir, jsonl), "");
  fs.writeFileSync(path.join(session.sessionDir, "notifications.json"), JSON.stringify({
    pending: false,
    priority: false,
    unreadForAgent: 0,
    updatedAt: null,
    latestMessageId: null,
    latestKind: null
  }, null, 2) + "\n");
  copySkillFiles(session);
  writeOpenCodeAgentFile(session, config);
  return paths;
}

function runOpenCodeOnce(
  db: ProteusDb,
  session: ChimeraSessionRow,
  promptPath: string,
  config: ChimeraConfig,
  timeoutSec: number | null,
  finalInstruction?: string
): ChimeraRunResult {
  const server = ensureOpenCodeServer(db, config);
  const current = requireChimeraSession(db, session.publicId);
  const attachedSessionId = current.opencodeSessionId && openCodeSessionMatchesDirectory(server.url, current.opencodeSessionId, session)
    ? current.opencodeSessionId
    : null;
  if (current.opencodeSessionId && !attachedSessionId) {
    appendJsonl(path.join(session.sessionDir, "transcript.jsonl"), {
      type: "opencode_session_id_ignored",
      publicId: session.publicId,
      opencodeSessionId: current.opencodeSessionId,
      reason: "attached OpenCode session id did not match this Chimera session directory",
      createdAt: new Date().toISOString()
    });
  }
  const opencodeDir = path.join(session.sessionDir, "opencode");
  const stdoutPath = path.join(opencodeDir, "stdout.log");
  const stderrPath = path.join(opencodeDir, "stderr.log");
  const runPath = path.join(opencodeDir, "run.json");
  const sessionIdPath = openCodeSessionIdPath(session);
  const args = [
    "run",
    "--pure",
    "--format",
    "json",
    "--thinking",
    "--attach",
    server.url,
    "--dir",
    session.sessionDir,
    "--file",
    promptPath,
    "--agent",
    config.defaultAgent ?? "proteus-chimera"
  ];
  if (attachedSessionId) {
    args.push("--session", attachedSessionId);
  } else {
    args.push("--title", `proteus-${session.publicId}`);
  }
  if (session.model) args.push("--model", session.model);
  if (session.provider) args.push("--variant", session.provider);
  if (config.skipPermissions) args.push("--dangerously-skip-permissions");
  args.push(finalInstruction ?? `Run the attached Proteus Chimera dossier for ${session.publicId}. Start by loading available Proteus skills if the skill tool is available, then execute only the assigned goal. Poll Proteus messages before long work and post a concise final snapshot.`);
  const startedAt = new Date().toISOString();
  const command = commandParts(config.opencodeCommand);
  const killPath = path.join(session.sessionDir, "kill.flag");
  const pidPath = path.join(opencodeDir, "opencode.pid");
  const runEnv = {
    ...process.env,
    PROTEUS_CHIMERA_SESSION_ID: session.publicId,
    PROTEUS_CHIMERA_SESSION_DIR: session.sessionDir,
    PROTEUS_CHIMERA_LAB_DIR: session.labDir,
    PROTEUS_CHIMERA_ACCESS_MODE: session.accessMode,
    PROTEUS_CHIMERA_CAMPAIGN_ID: session.campaignId ? String(session.campaignId) : "",
    PROTEUS_CHIMERA_ROUND_ID: session.roundId ? String(session.roundId) : "",
    PROTEUS_TARGET_ROOT: db.targetRoot
  };
  const result = runExternalControlled(command, args, {
    cwd: session.sessionDir,
    env: runEnv,
    timeoutMs: timeoutSec === null ? null : timeoutSec * 1000,
    killPath,
    pidPath,
    sessionIdPath,
    serverUrl: server.url,
    sessionTitle: `proteus-${session.publicId}`,
    sessionDir: session.sessionDir,
    stdoutPath,
    stderrPath
  });
  const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf8") : "";
  const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : "";
  const run = {
    startedAt,
    completedAt: new Date().toISOString(),
    command: command.file,
    args: [...command.args, ...args],
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    killed: result.killed,
    pid: result.pid,
    error: result.error ?? null
  };
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");
  appendJsonl(path.join(session.sessionDir, "transcript.jsonl"), { type: "opencode_run", ...run });
  const stdoutSessionId = readOpenCodeSessionIdFromStdout(session);
  const fileSessionId = readOpenCodeSessionId(session) ?? stdoutSessionId;
  if (stdoutSessionId && !fs.existsSync(sessionIdPath)) fs.writeFileSync(sessionIdPath, stdoutSessionId + "\n");
  const discovered = fileSessionId && openCodeSessionMatchesDirectory(server.url, fileSessionId, session)
    ? fileSessionId
    : stdoutSessionId ?? discoverOpenCodeSession(server.url, session);
  const updated = db.updateChimeraSession({
    publicId: session.publicId,
    opencodeServerUrl: server.url,
    opencodeSessionId: discovered ?? attachedSessionId
  });
  writeStatusFile(db, updated, { lastOpenCodeDiscovery: { serverUrl: server.url, opencodeSessionId: discovered ?? attachedSessionId } });
  if (stdout.trim()) {
    const agentText = extractOpenCodeAssistantText(stdout.trim());
    db.addChimeraMessage({
      publicId: session.publicId,
      direction: "agent_to_coordinator",
      kind: "message",
      body: agentText,
      metadata: { source: "opencode_stdout", stdoutPath: toRelative(db.targetRoot, stdoutPath) },
      readByAgent: true
    });
  }
  if (stderr.trim()) {
    db.addChimeraMessage({
      publicId: session.publicId,
      direction: "system",
      kind: "error",
      body: truncate(stderr.trim(), 4000),
      metadata: { source: "opencode_stderr", stderrPath: toRelative(db.targetRoot, stderrPath) },
      readByAgent: true
    });
  }
  return {
    exitCode: result.status,
    timedOut: run.timedOut,
    killed: run.killed,
    stdoutPath,
    stderrPath,
    runPath,
    stdoutPreview: truncate(stdout.trim(), 1000),
    stderrPreview: truncate(stderr.trim(), 1000)
  };
}

function renderRunInstruction(session: ChimeraSessionRow, instruction?: string): string {
  const trimmed = instruction?.trim();
  const lines = [
    `Continue the existing Proteus Chimera session ${session.publicId}.`,
    "Reuse the persisted dossier, contract, lab, skills, Proteus memory, OpenCode session history, and current assigned scope instead of treating this as a brand new co-agent.",
    "Poll Proteus messages before long work, dedupe against local Proteus memory before deep work, and post a concise final snapshot when the run completes or blocks."
  ];
  if (trimmed) {
    lines.push("", "Coordinator instruction for this run:", trimmed);
  } else {
    lines.push("", "No extra coordinator instruction was provided for this run. Continue the existing goal and stop condition with the next high-ROI move.");
  }
  return lines.join("\n");
}

function renderDossier(db: ProteusDb, session: ChimeraSessionRow, targetName: string): string {
  const campaign = session.campaignId ? db.getCampaign(session.campaignId) : null;
  const round = session.roundId ? db.getRound(session.roundId) : null;
  const activeCampaigns = db.listCampaigns("active").slice(0, 3);
  return `# Chimera Dossier ${session.publicId}

Target: ${targetName}
Role: ${session.role}
Goal: ${session.goal}
Campaign: ${campaign ? `C${campaign.id} ${campaign.title}` : "none"}
Round: ${round ? `R${round.id} ${round.objective}` : "none"}
Session dir: ${toRelative(db.targetRoot, session.sessionDir)}
Lab dir: ${toRelative(db.targetRoot, session.labDir)}

Coordinator context:
- Access mode: ${session.accessMode}.
- ${accessLine(session)}
- Assigned campaign id: ${session.campaignId ? `C${session.campaignId}` : "none"}.
- Assigned round id: ${session.roundId ? `R${session.roundId}` : "none"}.
- Use Proteus CLI for state and communication.
- Use the assigned campaign and round for research memory. When you record evidence, hypotheses, gates, decisions, branches, or agent output through Proteus from this Chimera session, Proteus links them to the assigned campaign automatically.
- Do not create, close, checkpoint, or otherwise edit campaigns or rounds. The coordinator owns campaign and round state.
- Do not promote findings. Return hypotheses, blockers, evidence pointers, and validation needs.

Active campaigns:
${activeCampaigns.map((item) => `- C${item.id} [${item.status}] ${item.title}: ${item.currentStateSummary || item.objective}`).join("\n") || "- none"}

Stop conditions:
- You see kill.flag in the session directory.
- You completed the assigned goal and wrote a final snapshot.
- You hit a concrete blocker and posted it to the coordinator.
- The branch becomes repetitive, speculative, or lacks testable signal.
- You need coordinator input to avoid unsafe or out-of-scope work.
`;
}

function renderContract(db: ProteusDb, session: ChimeraSessionRow, config: ChimeraConfig): string {
  const proteusCommand = proteusCliCommand();
  return `# Chimera Contract

You are a secondary Proteus Chimera co-agent, not an ordinary lightweight subagent. The coordinator remains the final authority for strategy, validation gates, promotion, reporting, and campaign state. Your role is to run a complete, independent research front that brings a different angle while staying inside the assigned scope.

Required behavior:
- Read dossier.md, contract.md, agent-instructions.md, skills/README.md, and injected skills/*.md before acting.
- Reconstruct the research context before substantial work: target, campaign/hypothesis, why this front exists, known killed paths, constraints, intended strategy, applicable Proteus heuristics, and expected output.
- Confirm the assigned campaign and round before recording research state: campaign=${session.campaignId ? `C${session.campaignId}` : "none"}, round=${session.roundId ? `R${session.roundId}` : "none"}. Use ${proteusCommand} --root "${db.targetRoot}" campaign resume${session.campaignId ? ` --id ${session.campaignId}` : ""} for context when available.
- Respect access mode ${session.accessMode}: ${accessLine(session)}
- Shell is available to Chimera sessions, but it is not blanket approval. Use shell only for the assigned research goal, obey the coordinator restrictions, avoid destructive commands, and keep generated artifacts in the Chimera lab.
- By default, create and edit files only inside your own Chimera lab: ${toRelative(db.targetRoot, session.labDir)}. Do not create, edit, move, or delete files elsewhere in the workspace unless editor-mode restrictions explicitly name the allowed path and action.
- Use ${toRelative(db.targetRoot, session.labDir)} for notes, scripts, PoC material, and evidence even when broader access is granted.
- Every Proteus command must use the shared workspace root explicitly: ${proteusCommand} --root "${db.targetRoot}" ...
- Never run Proteus against your Chimera lab, session directory, package subdirectory, fixture, generated lab, or temporary folder. Do not omit --root when invoking Proteus from inside your lab.
- Prefer the workspace root as the Proteus base. Do not create stray .vros directories in subfolders.
- If you accidentally find or create a stray base, report it. The coordinator can merge it with proteus merge.
- Do not mutate campaign or round state. Do not run campaign create, campaign checkpoint, campaign close, plan-round, update round, update rounds, or manual campaign links. If campaign or round state needs a change, post a blocker or message to the coordinator.
- On startup, perform a compact operational self-check before substantial work: confirm Proteus CLI access, assigned campaign/round context, access mode, shell availability, lab write access, and read-only target access. Post the result to the coordinator. If the coordinator explicitly asks for a registration test, record a clearly labeled test evidence item and verify it auto-links to the assigned campaign.
- Use concise snapshots and message the coordinator through Proteus.
- Coordinator messages and broadcasts update notifications.json in this session directory. Treat it as a lightweight signal to poll, not as the source of truth.
- Priority messages may also arrive as direct OpenCode steer notifications telling you to poll Proteus. Treat those notifications as a request to poll as soon as you can do so without corrupting an in-flight command or losing evidence.
- Poll your inbox periodically on your own initiative: before long work, after completing a branch, after meaningful pivots, before finalizing, and whenever you notice notifications.json changed.
- Heartbeat before long work and after meaningful pivots.
- Continue until the assigned goal is fulfilled, a concrete blocker prevents meaningful progress, or a stop condition is reached. Do not stop merely because one command or one reasoning round completed.
- Act independently, rationally, and pragmatically inside scope. Choose concrete probes, labs, PoCs, payloads, negative controls, and evidence capture steps yourself instead of waiting for step-by-step coordinator approval.
- Ask the coordinator only when the next move depends on scope, authorization, permissions, or a strategic decision the coordinator must own. Recover ordinary missing context from the session files and Proteus state instead of pausing.
- Use Proteus gates to avoid noise: realistic exploitability, target root cause, expected behavior, duplicate/public-known status, concrete impact, negative controls, and no artificial lab help.
- Do not invent evidence, ignore duplicate checks, or turn brainstorms into findings.
- Shared Chimera chat is advisory context. You do not need to answer every broadcast. Respond only when it changes your branch, asks you a direct question, or can help another active agent.
- Coordinator questions should be answered unless doing so would exceed scope or interrupt a higher-priority safety stop.
- Brainstorm council messages use kind "council". Accept a council invite only when you are free or at a safe pause point. In a council, identify yourself as ${session.publicId} / ${session.role}, wait for your ordered cue-turn message, read the included council transcript, and send exactly one concise turn per round with non-obvious options, evidence gaps, risks, and recommended next move. Do not answer the steer notification directly, debate every point, create a chat loop, or manually pass the turn to another agent; Proteus advances to the next accepted participant automatically after your turn. After the coordinator closes the council, resume prior work if still valid or follow the final instruction.
- Network use is ${config.defaultNetwork ? "authorized only within the target scope and coordinator restrictions" : "not authorized by default. Proteus omits OpenCode web permissions unless the coordinator enables network, but shell is not an OS sandbox; do not use network from shell unless explicitly authorized."}

Communication commands:
- ${proteusCommand} --root "${db.targetRoot}" chimera poll --id ${session.publicId} --unread --agent
- ${proteusCommand} --root "${db.targetRoot}" chimera post --id ${session.publicId} --kind message --body "..."
- ${session.campaignId ? `${proteusCommand} --root "${db.targetRoot}" campaign resume --id ${session.campaignId}` : `${proteusCommand} --root "${db.targetRoot}" campaign resume`}
- ${proteusCommand} --root "${db.targetRoot}" chimera broadcast --message "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera send --to-id CH-0000 --message "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera council accept --id ${session.publicId} --council-id CO-... --body "ready"
- ${proteusCommand} --root "${db.targetRoot}" chimera council turn --id ${session.publicId} --council-id CO-... --round 1 --body "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera snapshot --id ${session.publicId} --body "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera heartbeat --id ${session.publicId}

Use --priority only when sending to another OpenCode-backed Chimera agent that should be nudged to poll soon. Do not use --priority when posting to the coordinator.
`;
}

function renderAgentInstructions(db: ProteusDb, session: ChimeraSessionRow): string {
  const proteusCommand = proteusCliCommand();
  return `# Agent Instructions

Start with the highest-ROI path for this exact goal. Avoid broad repo review unless it directly supports the assignment, but cover the relevant surface and angles deeply enough to make this a complete research front.

For creative offensive work, generate several distinct branches, kill weak ones quickly, and preserve why they died. For fuzzing, learn how inputs change behavior instead of spraying generic payloads. For PoC work, prefer realistic manual blackbox reproduction and clear negative controls.

Keep working until the assigned goal is complete or blocked. Prototype labs, PoCs, harnesses, and payloads when they are the best path to evidence. If blocked, post the blocker and the next decision needed from the coordinator.

If invited to a brainstorm council, accept only at a safe pause point. During the council, wait for your turn, send one compact contribution for that round, and avoid reply loops. When the coordinator closes the council, resume the prior branch if still valid or follow the final coordinator instruction.

Before stopping, write a snapshot:

${proteusCommand} --root "${db.targetRoot}" chimera snapshot --body "Confirmed / killed / open / next move"
`;
}

function renderLabReadme(session: ChimeraSessionRow): string {
  return `# ${session.publicId} Lab

This is the private Chimera lab for role ${session.role}.

Preferred writes:
- notes.md
- poc/
- scripts/
- evidence/

Access mode: ${session.accessMode}
${accessLine(session)}
`;
}

function accessLine(session: ChimeraSessionRow): string {
  if (session.accessMode === "editor") {
    return `Editor mode grants shell plus OpenCode edit permission. You still create/edit only inside the Chimera lab unless these coordinator restrictions explicitly name another allowed path and action: ${session.accessNotes}`;
  }
  const notes = session.accessNotes ? ` Coordinator restrictions: ${session.accessNotes}` : "";
  return `Explorer mode grants shell for read-only inspection and lab-local work, but repository edits are out of scope. Write notes, scripts, PoC material, and evidence only inside the Chimera lab.${notes}`;
}

function copySkillFiles(session: ChimeraSessionRow): void {
  const skillsDir = resolveSkillsDir();
  if (!skillsDir) return;
  const available = listAvailableSkillNames(skillsDir);
  const wanted = new Set(["chimera-agent", ...skillsForRole(session.role, available)]);
  const injected: string[] = [];
  for (const name of wanted) {
    const source = path.join(skillsDir, name, "SKILL.md");
    if (!fs.existsSync(source)) continue;
    linkOrCopyFile(source, path.join(session.sessionDir, "skills", `${name}.md`));
    const opencodeSkillDir = path.join(session.sessionDir, ".opencode", "skills", name);
    linkOrCopyDir(path.dirname(source), opencodeSkillDir);
    injected.push(name);
  }
  const index = renderChimeraSkillsIndex(session, skillsDir, available, injected);
  fs.writeFileSync(path.join(session.sessionDir, "skills", "README.md"), index);
  fs.writeFileSync(path.join(session.sessionDir, ".opencode", "skills", "README.md"), index);
}

function linkOrCopyFile(source: string, destination: string): void {
  ensureDir(path.dirname(destination));
  try {
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) fs.unlinkSync(destination);
    if (!fs.existsSync(destination)) fs.symlinkSync(source, destination, "file");
    return;
  } catch {
    fs.copyFileSync(source, destination);
  }
}

function linkOrCopyDir(source: string, destination: string): void {
  ensureDir(path.dirname(destination));
  try {
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) fs.unlinkSync(destination);
    if (!fs.existsSync(destination)) fs.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
    return;
  } catch {
    ensureDir(destination);
    fs.copyFileSync(path.join(source, "SKILL.md"), path.join(destination, "SKILL.md"));
  }
}

function listAvailableSkillNames(skillsDir: string): string[] {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")))
    .sort();
}

function skillsForRole(role: string, available: string[]): string[] {
  if (role === "generalist") {
    return available.filter((name) => name !== "continuous-vuln-research" && name !== "chimera-agent");
  }
  return available.includes(role) ? [role] : [];
}

function renderChimeraSkillsIndex(session: ChimeraSessionRow, skillsDir: string, available: string[], copied: string[]): string {
  const copiedSet = new Set(copied);
  const coordinatorOnly = new Set(["continuous-vuln-research"]);
  const lines = [
    "# Chimera Skills",
    "",
    `Session: ${session.publicId}`,
    `Role: ${session.role}`,
    `Proteus skill package root: ${skillsDir}`,
    "",
    "Injected skill files for this co-agent are linked into this directory and into `.opencode/skills/` when the filesystem allows it; Proteus falls back to generated copies only when links are unavailable.",
    "Read `chimera-agent.md` first. It is the primary Chimera co-agent contract.",
    "Do not load `continuous-vuln-research`; it is the coordinator contract and is intentionally not injected into Chimera sessions.",
    "For non-injected specialist skills, use the package path only when the coordinator explicitly redirects you or asks you to consult that skill.",
    "",
    "## Injected",
    ""
  ];
  for (const name of copied) lines.push(`- ${name}: injected at skills/${name}.md`);
  if (copied.length === 0) lines.push("- none");
  lines.push("", "## Available In Proteus Package", "");
  for (const name of available) {
    if (coordinatorOnly.has(name)) {
      lines.push(`- ${name}: coordinator-only, not for Chimera co-agents`);
    } else if (copiedSet.has(name)) {
      lines.push(`- ${name}: injected`);
    } else {
      lines.push(`- ${name}: ${path.join(skillsDir, name, "SKILL.md")}; ask the coordinator to launch or redirect a role-specific co-agent when this expertise is needed`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeOpenCodeAgentFile(session: ChimeraSessionRow, config: ChimeraConfig): void {
  const agentName = config.defaultAgent ?? "proteus-chimera";
  const permissions = session.accessMode === "editor"
    ? ["bash", "read", "edit", "glob", "grep", "skill", "lsp"]
    : ["bash", "read", "glob", "grep", "skill", "lsp"];
  if (config.defaultNetwork) permissions.push("webfetch", "websearch");
  const deniedPermissions = [
    ...(session.accessMode === "editor" ? [] : ["edit"]),
    ...(config.defaultNetwork ? [] : ["webfetch", "websearch"])
  ];
  const agent = `---
description: Proteus Chimera secondary agent for ${session.role} work.
mode: primary
${session.model ? `model: ${session.model}\n` : ""}permissions:
  ${permissions.map((permission) => `${permission}: allow`).join("\n  ")}
  ${deniedPermissions.map((permission) => `${permission}: deny`).join("\n  ")}
---

# Proteus Chimera Runtime Agent

Read the attached dossier and the local Proteus skills before acting. Your session id is ${session.publicId}.

Operate through Proteus for coordination and memory. Create and edit files only inside your Chimera lab unless editor-mode restrictions explicitly name another allowed path and action. Respect access mode ${session.accessMode}.

Shell and edit permissions must follow the coordinator restrictions in dossier.md and contract.md. Do not wait for interactive permission approval. If an action is outside your granted access or unclear, post a blocker through Proteus instead of asking OpenCode to prompt a human.
`;
  fs.writeFileSync(path.join(session.sessionDir, ".opencode", "agents", `${agentName}.md`), agent);
}

function linkChimeraSession(db: ProteusDb, session: ChimeraSessionRow): Array<{ entityType: string; entityId: number }> {
  const linked: Array<{ entityType: string; entityId: number }> = [];
  if (session.campaignId) {
    const id = db.addEntityLink({
      fromType: "campaign",
      fromId: session.campaignId,
      toType: "chimera_session",
      toId: session.id,
      relation: "has_chimera_session",
      note: `Chimera ${session.publicId} ${session.role}: ${session.goal}`
    });
    linked.push({ entityType: "entity_link", entityId: id });
    db.addCampaignEvent({
      campaignId: session.campaignId,
      eventType: "chimera_started",
      entityType: "chimera_session",
      entityId: session.id,
      summary: `Started ${session.publicId} (${session.role}): ${session.goal}`
    });
  } else {
    const auto = db.linkActiveCampaignTo({
      toType: "chimera_session",
      toId: session.id,
      relation: "has_chimera_session",
      eventType: "chimera_started",
      eventSummary: `Started ${session.publicId} (${session.role}): ${session.goal}`
    });
    if (auto) linked.push({ entityType: "entity_link", entityId: auto.linkId });
  }
  return linked;
}

function resolveCouncilParticipants(db: ProteusDb, sessionIds?: string[]): ChimeraSessionRow[] {
  if (sessionIds && sessionIds.length > 0) {
    return sessionIds.map((id) => requireChimeraSession(db, id));
  }
  return db
    .listChimeraSessions({ limit: 500 })
    .filter(isActiveChimeraStatus)
    .reverse();
}

function councilMessages(db: ProteusDb, councilId: string): ChimeraMessageRow[] {
  return db
    .listChimeraMessages({ limit: 2000 })
    .filter((message) => councilMetadata(message).councilId === councilId);
}

function councilMetadata(message: ChimeraMessageRow): Record<string, JsonValue> {
  return metadataObject(message.metadata) ?? {};
}

function renderCouncilTranscript(council: ChimeraCouncilStatus): string {
  const lines = council.messages
    .map((message) => {
      const metadata = councilMetadata(message);
      if (metadata.councilState === "accepted") {
        return `- ${message.publicId} accepted at ${message.createdAt}: ${truncate(message.body, 400)}`;
      }
      if (metadata.councilState === "round_opened") {
        return `- coordinator opened round ${metadata.round ?? "?"} at ${message.createdAt}: ${truncate(message.body, 800)}`;
      }
      if (metadata.councilState === "turn") {
        return `- round ${metadata.round ?? "?"} ${message.publicId} at ${message.createdAt}: ${truncate(message.body, 800)}`;
      }
      if (metadata.councilState === "closed") {
        return `- coordinator closed for ${message.publicId} at ${message.createdAt}: ${truncate(message.body, 500)}`;
      }
      return null;
    })
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return "- no accepts or turns recorded yet";
  return lines.slice(-40).join("\n");
}

function extractWorkflowMessages(value: unknown): Array<{ text: string; createdAt: string | null }> {
  const direct = extractOpenCodeExportMessages(value);
  if (direct.length > 0) return direct;
  const messages: Array<{ text: string; createdAt: string | null }> = [];
  const seen = new Set<string>();
  collectWorkflowMessages(value, messages, seen);
  return messages.filter((message) => message.text.trim().length > 0);
}

function extractOpenCodeExportMessages(value: unknown): Array<{ text: string; createdAt: string | null }> {
  const root = metadataObject(value);
  if (!root || !Array.isArray(root.messages)) return [];
  const messages: Array<{ text: string; createdAt: string | null }> = [];
  for (const rawMessage of root.messages) {
    const message = metadataObject(rawMessage);
    if (!message) continue;
    const info = metadataObject(message?.info);
    const role = lowerString(info?.role);
    if (role !== "assistant" && role !== "agent") continue;
    const parts = [
      ...(Array.isArray(message?.parts) ? message.parts : []),
      ...(Array.isArray(message?.content) ? message.content : [])
    ];
    const texts: string[] = [];
    for (const rawPart of parts) {
      const part = metadataObject(rawPart);
      if (!part || part.synthetic === true) continue;
      if (lowerString(part.type) !== "text") continue;
      if (typeof part.text === "string" && part.text.trim()) texts.push(part.text.trim());
    }
    const text = compactWhitespace(texts.join("\n"));
    if (!text) continue;
    messages.push({ text, createdAt: workflowTimestamp(message) });
  }
  return messages;
}

function collectWorkflowMessages(value: unknown, messages: Array<{ text: string; createdAt: string | null }>, seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectWorkflowMessages(item, messages, seen);
    return;
  }
  const object = metadataObject(value);
  if (!object || isToolLikeObject(object)) return;
  if (isAgentMessageObject(object)) {
    const text = extractWorkflowText(object);
    if (text) {
      const key = `${workflowTimestamp(object) ?? ""}\n${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        messages.push({ text, createdAt: workflowTimestamp(object) });
      }
    }
    return;
  }
  for (const [key, child] of Object.entries(object)) {
    if (isToolLikeKey(key)) continue;
    collectWorkflowMessages(child, messages, seen);
  }
}

function isAgentMessageObject(object: Record<string, JsonValue>): boolean {
  const role = lowerString(object.role)
    ?? lowerString(metadataObject(object.info)?.role)
    ?? lowerString(metadataObject(object.author)?.role)
    ?? lowerString(metadataObject(object.message)?.role);
  if (role === "assistant" || role === "agent") return true;
  return false;
}

function extractWorkflowText(object: Record<string, JsonValue>): string | null {
  const parts: string[] = [];
  collectWorkflowTextParts(object, parts);
  const text = parts.join("\n").trim();
  return text || null;
}

function collectWorkflowTextParts(value: unknown, parts: string[]): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectWorkflowTextParts(item, parts);
    return;
  }
  const object = metadataObject(value);
  if (!object || isToolLikeObject(object)) return;
  if (object.synthetic === true) return;
  const type = lowerString(object.type);
  if (typeof object.text === "string" && (!type || type === "text")) parts.push(object.text);
  if (typeof object.content === "string" && (!type || type === "text")) parts.push(object.content);
  if (typeof object.body === "string" && (!type || type === "text")) parts.push(object.body);
  const part = metadataObject(object.part);
  if (part && part.synthetic !== true && !isToolLikeObject(part) && lowerString(part.type) === "text" && typeof part.text === "string") {
    parts.push(part.text);
  }
  for (const key of ["parts", "content", "messages", "children"]) {
    const child = object[key];
    if (Array.isArray(child)) {
      for (const item of child) collectWorkflowTextParts(item, parts);
    }
  }
}

function isToolLikeObject(object: Record<string, JsonValue>): boolean {
  const values = [object.type, object.kind, object.name, object.role]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  return values.some((value) => /tool|command|bash|shell|patch|diff|file|diagnostic|result/.test(value)) ||
    "toolCallId" in object ||
    "tool_call_id" in object ||
    "tool" in object;
}

function isToolLikeKey(key: string): boolean {
  return /tool|command|bash|shell|patch|diff|file|diagnostic|result/.test(key.toLowerCase());
}

function workflowTimestamp(object: Record<string, JsonValue>): string | null {
  for (const key of ["createdAt", "created_at", "timestamp", "time", "date"]) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  const info = metadataObject(object.info);
  const time = metadataObject(info?.time);
  for (const key of ["created", "updated", "completed"]) {
    const value = time?.[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return null;
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  if (start <= 0) return trimmed;
  return trimmed.slice(start);
}

function renderWorkflowSnapshotMarkdown(snapshot: ChimeraWorkflowSnapshotResult): string {
  const lines = [
    `# Chimera Workflow Snapshot ${snapshot.publicId}`,
    "",
    `Generated: ${snapshot.generatedAt}`,
    `OpenCode session: ${snapshot.opencodeSessionId}`,
    `Messages: ${snapshot.messages.length}`,
    `Limit: ${snapshot.limit}`,
    `Max message chars: ${snapshot.maxMessageChars}`,
    ""
  ];
  for (const message of snapshot.messages) {
    lines.push(`## Message ${message.ordinal}${message.createdAt ? ` (${message.createdAt})` : ""}`);
    lines.push("");
    lines.push(message.text);
    if (message.truncated) lines.push("\n[truncated]");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function councilRoundOpened(council: ChimeraCouncilStatus, round: number): boolean {
  return council.messages.some((message) => {
    const metadata = councilMetadata(message);
    return metadata.councilState === "round_opened" && metadata.round === round;
  });
}

function nextCouncilParticipant(council: ChimeraCouncilStatus, round: number): ChimeraCouncilStatus["participants"][number] | null {
  const responded = new Set(
    council.turns
      .filter((message) => councilMetadata(message).round === round)
      .map((message) => message.publicId)
  );
  return council.participants.find((participant) => participant.accepted && !responded.has(participant.publicId)) ?? null;
}

function isCouncilRoundComplete(council: ChimeraCouncilStatus, round: number): boolean {
  return nextCouncilParticipant(council, round) === null;
}

function requireOpenCouncilParticipation(db: ProteusDb, publicId: string, councilId: string): ChimeraCouncilStatus {
  requireChimeraSession(db, publicId);
  const council = getChimeraCouncil(db, councilId);
  if (council.closed) throw new Error(`Council is already closed: ${councilId}`);
  if (!council.participants.some((participant) => participant.publicId === publicId)) {
    throw new Error(`${publicId} is not an invited participant for council ${councilId}.`);
  }
  return council;
}

function metadataObject(value: unknown): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

function writeStatusFile(db: ProteusDb, session: ChimeraSessionRow, extra: unknown = {}): void {
  ensureDir(session.sessionDir);
  fs.writeFileSync(path.join(session.sessionDir, "status.json"), JSON.stringify({ session, extra }, null, 2) + "\n");
}

function chimeraMessagePollView(db: ProteusDb, message: ChimeraMessageRow): ChimeraMessagePollView {
  const metadata = metadataObject(message.metadata) ?? {};
  const fullBodyPath = chimeraMessageFullBodyPath(db, message, metadata);
  const bodyLength = message.body.length;
  const previewLimit = message.kind === "snapshot" ? 6000 : 12000;
  const bodyTruncated = bodyLength > previewLimit;
  return {
    ...message,
    body: bodyTruncated ? `${message.body.slice(0, previewLimit - 3)}...` : message.body,
    bodyLength,
    bodyTruncated,
    fullBodyPath
  };
}

function chimeraMessageFullBodyPath(db: ProteusDb, message: ChimeraMessageRow, metadata: Record<string, JsonValue>): string | null {
  const rawSnapshotPath = typeof metadata.snapshotPath === "string" ? metadata.snapshotPath : "";
  if (rawSnapshotPath) {
    return path.isAbsolute(rawSnapshotPath) ? rawSnapshotPath : path.join(db.targetRoot, rawSnapshotPath);
  }
  if (message.kind === "snapshot") {
    const session = db.getChimeraSession(message.publicId);
    return session ? path.join(session.sessionDir, "snapshot.md") : null;
  }
  return null;
}

function openCodeExportStdoutPreview(stdout: string, parsed: boolean): string {
  if (parsed) return `parsed OpenCode export (${stdout.length} chars)`;
  return truncate(stdout.trim(), 1000);
}

function clearKillFlag(session: ChimeraSessionRow): void {
  try {
    fs.rmSync(path.join(session.sessionDir, "kill.flag"), { force: true });
  } catch {
    // Best-effort; a missing or locked kill flag will be handled by the controlled run.
  }
}

function chimeraResumeHint(): string {
  return "Session is stopped, not destroyed. For the same dossier/lab, prefer chimera send --id for queued or priority steering; use chimera run --message only when intentionally starting another work cycle.";
}

function refreshChimeraRuntime(db: ProteusDb, session: ChimeraSessionRow): ChimeraSessionRow {
  return recoverChimeraRuntime(db, session).session;
}

function recoverChimeraRuntime(db: ProteusDb, session: ChimeraSessionRow): { session: ChimeraSessionRow; actions: string[] } {
  let current = db.getChimeraSession(session.publicId) ?? session;
  const actions: string[] = [];
  if (current.status === "running" || current.status === "starting") {
    const pid = current.opencodePid ?? readPidFile(path.join(current.sessionDir, "opencode", "opencode.pid"));
    if (pid && isSessionProcessAlive(pid, current.sessionDir)) {
      if (current.opencodePid !== pid || current.status !== "running") {
        current = db.updateChimeraSession({ publicId: current.publicId, status: "running", opencodePid: pid });
        actions.push(`attached live OpenCode pid ${pid}`);
        writeStatusFile(db, current, { recovery: actions, opencodePid: pid });
      }
    } else if (current.status === "starting" && startingGraceActive(current) && !hasCompletedChimeraRun(current)) {
      actions.push("kept starting status during bootstrap grace window");
    } else {
      current = db.updateChimeraSession({ publicId: current.publicId, status: "stopped", opencodePid: null });
      actions.push("recovered to stopped because no live OpenCode process was found");
      writeStatusFile(db, current, { recovery: actions });
    }
  }
  if (current.opencodeSessionId) return { session: current, actions };
  let sessionId = readOpenCodeSessionId(current) ?? readOpenCodeSessionIdFromStdout(current);
  if (!sessionId) {
    const serverUrl = current.opencodeServerUrl ?? getChimeraConfig().opencodeServerUrl;
    if (serverUrl && openCodeServerHealthy(serverUrl)) {
      sessionId = discoverOpenCodeSession(serverUrl, current);
    }
  }
  if (!sessionId) return { session: current, actions };
  const updated = db.updateChimeraSession({
    publicId: current.publicId,
    opencodeSessionId: sessionId,
    opencodeServerUrl: current.opencodeServerUrl ?? getChimeraConfig().opencodeServerUrl
  });
  actions.push(`attached OpenCode session ${sessionId}`);
  writeStatusFile(db, updated, { recovery: actions, opencodeSessionIdDiscovered: sessionId });
  return { session: updated, actions };
}

function startingGraceActive(session: ChimeraSessionRow): boolean {
  const updatedAt = Date.parse(session.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < 60_000;
}

function hasCompletedChimeraRun(session: ChimeraSessionRow): boolean {
  try {
    const runPath = path.join(session.sessionDir, "opencode", "run.json");
    const parsed = JSON.parse(fs.readFileSync(runPath, "utf8")) as { completedAt?: unknown };
    return typeof parsed.completedAt === "string" && parsed.completedAt.length > 0;
  } catch {
    return false;
  }
}

function reconcileOpenCodeSession(db: ProteusDb, session: ChimeraSessionRow): ChimeraSessionRow {
  let current = refreshChimeraRuntime(db, session);
  const config = getChimeraConfig();
  const serverUrl = current.opencodeServerUrl ?? config.opencodeServerUrl;
  if (!serverUrl || !openCodeServerHealthy(serverUrl)) return current;
  if (current.opencodeSessionId && openCodeSessionMatchesDirectory(serverUrl, current.opencodeSessionId, current)) {
    return current;
  }
  const discovered = discoverOpenCodeSession(serverUrl, current);
  const localSessionId = readOpenCodeSessionId(current) ?? readOpenCodeSessionIdFromStdout(current);
  const reconciled = discovered ?? (localSessionId && localSessionId !== current.opencodeSessionId ? localSessionId : null);
  if (!reconciled) return current;
  current = db.updateChimeraSession({
    publicId: current.publicId,
    opencodeServerUrl: serverUrl,
    opencodeSessionId: reconciled
  });
  writeStatusFile(db, current, {
    opencodeSessionIdReconciled: reconciled,
    reason: discovered
      ? "matched OpenCode session by Chimera session directory"
      : "recovered OpenCode session id from local Chimera session files after rejecting stale attached id"
  });
  return current;
}

function openCodeSessionIdPath(session: ChimeraSessionRow): string {
  return path.join(session.sessionDir, "opencode", "opencode.session-id");
}

function readOpenCodeSessionId(session: ChimeraSessionRow): string | null {
  try {
    const value = fs.readFileSync(openCodeSessionIdPath(session), "utf8").trim();
    return value.startsWith("ses") ? value : null;
  } catch {
    return null;
  }
}

function readOpenCodeSessionIdFromStdout(session: ChimeraSessionRow): string | null {
  const stdoutPath = path.join(session.sessionDir, "opencode", "stdout.log");
  try {
    const stdout = fs.readFileSync(stdoutPath, "utf8");
    const ids: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(trimmed) as { sessionID?: unknown; sessionId?: unknown };
        const id = typeof parsed.sessionID === "string"
          ? parsed.sessionID
          : typeof parsed.sessionId === "string"
            ? parsed.sessionId
            : null;
        if (id?.startsWith("ses")) ids.push(id);
      } catch {
        // Ignore non-JSON or partial streaming lines.
      }
    }
    return ids.at(-1) ?? null;
  } catch {
    return null;
  }
}

function singleActiveCampaignId(db: ProteusDb): number | null {
  const campaigns = db.listCampaigns("active");
  return campaigns.length === 1 ? campaigns[0].id : null;
}

function singleActiveRoundId(db: ProteusDb, campaignId: number | null): number | null {
  const activeRounds = db.listRounds().filter((round) => round.status === "active");
  if (activeRounds.length === 1) return activeRounds[0].id;
  if (!campaignId) return null;
  const linkedRoundIds = new Set(
    db
      .listEntityLinks({ entityType: "campaign", entityId: campaignId, limit: 1000 })
      .filter((link) => link.fromType === "campaign" && link.fromId === campaignId && link.toType === "round")
      .map((link) => link.toId)
  );
  const linkedActiveRounds = activeRounds.filter((round) => linkedRoundIds.has(round.id));
  return linkedActiveRounds.length === 1 ? linkedActiveRounds[0].id : null;
}

function requireChimeraSession(db: ProteusDb, publicId: string): ChimeraSessionRow {
  const session = db.getChimeraSession(publicId);
  if (!session) throw new Error(`Chimera session not found: ${publicId}`);
  return session;
}

function nextPublicId(db: ProteusDb): string {
  const latest = db.listChimeraSessions({ limit: 1 })[0];
  return `CH-${String((latest?.id ?? 0) + 1).padStart(4, "0")}`;
}

function nextCouncilId(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `CO-${stamp}-${suffix}`;
}

function inboxPath(db: ProteusDb, publicId: string): string {
  return path.join(requireChimeraSession(db, publicId).sessionDir, "inbox.jsonl");
}

function outboxPath(db: ProteusDb, publicId: string): string {
  return path.join(requireChimeraSession(db, publicId).sessionDir, "outbox.jsonl");
}

function writeNotificationFile(db: ProteusDb, publicId: string, message: ChimeraMessageRow): void {
  refreshNotificationFile(db, publicId, message);
}

function refreshNotificationFile(db: ProteusDb, publicId: string, latestMessage?: ChimeraMessageRow): void {
  const session = requireChimeraSession(db, publicId);
  const unreadMessages = db.listChimeraMessages({ publicId, unreadFor: "agent", limit: 500 });
  const latestUnread = unreadMessages[unreadMessages.length - 1];
  const markerMessage = latestMessage ?? latestUnread;
  fs.writeFileSync(path.join(session.sessionDir, "notifications.json"), JSON.stringify({
    pending: unreadMessages.length > 0,
    priority: unreadMessages.some(isPriorityMessage),
    unreadForAgent: unreadMessages.length,
    updatedAt: new Date().toISOString(),
    latestMessageId: markerMessage?.id ?? null,
    latestKind: markerMessage?.kind ?? null
  }, null, 2) + "\n");
}

function isPriorityMessage(message: ChimeraMessageRow): boolean {
  return typeof message.metadata === "object" &&
    message.metadata !== null &&
    !Array.isArray(message.metadata) &&
    (message.metadata as Record<string, unknown>).priority === true;
}

function notificationPendingForAgent(db: ProteusDb, publicId: string): boolean {
  try {
    const session = requireChimeraSession(db, publicId);
    const notificationPath = path.join(session.sessionDir, "notifications.json");
    const parsed = JSON.parse(fs.readFileSync(notificationPath, "utf8")) as Record<string, unknown>;
    return parsed.pending === true || Number(parsed.unreadForAgent ?? 0) > 0;
  } catch {
    return false;
  }
}

function chimeraControlStatus(db: ProteusDb, session: ChimeraSessionRow): ChimeraControlStatus {
  const unreadMessages = db.listChimeraMessages({ publicId: session.publicId, unreadFor: "agent", limit: 500 });
  const unreadForAgent = unreadMessages.length;
  const priorityPending = unreadMessages.some(isPriorityMessage);
  const deliveryState: ChimeraControlStatus["deliveryState"] = session.status === "running" || session.opencodeSessionId
      ? "live"
      : session.status === "starting"
        ? "starting"
        : "queued";
  let recommendedNextCommand: string | null = null;
  if (priorityPending) {
    if (deliveryState === "queued") {
      const latestPriority = unreadMessages.find(isPriorityMessage);
      recommendedNextCommand = `proteus chimera wake --root "${db.targetRoot}" --id ${session.publicId}${latestPriority ? ` --message-id ${latestPriority.id}` : ""}`;
    } else if (deliveryState === "starting") {
      recommendedNextCommand = `proteus chimera poll --root "${db.targetRoot}" --id ${session.publicId} --unread`;
    } else {
      recommendedNextCommand = `proteus chimera workflow-snapshot --root "${db.targetRoot}" --id ${session.publicId}`;
    }
  }
  return {
    publicId: session.publicId,
    status: session.status,
    opencodeSessionId: session.opencodeSessionId,
    unreadForAgent,
    priorityPending,
    deliveryState,
    recommendedNextCommand
  };
}

function appendJsonl(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(value) + "\n");
}

function deliverPriorityChimeraMessage(db: ProteusDb, session: ChimeraSessionRow, message: ChimeraMessageRow): ChimeraDirectDeliveryResult {
  const current = refreshChimeraRuntime(db, requireChimeraSession(db, session.publicId));
  const steer = steerOpenCodeSession(db, current, message);
  const wake = maybeWakeChimeraSession(db, current, message);
  if (!wake.attempted) return steer;
  const woke = wake.started === true;
  return {
    ...steer,
    ok: steer.ok || woke,
    mode: steer.ok ? steer.mode : "queue",
    autoWake: wake,
    detail: `${steer.detail}; ${wake.started ? `auto-wake started pid ${wake.pid ?? "unknown"}` : `auto-wake not started: ${wake.reason}`}`
  };
}

function steerOpenCodeSession(db: ProteusDb, session: ChimeraSessionRow, message: ChimeraMessageRow): ChimeraDirectDeliveryResult {
  const config = getChimeraConfig();
  const current = reconcileOpenCodeSession(db, session);
  if (!current.opencodeSessionId) {
    return { attempted: false, ok: false, mode: "none", detail: "no OpenCode session id is attached to this Chimera session" };
  }
  let serverUrl = current.opencodeServerUrl ?? config.opencodeServerUrl;
  if (!serverUrl || !openCodeServerHealthy(serverUrl)) {
    try {
      const server = ensureOpenCodeServer(db, config);
      serverUrl = server.url;
      db.updateChimeraSession({ publicId: current.publicId, opencodeServerUrl: server.url });
    } catch (error) {
      return {
        attempted: false,
        ok: false,
        mode: "none",
        ...(serverUrl ? { serverUrl } : {}),
        opencodeSessionId: current.opencodeSessionId,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }
  const prompt = renderSteerPrompt(db, current, message);
  const response = httpJson(`${trimSlash(serverUrl)}/api/session/${encodeURIComponent(current.opencodeSessionId)}/prompt`, {
    method: "POST",
    body: {
      prompt: { text: prompt },
      delivery: "steer",
      resume: true
    },
    timeoutMs: 10000
  });
  appendJsonl(path.join(current.sessionDir, "transcript.jsonl"), {
    type: "opencode_direct_steer",
    messageId: message.id,
    serverUrl,
    opencodeSessionId: current.opencodeSessionId,
    status: response.status ?? null,
    ok: response.ok,
    error: response.error ?? null
  });
  return {
    attempted: true,
    ok: response.ok,
    mode: "steer",
    serverUrl,
    opencodeSessionId: current.opencodeSessionId,
    status: response.status,
    detail: response.ok ? "sent via OpenCode delivery=steer" : response.error ?? `HTTP ${response.status ?? "unknown"}`
  };
}

function maybeWakeChimeraSession(db: ProteusDb, session: ChimeraSessionRow, message: ChimeraMessageRow): NonNullable<ChimeraDirectDeliveryResult["autoWake"]> {
  if (session.status === "running" || session.status === "starting") {
    return { attempted: false, started: false, pid: null, reason: `session is ${session.status}` };
  }
  const config = getChimeraConfig();
  const promptPath = path.join(session.sessionDir, "opencode", "prompt.md");
  if (!fs.existsSync(promptPath)) {
    return { attempted: true, started: false, pid: null, reason: `missing prompt ${promptPath}` };
  }
  const opencodeDir = path.join(session.sessionDir, "opencode");
  ensureDir(opencodeDir);
  const wakeLogPath = path.join(opencodeDir, "wake.log");
  const wakeErrPath = path.join(opencodeDir, "wake.err.log");
  const wakePidPath = path.join(opencodeDir, "wake.pid");
  const wakeArgs = [
    resolveProteusCliPath(),
    "--root",
    db.targetRoot,
    "chimera",
    "wake",
    "--id",
    session.publicId,
    "--message-id",
    String(message.id)
  ];
  const timeoutSec = resolveRunTimeoutSec(config);
  if (timeoutSec !== null) wakeArgs.push("--timeout", String(timeoutSec));
  const child = spawnHiddenBackground(process.execPath, wakeArgs, {
    cwd: session.sessionDir,
    stdoutPath: wakeLogPath,
    stderrPath: wakeErrPath,
    pidPath: wakePidPath
  });
  child.unref();
  appendJsonl(path.join(session.sessionDir, "transcript.jsonl"), {
    type: "chimera_auto_wake",
    messageId: message.id,
    pid: child.pid ?? null,
    logPath: toRelative(db.targetRoot, wakeLogPath),
    createdAt: new Date().toISOString()
  });
  return {
    attempted: true,
    started: true,
    pid: child.pid ?? null,
    reason: "priority message queued for a non-running session; compact wake started",
    logPath: toRelative(db.targetRoot, wakeLogPath)
  };
}

function isActiveChimeraStatus(session: ChimeraSessionRow): boolean {
  return session.status === "starting" || session.status === "running";
}

function enrichChimeraSessionForList(
  db: ProteusDb,
  session: ChimeraSessionRow,
  campaignMap: Map<number, CampaignRow>
): ChimeraSessionListItem {
  const campaigns = campaignIdsForChimeraSession(db, session)
    .map((id) => campaignMap.get(id))
    .filter((campaign): campaign is CampaignRow => Boolean(campaign))
    .map(publicCampaignSummary);
  return {
    ...session,
    campaigns,
    campaignLabel: campaigns.length > 0
      ? campaigns.map((campaign) => `C${campaign.id} [${campaign.status}] ${campaign.title}`).join("; ")
      : "unlinked",
    resumeHint: chimeraSessionHint(session)
  };
}

function campaignIdsForChimeraSession(db: ProteusDb, session: ChimeraSessionRow): number[] {
  const ids = new Set<number>();
  if (session.campaignId) ids.add(session.campaignId);
  for (const link of db.listEntityLinks({ entityType: "chimera_session", entityId: session.id, limit: 1000 })) {
    if (link.fromType === "campaign" && link.toType === "chimera_session" && link.toId === session.id) {
      ids.add(link.fromId);
    }
    if (link.toType === "campaign" && link.fromType === "chimera_session" && link.fromId === session.id) {
      ids.add(link.toId);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function publicCampaignSummary(campaign: CampaignRow): { id: number; title: string; status: string } {
  return { id: campaign.id, title: campaign.title, status: campaign.status };
}

function chimeraListAdvisories(activeOnly: boolean, all: boolean, activeCampaignCount: number): string[] {
  const advisories: string[] = [];
  if (activeOnly) {
    advisories.push("Active means currently starting or running. Stopped sessions are reusable but not live.");
  } else {
    advisories.push(chimeraResumeHint());
  }
  if (!all && activeCampaignCount > 0) {
    advisories.push("Default list scope is sessions linked to active campaigns. Use --all to include every historical Chimera session.");
  }
  return advisories;
}

function chimeraSessionHint(session: ChimeraSessionRow): string {
  if (session.status === "starting") {
    return "Session is starting. Use poll, workflow-snapshot after attachment, send --priority for urgent context, or kill if it should stop. Do not use run while it is starting.";
  }
  if (session.status === "running") {
    return "Session is running. Use poll, workflow-snapshot, send --priority, kill, or close. Do not use run while it is active.";
  }
  return chimeraResumeHint();
}

function renderSteerPrompt(db: ProteusDb, session: ChimeraSessionRow, message: ChimeraMessageRow): string {
  const metadata = metadataObject(message.metadata) ?? {};
  const pollCommand = `${proteusCliCommand()} --root "${db.targetRoot}" chimera poll --id ${session.publicId} --unread --agent`;
  if (message.kind === "council" && metadata.councilState === "turn_cued") {
    return [
      `Priority Proteus brainstorm council turn cue for ${session.publicId}.`,
      "This is your ordered council turn. Poll Proteus to load the canonical message, then post your council turn with the required command included in the message.",
      "Do not answer this steer notification directly in the OpenCode chat.",
      `Run first: ${pollCommand}`,
      "",
      "Council turn cue:",
      message.body
    ].join("\n");
  }
  return [
    `Priority Proteus coordinator message for ${session.publicId}.`,
    "Do not answer this notification directly unless the coordinator asked a direct question.",
    `Run: ${pollCommand}`,
    "",
    "Coordinator message:",
    message.body
  ].join("\n");
}

function renderWakePrompt(db: ProteusDb, session: ChimeraSessionRow, messageId?: number): string {
  const message = messageId ? db.getChimeraMessage(messageId) : null;
  const pollCommand = `${proteusCliCommand()} --root "${db.targetRoot}" chimera poll --id ${session.publicId} --unread --agent`;
  const councilTurn = message && message.kind === "council" && metadataObject(message.metadata)?.councilState === "turn_cued";
  return `# Proteus Chimera Priority Wake

You are ${session.publicId}. This is not a normal research run. A priority Proteus message was queued while your OpenCode session was not actively running.

Required first action:
- Run: ${pollCommand}
- If the first poll returns no messages but notifications.json still shows pending/unread, wait briefly and poll once more.

Required behavior:
- Process only the unread priority message${messageId ? ` id ${messageId}` : ""}.
- If it is a council invite, accept when ready with the exact council accept command from the message.
- If it is your ordered council turn, post exactly one council turn using the required command from the message.
- If it is a coordinator question or direct message, answer through Proteus with chimera post or the requested command.
- Do not restart broad research, do not re-run the whole original goal, and do not continue after the communication/control action is complete.
- If blocked, post a concise blocker to the coordinator and stop.

${message ? `Queued message summary:
- kind: ${message.kind}
- createdAt: ${message.createdAt}
- body:
${message.body}
` : ""}
${councilTurn ? "This wake is for an ordered council turn. Keep the reply concise, one turn only, and do not create a debate loop.\n" : ""}`;
}

function ensureOpenCodeServer(db: ProteusDb, config: ChimeraConfig): OpenCodeServerState {
  if (config.opencodeServerUrl && openCodeServerHealthy(config.opencodeServerUrl)) {
    return { url: config.opencodeServerUrl, pid: config.opencodeServerPid, started: false };
  }
  for (let port = 4096; port <= 4115; port++) {
    const url = `http://127.0.0.1:${port}`;
    if (openCodeServerHealthy(url)) {
      saveChimeraConfig({ ...config, opencodeServerUrl: url, opencodeServerPid: null });
      return { url, pid: null, started: false };
    }
    const started = startOpenCodeServerProcess(db, config, port);
    for (let attempt = 0; attempt < 20; attempt++) {
      sleepMs(250);
      if (openCodeServerHealthy(url)) {
        const next = { ...config, opencodeServerUrl: url, opencodeServerPid: started.pid };
        saveChimeraConfig(next);
        return { url, pid: started.pid, started: true };
      }
    }
    if (started.pid) {
      try {
        process.kill(started.pid);
      } catch {
        // Try the next port if this spawned server did not come up.
      }
    }
  }
  throw new Error("Could not start or find an OpenCode server on 127.0.0.1:4096-4115.");
}

function startOpenCodeServerProcess(db: ProteusDb, config: ChimeraConfig, port: number): { pid: number | null } {
  ensureDir(chimeraDir(db.targetRoot));
  const stdout = fs.openSync(path.join(chimeraDir(db.targetRoot), "opencode-server.stdout.log"), "a");
  const stderr = fs.openSync(path.join(chimeraDir(db.targetRoot), "opencode-server.stderr.log"), "a");
  const command = commandParts(config.opencodeCommand);
  const child = spawn(command.file, [...command.args, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: db.targetRoot,
    detached: true,
    stdio: ["ignore", stdout, stderr],
    shell: needsWindowsShell(command.file),
    windowsHide: true
  });
  try { fs.closeSync(stdout); } catch {}
  try { fs.closeSync(stderr); } catch {}
  child.unref();
  return { pid: child.pid ?? null };
}

function openCodeServerHealthy(url: string): boolean {
  const response = httpJson(`${trimSlash(url)}/session`, { method: "GET", timeoutMs: 3000 });
  return response.ok;
}

function discoverOpenCodeSession(serverUrl: string, session: ChimeraSessionRow): string | null {
  const sessions = listOpenCodeSessions(serverUrl);
  const normalizedSessionDir = normalizeFsPath(session.sessionDir);
  const candidates = sessions
    .filter((item) => normalizeFsPath(String(item.directory ?? "")) === normalizedSessionDir)
    .sort((a, b) => Number((b.time as { updated?: number } | undefined)?.updated ?? 0) - Number((a.time as { updated?: number } | undefined)?.updated ?? 0));
  const id = candidates[0]?.id;
  return typeof id === "string" && id.startsWith("ses") ? id : null;
}

function openCodeSessionMatchesDirectory(serverUrl: string, sessionId: string, session: ChimeraSessionRow): boolean {
  const normalizedSessionDir = normalizeFsPath(session.sessionDir);
  return listOpenCodeSessions(serverUrl).some((item) =>
    item.id === sessionId && normalizeFsPath(String(item.directory ?? "")) === normalizedSessionDir
  );
}

function listOpenCodeSessions(serverUrl: string): Record<string, unknown>[] {
  const response = httpJson(`${trimSlash(serverUrl)}/session`, { method: "GET", timeoutMs: 10000 });
  if (!response.ok || !Array.isArray(response.body)) return [];
  return response.body.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
}

function chimeraStatusAfterRun(run: ChimeraRunResult, session: ChimeraSessionRow | null): ChimeraStatus {
  if (run.exitCode === 0 || run.timedOut) return "stopped";
  if (run.killed) return "stopped";
  if (session?.opencodeSessionId || run.stdoutPreview.includes('"type":"error"')) return "stopped";
  return "stopped";
}

function httpJson(url: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): {
  ok: boolean;
  status?: number;
  body?: JsonValue | unknown;
  error?: string;
} {
  const script = `
const url = process.argv[1];
const method = process.argv[2];
const body = process.argv[3] ? JSON.parse(process.argv[3]) : undefined;
const timeoutMs = Number(process.argv[4] || 10000);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
fetch(url, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
  signal: controller.signal
}).then(async (response) => {
  clearTimeout(timer);
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status, body: parsed }));
}).catch((error) => {
  clearTimeout(timer);
  process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
});
`;
  const result = spawnSync(process.execPath, ["-e", script, url, options.method ?? "GET", options.body === undefined ? "" : JSON.stringify(options.body), String(options.timeoutMs ?? 10000)], {
    encoding: "utf8",
    timeout: (options.timeoutMs ?? 10000) + 1000
  });
  if (result.status !== 0 || !String(result.stdout ?? "").trim()) {
    return { ok: false, error: String(result.stderr || result.error?.message || `http helper exit ${result.status}`) };
  }
  try {
    return JSON.parse(String(result.stdout)) as { ok: boolean; status?: number; body?: JsonValue | unknown; error?: string };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function sleepMs(ms: number): void {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${Math.max(0, Math.floor(ms))})`]);
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    if (result.status === 0) return;
  }
  process.kill(pid);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeFsPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function commandCheck(name: string, command: string, args: string[]): { name: string; ok: boolean; detail: string } {
  if (!command.trim()) return { name, ok: false, detail: "empty command" };
  const parsed = commandParts(command);
  const result = spawnExternalSync(parsed, args, { encoding: "utf8", timeout: 10000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    name,
    ok: result.status === 0,
    detail: output || result.error?.message || `exit ${result.status}`
  };
}

function commandParts(command: string): { file: string; args: string[] } {
  const trimmed = command.trim();
  if (trimmed && fs.existsSync(trimmed)) return { file: resolveWindowsCommand(trimmed), args: [] };
  const parts = command.match(/"([^"]+)"|'([^']+)'|[^\s]+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
  if (parts.length === 0) return { file: command, args: [] };
  const joinedPrefix = longestExistingCommandPrefix(parts);
  if (joinedPrefix) return { file: resolveWindowsCommand(joinedPrefix.file), args: [...joinedPrefix.args, ...parts.slice(joinedPrefix.consumed)] };
  return { file: resolveWindowsCommand(parts[0]), args: parts.slice(1) };
}

function longestExistingCommandPrefix(parts: string[]): { file: string; args: string[]; consumed: number } | null {
  for (let consumed = parts.length; consumed > 1; consumed--) {
    const candidate = parts.slice(0, consumed).join(" ");
    if (fs.existsSync(candidate)) return { file: candidate, args: [], consumed };
    if (process.platform === "win32") {
      for (const extension of [".exe", ".cmd", ".bat"]) {
        const withExtension = `${candidate}${extension}`;
        if (fs.existsSync(withExtension)) return { file: withExtension, args: [], consumed };
      }
    }
  }
  return null;
}

function spawnExternalSync(
  command: { file: string; args: string[] },
  args: string[],
  options: Parameters<typeof spawnSync>[2]
): ReturnType<typeof spawnSync> {
  return spawnSync(command.file, [...command.args, ...args], {
    ...options,
    shell: needsWindowsShell(command.file)
  });
}

function spawnHiddenBackground(
  file: string,
  args: string[],
  options: { cwd: string; stdoutPath: string; stderrPath: string; pidPath: string }
): ReturnType<typeof spawn> {
  ensureDir(path.dirname(options.stdoutPath));
  ensureDir(path.dirname(options.stderrPath));
  if (process.platform === "win32") {
    const launchDir = path.dirname(options.stdoutPath);
    const launchId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const cmdPath = path.join(launchDir, `wake-launch-${launchId}.cmd`);
    const vbsPath = path.join(launchDir, `wake-launch-${launchId}.vbs`);
    const commandLine = [cmdQuote(file), ...args.map(cmdQuote)].join(" ");
    fs.writeFileSync(cmdPath, [
      "@echo off",
      `cd /d ${cmdQuote(options.cwd)}`,
      `${commandLine} >> ${cmdQuote(options.stdoutPath)} 2>> ${cmdQuote(options.stderrPath)}`
    ].join("\r\n") + "\r\n");
    fs.writeFileSync(vbsPath, [
      `Set shell = CreateObject("WScript.Shell")`,
      `shell.Run ${vbsQuote(cmdPath)}, 0, False`
    ].join("\r\n") + "\r\n");
    return spawn("wscript.exe", [vbsPath], {
      cwd: options.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  }
  const stdout = fs.openSync(options.stdoutPath, "a");
  const stderr = fs.openSync(options.stderrPath, "a");
  const child = spawn(file, args, {
    cwd: options.cwd,
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true
  });
  try { fs.closeSync(stdout); } catch {}
  try { fs.closeSync(stderr); } catch {}
  if (child.pid) fs.writeFileSync(options.pidPath, String(child.pid) + "\n");
  return child;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function vbsQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function runExternalControlled(command: { file: string; args: string[] }, args: string[], options: ControlledRunOptions): ControlledRunResult {
  ensureDir(path.dirname(options.stdoutPath));
  ensureDir(path.dirname(options.stderrPath));
  const input = {
    file: command.file,
    commandArgs: command.args,
    args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    killPath: options.killPath,
    pidPath: options.pidPath,
    sessionIdPath: options.sessionIdPath,
    serverUrl: options.serverUrl,
    sessionTitle: options.sessionTitle,
    sessionDir: options.sessionDir,
    stdoutPath: options.stdoutPath,
    stderrPath: options.stderrPath,
    shell: needsWindowsShell(command.file)
  };
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const input = JSON.parse(process.argv[1]);
const timeoutMs = Number(input.timeoutMs);
const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
fs.mkdirSync(path.dirname(input.stdoutPath), { recursive: true });
fs.mkdirSync(path.dirname(input.stderrPath), { recursive: true });
const stdout = fs.createWriteStream(input.stdoutPath, { flags: "w" });
const stderr = fs.createWriteStream(input.stderrPath, { flags: "w" });
let finished = false;
let timedOut = false;
let killed = false;
let status = null;
let signal = null;
let error = null;
let child = null;
let discoveredSessionId = null;
function terminateChild() {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 1500).unref();
    }
  } catch {}
}
async function discoverSession() {
  if (discoveredSessionId || !input.serverUrl) return;
  try {
    const response = await fetch(String(input.serverUrl).replace(/\\/+$/, "") + "/session");
    if (!response.ok) return;
    const sessions = await response.json();
    if (!Array.isArray(sessions)) return;
    const normalizedDir = path.resolve(input.sessionDir).toLowerCase();
    const candidates = sessions
      .filter((item) => item && typeof item === "object")
      .filter((item) => path.resolve(String(item.directory || "")).toLowerCase() === normalizedDir)
      .sort((a, b) => Number((b.time && b.time.updated) || 0) - Number((a.time && a.time.updated) || 0));
    const id = candidates[0] && candidates[0].id;
    if (typeof id === "string" && id.startsWith("ses")) {
      discoveredSessionId = id;
      fs.writeFileSync(input.sessionIdPath, id + "\\n");
    }
  } catch {}
}
function finish() {
  if (finished) return;
  finished = true;
  try {
    if (fs.existsSync(input.killPath)) killed = true;
  } catch {}
  if (timeoutTimer) clearTimeout(timeoutTimer);
  clearInterval(killPoll);
  clearInterval(sessionPoll);
  try { fs.rmSync(input.pidPath, { force: true }); } catch {}
  stdout.end();
  stderr.end();
  process.stdout.write(JSON.stringify({
    status,
    signal,
    timedOut,
    killed,
    pid: child && child.pid ? child.pid : null,
    discoveredSessionId,
    error
  }));
}
child = spawn(input.file, [...input.commandArgs, ...input.args], {
  cwd: input.cwd,
  env: process.env,
  shell: input.shell,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
if (child.pid) fs.writeFileSync(input.pidPath, String(child.pid) + "\\n");
child.stdout && child.stdout.pipe(stdout);
child.stderr && child.stderr.pipe(stderr);
child.on("error", (err) => {
  error = err && err.message ? err.message : String(err);
});
child.on("close", (code, sig) => {
  status = code;
  signal = sig || null;
  discoverSession().finally(finish);
});
const timeoutTimer = hasTimeout ? setTimeout(() => {
  timedOut = true;
  terminateChild();
}, Math.max(1, timeoutMs)) : null;
const killPoll = setInterval(() => {
  try {
    if (fs.existsSync(input.killPath)) {
      killed = true;
      terminateChild();
    }
  } catch {}
}, 250);
const sessionPoll = setInterval(() => {
  discoverSession();
}, 1000);
discoverSession();
`;
  const spawnOptions: Parameters<typeof spawnSync>[2] = {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8"
  };
  if (options.timeoutMs !== null) {
    spawnOptions.timeout = Math.max(1000, options.timeoutMs + 5000);
  }
  const result = spawnSync(process.execPath, ["-e", script, JSON.stringify(input)], spawnOptions);
  const stdout = String(result.stdout ?? "").trim();
  if (stdout) {
    try {
      return JSON.parse(stdout) as ControlledRunResult;
    } catch {
      // Fall through to the generic failure result below.
    }
  }
  return {
    status: result.status,
    signal: result.signal,
    timedOut: result.error?.name === "ETIMEDOUT",
    killed: fs.existsSync(options.killPath),
    pid: readPidFile(options.pidPath),
    error: String(result.stderr || result.error?.message || `controlled runner exit ${result.status}`)
  };
}

function readPidFile(filePath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(filePath, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EPERM");
  }
}

function isSessionProcessAlive(pid: number, sessionDir: string): boolean {
  if (!isProcessAlive(pid)) return false;
  const commandLine = processCommandLine(pid);
  if (!commandLine) return false;
  return commandLine.toLowerCase().includes(path.resolve(sessionDir).toLowerCase());
}

function processCommandLine(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`
      ], { encoding: "utf8", windowsHide: true });
      const output = String(result.stdout ?? "").trim();
      return output || null;
    }
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (fs.existsSync(cmdlinePath)) {
      return fs.readFileSync(cmdlinePath, "utf8").replace(/\0/g, " ").trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

function terminateProcess(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid);
    }
  } catch {
    // The controlled runner also watches kill.flag; a missing process is fine.
  }
}

function resolveWindowsCommand(file: string): string {
  if (process.platform !== "win32" || /[\\/]/.test(file) || path.extname(file)) return file;
  const result = spawnSync("where.exe", [file], { encoding: "utf8" });
  if (result.status !== 0) return file;
  const candidates = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const exe = candidates.find((candidate) => path.extname(candidate).toLowerCase() === ".exe");
  if (exe) return exe;
  const cmd = candidates.find((candidate) => path.extname(candidate).toLowerCase() === ".cmd");
  const cmdTarget = cmd ? resolveNpmShimTarget(cmd) : null;
  if (cmdTarget) return cmdTarget;
  return cmd ?? candidates.find((candidate) => path.extname(candidate).toLowerCase() === ".bat") ?? candidates[0] ?? file;
}

function needsWindowsShell(file: string): boolean {
  if (process.platform !== "win32") return false;
  const ext = path.extname(file).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

function resolveNpmShimTarget(cmdPath: string): string | null {
  try {
    const body = fs.readFileSync(cmdPath, "utf8");
    const match = body.match(/node_modules[\\/][^"\r\n]+?\.exe/i);
    if (!match) return null;
    const target = path.join(path.dirname(cmdPath), match[0]);
    return fs.existsSync(target) ? target : null;
  } catch {
    return null;
  }
}

function canWriteDir(dir: string): boolean {
  try {
    ensureDir(dir);
    const probe = path.join(dir, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function resolveSkillsDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "..", "plugins", "proteus", "skills"),
    path.resolve(__dirname, "..", "skills")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveProteusCliPath(): string {
  const candidates = [
    path.resolve(__dirname, "cli.js"),
    path.resolve(__dirname, "..", "dist", "cli.js")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? (process.argv[1] ?? "");
}

function proteusCliCommand(): string {
  const command = `${quoteArg(process.execPath)} ${quoteArg(resolveProteusCliPath())}`;
  return process.platform === "win32" ? `& ${command}` : command;
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function extractOpenCodeAssistantText(stdout: string): string {
  const texts: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } };
      if (event.type === "text" && event.part?.type === "text" && event.part.text?.trim()) {
        texts.push(event.part.text.trim());
      }
    } catch {
      continue;
    }
  }
  if (texts.length > 0) return truncate(texts.join("\n").trim(), 4000);
  return "OpenCode run completed. See stdout log for the full transcript.";
}

function normalizeOpenCodeVariant(variant: string | undefined, provider: string | undefined, fallback: string | null): string | null {
  return variant?.trim() || provider?.trim() || fallback;
}

function normalizeChimeraConfig(input: Partial<ChimeraConfig>): ChimeraConfig {
  return {
    enabled: input.enabled === true,
    runtime: "opencode",
    opencodeCommand: typeof input.opencodeCommand === "string" && input.opencodeCommand.trim()
      ? input.opencodeCommand.trim()
      : DEFAULT_CHIMERA_CONFIG.opencodeCommand,
    opencodeServerUrl: typeof input.opencodeServerUrl === "string" && input.opencodeServerUrl.trim()
      ? input.opencodeServerUrl.trim()
      : null,
    opencodeServerPid: Number.isFinite(input.opencodeServerPid) && Number(input.opencodeServerPid) > 0
      ? Math.floor(Number(input.opencodeServerPid))
      : null,
    defaultModel: typeof input.defaultModel === "string" && input.defaultModel.trim() ? input.defaultModel.trim() : null,
    defaultVariant: typeof input.defaultVariant === "string" && input.defaultVariant.trim() ? input.defaultVariant.trim() : null,
    defaultAgent: typeof input.defaultAgent === "string" && input.defaultAgent.trim() ? input.defaultAgent.trim() : DEFAULT_CHIMERA_CONFIG.defaultAgent,
    maxAgents: Number.isFinite(input.maxAgents) && Number(input.maxAgents) > 0 ? Math.floor(Number(input.maxAgents)) : DEFAULT_CHIMERA_CONFIG.maxAgents,
    defaultTimeoutSec: normalizeTimeoutConfig(input.defaultTimeoutSec),
    defaultNetwork: input.defaultNetwork === true,
    skipPermissions: input.skipPermissions !== false
  };
}

function normalizeTimeoutConfig(value: unknown): number {
  if (!Number.isFinite(value)) return DEFAULT_CHIMERA_CONFIG.defaultTimeoutSec;
  const seconds = Math.floor(Number(value));
  if (seconds <= 0 || seconds === LEGACY_DEFAULT_TIMEOUT_SEC) return 0;
  return seconds;
}

function resolveRunTimeoutSec(config: ChimeraConfig, override?: number): number | null {
  if (Number.isFinite(override)) {
    const seconds = Math.floor(Number(override));
    return seconds > 0 ? seconds : null;
  }
  return config.defaultTimeoutSec > 0 ? config.defaultTimeoutSec : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function lowerString(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}
