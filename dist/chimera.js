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
exports.killChimeraSession = killChimeraSession;
exports.closeChimeraSession = closeChimeraSession;
exports.startChimeraSwarm = startChimeraSwarm;
exports.runChimeraSession = runChimeraSession;
exports.attachOpenCodeSession = attachOpenCodeSession;
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
    defaultTimeoutSec: 900,
    defaultNetwork: false,
    skipPermissions: true
};
function initChimeraConfig(db, input = {}) {
    const current = db.getChimeraConfig() ?? exports.DEFAULT_CHIMERA_CONFIG;
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
        defaultTimeoutSec: positiveInteger(input.defaultTimeoutSec, current.defaultTimeoutSec),
        defaultNetwork: input.defaultNetwork ?? current.defaultNetwork,
        skipPermissions: input.skipPermissions ?? current.skipPermissions
    };
    saveChimeraConfig(db, next);
    return next;
}
function saveChimeraConfig(db, config) {
    db.saveChimeraConfig(config);
    (0, paths_1.ensureDir)((0, paths_1.chimeraDir)(db.targetRoot));
    node_fs_1.default.writeFileSync(node_path_1.default.join((0, paths_1.chimeraDir)(db.targetRoot), "config.json"), JSON.stringify(config, null, 2) + "\n");
}
function getChimeraConfig(db) {
    return db.getChimeraConfig() ?? exports.DEFAULT_CHIMERA_CONFIG;
}
function chimeraDoctor(db) {
    const config = getChimeraConfig(db);
    (0, paths_1.ensureDir)((0, paths_1.chimeraDir)(db.targetRoot));
    const checks = [
        {
            name: "enabled",
            ok: config.enabled,
            detail: config.enabled ? "Chimera is enabled." : "Run proteus chimera config init before starting agents."
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
function stopOpenCodeServer(db) {
    const config = getChimeraConfig(db);
    let stopped = false;
    let detail = "no managed OpenCode server PID is recorded";
    if (config.opencodeServerPid) {
        try {
            process.kill(config.opencodeServerPid);
            stopped = true;
            detail = "managed OpenCode server process was signaled";
        }
        catch (error) {
            detail = error instanceof Error ? error.message : String(error);
        }
    }
    saveChimeraConfig(db, { ...config, opencodeServerUrl: null, opencodeServerPid: null });
    return { stopped, pid: config.opencodeServerPid, url: config.opencodeServerUrl, detail };
}
function startChimeraSession(db, input) {
    if (!input.role?.trim())
        throw new Error("Missing Chimera role.");
    if (!input.goal?.trim())
        throw new Error("Missing Chimera goal.");
    const config = getChimeraConfig(db);
    if (!config.enabled) {
        throw new Error("Chimera is disabled. Run `proteus chimera config init` first.");
    }
    const publicId = nextPublicId(db);
    const sessionDir = (0, paths_1.chimeraSessionDir)(db.targetRoot, publicId);
    const labDir = node_path_1.default.join(sessionDir, "lab");
    const session = db.createChimeraSession({
        publicId,
        campaignId: input.campaignId ?? null,
        roundId: input.roundId ?? null,
        role: input.role.trim(),
        goal: input.goal.trim(),
        accessMode: input.accessMode ?? "lab",
        accessNotes: input.accessNotes ?? null,
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
    let updated = db.updateChimeraSession({ publicId: session.publicId, status: input.run ? "running" : "waiting" });
    writeStatusFile(db, updated, { linked });
    let run;
    if (input.run) {
        run = runChimeraSession(db, updated.publicId, input.timeoutSec ?? config.defaultTimeoutSec);
        updated = db.updateChimeraSession({
            publicId: session.publicId,
            status: run.exitCode === 0 ? "waiting" : run.timedOut ? "timeout" : "failed"
        });
        writeStatusFile(db, updated, { linked, lastRun: run });
    }
    return {
        session: updated,
        config,
        paths,
        run,
        nextSuggestedReads: [
            `proteus chimera poll --id ${session.publicId} --unread`,
            `proteus chimera send --id ${session.publicId} --message "..."`
        ]
    };
}
function sendChimeraMessage(db, publicId, body, kind = "message", options = {}) {
    const session = requireChimeraSession(db, publicId);
    const message = db.addChimeraMessage({
        publicId,
        direction: "coordinator_to_agent",
        kind,
        body,
        metadata: { ...(options.metadata ?? {}), priority: options.priority === true },
        readByCoordinator: true,
        readByAgent: false
    });
    appendJsonl(inboxPath(db, publicId), message);
    writeNotificationFile(db, publicId, message);
    const directDelivery = options.priority === true
        ? steerOpenCodeSession(db, session, message)
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
            directDeliveries.push({ publicId: session.publicId, result: steerOpenCodeSession(db, session, message) });
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
        `When ready: proteus chimera council accept --id <your CH-ID> --council-id ${councilId} --body "ready"`,
        `During the council, wait for your turn and send exactly one concise observation for the current round: proteus chimera council turn --id <your CH-ID> --council-id ${councilId} --round 1 --body "...".`,
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
            `proteus chimera council status --council-id ${councilId}`,
            `proteus chimera poll --unread`
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
    if (council.turns.some((message) => message.publicId === publicId && councilMetadata(message).round === roundNumber)) {
        throw new Error(`${publicId} already posted a council turn for ${councilId} round ${roundNumber}. Use the next round only if the coordinator extends the council.`);
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
        `${proteusCliCommand()} --root "${db.targetRoot}" chimera council turn --id ${publicId} --council-id ${councilId} --round ${roundNumber} --body "..."`,
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
    const coordinatorSession = council.participants[0];
    if (!coordinatorSession)
        throw new Error(`Council has no participants: ${councilId}`);
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
    const updatedCouncil = getChimeraCouncil(db, councilId);
    let firstCue = null;
    if (autoCue) {
        const next = startId ? updatedCouncil.participants.find((participant) => participant.publicId === startId) : nextCouncilParticipant(updatedCouncil, roundNumber);
        if (next) {
            firstCue = cueChimeraCouncilTurnInternal(db, next.publicId, councilId, roundNumber, "The coordinator opened this council round. It is now your ordered turn.");
        }
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
    const current = requireChimeraSession(db, publicId);
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
    const messages = db.listChimeraMessages({
        publicId: input.publicId,
        unreadFor,
        limit: input.limit
    });
    if (input.unreadOnly && !input.peek) {
        db.markChimeraMessagesRead(messages.map((message) => message.id), input.forAgent ? "agent" : "coordinator");
        if (input.forAgent) {
            const publicIds = new Set(messages.map((message) => message.publicId));
            for (const publicId of publicIds)
                refreshNotificationFile(db, publicId);
        }
    }
    const sessions = input.publicId
        ? [requireChimeraSession(db, input.publicId)]
        : db.listChimeraSessions({ limit: 50 });
    const latestSnapshots = sessions
        .map((session) => db.latestChimeraSnapshot(session.publicId))
        .filter((message) => message !== null)
        .map((message) => ({ publicId: message.publicId, body: message.body, createdAt: message.createdAt }));
    return { sessions, messages, latestSnapshots };
}
function killChimeraSession(db, publicId, reason) {
    const session = requireChimeraSession(db, publicId);
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
    if (session.opencodePid) {
        try {
            process.kill(session.opencodePid);
        }
        catch {
            // The process may have already exited. The kill flag remains authoritative.
        }
    }
    const updated = db.updateChimeraSession({ publicId, status: "killed", closeVerdict: "kill", closeSummary: reason });
    writeStatusFile(db, updated, { killReason: reason });
    return updated;
}
function closeChimeraSession(db, publicId, verdict, summary) {
    const current = requireChimeraSession(db, publicId);
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
    const config = getChimeraConfig(db);
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
function runChimeraSession(db, publicId, timeoutSec) {
    const config = getChimeraConfig(db);
    const session = requireChimeraSession(db, publicId);
    const promptPath = node_path_1.default.join(session.sessionDir, "opencode", "prompt.md");
    if (!node_fs_1.default.existsSync(promptPath))
        throw new Error(`Missing Chimera prompt: ${promptPath}`);
    const running = db.updateChimeraSession({ publicId, status: "running" });
    writeStatusFile(db, running, { runStartedAt: new Date().toISOString() });
    const run = runOpenCodeOnce(db, running, promptPath, config, timeoutSec ?? config.defaultTimeoutSec);
    const updated = db.updateChimeraSession({
        publicId,
        status: run.exitCode === 0 ? "waiting" : run.timedOut ? "timeout" : "failed"
    });
    writeStatusFile(db, updated, { lastRun: run });
    return run;
}
function attachOpenCodeSession(db, publicId, input) {
    const current = requireChimeraSession(db, publicId);
    const config = getChimeraConfig(db);
    const serverUrl = nullableString(input.serverUrl, current.opencodeServerUrl ?? config.opencodeServerUrl);
    const opencodeSessionId = nullableString(input.opencodeSessionId, current.opencodeSessionId);
    const updated = db.updateChimeraSession({
        publicId,
        opencodeServerUrl: serverUrl,
        opencodeSessionId
    });
    if (serverUrl && serverUrl !== config.opencodeServerUrl) {
        saveChimeraConfig(db, { ...config, opencodeServerUrl: serverUrl });
    }
    writeStatusFile(db, updated, { opencodeAttached: true });
    return updated;
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
function runOpenCodeOnce(db, session, promptPath, config, timeoutSec) {
    const server = ensureOpenCodeServer(db, config);
    const current = requireChimeraSession(db, session.publicId);
    const opencodeDir = node_path_1.default.join(session.sessionDir, "opencode");
    const stdoutPath = node_path_1.default.join(opencodeDir, "stdout.log");
    const stderrPath = node_path_1.default.join(opencodeDir, "stderr.log");
    const runPath = node_path_1.default.join(opencodeDir, "run.json");
    const args = [
        "run",
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
    if (current.opencodeSessionId) {
        args.push("--session", current.opencodeSessionId);
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
    args.push(`Run the attached Proteus Chimera dossier for ${session.publicId}. Start by loading available Proteus skills if the skill tool is available, then execute only the assigned goal. Poll Proteus messages before long work and post a concise final snapshot.`);
    const startedAt = new Date().toISOString();
    const command = commandParts(config.opencodeCommand);
    const result = spawnExternalSync(command, args, {
        cwd: session.sessionDir,
        encoding: "utf8",
        timeout: timeoutSec * 1000,
        env: {
            ...process.env,
            PROTEUS_CHIMERA_SESSION_ID: session.publicId,
            PROTEUS_CHIMERA_SESSION_DIR: session.sessionDir,
            PROTEUS_CHIMERA_LAB_DIR: session.labDir,
            PROTEUS_CHIMERA_ACCESS_MODE: session.accessMode,
            PROTEUS_TARGET_ROOT: db.targetRoot
        }
    });
    const stdout = String(result.stdout ?? "");
    const stderr = String(result.stderr ?? "");
    node_fs_1.default.writeFileSync(stdoutPath, stdout);
    node_fs_1.default.writeFileSync(stderrPath, stderr);
    const run = {
        startedAt,
        completedAt: new Date().toISOString(),
        command: command.file,
        args: [...command.args, ...args],
        exitCode: result.status,
        signal: result.signal,
        timedOut: result.error?.name === "ETIMEDOUT",
        error: result.error ? String(result.error.message) : null
    };
    node_fs_1.default.writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), { type: "opencode_run", ...run });
    const discovered = discoverOpenCodeSession(server.url, session);
    const updated = db.updateChimeraSession({
        publicId: session.publicId,
        opencodeServerUrl: server.url,
        opencodeSessionId: discovered ?? current.opencodeSessionId
    });
    writeStatusFile(db, updated, { lastOpenCodeDiscovery: { serverUrl: server.url, opencodeSessionId: discovered ?? current.opencodeSessionId } });
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
        stdoutPath,
        stderrPath,
        runPath,
        stdoutPreview: truncate(stdout.trim(), 1000),
        stderrPreview: truncate(stderr.trim(), 1000)
    };
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
- Use Proteus CLI for state and communication.
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
- Read dossier.md, contract.md, agent-instructions.md, and skills/*.md before acting.
- Reconstruct the research context before substantial work: target, campaign/hypothesis, why this front exists, known killed paths, constraints, intended strategy, applicable Proteus heuristics, and expected output.
- Respect access mode ${session.accessMode}: ${accessLine(session)}
- Use ${(0, paths_1.toRelative)(db.targetRoot, session.labDir)} for notes, scripts, PoC material, and evidence even when broader access is granted.
- Prefer the workspace root as the Proteus base. Do not create stray .vros directories in subfolders.
- If you accidentally find or create a stray base, report it. The coordinator can merge it with proteus merge.
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
- Network is ${config.defaultNetwork ? "allowed only within the target authorization" : "disabled by default unless the coordinator explicitly authorizes it"}.

Communication commands:
- ${proteusCommand} --root "${db.targetRoot}" chimera poll --id ${session.publicId} --unread --agent
- ${proteusCommand} --root "${db.targetRoot}" chimera post --id ${session.publicId} --kind message --body "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera broadcast --from-id ${session.publicId} --message "..." --priority
- ${proteusCommand} --root "${db.targetRoot}" chimera council accept --id ${session.publicId} --council-id CO-... --body "ready"
- ${proteusCommand} --root "${db.targetRoot}" chimera council turn --id ${session.publicId} --council-id CO-... --round 1 --body "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera snapshot --id ${session.publicId} --body "..."
- ${proteusCommand} --root "${db.targetRoot}" chimera heartbeat --id ${session.publicId}
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

${proteusCommand} --root "${db.targetRoot}" chimera snapshot --id ${session.publicId} --body "Confirmed / killed / open / next move"
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
    if (session.accessMode === "inherit") {
        return `The coordinator granted inherited workspace permissions for this task. ${session.accessNotes || "Use the broader access only where it directly supports the goal."}`;
    }
    return `Keep repository writes out of scope and write only inside the Chimera lab unless the coordinator redirects you. ${session.accessNotes}`;
}
function copySkillFiles(session) {
    const skillsDir = resolveSkillsDir();
    if (!skillsDir)
        return;
    const wanted = new Set(["continuous-vuln-research", "chimera-agent", session.role]);
    for (const name of wanted) {
        const source = node_path_1.default.join(skillsDir, name, "SKILL.md");
        if (!node_fs_1.default.existsSync(source))
            continue;
        node_fs_1.default.copyFileSync(source, node_path_1.default.join(session.sessionDir, "skills", `${name}.md`));
        const opencodeSkillDir = node_path_1.default.join(session.sessionDir, ".opencode", "skills", name);
        (0, paths_1.ensureDir)(opencodeSkillDir);
        node_fs_1.default.copyFileSync(source, node_path_1.default.join(opencodeSkillDir, "SKILL.md"));
    }
}
function writeOpenCodeAgentFile(session, config) {
    const agentName = config.defaultAgent ?? "proteus-chimera";
    const permissions = session.accessMode === "inherit"
        ? ["bash", "read", "edit", "glob", "grep", "webfetch", "websearch", "skill", "lsp"]
        : ["bash", "read", "glob", "grep", "webfetch", "websearch", "skill", "lsp"];
    const agent = `---
description: Proteus Chimera secondary agent for ${session.role} work.
mode: primary
${session.model ? `model: ${session.model}\n` : ""}permissions:
  ${permissions.map((permission) => `${permission}: allow`).join("\n  ")}
---

# Proteus Chimera Runtime Agent

Read the attached dossier and the local Proteus skills before acting. Your session id is ${session.publicId}.

Operate through Proteus for coordination and memory. Use your Chimera lab for artifacts. Respect access mode ${session.accessMode}.

Do not wait for interactive permission approval. If an action is outside your granted access or unclear, post a blocker through Proteus instead of asking OpenCode to prompt a human.
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
function appendJsonl(filePath, value) {
    (0, paths_1.ensureDir)(node_path_1.default.dirname(filePath));
    node_fs_1.default.appendFileSync(filePath, JSON.stringify(value) + "\n");
}
function steerOpenCodeSession(db, session, message) {
    const config = getChimeraConfig(db);
    if (!session.opencodeSessionId) {
        return { attempted: false, ok: false, mode: "none", detail: "no OpenCode session id is attached to this Chimera session" };
    }
    let serverUrl = session.opencodeServerUrl ?? config.opencodeServerUrl;
    if (!serverUrl || !openCodeServerHealthy(serverUrl)) {
        try {
            const server = ensureOpenCodeServer(db, config);
            serverUrl = server.url;
            db.updateChimeraSession({ publicId: session.publicId, opencodeServerUrl: server.url });
        }
        catch (error) {
            return {
                attempted: false,
                ok: false,
                mode: "none",
                ...(serverUrl ? { serverUrl } : {}),
                opencodeSessionId: session.opencodeSessionId,
                detail: error instanceof Error ? error.message : String(error)
            };
        }
    }
    const prompt = renderSteerPrompt(db, session, message);
    const response = httpJson(`${trimSlash(serverUrl)}/api/session/${encodeURIComponent(session.opencodeSessionId)}/prompt`, {
        method: "POST",
        body: {
            prompt: { text: prompt },
            delivery: "steer",
            resume: true
        },
        timeoutMs: 10000
    });
    appendJsonl(node_path_1.default.join(session.sessionDir, "transcript.jsonl"), {
        type: "opencode_direct_steer",
        messageId: message.id,
        serverUrl,
        opencodeSessionId: session.opencodeSessionId,
        status: response.status ?? null,
        ok: response.ok,
        error: response.error ?? null
    });
    return {
        attempted: true,
        ok: response.ok,
        mode: "steer",
        serverUrl,
        opencodeSessionId: session.opencodeSessionId,
        status: response.status,
        detail: response.ok ? "sent via OpenCode delivery=steer" : response.error ?? `HTTP ${response.status ?? "unknown"}`
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
function ensureOpenCodeServer(db, config) {
    if (config.opencodeServerUrl && openCodeServerHealthy(config.opencodeServerUrl)) {
        return { url: config.opencodeServerUrl, pid: config.opencodeServerPid, started: false };
    }
    for (let port = 4096; port <= 4115; port++) {
        const url = `http://127.0.0.1:${port}`;
        if (openCodeServerHealthy(url)) {
            const next = { ...config, opencodeServerUrl: url, opencodeServerPid: null };
            saveChimeraConfig(db, next);
            return { url, pid: null, started: false };
        }
        const started = startOpenCodeServerProcess(db, config, port);
        for (let attempt = 0; attempt < 20; attempt++) {
            sleepMs(250);
            if (openCodeServerHealthy(url)) {
                const next = { ...config, opencodeServerUrl: url, opencodeServerPid: started.pid };
                saveChimeraConfig(db, next);
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
    child.unref();
    return { pid: child.pid ?? null };
}
function openCodeServerHealthy(url) {
    const response = httpJson(`${trimSlash(url)}/session`, { method: "GET", timeoutMs: 3000 });
    return response.ok;
}
function discoverOpenCodeSession(serverUrl, session) {
    const response = httpJson(`${trimSlash(serverUrl)}/session`, { method: "GET", timeoutMs: 10000 });
    if (!response.ok || !Array.isArray(response.body))
        return null;
    const title = `proteus-${session.publicId}`;
    const normalizedSessionDir = normalizeFsPath(session.sessionDir);
    const candidates = response.body
        .filter((item) => typeof item === "object" && item !== null && !Array.isArray(item))
        .filter((item) => item.title === title || normalizeFsPath(String(item.directory ?? "")) === normalizedSessionDir)
        .sort((a, b) => Number(b.time?.updated ?? 0) - Number(a.time?.updated ?? 0));
    const id = candidates[0]?.id;
    return typeof id === "string" && id.startsWith("ses") ? id : null;
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
    const parts = command.match(/"([^"]+)"|'([^']+)'|[^\s]+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
    if (parts.length === 0)
        return { file: command, args: [] };
    return { file: resolveWindowsCommand(parts[0]), args: parts.slice(1) };
}
function spawnExternalSync(command, args, options) {
    return (0, node_child_process_1.spawnSync)(command.file, [...command.args, ...args], {
        ...options,
        shell: needsWindowsShell(command.file)
    });
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
    return `${quoteArg(process.execPath)} ${quoteArg(resolveProteusCliPath())}`;
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
function truncate(value, limit) {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}
