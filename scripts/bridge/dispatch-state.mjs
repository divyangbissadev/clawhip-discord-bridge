export const MAX_DISPATCH_HISTORY = 12;

const ACTIVE_DISPATCH_STATUSES = new Set([
  'queued',
  'running',
  'awaiting-approval',
  'review-ready',
  'feedback-needed',
]);

function trimDispatchHistory(history) {
  return history.slice(0, MAX_DISPATCH_HISTORY);
}

export function buildDispatchRecord(route, authorName, messageId = null, now = new Date().toISOString()) {
  const status = 'queued';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messageId,
    routeType: route.routeType,
    targetSession: route.targetSession,
    executorName: route.executorName ?? null,
    executor: route.routeType === 'executor' ? route.ackLabel : null,
    agent: route.agent ?? null,
    skills: route.skills ?? [],
    task: route.task ?? null,
    description: route.description ?? null,
    authorName,
    status,
    queuedAt: now,
    startedAt: now,
    updatedAt: now,
    tokenUsage: null,
    transitions: [{ status, at: now }],
  };
}

export function recordDispatch(state, dispatch) {
  const history = Array.isArray(state.dispatchHistory) ? state.dispatchHistory : [];
  state.dispatchHistory = trimDispatchHistory([dispatch, ...history]);
  state.lastDispatch = dispatch;
  if (ACTIVE_DISPATCH_STATUSES.has(dispatch.status)) {
    state.activeDispatchId = dispatch.id;
  }
  return dispatch;
}

export function patchDispatch(state, dispatchId, patch) {
  const history = Array.isArray(state.dispatchHistory) ? state.dispatchHistory : [];
  if (history.length === 0) {
    return null;
  }

  const index = history.findIndex((entry) => entry.id === dispatchId);
  if (index < 0) {
    return null;
  }

  const previous = history[index];
  const next = {
    ...previous,
    ...patch,
  };

  if (patch.status && patch.status !== previous.status) {
    next.transitions = [
      ...(previous.transitions ?? []),
      { status: patch.status, at: patch.updatedAt ?? new Date().toISOString() },
    ];
  }

  history[index] = next;
  state.dispatchHistory = trimDispatchHistory(history);
  state.lastDispatch = next;

  if (ACTIVE_DISPATCH_STATUSES.has(next.status)) {
    state.activeDispatchId = next.id;
  } else if (state.activeDispatchId === next.id) {
    delete state.activeDispatchId;
  }

  return next;
}

export function formatDispatchSummary(dispatch) {
  if (!dispatch) {
    return null;
  }

  const lines = [
    'last dispatch:',
    `- id: \`${dispatch.id}\``,
    `- kind: \`${dispatch.routeType}\``,
  ];

  if (dispatch.executor) {
    lines.push(`- executor: \`${dispatch.executor}\``);
  }
  if (dispatch.authorName) {
    lines.push(`- author: \`${dispatch.authorName}\``);
  }
  if (dispatch.task) {
    lines.push(`- task: \`${dispatch.task}\``);
  } else if (dispatch.description) {
    lines.push(`- command: \`${dispatch.description}\``);
  }
  if (dispatch.status) {
    lines.push(`- status: \`${dispatch.status}\``);
  }
  if (dispatch.queuedAt) {
    lines.push(`- queued: \`${dispatch.queuedAt}\``);
  }
  if (dispatch.updatedAt && dispatch.updatedAt !== dispatch.queuedAt) {
    lines.push(`- updated: \`${dispatch.updatedAt}\``);
  }
  if (dispatch.lastReplyExcerpt) {
    lines.push(`- reply: \`${dispatch.lastReplyExcerpt}\``);
  }

  return lines.join('\n');
}

export function formatDispatchHistory(state, limit = 3) {
  const history = Array.isArray(state?.dispatchHistory) ? state.dispatchHistory.slice(0, limit) : [];
  if (history.length === 0) {
    return null;
  }

  return [
    'recent dispatches:',
    ...history.map((dispatch) => {
      const label = dispatch.task ?? dispatch.description ?? dispatch.routeType;
      return `- \`${dispatch.id}\` ${dispatch.status} — ${label}`;
    }),
  ].join('\n');
}

export function formatElapsedMs(startedAt, finishedAt = new Date().toISOString()) {
  if (!startedAt) {
    return '0s';
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return '0s';
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function extractTokenUsage(text) {
  const patterns = [
    /\b([\d,.]+(?:k|m)?)\s+tokens?\b/i,
    /\btotal\s+tokens?\s*[:=]\s*([\d,.]+(?:k|m)?)\b/i,
    /\binput\s+tokens?\s*[:=]\s*([\d,.]+(?:k|m)?)\b/i,
    /\boutput\s+tokens?\s*[:=]\s*([\d,.]+(?:k|m)?)\b/i,
    /\btokens?\s+used\s*[:=]?\s*([\d,.]+(?:k|m)?)\b/i,
    /\btokens?\s+used\s*\n\s*([\d,.]+(?:k|m)?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function quoteCode(value) {
  return `\`${value}\``;
}

export function formatDispatchLifecycleMessage(dispatch, phase = 'started') {
  const phaseIcon = {
    started: '🚀',
    running: '🧭',
    complete: '✅',
    'review-ready': '🔔',
    'feedback-needed': '📝',
    'awaiting-approval': '🔐',
    failed: '❌',
  }[phase] ?? '🧭';

  const title = {
    started: 'task context',
    running: 'task update',
    complete: 'task complete',
    'review-ready': 'task ready for review',
    'feedback-needed': 'task waiting for feedback',
    'awaiting-approval': 'task waiting for approval',
    failed: 'task failed',
  }[phase] ?? 'task update';

  const lines = [
    `${phaseIcon} ${title}`,
    `- id: ${quoteCode(dispatch.id)}`,
    `- status: ${quoteCode(dispatch.status ?? phase)}`,
    `- started: ${quoteCode(dispatch.startedAt ?? dispatch.queuedAt ?? 'unknown')}`,
    `- elapsed: ${quoteCode(formatElapsedMs(dispatch.startedAt ?? dispatch.queuedAt, dispatch.updatedAt))}`,
  ];

  if (dispatch.executorName || dispatch.executor) {
    lines.push(`- executor: ${quoteCode(dispatch.executor ?? dispatch.executorName)}`);
  }
  if (dispatch.agent) {
    lines.push(`- agent: ${quoteCode(dispatch.agent)}`);
  }
  if (dispatch.skills?.length) {
    lines.push(`- skills: ${dispatch.skills.map(quoteCode).join(', ')}`);
  } else {
    lines.push(`- skills: ${quoteCode('none')}`);
  }
  if (dispatch.task) {
    lines.push(`- task: ${quoteCode(dispatch.task)}`);
  } else if (dispatch.description) {
    lines.push(`- command: ${quoteCode(dispatch.description)}`);
  }
  lines.push(`- session: ${quoteCode(dispatch.targetSession)}`);
  lines.push(`- author: ${quoteCode(dispatch.authorName)}`);
  lines.push(`- tokens: ${quoteCode(dispatch.tokenUsage ?? 'unavailable')}`);

  return lines.join('\n');
}
