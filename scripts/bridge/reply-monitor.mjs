import { captureTmuxTail } from '../clawhip-discord-bridge-lib.mjs';
import { truncateForDiscord } from './discord-adapter.mjs';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitLines(text) {
  return text.trimEnd().split(/\r?\n/);
}

export function diffTailFromBaseline(baseline, current) {
  const before = splitLines(baseline);
  const after = splitLines(current);
  let index = 0;
  while (index < before.length && index < after.length && before[index] === after[index]) {
    index += 1;
  }
  return after.slice(index).join('\n').trim();
}

export function hasPrompt(text) {
  return text.split(/\r?\n/).some((line) => line.trimStart().startsWith('❯'));
}

export function hasShellPrompt(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? '';
  return /^[^\n]*[%#$>] ?$/.test(lastLine);
}

export function extractBridgeStatus(reply) {
  const match = reply.match(/^\s*BRIDGE_STATUS:\s*([a-z-]+)\s*$/im);
  return match?.[1]?.toLowerCase() ?? null;
}

export function stripBridgeStatus(reply) {
  return reply.replace(/^\s*BRIDGE_STATUS:\s*[a-z-]+\s*$/gim, '').trim();
}

export function detectPermissionRequest(reply) {
  if (!/This command requires approval/i.test(reply)) {
    return null;
  }

  const commandMatch = reply.match(/Bash command\s+([\s\S]*?)\s+This command requires approval/i);
  const command = commandMatch?.[1]?.trim() ?? null;
  const allowAlways = /Yes, and don.?t ask again/i.test(reply);

  return {
    command,
    allowAlways,
  };
}

function isBoilerplateLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return [
    /^quote>\s?/i,
    /^OpenAI Codex v/i,
    /^Claude Code v/i,
    /^workdir:\s/i,
    /^model:\s/i,
    /^provider:\s/i,
    /^approval:\s/i,
    /^sandbox:\s/i,
    /^reasoning effort:\s/i,
    /^reasoning summaries:\s/i,
    /^session id:\s/i,
    /^--------$/,
    /^Bridge autonomy contract:$/i,
    /^- Work independently until/i,
    /^- If you need human review/i,
    /^- If you need human feedback/i,
    /^- If the task is complete/i,
    /^- Keep the final response concise/i,
    /^\[omx\] postLaunch:/i,
    /^user$/i,
    /^codex$/i,
    /^omx$/i,
    /^claude$/i,
    /^Autonomously progress, pause only for blockers/i,
    /^Garimas-MacBook-Pro% (?:codex|omx exec|claude )/i,
    /^(?:codex|omx exec --dangerously-bypass-approvals-and-sandbox|claude) /i,
  ].some((pattern) => pattern.test(trimmed));
}

function compressBlankLines(lines) {
  const out = [];
  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank && out.at(-1) === '') {
      continue;
    }
    out.push(isBlank ? '' : line);
  }
  while (out[0] === '') out.shift();
  while (out.at(-1) === '') out.pop();
  return out;
}

export function sanitizeTmuxReply(reply) {
  const stripped = stripBridgeStatus(reply);
  const rawLines = stripped.split(/\r?\n/);
  const filtered = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const trimmed = line.trim();

    if (/^tokens used$/i.test(trimmed) && rawLines[index + 1]?.trim()) {
      filtered.push(`tokens used: ${rawLines[index + 1].trim()}`);
      index += 1;
      continue;
    }

    if (isBoilerplateLine(line)) {
      continue;
    }

    if (/^BRIDGE_STATUS:/i.test(trimmed)) {
      continue;
    }

    if (/^Garimas-MacBook-Pro%$/.test(trimmed)) {
      continue;
    }

    filtered.push(line);
  }

  const compact = compressBlankLines(filtered);
  if (compact.length === 0) {
    return '<no useful output>';
  }

  const usefulTail = compact.slice(-20).join('\n').trim();
  return usefulTail || '<no useful output>';
}

export function formatTmuxReply(session, reply) {
  return truncateForDiscord([
    `📨 tmux reply from \`${session}\``,
    '```',
    sanitizeTmuxReply(reply),
    '```',
  ].join('\n'));
}

export function formatPermissionRequest(session, permissionRequest) {
  const lines = [
    `🔐 permission required in \`${session}\``,
  ];

  if (permissionRequest.command) {
    lines.push('```', permissionRequest.command, '```');
  }

  lines.push('Reply with `approve`, `approve always`, or `reject`.');
  return truncateForDiscord(lines.join('\n'));
}

export function formatBridgeStatusNotice(status) {
  switch (status) {
    case 'review-ready':
      return '🔔 autonomous task is ready for review';
    case 'feedback-needed':
      return '📝 autonomous task is blocked on feedback';
    case 'complete':
      return '✅ autonomous task is complete';
    default:
      return null;
  }
}

export async function waitForTmuxReply(session, baselineTail, options) {
  let lastTail = baselineTail;
  let sawChange = false;
  const deadline = Date.now() + options.responseTimeoutMs;
  const expectBridgeStatus = options.expectBridgeStatus === true;
  const expectShellPrompt = options.expectShellPrompt === true;

  while (Date.now() < deadline) {
    await sleep(options.responsePollMs);
    const currentTail = captureTmuxTail(session, 160);
    const diff = diffTailFromBaseline(baselineTail, currentTail) || currentTail.trim();

    if (currentTail !== baselineTail) {
      sawChange = true;
    }

    if (sawChange && detectPermissionRequest(diff)) {
      return diff;
    }

    if (sawChange && expectBridgeStatus && extractBridgeStatus(diff)) {
      return diff;
    }

    if (sawChange && hasPrompt(currentTail) && !expectBridgeStatus) {
      return diff;
    }

    if (sawChange && expectShellPrompt && hasShellPrompt(currentTail)) {
      return diff;
    }

    lastTail = currentTail;
  }

  if (lastTail !== baselineTail) {
    return diffTailFromBaseline(baselineTail, lastTail) || lastTail.trim();
  }

  return null;
}
