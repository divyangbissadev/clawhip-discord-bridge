import {
  captureTmuxTail,
  detectTmuxExecutor,
  ensureTmuxSession,
  getExecutorSessionName,
  sendCommandToTmux,
  sendKeysToTmux,
} from '../clawhip-discord-bridge-lib.mjs';
import { getAllowedPrefixes, routeBridgeCommand } from './command-router.mjs';
import {
  detectPermissionRequest,
  extractBridgeStatus,
  formatBridgeStatusNotice,
  formatPermissionRequest,
  formatTmuxReply,
  waitForTmuxReply,
} from './reply-monitor.mjs';
import {
  buildDispatchRecord,
  extractTokenUsage,
  formatDispatchLifecycleMessage,
  formatDispatchHistory,
  formatDispatchSummary,
  patchDispatch,
  recordDispatch,
} from './dispatch-state.mjs';
import {
  sendBridgeNotificationViaClawhip,
  watchBridgeSessionWithClawhip,
} from './clawhip-notify.mjs';

function writeStateSafely(statePath, state, writeState) {
  if (!state || !statePath || !writeState) {
    return;
  }
  writeState(statePath, state);
}

function recordDispatchState(statePath, state, writeState, dispatch) {
  if (!state || !statePath || !writeState) {
    return dispatch;
  }

  recordDispatch(state, dispatch);
  writeState(statePath, state);
  return dispatch;
}

function patchDispatchState(statePath, state, writeState, dispatchId, patch) {
  if (!state || !statePath || !writeState) {
    return null;
  }

  const nextDispatch = patchDispatch(state, dispatchId, patch);
  writeStateSafely(statePath, state, writeState);
  return nextDispatch;
}

async function notifyDispatchLifecycle(notify, dispatch, phase, bridgeConfig, runtimeOptions) {
  if (!dispatch) {
    return;
  }

  await notifyBridge(
    notify,
    formatDispatchLifecycleMessage(dispatch, phase),
    bridgeConfig,
    runtimeOptions
  );
}

async function notifyBridge(notify, message, bridgeConfig, runtimeOptions) {
  if (runtimeOptions.useClawhipNotifications) {
    const clawhipResult = sendBridgeNotificationViaClawhip(message, bridgeConfig);
    if (clawhipResult.ok) {
      return;
    }
    console.warn(`[clawhip-bridge] clawhip notify failed, falling back to direct Discord post: ${clawhipResult.error}`);
  }

  await notify(message);
}

function safeDetectTmuxExecutor(session, fallbackExecutor = null) {
  try {
    return detectTmuxExecutor(session);
  } catch {
    return fallbackExecutor;
  }
}

function getActiveDispatch(state) {
  const history = Array.isArray(state?.dispatchHistory) ? state.dispatchHistory : [];
  if (!state?.activeDispatchId) {
    return history[0] ?? null;
  }
  return history.find((entry) => entry.id === state.activeDispatchId) ?? history[0] ?? null;
}

function resolveExecutorSession(bridgeConfig, executor = null) {
  const resolvedExecutor = executor ?? bridgeConfig.defaultExecutor;
  return getExecutorSessionName(bridgeConfig.tmuxSession, resolvedExecutor);
}

function resolveMetaSession(metaCommand, bridgeConfig, state = null) {
  if (metaCommand.executor) {
    return resolveExecutorSession(bridgeConfig, metaCommand.executor);
  }

  const activeDispatch = getActiveDispatch(state);
  if (activeDispatch?.targetSession) {
    return activeDispatch.targetSession;
  }

  return resolveExecutorSession(bridgeConfig, bridgeConfig.defaultExecutor);
}

export async function createTmuxSummary(bridgeConfig, requestedExecutor = null, state = null) {
  const summarySession = requestedExecutor
    ? resolveExecutorSession(bridgeConfig, requestedExecutor)
    : resolveMetaSession({ executor: null }, bridgeConfig, state);
  ensureTmuxSession(summarySession, bridgeConfig.workingDirectory);
  const currentCommand = safeDetectTmuxExecutor(summarySession, requestedExecutor ?? bridgeConfig.defaultExecutor);
  if (requestedExecutor && currentCommand !== requestedExecutor) {
    return `⛔ summary unavailable: tmux session \`${summarySession}\` is running \`${currentCommand || 'unknown'}\`, not \`${requestedExecutor}\``;
  }

  const tail = captureTmuxTail(summarySession, 24) || '<no output>';
  const lastDispatchSummary = formatDispatchSummary(state?.lastDispatch);
  const recentDispatches = formatDispatchHistory(state);
  return [
    `🧾 tmux summary for \`${summarySession}\``,
    `active command: \`${currentCommand || 'unknown'}\``,
    ...(lastDispatchSummary ? [lastDispatchSummary] : []),
    ...(recentDispatches ? [recentDispatches] : []),
    '```',
    tail,
    '```',
  ].join('\n');
}

export async function processMetaCommand(metaCommand, bridgeConfig, state = null) {
  if (metaCommand.kind === 'summary') {
    return { ack: await createTmuxSummary(bridgeConfig, metaCommand.executor, state) };
  }

  const targetSession = resolveMetaSession(metaCommand, bridgeConfig, state);
  const fallbackExecutor = metaCommand.executor ?? bridgeConfig.defaultExecutor;
  const sessionInfo = ensureTmuxSession(targetSession, bridgeConfig.workingDirectory);
  const currentCommand = safeDetectTmuxExecutor(targetSession, fallbackExecutor);
  if (metaCommand.executor && currentCommand !== metaCommand.executor) {
    return {
      ack: `⛔ ${metaCommand.kind} rejected: tmux session \`${targetSession}\` is running \`${currentCommand}\`, not \`${metaCommand.executor}\``,
    };
  }

  if (!metaCommand.executor && !bridgeConfig.executorCommands.includes(currentCommand)) {
    return {
      ack: `⛔ ${metaCommand.kind} rejected: tmux session \`${targetSession}\` is not currently running one of ${bridgeConfig.executorCommands.map((entry) => `\`${entry}\``).join(', ')}`,
    };
  }

  const baselineTail = captureTmuxTail(targetSession, 160);
  const permissionRequest = detectPermissionRequest(baselineTail);

  if (permissionRequest && metaCommand.kind !== 'continue') {
    const keyMap = {
      approve: ['Enter'],
      'approve-always': ['Down', 'Enter'],
      reject: ['Down', 'Down', 'Enter'],
      abort: ['Escape'],
    };
    sendKeysToTmux(targetSession, keyMap[metaCommand.kind] ?? ['Escape']);
  } else {
    const controlMap = {
      continue: 'continue',
      approve: '1',
      'approve-always': '2',
      reject: '3',
      abort: '\u001b',
    };
    sendCommandToTmux(targetSession, controlMap[metaCommand.kind]);
  }
  return {
    ack: `▶️ sent \`${metaCommand.kind}\` to tmux \`${targetSession}\`${sessionInfo.created ? ' (created session)' : ''}`,
    responseSession: targetSession,
    baselineTail,
  };
}

function buildDispatchAck(route, sessionInfo, authorName) {
  const created = sessionInfo.created ? ' (created session)' : '';
  if (route.routeType === 'executor') {
    return `🛠 queued ${route.ackLabel} task in tmux \`${route.targetSession}\`${created} from ${authorName}: \`${route.task}\``;
  }

  if (route.routeType === 'git') {
    return `🌿 queued ${route.description} in tmux \`${route.targetSession}\`${created} from ${authorName}`;
  }

  return `🖥 queued shell command in tmux \`${route.targetSession}\`${created} from ${authorName}: \`${route.description}\``;
}


const PERMISSION_REACTION_MAP = {
  '✅': 'approve',
  '🔁': 'approve always',
  '❌': 'reject',
};

function getPermissionRequestSignature(permissionRequest) {
  return permissionRequest
    ? JSON.stringify({
        command: permissionRequest.command ?? null,
        allowAlways: Boolean(permissionRequest.allowAlways),
      })
    : null;
}

function getReactionActionSignature(messageId, emoji, userId) {
  return `${messageId}:${emoji}:${userId}`;
}

function getReactionCount(reactions, emoji) {
  const reaction = reactions.find((entry) => entry.emoji?.name === emoji);
  return Number(reaction?.count ?? 0);
}

function getReactionCountsSignature(reactions) {
  return Object.keys(PERMISSION_REACTION_MAP)
    .map((emoji) => `${emoji}:${getReactionCount(reactions, emoji)}`)
    .join('|');
}

function getRetryAfterMs(error) {
  const match = String(error?.message ?? '').match(/"retry_after":\s*([0-9.]+)/);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

async function publishLivePermissionPrompt({ bridgeConfig, adapter, state, statePath, writeState }) {
  const targetSession = getActiveDispatch(state)?.targetSession ?? resolveExecutorSession(bridgeConfig);
  const tail = captureTmuxTail(targetSession, 160);
  const permissionRequest = detectPermissionRequest(tail);
  const signature = getPermissionRequestSignature(permissionRequest);

  if (!signature) {
    if (
      state.livePermissionRequestSignature ||
      state.livePermissionPromptMessageId ||
      state.livePermissionActionSignature ||
      state.livePermissionReactionSignature ||
      state.livePermissionReactionRetryAt
    ) {
      delete state.livePermissionRequestSignature;
      delete state.livePermissionPromptMessageId;
      delete state.livePermissionActionSignature;
      delete state.livePermissionReactionSignature;
      delete state.livePermissionReactionRetryAt;
      delete state.livePermissionTargetSession;
      writeState(statePath, state);
    }
    return;
  }

  if (state.livePermissionRequestSignature === signature && state.livePermissionPromptMessageId) {
    return;
  }

  state.livePermissionRequestSignature = signature;
  state.livePermissionTargetSession = targetSession;
  delete state.livePermissionActionSignature;
  delete state.livePermissionReactionSignature;
  delete state.livePermissionReactionRetryAt;
  const posted = await adapter.postMessage(formatPermissionRequest(targetSession, permissionRequest));
  state.livePermissionPromptMessageId = posted?.id ?? state.livePermissionPromptMessageId ?? null;
  writeState(statePath, state);
  console.log(`[clawhip-bridge] published permission prompt for ${targetSession}: ${permissionRequest.command}`);

  if (adapter.supportsReactions && posted?.id) {
    for (const emoji of Object.keys(PERMISSION_REACTION_MAP)) {
      try {
        await adapter.addReaction(posted.id, emoji);
      } catch (error) {
        console.error('[clawhip-bridge] failed to add reaction:', emoji, error);
      }
    }
  }
}

async function applyPermissionReaction({ bridgeConfig, adapter, runtimeOptions, state, statePath, writeState }) {
  if (!adapter.supportsReactions) {
    return false;
  }
  const messageId = state.livePermissionPromptMessageId;
  if (!messageId) {
    return false;
  }

  if (
    typeof state.livePermissionReactionRetryAt === 'number' &&
    Date.now() < state.livePermissionReactionRetryAt
  ) {
    return false;
  }

  const promptMessage = await adapter.fetchMessage(messageId);
  const reactions = promptMessage.reactions ?? [];
  const countsSignature = getReactionCountsSignature(reactions);
  if (state.livePermissionReactionSignature === countsSignature) {
    return false;
  }

  for (const [emoji, command] of Object.entries(PERMISSION_REACTION_MAP)) {
    if (getReactionCount(reactions, emoji) <= 1) {
      continue;
    }

    let users;
    try {
      users = await adapter.fetchReactionUsers(messageId, emoji, 25);
    } catch (error) {
      const retryAfterMs = getRetryAfterMs(error);
      if (retryAfterMs !== null) {
        state.livePermissionReactionRetryAt = Date.now() + retryAfterMs;
        writeState(statePath, state);
        console.warn(`[clawhip-bridge] reaction fetch rate-limited for ${emoji}; retrying in ${retryAfterMs}ms`);
        return false;
      }
      throw error;
    }

    const allowed = users.find((user) => !user.bot && (bridgeConfig.allowedUserIds.length === 0 || bridgeConfig.allowedUserIds.includes(user.id)));
    if (!allowed) {
      continue;
    }

    const actionSignature = getReactionActionSignature(messageId, emoji, allowed.id);
    if (state.livePermissionActionSignature === actionSignature) {
      return false;
    }

    state.livePermissionActionSignature = actionSignature;
    state.livePermissionReactionSignature = countsSignature;
    delete state.livePermissionReactionRetryAt;
    writeState(statePath, state);
    console.log(`[clawhip-bridge] applying permission action ${command} from ${allowed.id} via ${emoji}`);

    await executeBridgeCommand({
      content: command,
      authorName: allowed.global_name || allowed.username || allowed.id,
      bridgeConfig,
      runtimeOptions,
      notify: (text) => adapter.postMessage(text),
    });

    return true;
  }

  state.livePermissionReactionSignature = countsSignature;
  delete state.livePermissionReactionRetryAt;
  writeState(statePath, state);
  return false;
}

export async function handleTmuxReply({ session, reply, notify }) {
  await notify(formatTmuxReply(session, reply));

  const permissionRequest = detectPermissionRequest(reply);
  if (permissionRequest) {
    await notify(formatPermissionRequest(session, permissionRequest));
    return { permissionRequest };
  }

  const status = extractBridgeStatus(reply);
  const statusNotice = formatBridgeStatusNotice(status);
  if (statusNotice) {
    await notify(statusNotice);
  }

  return { status, permissionRequest: null };
}

export async function executeBridgeCommand({
  content,
  authorName,
  bridgeConfig,
  runtimeOptions,
  notify,
  messageId = null,
  state = null,
  statePath = null,
  writeState = null,
}) {
  const route = routeBridgeCommand(content, bridgeConfig);

  if (route.kind === 'rejected') {
    await notifyBridge(
      notify,
      `${route.message} (allowlist: ${getAllowedPrefixes(bridgeConfig).join(', ')})`,
      bridgeConfig,
      runtimeOptions
    );
    return { ok: false, kind: 'rejected' };
  }

  if (route.kind === 'meta') {
    const metaResult = await processMetaCommand(route.metaCommand, bridgeConfig, state);
    await notifyBridge(notify, metaResult.ack, bridgeConfig, runtimeOptions);
    if (!metaResult.responseSession || !metaResult.baselineTail) {
      return { ok: true, kind: 'meta' };
    }

    const reply = await waitForTmuxReply(metaResult.responseSession, metaResult.baselineTail, runtimeOptions);
    if (!reply) {
      return { ok: true, kind: 'meta', reply: null };
    }

    const handled = await handleTmuxReply({
      session: metaResult.responseSession,
      reply,
      notify: (message) => notifyBridge(notify, message, bridgeConfig, runtimeOptions),
    });
    return { ok: true, kind: 'meta', reply, ...handled };
  }

  const sessionInfo = ensureTmuxSession(route.targetSession, bridgeConfig.workingDirectory);
  const baselineTail = captureTmuxTail(route.targetSession, 160);
  sendCommandToTmux(route.targetSession, route.shellCommand);
  const dispatch = recordDispatchState(
    statePath,
    state,
    writeState,
    buildDispatchRecord(route, authorName, messageId)
  );

  await notifyBridge(notify, buildDispatchAck(route, sessionInfo, authorName), bridgeConfig, runtimeOptions);
  await notifyDispatchLifecycle(notify, dispatch, 'started', bridgeConfig, runtimeOptions);

  const reply = await waitForTmuxReply(route.targetSession, baselineTail, {
    ...runtimeOptions,
    expectBridgeStatus: route.routeType === 'executor',
    expectShellPrompt:
      route.routeType === 'shell' ||
      route.routeType === 'git' ||
      (route.routeType === 'executor' && ['omx', 'codex'].includes(route.executorName ?? '')),
  });
  if (!reply) {
    const runningPatch = {
      status: 'running',
      updatedAt: new Date().toISOString(),
    };
    const runningDispatch = patchDispatchState(statePath, state, writeState, dispatch?.id, runningPatch)
      ?? { ...dispatch, ...runningPatch };
    await notifyDispatchLifecycle(notify, runningDispatch, 'running', bridgeConfig, runtimeOptions);
    return { ok: true, kind: 'dispatch', reply: null };
  }

  const handled = await handleTmuxReply({
    session: route.targetSession,
    reply,
    notify: (message) => notifyBridge(notify, message, bridgeConfig, runtimeOptions),
  });

  const tokenUsage = extractTokenUsage(reply);
  const completionPatch = {
    status: handled.permissionRequest
      ? 'awaiting-approval'
      : handled.status ?? 'running',
    updatedAt: new Date().toISOString(),
    lastReplyExcerpt: reply.replace(/\s+/g, ' ').slice(0, 280),
    tokenUsage,
  };
  const nextDispatch = patchDispatchState(statePath, state, writeState, dispatch?.id, completionPatch)
    ?? { ...dispatch, ...completionPatch };
  await notifyDispatchLifecycle(
    notify,
    nextDispatch,
    handled.permissionRequest
      ? 'awaiting-approval'
      : handled.status ?? 'running',
    bridgeConfig,
    runtimeOptions
  );

  return { ok: true, kind: 'dispatch', reply, ...handled };
}

export async function processBridgeMessage({
  message,
  bridgeConfig,
  adapter,
  runtimeOptions,
  selfId,
  state,
  statePath,
  writeState,
}) {
  const previousCursor = state.lastSeenCursor ?? state.lastSeenMessageId ?? null;
  if (previousCursor && !adapter.isMessageNewer(message, previousCursor)) {
    return;
  }

  state.lastSeenCursor = adapter.getMessageCursor(message);
  delete state.lastSeenMessageId;
  writeState(statePath, state);

  if (!runtimeOptions.allowBotMessages && selfId && adapter.getAuthorId(message) === selfId) {
    return;
  }

  const content = adapter.extractMessageText(message);
  if (!content) {
    console.log(`[clawhip-bridge] skipped message ${adapter.getMessageCursor(message)}: empty extracted content`);
    return;
  }

  const authorId = adapter.getAuthorId(message);
  const authorName = adapter.getAuthorName(message);

  if (
    bridgeConfig.allowedUserIds.length > 0 &&
    !bridgeConfig.allowedUserIds.includes(authorId)
  ) {
    await adapter.postMessage(
      `⛔ command rejected from ${authorName}: user is not in the Discord bridge allowlist`
    );
    return;
  }

  console.log(`[clawhip-bridge] dispatching message ${adapter.getMessageCursor(message)} from ${authorName}: ${content.replace(/\s+/g, ' ').slice(0, 160)}`);

  await executeBridgeCommand({
    content,
    authorName,
    bridgeConfig,
    runtimeOptions,
    messageId: adapter.getMessageCursor(message),
    state,
    statePath,
    writeState,
    notify: (text) => adapter.postMessage(text),
  });
}

export async function runBridge({
  bridgeConfig,
  adapter,
  runtimeOptions,
  statePath,
  readState,
  writeState,
}) {
  const state = readState(statePath);
  if (!adapter.supportsPolling) {
    throw new Error(
      `${bridgeConfig.provider} provider does not support pull-based message polling. Use discord, telegram, relay, or local --process-command mode.`
    );
  }
  const bot = await adapter.fetchBotIdentity();
  const selfId = bot?.id != null ? String(bot.id) : null;

  if (runtimeOptions.useClawhipNotifications && runtimeOptions.autoRegisterClawhipWatch) {
    for (const session of [bridgeConfig.tmuxSession, bridgeConfig.shellTmuxSession]) {
      const watchResult = watchBridgeSessionWithClawhip(session, bridgeConfig);
      if (!watchResult.ok) {
        console.warn(`[clawhip-bridge] clawhip tmux watch skipped for ${session}: ${watchResult.error}`);
      }
    }
  }

  console.log(
    `[clawhip-bridge] watching ${bridgeConfig.provider} transport -> tmux session ${bridgeConfig.tmuxSession}`
  );

  if (!state.lastSeenCursor && state.lastSeenMessageId) {
    state.lastSeenCursor = state.lastSeenMessageId;
    delete state.lastSeenMessageId;
    writeState(statePath, state);
  }

  if (!state.lastSeenCursor) {
    const initialMessages = await adapter.fetchRecentMessages({ limit: 20 });
    if (initialMessages.length > 0) {
      const sortedInitial = adapter.sortMessages(initialMessages);
      state.lastSeenCursor = adapter.getMessageCursor(sortedInitial.at(-1));
      writeState(statePath, state);
    }
  }

  while (true) {
    try {
      const messages = await adapter.fetchRecentMessages({
        limit: 20,
        afterCursor: state.lastSeenCursor ?? null,
      });
      const sorted = adapter.sortMessages(messages);
      for (const message of sorted) {
        await processBridgeMessage({
          message,
          bridgeConfig,
          adapter,
          runtimeOptions,
          selfId,
          state,
          statePath,
          writeState,
        });
      }
      await publishLivePermissionPrompt({
        bridgeConfig,
        adapter,
        state,
        statePath,
        writeState,
      });
      await applyPermissionReaction({
        bridgeConfig,
        adapter,
        runtimeOptions,
        state,
        statePath,
        writeState,
      });
    } catch (error) {
      console.error('[clawhip-bridge] poll failed:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, runtimeOptions.pollMs));
  }
}
