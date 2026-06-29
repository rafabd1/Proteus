"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHIMERA_CONFIG = void 0;
exports.initChimeraConfig = initChimeraConfig;
exports.saveChimeraConfig = saveChimeraConfig;
exports.getChimeraConfig = getChimeraConfig;
exports.chimeraDoctor = chimeraDoctor;
exports.stopOpenCodeServer = stopOpenCodeServer;
exports.startChimeraSession = startChimeraSession;
exports.sendChimeraMessage = sendChimeraMessage;
exports.broadcastChimeraMessage = broadcastChimeraMessage;
exports.startChimeraCouncil = startChimeraCouncil;
exports.acceptChimeraCouncil = acceptChimeraCouncil;
exports.postChimeraCouncilTurn = postChimeraCouncilTurn;
exports.cueChimeraCouncilTurn = cueChimeraCouncilTurn;
exports.openChimeraCouncilRound = openChimeraCouncilRound;
exports.getChimeraCouncil = getChimeraCouncil;
exports.closeChimeraCouncil = closeChimeraCouncil;
exports.postChimeraMessage = postChimeraMessage;
exports.snapshotChimeraSession = snapshotChimeraSession;
exports.heartbeatChimeraSession = heartbeatChimeraSession;
exports.pollChimeraMessages = pollChimeraMessages;
exports.listChimeraSessions = listChimeraSessions;
exports.recoverChimeraSession = recoverChimeraSession;
exports.killChimeraSession = killChimeraSession;
exports.closeChimeraSession = closeChimeraSession;
exports.startChimeraSwarm = startChimeraSwarm;
exports.runChimeraSession = runChimeraSession;
exports.startChimeraRunBackground = startChimeraRunBackground;
exports.wakeChimeraSession = wakeChimeraSession;
exports.attachOpenCodeSession = attachOpenCodeSession;
exports.snapshotChimeraWorkflow = snapshotChimeraWorkflow;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const paths_1 = require("./paths");
exports.DEFAULT_CHIMERA_CONFIG = {
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
function initChimeraConfig(input = {}) {
    const current = getChimeraConfig();
    const next = {
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
function saveChimeraConfig(config) {
    const configPath = (0, paths_1.globalChimeraConfigPath)();
    (0, paths_1.ensureDir)(node_path_1.default.dirname(configPath));
    node_fs_1.default.writeFileSync(configPath, JSON.stringify(normalizeChimeraConfig(config), null, 2) + "\n");
}
function getChimeraConfig() {
    const configPath = (0, paths_1.globalChimeraConfigPath)();
    if (!node_fs_1.default.existsSync(configPath))
        return exports.DEFAULT_CHIMERA_CONFIG;
    try {
        return normalizeChimeraConfig(JSON.parse(node_fs_1.default.readFileSync(configPath, "utf8")));
    }
    catch {
        return exports.DEFAULT_CHIMERA_CONFIG;
    }
}
function chimeraDoctor(db) {
    const config = getChimeraConfig();
    (0, paths_1.ensureDir)((0, paths_1.chimeraDir)(db.targetRoot));
    const checks = [
        {
            name: "enabled",
            ok: config.enabled,
            detail: config.enabled ? "Chimera is enabled globally." : "Run proteus chimera config init before starting agents."
        },
        {
            name: "chimera_dir",
            ok: canWriteDir((0, paths_1.chimeraDir)(db.targetRoot)),
            detail: (0, paths_1.chimeraDir)(db.targetRoot)
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
function stopOpenCodeServer() {
    const config = getChimeraConfig();
    let stopped = false;
    let detail = "no managed OpenCode server PID is recorded";
    if (config.opencodeServerPid) {
        try {
            terminateProcessTree(config.opencodeServerPid);
            stopped = true;
            detail = "managed OpenCode server process was signaled";
        }
        catch (error) {
            detail = error instanceof Error ? error.message : String(error);
        }
    }
    saveChimeraConfig({ ...config, opencodeServerUrl: null, opencodeServerPid: null });
    return { stopped, pid: config.opencodeServerPid, url: config.opencodeServerUrl, detail };
}
function startChimeraSession(db, input) {
    if (!input.role?.trim())
        throw new Error("Missing Chimera role.");
    if (!input.goal?.trim())
        throw new Error("Missing Chimera goal.");
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
    const sessionDir = (0, paths_1.chimeraSessionDir)(db.targetRoot, publicId);
    const labDir = node_path_1.default.join(sessionDir, "lab");
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
        metadata: { sessionDir: (0, paths_1.toRelative)(db.targetRoot, session.sessionDir) },
        readByAgent: true,
        readByCoordinator: true
    });
    const linked = linkChimeraSession(db, session);
    const shouldRunSynchronously = input.run === true && typeof input.timeoutSec === "number" && input.timeoutSec > 0;
    let updated = db.updateChimeraSession({ publicId: session.publicId, status: shouldRunSynchronously ? "running" : "ready" });
    writeStatusFile(db, updated, { linked });
    let run;
    let backgroundRun;
    if (shouldRunSynchronously) {
        run = runChimeraSession(db, updated.publicId, input.timeoutSec ?? config.defaultTimeoutSec);
        updated = db.updateChimeraSession({
            publicId: session.publicId,
            status: chimeraStatusAfterRun(run, db.getChimeraSession(session.publicId)),
            opencodePid: null
        });
        writeStatusFile(db, updated, { linked, lastRun: run });
    }
    else {
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
function sendChimeraMessage(db, publicId, body, kind = "message", options = {}) {
    const fromId = options.fromId?.trim();
    if (fromId) {
        const from = requireChimeraSession(db, fromId);
        if (from.publicId === publicId)
            throw new Error("Chimera message source and destination must differ.");
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
        : { attempted: false, ok: false, mode: "none", detail: "priority is false; stored in Proteus inbox only" };
    return { message, directDelivery };
}
function broadcastChimeraMessage(db, input) {
    const fromId = input.fromId?.trim();
    const sessions = db.listChimeraSessions({ limit: 500 });
    const delivered = [];
    const directDeliveries = [];
    const skipped = [];
    for (const session of sessions.reverse()) {
        if (fromId && session.publicId === fromId) {
            skipped.push({ publicId: session.publicId, reason: "source session" });
            continue;
        }
        if (!input.includeClosed && ["closed", "failed", "killed", "timeout"].includes(session.status)) {
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
function startChimeraCouncil(db, input) {
    const topic = input.topic.trim();
    if (!topic)
        throw new Error("Council topic is required.");
    const participants = resolveCouncilParticipants(db, input.sessionIds);
    if (participants.length === 0)
        throw new Error("No active Chimera sessions are available for council.");
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
    };
    const invitations = participants.map((session) => sendChimeraMessage(db, session.publicId, body, "council", {
        priority: true,
        metadata: {
            ...commonMetadata,
            participantId: session.publicId,
            participantRole: session.role
        }
    }));
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
function acceptChimeraCouncil(db, publicId, councilId, body) {
    requireOpenCouncilParticipation(db, publicId, councilId);
    return postChimeraMessage(db, publicId, "council", body?.trim() || `Ready for council ${councilId}.`, {
        councilId,
        councilState: "accepted"
    });
}
function postChimeraCouncilTurn(db, publicId, councilId, body, round, advance) {
    const council = requireOpenCouncilParticipation(db, publicId, councilId);
    const trimmed = body.trim();
    if (!trimmed)
        throw new Error("Council turn body is required.");
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
function cueChimeraCouncilTurn(db, publicId, councilId, round, prompt, manual) {
    if (manual !== true) {
        throw new Error("Manual cue-turn is disabled in the normal council flow. Use open-round to cue the first participant, or pass --manual only for recovery/troubleshooting.");
    }
    return cueChimeraCouncilTurnInternal(db, publicId, councilId, round, prompt);
}
function cueChimeraCouncilTurnInternal(db, publicId, councilId, round, prompt) {
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
function openChimeraCouncilRound(db, councilId, round, body, startId, autoCue = true) {
    const council = getChimeraCouncil(db, councilId);
    if (council.closed)
        throw new Error(`Council is already closed: ${councilId}`);
    const roundNumber = positiveInteger(round, 1);
    const trimmed = body.trim();
    if (!trimmed)
        throw new Error("Council round opening body is required.");
    if (councilRoundOpened(council, roundNumber)) {
        throw new Error(`Council ${councilId} round ${roundNumber} is already open.`);
    }
    const coordinatorSession = council.participants[0];
    if (!coordinatorSession)
        throw new Error(`Council has no participants: ${councilId}`);
    let firstParticipantId = null;
    if (autoCue) {
        const next = startId ? council.participants.find((participant) => participant.publicId === startId) : nextCouncilParticipant(council, roundNumber);
        if (startId && !next)
            throw new Error(`Council participant not found for startId: ${startId}`);
        if (startId && next && !next.accepted)
            throw new Error(`Council participant has not accepted yet: ${startId}`);
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
    appendJsonl(node_path_1.default.join(requireChimeraSession(db, coordinatorSession.publicId).sessionDir, "transcript.jsonl"), message);
    let firstCue = null;
    if (firstParticipantId) {
        firstCue = cueChimeraCouncilTurnInternal(db, firstParticipantId, councilId, roundNumber, "The coordinator opened this council round. It is now your ordered turn.");
    }
    return { message, firstCue, council: getChimeraCouncil(db, councilId) };
}
function getChimeraCouncil(db, councilId) {
    const messages = councilMessages(db, councilId);
    if (messages.length === 0)
        throw new Error(`Council not found: ${councilId}`);
    const invite = messages.find((message) => councilMetadata(message).councilState === "invited");
    const inviteMetadata = invite ? councilMetadata(invite) : {};
    const invitedIds = new Set();
    const participantIdsFromInvite = Array.isArray(inviteMetadata.participants)
        ? inviteMetadata.participants
            .map((item) => metadataObject(item)?.publicId)
            .filter((value) => typeof value === "string")
        : [];
    for (const id of participantIdsFromInvite)
        invitedIds.add(id);
    for (const message of messages)
        invitedIds.add(message.publicId);
    const acceptedBy = new Map();
    const turns = [];
    let closed = false;
    for (const message of messages) {
        const metadata = councilMetadata(message);
        if (metadata.councilState === "accepted")
            acceptedBy.set(message.publicId, message);
        if (metadata.councilState === "turn")
            turns.push(message);
        if (metadata.councilState === "closed")
            closed = true;
    }
    const participants = [...invitedIds]
        .map((publicId) => db.getChimeraSession(publicId))
        .filter((session) => session !== null)
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
function closeChimeraCouncil(db, councilId, summary, instruction) {
    const council = getChimeraCouncil(db, councilId);
    const trimmedSummary = summary.trim();
    if (!trimmedSummary)
        throw new Error("Council close summary is required.");
    const body = [
        `Brainstorm council ${councilId} closed.`,
        `Final coordinator decision: ${trimmedSummary}`,
        instruction?.trim() ? `Next instruction: ${instruction.trim()}` : null,
        "Resume your previous work if it is still valid, or follow the coordinator's updated instruction. Do not continue the council unless explicitly reopened."
    ].filter(Boolean).join("\n");
    const deliveries = council.participants.map((participant) => sendChimeraMessage(db, participant.publicId, body, "council", {
        priority: true,
        metadata: {
            councilId,
            councilState: "closed",
            summary: trimmedSummary,
            instruction: instruction?.trim() || null
        }
    }));
    return { council: getChimeraCouncil(db, councilId), deliveries };
}
function postChimeraMessage(db, publicId, kind, body, metadata) {
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
function snapshotChimeraSession(db, publicId, body) {
    const session = requireChimeraSession(db, publicId);
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "snapshot.md"), body.trimEnd() + "\n");
    const message = postChimeraMessage(db, publicId, "snapshot", body);
    writeStatusFile(db, session, { latestSnapshotAt: message.createdAt });
    return message;
}
function heartbeatChimeraSession(db, publicId) {
    const current = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
    const killPath = node_path_1.default.join(current.sessionDir, "kill.flag");
    const killed = node_fs_1.default.existsSync(killPath);
    const session = db.updateChimeraSession({ publicId, status: killed ? "killed" : current.status === "starting" ? "running" : current.status });
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
        alive: !killed && session.status !== "closed" && session.status !== "failed" && session.status !== "timeout",
        killed,
        session,
        killReason: killed ? node_fs_1.default.readFileSync(killPath, "utf8") : undefined
    };
}
function pollChimeraMessages(db, input) {
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
            for (const publicId of publicIds)
                refreshNotificationFile(db, publicId);
        }
    }
    const sessions = input.publicId
        ? [refreshChimeraRuntime(db, requireChimeraSession(db, input.publicId))]
        : listChimeraSessions(db, { limit: 50 });
    const latestSnapshots = sessions
        .map((session) => db.latestChimeraSnapshot(session.publicId))
        .filter((message) => message !== null)
        .map((message) => ({ publicId: message.publicId, body: message.body, createdAt: message.createdAt }));
    const controlStatus = sessions.map((session) => chimeraControlStatus(db, session));
    return { sessions, messages, latestSnapshots, controlStatus };
}
function listChimeraSessions(db, input = {}) {
    return db.listChimeraSessions(input).map((session) => refreshChimeraRuntime(db, session));
}
function recoverChimeraSession(db, publicId) {
    const recovered = recoverChimeraRuntime(db, requireChimeraSession(db, publicId));
    return {
        session: recovered.session,
        actions: recovered.actions,
        controlStatus: chimeraControlStatus(db, recovered.session)
    };
}
function killChimeraSession(db, publicId, reason) {
    const session = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "kill.flag"), reason.trimEnd() + "\n");
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
    const pid = session.opencodePid ?? readPidFile(node_path_1.default.join(session.sessionDir, "opencode", "opencode.pid"));
    if (pid)
        terminateProcess(pid);
    const updated = db.updateChimeraSession({ publicId, status: "killed", closeVerdict: "kill", closeSummary: reason });
    writeStatusFile(db, updated, { killReason: reason });
    return updated;
}
function closeChimeraSession(db, publicId, verdict, summary) {
    const current = refreshChimeraRuntime(db, requireChimeraSession(db, publicId));
    const updated = db.updateChimeraSession({ publicId, status: "closed", closeVerdict: verdict, closeSummary: summary });
    db.addChimeraMessage({
        publicId,
        direction: "system",
        kind: "close",
        body: summary,
        metadata: { verdict },
        readByAgent: true,
        readByCoordinator: true
    });
    let agentOutputId = null;
    if (current.roundId) {
        agentOutputId = db.addAgentOutput({
            roundId: current.roundId,
            codename: "cicada",
            roleFamily: `chimera:${current.role}`,
            assignedSurface: current.goal,
            outputPath: (0, paths_1.toRelative)(db.targetRoot, node_path_1.default.join(current.sessionDir, "snapshot.md")),
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
function startChimeraSwarm(db, plan) {
    const config = getChimeraConfig();
    if (!Array.isArray(plan.agents) || plan.agents.length === 0)
        throw new Error("Swarm plan must include at least one agent.");
    if (plan.agents.length > config.maxAgents) {
        throw new Error(`Swarm plan has ${plan.agents.length} agents, but config maxAgents is ${config.maxAgents}.`);
    }
    const sessions = plan.agents.map((agent) => startChimeraSession(db, {
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
    }));
    return { sessions, maxAgents: config.maxAgents };
}
function runChimeraSession(db, publicId, timeoutSec, options = {}) {
    const config = getChimeraConfig();
    const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
    if (!options.internalRun && (session.status === "running" || session.status === "starting")) {
        throw new Error(`Chimera session ${publicId} is already ${session.status}. Use poll, workflow-snapshot, send --priority, kill, or close instead of run.`);
    }
    const promptPath = node_path_1.default.join(session.sessionDir, "opencode", "prompt.md");
    if (!node_fs_1.default.existsSync(promptPath))
        throw new Error(`Missing Chimera prompt: ${promptPath}`);
    const running = db.updateChimeraSession({ publicId, status: "running" });
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
function startChimeraRunBackground(db, publicId, timeoutSec, options = {}) {
    const config = getChimeraConfig();
    const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
    if (session.status === "running" || session.status === "starting") {
        throw new Error(`Chimera session ${publicId} is already ${session.status}. Use priority steer only.`);
    }
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    (0, paths_1.ensureDir)(opencodeDir);
    const backgroundLogPath = node_path_1.default.join(opencodeDir, "background-run.log");
    const backgroundErrPath = node_path_1.default.join(opencodeDir, "background-run.err.log");
    const backgroundPidPath = node_path_1.default.join(opencodeDir, "background-run.pid");
    const resolvedTimeout = resolveRunTimeoutSec(config, timeoutSec);
    const starting = db.updateChimeraSession({
        publicId: session.publicId,
        status: "starting",
        opencodePid: null
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
    if (resolvedTimeout !== null)
        args.push("--timeout", String(resolvedTimeout));
    if (options.instruction?.trim())
        args.push("--message", options.instruction.trim());
    const child = spawnHiddenBackground(process.execPath, args, {
        cwd: session.sessionDir,
        stdoutPath: backgroundLogPath,
        stderrPath: backgroundErrPath,
        pidPath: backgroundPidPath
    });
    child.unref();
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), {
        type: "chimera_background_run",
        publicId: starting.publicId,
        pid: child.pid ?? null,
        timeoutSec: resolvedTimeout,
        instruction: options.instruction?.trim() ? true : false,
        logPath: (0, paths_1.toRelative)(db.targetRoot, backgroundLogPath),
        stderrPath: (0, paths_1.toRelative)(db.targetRoot, backgroundErrPath),
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
function wakeChimeraSession(db, publicId, input = {}) {
    const config = getChimeraConfig();
    const session = recoverChimeraRuntime(db, requireChimeraSession(db, publicId)).session;
    if (session.status === "running" || session.status === "starting") {
        throw new Error(`Chimera session ${publicId} is already ${session.status}. Use priority steer only.`);
    }
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    (0, paths_1.ensureDir)(opencodeDir);
    const promptPath = node_path_1.default.join(opencodeDir, `wake-${input.messageId ?? "latest"}.md`);
    node_fs_1.default.writeFileSync(promptPath, renderWakePrompt(db, session, input.messageId));
    const running = db.updateChimeraSession({ publicId, status: "running" });
    writeStatusFile(db, running, { wakeStartedAt: new Date().toISOString(), wakeMessageId: input.messageId ?? null });
    const run = runOpenCodeOnce(db, running, promptPath, config, resolveRunTimeoutSec(config, input.timeoutSec), `Priority Proteus wake for ${session.publicId}. Read the attached wake instructions, poll Proteus unread messages immediately, perform only the requested communication/control action, then stop.`);
    const updated = db.updateChimeraSession({
        publicId,
        status: chimeraStatusAfterRun(run, db.getChimeraSession(publicId)),
        opencodePid: null
    });
    writeStatusFile(db, updated, { lastWakeRun: run, wakeMessageId: input.messageId ?? null });
    return run;
}
function attachOpenCodeSession(db, publicId, input) {
    const current = requireChimeraSession(db, publicId);
    const config = getChimeraConfig();
    const serverUrl = nullableString(input.serverUrl, current.opencodeServerUrl ?? config.opencodeServerUrl);
    const opencodeSessionId = nullableString(input.opencodeSessionId, current.opencodeSessionId);
    if (!serverUrl)
        throw new Error(`OpenCode server URL is required to attach Chimera session ${publicId}.`);
    if (!opencodeSessionId)
        throw new Error(`OpenCode session id is required to attach Chimera session ${publicId}.`);
    if (!openCodeServerHealthy(serverUrl))
        throw new Error(`OpenCode server is not reachable or healthy: ${serverUrl}`);
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
function snapshotChimeraWorkflow(db, publicId, input = {}) {
    const session = reconcileOpenCodeSession(db, requireChimeraSession(db, publicId));
    if (!session.opencodeSessionId) {
        throw new Error(`Chimera session ${publicId} has no attached OpenCode session id. Run or attach OpenCode first.`);
    }
    const limit = Math.max(1, Math.min(50, positiveInteger(input.limit, 8)));
    const maxMessageChars = Math.max(80, Math.min(8000, positiveInteger(input.maxMessageChars, 1200)));
    const command = commandParts(session.opencodeCommand || getChimeraConfig().opencodeCommand);
    const result = exportOpenCodeSession(command, session);
    const stdout = String(result.stdout ?? "");
    const stderr = String(result.stderr ?? "");
    if (result.status !== 0) {
        throw new Error(`OpenCode export failed for ${session.opencodeSessionId}: ${truncate(stderr || result.error?.message || `exit ${result.status}`, 1000)}`);
    }
    let exported;
    try {
        exported = JSON.parse(extractJsonObject(stdout));
    }
    catch (error) {
        throw new Error(`OpenCode export did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
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
    const outDir = node_path_1.default.join(session.sessionDir, "opencode", "workflow-snapshots");
    (0, paths_1.ensureDir)(outDir);
    const stamp = generatedAt.replace(/\D/g, "").slice(0, 14);
    const jsonPath = node_path_1.default.join(outDir, `${stamp}.json`);
    const markdownPath = node_path_1.default.join(outDir, `${stamp}.md`);
    const snapshot = {
        publicId,
        opencodeSessionId: session.opencodeSessionId,
        generatedAt,
        limit,
        maxMessageChars,
        messages,
        files: { jsonPath, markdownPath },
        export: {
            exitCode: result.status,
            stderrPreview: truncate(stderr.trim(), 1000)
        }
    };
    node_fs_1.default.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + "\n");
    node_fs_1.default.writeFileSync(markdownPath, renderWorkflowSnapshotMarkdown(snapshot));
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), {
        type: "workflow_snapshot",
        generatedAt,
        opencodeSessionId: session.opencodeSessionId,
        messageCount: messages.length,
        jsonPath: (0, paths_1.toRelative)(db.targetRoot, jsonPath),
        markdownPath: (0, paths_1.toRelative)(db.targetRoot, markdownPath)
    });
    return snapshot;
}
function exportOpenCodeSession(command, session) {
    return spawnExternalSync(command, ["export", String(session.opencodeSessionId)], {
        cwd: session.sessionDir,
        encoding: "utf8",
        timeout: 30000
    });
}
function createSessionFiles(db, session, config) {
    (0, paths_1.ensureDir)((0, paths_1.chimeraSessionsDir)(db.targetRoot));
    (0, paths_1.ensureDir)(session.sessionDir);
    (0, paths_1.ensureDir)(session.labDir);
    for (const dir of ["poc", "scripts", "evidence"])
        (0, paths_1.ensureDir)(node_path_1.default.join(session.labDir, dir));
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    (0, paths_1.ensureDir)(opencodeDir);
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, "skills"));
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, ".opencode", "agents"));
    (0, paths_1.ensureDir)(node_path_1.default.join(session.sessionDir, ".opencode", "skills"));
    const target = db.getTarget();
    const contract = renderContract(db, session, config);
    const instructions = renderAgentInstructions(db, session);
    const dossier = renderDossier(db, session, target?.name ?? "unknown target");
    const prompt = [dossier, contract, instructions].join("\n\n");
    const paths = {
        sessionDir: session.sessionDir,
        labDir: session.labDir,
        dossierPath: node_path_1.default.join(session.sessionDir, "dossier.md"),
        promptPath: node_path_1.default.join(opencodeDir, "prompt.md"),
        contractPath: node_path_1.default.join(session.sessionDir, "contract.md"),
        instructionsPath: node_path_1.default.join(session.sessionDir, "agent-instructions.md")
    };
    node_fs_1.default.writeFileSync(paths.dossierPath, dossier);
    node_fs_1.default.writeFileSync(paths.contractPath, contract);
    node_fs_1.default.writeFileSync(paths.instructionsPath, instructions);
    node_fs_1.default.writeFileSync(paths.promptPath, prompt);
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.labDir, "README.md"), renderLabReadme(session));
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.labDir, "notes.md"), `# ${session.publicId} Notes\n\n`);
    for (const jsonl of ["inbox.jsonl", "outbox.jsonl", "transcript.jsonl"])
        node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, jsonl), "");
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "notifications.json"), JSON.stringify({
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
function runOpenCodeOnce(db, session, promptPath, config, timeoutSec, finalInstruction) {
    const server = ensureOpenCodeServer(db, config);
    const current = requireChimeraSession(db, session.publicId);
    const attachedSessionId = current.opencodeSessionId && openCodeSessionMatchesDirectory(server.url, current.opencodeSessionId, session)
        ? current.opencodeSessionId
        : null;
    if (current.opencodeSessionId && !attachedSessionId) {
        appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), {
            type: "opencode_session_id_ignored",
            publicId: session.publicId,
            opencodeSessionId: current.opencodeSessionId,
            reason: "attached OpenCode session id did not match this Chimera session directory",
            createdAt: new Date().toISOString()
        });
    }
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    const stdoutPath = node_path_1.default.join(opencodeDir, "stdout.log");
    const stderrPath = node_path_1.default.join(opencodeDir, "stderr.log");
    const runPath = node_path_1.default.join(opencodeDir, "run.json");
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
    }
    else {
        args.push("--title", `proteus-${session.publicId}`);
    }
    if (session.model)
        args.push("--model", session.model);
    if (session.provider)
        args.push("--variant", session.provider);
    if (config.skipPermissions)
        args.push("--dangerously-skip-permissions");
    args.push(finalInstruction ?? `Run the attached Proteus Chimera dossier for ${session.publicId}. Start by loading available Proteus skills if the skill tool is available, then execute only the assigned goal. Poll Proteus messages before long work and post a concise final snapshot.`);
    const startedAt = new Date().toISOString();
    const command = commandParts(config.opencodeCommand);
    const killPath = node_path_1.default.join(session.sessionDir, "kill.flag");
    const pidPath = node_path_1.default.join(opencodeDir, "opencode.pid");
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
    const stdout = node_fs_1.default.existsSync(stdoutPath) ? node_fs_1.default.readFileSync(stdoutPath, "utf8") : "";
    const stderr = node_fs_1.default.existsSync(stderrPath) ? node_fs_1.default.readFileSync(stderrPath, "utf8") : "";
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
    node_fs_1.default.writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), { type: "opencode_run", ...run });
    const stdoutSessionId = readOpenCodeSessionIdFromStdout(session);
    const fileSessionId = readOpenCodeSessionId(session) ?? stdoutSessionId;
    if (stdoutSessionId && !node_fs_1.default.existsSync(sessionIdPath))
        node_fs_1.default.writeFileSync(sessionIdPath, stdoutSessionId + "\n");
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
            metadata: { source: "opencode_stdout", stdoutPath: (0, paths_1.toRelative)(db.targetRoot, stdoutPath) },
            readByAgent: true
        });
    }
    if (stderr.trim()) {
        db.addChimeraMessage({
            publicId: session.publicId,
            direction: "system",
            kind: "error",
            body: truncate(stderr.trim(), 4000),
            metadata: { source: "opencode_stderr", stderrPath: (0, paths_1.toRelative)(db.targetRoot, stderrPath) },
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
function renderRunInstruction(session, instruction) {
    const trimmed = instruction?.trim();
    const lines = [
        `Continue the existing Proteus Chimera session ${session.publicId}.`,
        "Reuse the persisted dossier, contract, lab, skills, Proteus memory, OpenCode session history, and current assigned scope instead of treating this as a brand new co-agent.",
        "Poll Proteus messages before long work, dedupe against local Proteus memory before deep work, and post a concise final snapshot when the run completes or blocks."
    ];
    if (trimmed) {
        lines.push("", "Coordinator instruction for this run:", trimmed);
    }
    else {
        lines.push("", "No extra coordinator instruction was provided for this run. Continue the existing goal and stop condition with the next high-ROI move.");
    }
    return lines.join("\n");
}
function renderDossier(db, session, targetName) {
    const campaign = session.campaignId ? db.getCampaign(session.campaignId) : null;
    const round = session.roundId ? db.getRound(session.roundId) : null;
    const activeCampaigns = db.listCampaigns("active").slice(0, 3);
    return `# Chimera Dossier ${session.publicId}

Target: ${targetName}
Role: ${session.role}
Goal: ${session.goal}
Campaign: ${campaign ? `C${campaign.id} ${campaign.title}` : "none"}
Round: ${round ? `R${round.id} ${round.objective}` : "none"}
Session dir: ${(0, paths_1.toRelative)(db.targetRoot, session.sessionDir)}
Lab dir: ${(0, paths_1.toRelative)(db.targetRoot, session.labDir)}

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
function renderContract(db, session, config) {
    const proteusCommand = proteusCliCommand();
    return `# Chimera Contract

You are a secondary Proteus Chimera co-agent, not an ordinary lightweight subagent. The coordinator remains the final authority for strategy, validation gates, promotion, reporting, and campaign state. Your role is to run a complete, independent research front that brings a different angle while staying inside the assigned scope.

Required behavior:
- Read dossier.md, contract.md, agent-instructions.md, skills/README.md, and injected skills/*.md before acting.
- Reconstruct the research context before substantial work: target, campaign/hypothesis, why this front exists, known killed paths, constraints, intended strategy, applicable Proteus heuristics, and expected output.
- Confirm the assigned campaign and round before recording research state: campaign=${session.campaignId ? `C${session.campaignId}` : "none"}, round=${session.roundId ? `R${session.roundId}` : "none"}. Use ${proteusCommand} --root "${db.targetRoot}" campaign resume${session.campaignId ? ` --id ${session.campaignId}` : ""} for context when available.
- Respect access mode ${session.accessMode}: ${accessLine(session)}
- Shell is available to Chimera sessions, but it is not blanket approval. Use shell only for the assigned research goal, obey the coordinator restrictions, avoid destructive commands, and keep generated artifacts in the Chimera lab.
- By default, create and edit files only inside your own Chimera lab: ${(0, paths_1.toRelative)(db.targetRoot, session.labDir)}. Do not create, edit, move, or delete files elsewhere in the workspace unless editor-mode restrictions explicitly name the allowed path and action.
- Use ${(0, paths_1.toRelative)(db.targetRoot, session.labDir)} for notes, scripts, PoC material, and evidence even when broader access is granted.
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
function renderAgentInstructions(db, session) {
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
function renderLabReadme(session) {
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
function accessLine(session) {
    if (session.accessMode === "editor") {
        return `Editor mode grants shell plus OpenCode edit permission. You still create/edit only inside the Chimera lab unless these coordinator restrictions explicitly name another allowed path and action: ${session.accessNotes}`;
    }
    const notes = session.accessNotes ? ` Coordinator restrictions: ${session.accessNotes}` : "";
    return `Explorer mode grants shell for read-only inspection and lab-local work, but repository edits are out of scope. Write notes, scripts, PoC material, and evidence only inside the Chimera lab.${notes}`;
}
function copySkillFiles(session) {
    const skillsDir = resolveSkillsDir();
    if (!skillsDir)
        return;
    const available = listAvailableSkillNames(skillsDir);
    const wanted = new Set(["chimera-agent", ...skillsForRole(session.role, available)]);
    const injected = [];
    for (const name of wanted) {
        const source = node_path_1.default.join(skillsDir, name, "SKILL.md");
        if (!node_fs_1.default.existsSync(source))
            continue;
        linkOrCopyFile(source, node_path_1.default.join(session.sessionDir, "skills", `${name}.md`));
        const opencodeSkillDir = node_path_1.default.join(session.sessionDir, ".opencode", "skills", name);
        linkOrCopyDir(node_path_1.default.dirname(source), opencodeSkillDir);
        injected.push(name);
    }
    const index = renderChimeraSkillsIndex(session, skillsDir, available, injected);
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "skills", "README.md"), index);
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, ".opencode", "skills", "README.md"), index);
}
function linkOrCopyFile(source, destination) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(destination));
    try {
        if (node_fs_1.default.existsSync(destination) && node_fs_1.default.lstatSync(destination).isSymbolicLink())
            node_fs_1.default.unlinkSync(destination);
        if (!node_fs_1.default.existsSync(destination))
            node_fs_1.default.symlinkSync(source, destination, "file");
        return;
    }
    catch {
        node_fs_1.default.copyFileSync(source, destination);
    }
}
function linkOrCopyDir(source, destination) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(destination));
    try {
        if (node_fs_1.default.existsSync(destination) && node_fs_1.default.lstatSync(destination).isSymbolicLink())
            node_fs_1.default.unlinkSync(destination);
        if (!node_fs_1.default.existsSync(destination))
            node_fs_1.default.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
        return;
    }
    catch {
        (0, paths_1.ensureDir)(destination);
        node_fs_1.default.copyFileSync(node_path_1.default.join(source, "SKILL.md"), node_path_1.default.join(destination, "SKILL.md"));
    }
}
function listAvailableSkillNames(skillsDir) {
    return node_fs_1.default
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => node_fs_1.default.existsSync(node_path_1.default.join(skillsDir, name, "SKILL.md")))
        .sort();
}
function skillsForRole(role, available) {
    if (role === "generalist") {
        return available.filter((name) => name !== "continuous-vuln-research" && name !== "chimera-agent");
    }
    return available.includes(role) ? [role] : [];
}
function renderChimeraSkillsIndex(session, skillsDir, available, copied) {
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
    for (const name of copied)
        lines.push(`- ${name}: injected at skills/${name}.md`);
    if (copied.length === 0)
        lines.push("- none");
    lines.push("", "## Available In Proteus Package", "");
    for (const name of available) {
        if (coordinatorOnly.has(name)) {
            lines.push(`- ${name}: coordinator-only, not for Chimera co-agents`);
        }
        else if (copiedSet.has(name)) {
            lines.push(`- ${name}: injected`);
        }
        else {
            lines.push(`- ${name}: ${node_path_1.default.join(skillsDir, name, "SKILL.md")}; ask the coordinator to launch or redirect a role-specific co-agent when this expertise is needed`);
        }
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
}
function writeOpenCodeAgentFile(session, config) {
    const agentName = config.defaultAgent ?? "proteus-chimera";
    const permissions = session.accessMode === "editor"
        ? ["bash", "read", "edit", "glob", "grep", "skill", "lsp"]
        : ["bash", "read", "glob", "grep", "skill", "lsp"];
    if (config.defaultNetwork)
        permissions.push("webfetch", "websearch");
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
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, ".opencode", "agents", `${agentName}.md`), agent);
}
function linkChimeraSession(db, session) {
    const linked = [];
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
    }
    else {
        const auto = db.linkActiveCampaignTo({
            toType: "chimera_session",
            toId: session.id,
            relation: "has_chimera_session",
            eventType: "chimera_started",
            eventSummary: `Started ${session.publicId} (${session.role}): ${session.goal}`
        });
        if (auto)
            linked.push({ entityType: "entity_link", entityId: auto.linkId });
    }
    return linked;
}
function resolveCouncilParticipants(db, sessionIds) {
    const closedStatuses = new Set(["closed", "failed", "killed", "timeout"]);
    if (sessionIds && sessionIds.length > 0) {
        return sessionIds
            .map((id) => requireChimeraSession(db, id))
            .filter((session) => !closedStatuses.has(session.status));
    }
    return db
        .listChimeraSessions({ limit: 500 })
        .filter((session) => !closedStatuses.has(session.status))
        .reverse();
}
function councilMessages(db, councilId) {
    return db
        .listChimeraMessages({ limit: 2000 })
        .filter((message) => councilMetadata(message).councilId === councilId);
}
function councilMetadata(message) {
    return metadataObject(message.metadata) ?? {};
}
function renderCouncilTranscript(council) {
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
        .filter((line) => line !== null);
    if (lines.length === 0)
        return "- no accepts or turns recorded yet";
    return lines.slice(-40).join("\n");
}
function extractWorkflowMessages(value) {
    const direct = extractOpenCodeExportMessages(value);
    if (direct.length > 0)
        return direct;
    const messages = [];
    const seen = new Set();
    collectWorkflowMessages(value, messages, seen);
    return messages.filter((message) => message.text.trim().length > 0);
}
function extractOpenCodeExportMessages(value) {
    const root = metadataObject(value);
    if (!root || !Array.isArray(root.messages))
        return [];
    const messages = [];
    for (const rawMessage of root.messages) {
        const message = metadataObject(rawMessage);
        if (!message)
            continue;
        const info = metadataObject(message?.info);
        const role = lowerString(info?.role);
        if (role !== "assistant" && role !== "agent")
            continue;
        const parts = [
            ...(Array.isArray(message?.parts) ? message.parts : []),
            ...(Array.isArray(message?.content) ? message.content : [])
        ];
        const texts = [];
        for (const rawPart of parts) {
            const part = metadataObject(rawPart);
            if (!part || part.synthetic === true)
                continue;
            if (lowerString(part.type) !== "text")
                continue;
            if (typeof part.text === "string" && part.text.trim())
                texts.push(part.text.trim());
        }
        const text = compactWhitespace(texts.join("\n"));
        if (!text)
            continue;
        messages.push({ text, createdAt: workflowTimestamp(message) });
    }
    return messages;
}
function collectWorkflowMessages(value, messages, seen) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectWorkflowMessages(item, messages, seen);
        return;
    }
    const object = metadataObject(value);
    if (!object || isToolLikeObject(object))
        return;
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
        if (isToolLikeKey(key))
            continue;
        collectWorkflowMessages(child, messages, seen);
    }
}
function isAgentMessageObject(object) {
    const role = lowerString(object.role)
        ?? lowerString(metadataObject(object.info)?.role)
        ?? lowerString(metadataObject(object.author)?.role)
        ?? lowerString(metadataObject(object.message)?.role);
    if (role === "assistant" || role === "agent")
        return true;
    return false;
}
function extractWorkflowText(object) {
    const parts = [];
    collectWorkflowTextParts(object, parts);
    const text = parts.join("\n").trim();
    return text || null;
}
function collectWorkflowTextParts(value, parts) {
    if (typeof value === "string")
        return;
    if (Array.isArray(value)) {
        for (const item of value)
            collectWorkflowTextParts(item, parts);
        return;
    }
    const object = metadataObject(value);
    if (!object || isToolLikeObject(object))
        return;
    if (object.synthetic === true)
        return;
    const type = lowerString(object.type);
    if (typeof object.text === "string" && (!type || type === "text"))
        parts.push(object.text);
    if (typeof object.content === "string" && (!type || type === "text"))
        parts.push(object.content);
    if (typeof object.body === "string" && (!type || type === "text"))
        parts.push(object.body);
    const part = metadataObject(object.part);
    if (part && part.synthetic !== true && !isToolLikeObject(part) && lowerString(part.type) === "text" && typeof part.text === "string") {
        parts.push(part.text);
    }
    for (const key of ["parts", "content", "messages", "children"]) {
        const child = object[key];
        if (Array.isArray(child)) {
            for (const item of child)
                collectWorkflowTextParts(item, parts);
        }
    }
}
function isToolLikeObject(object) {
    const values = [object.type, object.kind, object.name, object.role]
        .filter((value) => typeof value === "string")
        .map((value) => value.toLowerCase());
    return values.some((value) => /tool|command|bash|shell|patch|diff|file|diagnostic|result/.test(value)) ||
        "toolCallId" in object ||
        "tool_call_id" in object ||
        "tool" in object;
}
function isToolLikeKey(key) {
    return /tool|command|bash|shell|patch|diff|file|diagnostic|result/.test(key.toLowerCase());
}
function workflowTimestamp(object) {
    for (const key of ["createdAt", "created_at", "timestamp", "time", "date"]) {
        const value = object[key];
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number" && Number.isFinite(value))
            return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
    }
    const info = metadataObject(object.info);
    const time = metadataObject(info?.time);
    for (const key of ["created", "updated", "completed"]) {
        const value = time?.[key];
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number" && Number.isFinite(value))
            return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
    }
    return null;
}
function extractJsonObject(value) {
    const trimmed = value.trim();
    const start = trimmed.indexOf("{");
    if (start <= 0)
        return trimmed;
    return trimmed.slice(start);
}
function renderWorkflowSnapshotMarkdown(snapshot) {
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
        if (message.truncated)
            lines.push("\n[truncated]");
        lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
}
function councilRoundOpened(council, round) {
    return council.messages.some((message) => {
        const metadata = councilMetadata(message);
        return metadata.councilState === "round_opened" && metadata.round === round;
    });
}
function nextCouncilParticipant(council, round) {
    const responded = new Set(council.turns
        .filter((message) => councilMetadata(message).round === round)
        .map((message) => message.publicId));
    return council.participants.find((participant) => participant.accepted && !responded.has(participant.publicId)) ?? null;
}
function isCouncilRoundComplete(council, round) {
    return nextCouncilParticipant(council, round) === null;
}
function requireOpenCouncilParticipation(db, publicId, councilId) {
    requireChimeraSession(db, publicId);
    const council = getChimeraCouncil(db, councilId);
    if (council.closed)
        throw new Error(`Council is already closed: ${councilId}`);
    if (!council.participants.some((participant) => participant.publicId === publicId)) {
        throw new Error(`${publicId} is not an invited participant for council ${councilId}.`);
    }
    return council;
}
function metadataObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function writeStatusFile(db, session, extra = {}) {
    (0, paths_1.ensureDir)(session.sessionDir);
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "status.json"), JSON.stringify({ session, extra }, null, 2) + "\n");
}
function refreshChimeraRuntime(db, session) {
    return recoverChimeraRuntime(db, session).session;
}
function recoverChimeraRuntime(db, session) {
    let current = db.getChimeraSession(session.publicId) ?? session;
    const actions = [];
    if (current.status === "running" || current.status === "starting") {
        const pid = current.opencodePid ?? readPidFile(node_path_1.default.join(current.sessionDir, "opencode", "opencode.pid"));
        if (pid && isSessionProcessAlive(pid, current.sessionDir)) {
            if (current.opencodePid !== pid || current.status !== "running") {
                current = db.updateChimeraSession({ publicId: current.publicId, status: "running", opencodePid: pid });
                actions.push(`attached live OpenCode pid ${pid}`);
                writeStatusFile(db, current, { recovery: actions, opencodePid: pid });
            }
        }
        else if (current.status === "starting" && startingGraceActive(current) && !hasCompletedChimeraRun(current)) {
            actions.push("kept starting status during bootstrap grace window");
        }
        else {
            current = db.updateChimeraSession({ publicId: current.publicId, status: "waiting", opencodePid: null });
            actions.push("recovered to waiting because no live OpenCode process was found");
            writeStatusFile(db, current, { recovery: actions });
        }
    }
    if (current.opencodeSessionId)
        return { session: current, actions };
    let sessionId = readOpenCodeSessionId(current) ?? readOpenCodeSessionIdFromStdout(current);
    if (!sessionId) {
        const serverUrl = current.opencodeServerUrl ?? getChimeraConfig().opencodeServerUrl;
        if (serverUrl && openCodeServerHealthy(serverUrl)) {
            sessionId = discoverOpenCodeSession(serverUrl, current);
        }
    }
    if (!sessionId)
        return { session: current, actions };
    const updated = db.updateChimeraSession({
        publicId: current.publicId,
        opencodeSessionId: sessionId,
        opencodeServerUrl: current.opencodeServerUrl ?? getChimeraConfig().opencodeServerUrl
    });
    actions.push(`attached OpenCode session ${sessionId}`);
    writeStatusFile(db, updated, { recovery: actions, opencodeSessionIdDiscovered: sessionId });
    return { session: updated, actions };
}
function startingGraceActive(session) {
    const updatedAt = Date.parse(session.updatedAt);
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 60_000;
}
function hasCompletedChimeraRun(session) {
    try {
        const runPath = node_path_1.default.join(session.sessionDir, "opencode", "run.json");
        const parsed = JSON.parse(node_fs_1.default.readFileSync(runPath, "utf8"));
        return typeof parsed.completedAt === "string" && parsed.completedAt.length > 0;
    }
    catch {
        return false;
    }
}
function reconcileOpenCodeSession(db, session) {
    let current = refreshChimeraRuntime(db, session);
    const config = getChimeraConfig();
    const serverUrl = current.opencodeServerUrl ?? config.opencodeServerUrl;
    if (!serverUrl || !openCodeServerHealthy(serverUrl))
        return current;
    if (current.opencodeSessionId && openCodeSessionMatchesDirectory(serverUrl, current.opencodeSessionId, current)) {
        return current;
    }
    const discovered = discoverOpenCodeSession(serverUrl, current);
    if (!discovered)
        return current;
    current = db.updateChimeraSession({
        publicId: current.publicId,
        opencodeServerUrl: serverUrl,
        opencodeSessionId: discovered
    });
    writeStatusFile(db, current, {
        opencodeSessionIdReconciled: discovered,
        reason: "matched OpenCode session by Chimera session directory"
    });
    return current;
}
function openCodeSessionIdPath(session) {
    return node_path_1.default.join(session.sessionDir, "opencode", "opencode.session-id");
}
function readOpenCodeSessionId(session) {
    try {
        const value = node_fs_1.default.readFileSync(openCodeSessionIdPath(session), "utf8").trim();
        return value.startsWith("ses") ? value : null;
    }
    catch {
        return null;
    }
}
function readOpenCodeSessionIdFromStdout(session) {
    const stdoutPath = node_path_1.default.join(session.sessionDir, "opencode", "stdout.log");
    try {
        const stdout = node_fs_1.default.readFileSync(stdoutPath, "utf8");
        const ids = [];
        for (const line of stdout.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("{"))
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                const id = typeof parsed.sessionID === "string"
                    ? parsed.sessionID
                    : typeof parsed.sessionId === "string"
                        ? parsed.sessionId
                        : null;
                if (id?.startsWith("ses"))
                    ids.push(id);
            }
            catch {
                // Ignore non-JSON or partial streaming lines.
            }
        }
        return ids.at(-1) ?? null;
    }
    catch {
        return null;
    }
}
function singleActiveCampaignId(db) {
    const campaigns = db.listCampaigns("active");
    return campaigns.length === 1 ? campaigns[0].id : null;
}
function singleActiveRoundId(db, campaignId) {
    const activeRounds = db.listRounds().filter((round) => round.status === "active");
    if (activeRounds.length === 1)
        return activeRounds[0].id;
    if (!campaignId)
        return null;
    const linkedRoundIds = new Set(db
        .listEntityLinks({ entityType: "campaign", entityId: campaignId, limit: 1000 })
        .filter((link) => link.fromType === "campaign" && link.fromId === campaignId && link.toType === "round")
        .map((link) => link.toId));
    const linkedActiveRounds = activeRounds.filter((round) => linkedRoundIds.has(round.id));
    return linkedActiveRounds.length === 1 ? linkedActiveRounds[0].id : null;
}
function requireChimeraSession(db, publicId) {
    const session = db.getChimeraSession(publicId);
    if (!session)
        throw new Error(`Chimera session not found: ${publicId}`);
    return session;
}
function nextPublicId(db) {
    const latest = db.listChimeraSessions({ limit: 1 })[0];
    return `CH-${String((latest?.id ?? 0) + 1).padStart(4, "0")}`;
}
function nextCouncilId() {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 6);
    return `CO-${stamp}-${suffix}`;
}
function inboxPath(db, publicId) {
    return node_path_1.default.join(requireChimeraSession(db, publicId).sessionDir, "inbox.jsonl");
}
function outboxPath(db, publicId) {
    return node_path_1.default.join(requireChimeraSession(db, publicId).sessionDir, "outbox.jsonl");
}
function writeNotificationFile(db, publicId, message) {
    refreshNotificationFile(db, publicId, message);
}
function refreshNotificationFile(db, publicId, latestMessage) {
    const session = requireChimeraSession(db, publicId);
    const unreadMessages = db.listChimeraMessages({ publicId, unreadFor: "agent", limit: 500 });
    const latestUnread = unreadMessages[unreadMessages.length - 1];
    const markerMessage = latestMessage ?? latestUnread;
    node_fs_1.default.writeFileSync(node_path_1.default.join(session.sessionDir, "notifications.json"), JSON.stringify({
        pending: unreadMessages.length > 0,
        priority: unreadMessages.some(isPriorityMessage),
        unreadForAgent: unreadMessages.length,
        updatedAt: new Date().toISOString(),
        latestMessageId: markerMessage?.id ?? null,
        latestKind: markerMessage?.kind ?? null
    }, null, 2) + "\n");
}
function isPriorityMessage(message) {
    return typeof message.metadata === "object" &&
        message.metadata !== null &&
        !Array.isArray(message.metadata) &&
        message.metadata.priority === true;
}
function notificationPendingForAgent(db, publicId) {
    try {
        const session = requireChimeraSession(db, publicId);
        const notificationPath = node_path_1.default.join(session.sessionDir, "notifications.json");
        const parsed = JSON.parse(node_fs_1.default.readFileSync(notificationPath, "utf8"));
        return parsed.pending === true || Number(parsed.unreadForAgent ?? 0) > 0;
    }
    catch {
        return false;
    }
}
function chimeraControlStatus(db, session) {
    const unreadMessages = db.listChimeraMessages({ publicId: session.publicId, unreadFor: "agent", limit: 500 });
    const unreadForAgent = unreadMessages.length;
    const priorityPending = unreadMessages.some(isPriorityMessage);
    const closed = ["closed", "failed", "killed", "timeout"].includes(session.status);
    const deliveryState = closed
        ? "closed"
        : session.status === "running" || session.opencodeSessionId
            ? "live"
            : session.status === "starting"
                ? "starting"
                : "queued";
    let recommendedNextCommand = null;
    if (!closed && priorityPending) {
        if (deliveryState === "queued") {
            const latestPriority = unreadMessages.find(isPriorityMessage);
            recommendedNextCommand = `proteus chimera wake --root "${db.targetRoot}" --id ${session.publicId}${latestPriority ? ` --message-id ${latestPriority.id}` : ""}`;
        }
        else if (deliveryState === "starting") {
            recommendedNextCommand = `proteus chimera poll --root "${db.targetRoot}" --id ${session.publicId} --unread`;
        }
        else {
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
function appendJsonl(filePath, value) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(filePath));
    node_fs_1.default.appendFileSync(filePath, JSON.stringify(value) + "\n");
}
function deliverPriorityChimeraMessage(db, session, message) {
    const current = refreshChimeraRuntime(db, requireChimeraSession(db, session.publicId));
    const steer = steerOpenCodeSession(db, current, message);
    const wake = maybeWakeChimeraSession(db, current, message);
    if (!wake.attempted)
        return steer;
    return {
        ...steer,
        autoWake: wake,
        detail: `${steer.detail}; ${wake.started ? `auto-wake started pid ${wake.pid ?? "unknown"}` : `auto-wake not started: ${wake.reason}`}`
    };
}
function steerOpenCodeSession(db, session, message) {
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
        }
        catch (error) {
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
    appendJsonl(node_path_1.default.join(current.sessionDir, "transcript.jsonl"), {
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
function maybeWakeChimeraSession(db, session, message) {
    if (session.status === "running" || session.status === "starting") {
        return { attempted: false, started: false, pid: null, reason: `session is ${session.status}` };
    }
    if (session.status === "closed" || session.status === "killed" || session.status === "failed") {
        return { attempted: false, started: false, pid: null, reason: `session is ${session.status}` };
    }
    const config = getChimeraConfig();
    const promptPath = node_path_1.default.join(session.sessionDir, "opencode", "prompt.md");
    if (!node_fs_1.default.existsSync(promptPath)) {
        return { attempted: true, started: false, pid: null, reason: `missing prompt ${promptPath}` };
    }
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    (0, paths_1.ensureDir)(opencodeDir);
    const wakeLogPath = node_path_1.default.join(opencodeDir, "wake.log");
    const wakeErrPath = node_path_1.default.join(opencodeDir, "wake.err.log");
    const wakePidPath = node_path_1.default.join(opencodeDir, "wake.pid");
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
    if (timeoutSec !== null)
        wakeArgs.push("--timeout", String(timeoutSec));
    const child = spawnHiddenBackground(process.execPath, wakeArgs, {
        cwd: session.sessionDir,
        stdoutPath: wakeLogPath,
        stderrPath: wakeErrPath,
        pidPath: wakePidPath
    });
    child.unref();
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), {
        type: "chimera_auto_wake",
        messageId: message.id,
        pid: child.pid ?? null,
        logPath: (0, paths_1.toRelative)(db.targetRoot, wakeLogPath),
        createdAt: new Date().toISOString()
    });
    return {
        attempted: true,
        started: true,
        pid: child.pid ?? null,
        reason: "priority message queued for a non-running session; compact wake started",
        logPath: (0, paths_1.toRelative)(db.targetRoot, wakeLogPath)
    };
}
function renderSteerPrompt(db, session, message) {
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
function renderWakePrompt(db, session, messageId) {
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
function ensureOpenCodeServer(db, config) {
    if (config.opencodeServerUrl && openCodeServerHealthy(config.opencodeServerUrl)) {
        return { url: config.opencodeServerUrl, pid: config.opencodeServerPid, started: false };
    }
    for (let port = 4096; port <= 4115; port++) {
        const url = `http://127.0.0.1:${port}`;
        if (openCodeServerHealthy(url)) {
            continue;
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
            }
            catch {
                // Try the next port if this spawned server did not come up.
            }
        }
    }
    throw new Error("Could not start or find an OpenCode server on 127.0.0.1:4096-4115.");
}
function startOpenCodeServerProcess(db, config, port) {
    (0, paths_1.ensureDir)((0, paths_1.chimeraDir)(db.targetRoot));
    const stdout = node_fs_1.default.openSync(node_path_1.default.join((0, paths_1.chimeraDir)(db.targetRoot), "opencode-server.stdout.log"), "a");
    const stderr = node_fs_1.default.openSync(node_path_1.default.join((0, paths_1.chimeraDir)(db.targetRoot), "opencode-server.stderr.log"), "a");
    const command = commandParts(config.opencodeCommand);
    const child = (0, node_child_process_1.spawn)(command.file, [...command.args, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: db.targetRoot,
        detached: true,
        stdio: ["ignore", stdout, stderr],
        shell: needsWindowsShell(command.file),
        windowsHide: true
    });
    try {
        node_fs_1.default.closeSync(stdout);
    }
    catch { }
    try {
        node_fs_1.default.closeSync(stderr);
    }
    catch { }
    child.unref();
    return { pid: child.pid ?? null };
}
function openCodeServerHealthy(url) {
    const response = httpJson(`${trimSlash(url)}/session`, { method: "GET", timeoutMs: 3000 });
    return response.ok;
}
function discoverOpenCodeSession(serverUrl, session) {
    const sessions = listOpenCodeSessions(serverUrl);
    const normalizedSessionDir = normalizeFsPath(session.sessionDir);
    const candidates = sessions
        .filter((item) => normalizeFsPath(String(item.directory ?? "")) === normalizedSessionDir)
        .sort((a, b) => Number(b.time?.updated ?? 0) - Number(a.time?.updated ?? 0));
    const id = candidates[0]?.id;
    return typeof id === "string" && id.startsWith("ses") ? id : null;
}
function openCodeSessionMatchesDirectory(serverUrl, sessionId, session) {
    const normalizedSessionDir = normalizeFsPath(session.sessionDir);
    return listOpenCodeSessions(serverUrl).some((item) => item.id === sessionId && normalizeFsPath(String(item.directory ?? "")) === normalizedSessionDir);
}
function listOpenCodeSessions(serverUrl) {
    const response = httpJson(`${trimSlash(serverUrl)}/session`, { method: "GET", timeoutMs: 10000 });
    if (!response.ok || !Array.isArray(response.body))
        return [];
    return response.body.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
}
function chimeraStatusAfterRun(run, session) {
    if (run.exitCode === 0 || run.timedOut)
        return "waiting";
    if (run.killed)
        return "killed";
    if (session?.opencodeSessionId || run.stdoutPreview.includes('"type":"error"'))
        return "waiting";
    return "failed";
}
function httpJson(url, options = {}) {
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
    const result = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", script, url, options.method ?? "GET", options.body === undefined ? "" : JSON.stringify(options.body), String(options.timeoutMs ?? 10000)], {
        encoding: "utf8",
        timeout: (options.timeoutMs ?? 10000) + 1000
    });
    if (result.status !== 0 || !String(result.stdout ?? "").trim()) {
        return { ok: false, error: String(result.stderr || result.error?.message || `http helper exit ${result.status}`) };
    }
    try {
        return JSON.parse(String(result.stdout));
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
function sleepMs(ms) {
    (0, node_child_process_1.spawnSync)(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${Math.max(0, Math.floor(ms))})`]);
}
function terminateProcessTree(pid) {
    if (process.platform === "win32") {
        const result = (0, node_child_process_1.spawnSync)("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        if (result.status === 0)
            return;
    }
    process.kill(pid);
}
function trimSlash(value) {
    return value.replace(/\/+$/, "");
}
function normalizeFsPath(value) {
    return node_path_1.default.resolve(value).toLowerCase();
}
function commandCheck(name, command, args) {
    if (!command.trim())
        return { name, ok: false, detail: "empty command" };
    const parsed = commandParts(command);
    const result = spawnExternalSync(parsed, args, { encoding: "utf8", timeout: 10000 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return {
        name,
        ok: result.status === 0,
        detail: output || result.error?.message || `exit ${result.status}`
    };
}
function commandParts(command) {
    const trimmed = command.trim();
    if (trimmed && node_fs_1.default.existsSync(trimmed))
        return { file: resolveWindowsCommand(trimmed), args: [] };
    const parts = command.match(/"([^"]+)"|'([^']+)'|[^\s]+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
    if (parts.length === 0)
        return { file: command, args: [] };
    const joinedPrefix = longestExistingCommandPrefix(parts);
    if (joinedPrefix)
        return { file: resolveWindowsCommand(joinedPrefix.file), args: [...joinedPrefix.args, ...parts.slice(joinedPrefix.consumed)] };
    return { file: resolveWindowsCommand(parts[0]), args: parts.slice(1) };
}
function longestExistingCommandPrefix(parts) {
    for (let consumed = parts.length; consumed > 1; consumed--) {
        const candidate = parts.slice(0, consumed).join(" ");
        if (node_fs_1.default.existsSync(candidate))
            return { file: candidate, args: [], consumed };
        if (process.platform === "win32") {
            for (const extension of [".exe", ".cmd", ".bat"]) {
                const withExtension = `${candidate}${extension}`;
                if (node_fs_1.default.existsSync(withExtension))
                    return { file: withExtension, args: [], consumed };
            }
        }
    }
    return null;
}
function spawnExternalSync(command, args, options) {
    return (0, node_child_process_1.spawnSync)(command.file, [...command.args, ...args], {
        ...options,
        shell: needsWindowsShell(command.file)
    });
}
function spawnHiddenBackground(file, args, options) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(options.stdoutPath));
    (0, paths_1.ensureDir)(node_path_1.default.dirname(options.stderrPath));
    if (process.platform === "win32") {
        const launchDir = node_path_1.default.dirname(options.stdoutPath);
        const launchId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        const cmdPath = node_path_1.default.join(launchDir, `wake-launch-${launchId}.cmd`);
        const vbsPath = node_path_1.default.join(launchDir, `wake-launch-${launchId}.vbs`);
        const commandLine = [cmdQuote(file), ...args.map(cmdQuote)].join(" ");
        node_fs_1.default.writeFileSync(cmdPath, [
            "@echo off",
            `cd /d ${cmdQuote(options.cwd)}`,
            `${commandLine} >> ${cmdQuote(options.stdoutPath)} 2>> ${cmdQuote(options.stderrPath)}`
        ].join("\r\n") + "\r\n");
        node_fs_1.default.writeFileSync(vbsPath, [
            `Set shell = CreateObject("WScript.Shell")`,
            `shell.Run ${vbsQuote(cmdPath)}, 0, False`
        ].join("\r\n") + "\r\n");
        return (0, node_child_process_1.spawn)("wscript.exe", [vbsPath], {
            cwd: options.cwd,
            detached: true,
            stdio: "ignore",
            windowsHide: true
        });
    }
    const stdout = node_fs_1.default.openSync(options.stdoutPath, "a");
    const stderr = node_fs_1.default.openSync(options.stderrPath, "a");
    const child = (0, node_child_process_1.spawn)(file, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ["ignore", stdout, stderr],
        windowsHide: true
    });
    try {
        node_fs_1.default.closeSync(stdout);
    }
    catch { }
    try {
        node_fs_1.default.closeSync(stderr);
    }
    catch { }
    if (child.pid)
        node_fs_1.default.writeFileSync(options.pidPath, String(child.pid) + "\n");
    return child;
}
function cmdQuote(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function vbsQuote(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function runExternalControlled(command, args, options) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(options.stdoutPath));
    (0, paths_1.ensureDir)(node_path_1.default.dirname(options.stderrPath));
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
    const spawnOptions = {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8"
    };
    if (options.timeoutMs !== null) {
        spawnOptions.timeout = Math.max(1000, options.timeoutMs + 5000);
    }
    const result = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", script, JSON.stringify(input)], spawnOptions);
    const stdout = String(result.stdout ?? "").trim();
    if (stdout) {
        try {
            return JSON.parse(stdout);
        }
        catch {
            // Fall through to the generic failure result below.
        }
    }
    return {
        status: result.status,
        signal: result.signal,
        timedOut: result.error?.name === "ETIMEDOUT",
        killed: node_fs_1.default.existsSync(options.killPath),
        pid: readPidFile(options.pidPath),
        error: String(result.stderr || result.error?.message || `controlled runner exit ${result.status}`)
    };
}
function readPidFile(filePath) {
    try {
        const pid = Number(node_fs_1.default.readFileSync(filePath, "utf8").trim());
        return Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : null;
    }
    catch {
        return null;
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
    }
}
function isSessionProcessAlive(pid, sessionDir) {
    if (!isProcessAlive(pid))
        return false;
    const commandLine = processCommandLine(pid);
    if (!commandLine)
        return false;
    return commandLine.toLowerCase().includes(node_path_1.default.resolve(sessionDir).toLowerCase());
}
function processCommandLine(pid) {
    try {
        if (process.platform === "win32") {
            const result = (0, node_child_process_1.spawnSync)("powershell.exe", [
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
        if (node_fs_1.default.existsSync(cmdlinePath)) {
            return node_fs_1.default.readFileSync(cmdlinePath, "utf8").replace(/\0/g, " ").trim() || null;
        }
    }
    catch {
        return null;
    }
    return null;
}
function terminateProcess(pid) {
    try {
        if (process.platform === "win32") {
            (0, node_child_process_1.spawnSync)("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        }
        else {
            process.kill(pid);
        }
    }
    catch {
        // The controlled runner also watches kill.flag; a missing process is fine.
    }
}
function resolveWindowsCommand(file) {
    if (process.platform !== "win32" || /[\\/]/.test(file) || node_path_1.default.extname(file))
        return file;
    const result = (0, node_child_process_1.spawnSync)("where.exe", [file], { encoding: "utf8" });
    if (result.status !== 0)
        return file;
    const candidates = String(result.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const exe = candidates.find((candidate) => node_path_1.default.extname(candidate).toLowerCase() === ".exe");
    if (exe)
        return exe;
    const cmd = candidates.find((candidate) => node_path_1.default.extname(candidate).toLowerCase() === ".cmd");
    const cmdTarget = cmd ? resolveNpmShimTarget(cmd) : null;
    if (cmdTarget)
        return cmdTarget;
    return cmd ?? candidates.find((candidate) => node_path_1.default.extname(candidate).toLowerCase() === ".bat") ?? candidates[0] ?? file;
}
function needsWindowsShell(file) {
    if (process.platform !== "win32")
        return false;
    const ext = node_path_1.default.extname(file).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
}
function resolveNpmShimTarget(cmdPath) {
    try {
        const body = node_fs_1.default.readFileSync(cmdPath, "utf8");
        const match = body.match(/node_modules[\\/][^"\r\n]+?\.exe/i);
        if (!match)
            return null;
        const target = node_path_1.default.join(node_path_1.default.dirname(cmdPath), match[0]);
        return node_fs_1.default.existsSync(target) ? target : null;
    }
    catch {
        return null;
    }
}
function canWriteDir(dir) {
    try {
        (0, paths_1.ensureDir)(dir);
        const probe = node_path_1.default.join(dir, ".write-probe");
        node_fs_1.default.writeFileSync(probe, "ok");
        node_fs_1.default.rmSync(probe, { force: true });
        return true;
    }
    catch {
        return false;
    }
}
function resolveSkillsDir() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "..", "plugins", "proteus", "skills"),
        node_path_1.default.resolve(__dirname, "..", "skills")
    ];
    return candidates.find((candidate) => node_fs_1.default.existsSync(candidate)) ?? null;
}
function resolveProteusCliPath() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "cli.js"),
        node_path_1.default.resolve(__dirname, "..", "dist", "cli.js")
    ];
    return candidates.find((candidate) => node_fs_1.default.existsSync(candidate)) ?? (process.argv[1] ?? "");
}
function proteusCliCommand() {
    const command = `${quoteArg(process.execPath)} ${quoteArg(resolveProteusCliPath())}`;
    return process.platform === "win32" ? `& ${command}` : command;
}
function quoteArg(value) {
    return `"${value.replace(/"/g, '\\"')}"`;
}
function extractOpenCodeAssistantText(stdout) {
    const texts = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith("{"))
            continue;
        try {
            const event = JSON.parse(line);
            if (event.type === "text" && event.part?.type === "text" && event.part.text?.trim()) {
                texts.push(event.part.text.trim());
            }
        }
        catch {
            continue;
        }
    }
    if (texts.length > 0)
        return truncate(texts.join("\n").trim(), 4000);
    return "OpenCode run completed. See stdout log for the full transcript.";
}
function normalizeOpenCodeVariant(variant, provider, fallback) {
    return variant?.trim() || provider?.trim() || fallback;
}
function normalizeChimeraConfig(input) {
    return {
        enabled: input.enabled === true,
        runtime: "opencode",
        opencodeCommand: typeof input.opencodeCommand === "string" && input.opencodeCommand.trim()
            ? input.opencodeCommand.trim()
            : exports.DEFAULT_CHIMERA_CONFIG.opencodeCommand,
        opencodeServerUrl: typeof input.opencodeServerUrl === "string" && input.opencodeServerUrl.trim()
            ? input.opencodeServerUrl.trim()
            : null,
        opencodeServerPid: Number.isFinite(input.opencodeServerPid) && Number(input.opencodeServerPid) > 0
            ? Math.floor(Number(input.opencodeServerPid))
            : null,
        defaultModel: typeof input.defaultModel === "string" && input.defaultModel.trim() ? input.defaultModel.trim() : null,
        defaultVariant: typeof input.defaultVariant === "string" && input.defaultVariant.trim() ? input.defaultVariant.trim() : null,
        defaultAgent: typeof input.defaultAgent === "string" && input.defaultAgent.trim() ? input.defaultAgent.trim() : exports.DEFAULT_CHIMERA_CONFIG.defaultAgent,
        maxAgents: Number.isFinite(input.maxAgents) && Number(input.maxAgents) > 0 ? Math.floor(Number(input.maxAgents)) : exports.DEFAULT_CHIMERA_CONFIG.maxAgents,
        defaultTimeoutSec: normalizeTimeoutConfig(input.defaultTimeoutSec),
        defaultNetwork: input.defaultNetwork === true,
        skipPermissions: input.skipPermissions !== false
    };
}
function normalizeTimeoutConfig(value) {
    if (!Number.isFinite(value))
        return exports.DEFAULT_CHIMERA_CONFIG.defaultTimeoutSec;
    const seconds = Math.floor(Number(value));
    if (seconds <= 0 || seconds === LEGACY_DEFAULT_TIMEOUT_SEC)
        return 0;
    return seconds;
}
function resolveRunTimeoutSec(config, override) {
    if (Number.isFinite(override)) {
        const seconds = Math.floor(Number(override));
        return seconds > 0 ? seconds : null;
    }
    return config.defaultTimeoutSec > 0 ? config.defaultTimeoutSec : null;
}
function stringOr(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function nullableString(value, fallback) {
    if (value === null)
        return null;
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function nullableNumber(value, fallback) {
    if (value === null)
        return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function lowerString(value) {
    return typeof value === "string" ? value.toLowerCase() : null;
}
function compactWhitespace(value) {
    return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function truncate(value, limit) {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}
