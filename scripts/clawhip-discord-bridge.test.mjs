import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildExecutorCommand,
  buildExecutorCommandFromParts,
  buildGitCommand,
  captureTmuxTail,
  detectTmuxExecutor,
  detectTmuxExecutorFromSignals,
  getTmuxCurrentCommand,
  getTmuxPaneTitle,
  isAllowedCommand,
  isSnowflakeGreater,
  loadBridgeConfig,
  parseFixCommand,
  shellSingleQuote,
} from './clawhip-discord-bridge-lib.mjs';
import { extractMessageText } from './bridge/discord-adapter.mjs';
import { getBridgeRuntimeOptions } from './bridge/config.mjs';
import { createMessagingAdapter } from './messaging/provider-factory.mjs';
import { TelegramChatAdapter } from './messaging/telegram.mjs';
import { RelayMessagingAdapter } from './messaging/relay.mjs';
import {
  normalizeSlackEvent,
  normalizeTeamsWebhook,
  normalizeTelegramUpdate,
  normalizeTwilioWhatsAppForm,
} from './relay/normalizers.mjs';
import {
  appendRelayMessages,
  listRelayMessages,
  readRelayState,
} from './relay/state-store.mjs';
import {
  buildDispatchRecord as buildStateDispatchRecord,
  extractTokenUsage,
  formatDispatchLifecycleMessage,
  formatDispatchHistory,
  patchDispatch,
  recordDispatch,
} from './bridge/dispatch-state.mjs';
import {
  sendBridgeNotificationViaClawhip,
  watchBridgeSessionWithClawhip,
} from './bridge/clawhip-notify.mjs';
import { parseBridgeMetaCommand, routeBridgeCommand } from './bridge/command-router.mjs';
import {
  detectPermissionRequest,
  extractBridgeStatus,
  formatBridgeStatusNotice,
  formatPermissionRequest,
  hasShellPrompt,
  sanitizeTmuxReply,
  stripBridgeStatus,
} from './bridge/reply-monitor.mjs';

test('parseFixCommand handles bare and prefixed fix commands', () => {
  assert.equal(parseFixCommand('fix'), 'fix');
  assert.equal(parseFixCommand('fix investigate login'), 'investigate login');
  assert.equal(parseFixCommand('!fix run tests'), 'run tests');
  assert.equal(parseFixCommand('hello'), null);
});

test('isSnowflakeGreater compares Discord snowflakes numerically', () => {
  assert.equal(isSnowflakeGreater('2', '1'), true);
  assert.equal(isSnowflakeGreater('1', '2'), false);
});

test('loadBridgeConfig reads token, channel, tmux session, and git path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawhip-bridge-'));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(
    configPath,
    `
[providers.discord]
token = "discord-token"
default_channel = "123"

[[monitors.git.repos]]
path = "/tmp/project"

[[monitors.tmux.sessions]]
session = "demo-session"
`
  );

  const config = loadBridgeConfig(configPath);
  assert.equal(config.token, 'discord-token');
  assert.equal(config.channelId, '123');
  assert.equal(config.tmuxSession, 'demo-session');
  assert.equal(config.shellTmuxSession, 'demo-session-shell');
  assert.equal(config.workingDirectory, '/tmp/project');
});

test('loadBridgeConfig reads bridge hardening settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawhip-bridge-'));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(
    configPath,
    `
[providers.discord]
token = "discord-token"
default_channel = "123"

[discord_bridge]
allowed_user_ids = ["111", "222"]
allowed_command_prefixes = ["echo", "git status"]
`
  );

  const config = loadBridgeConfig(configPath);
  assert.deepEqual(config.allowedUserIds, ['111', '222']);
  assert.deepEqual(config.allowedCommandPrefixes, ['echo', 'git status']);
});

test('loadBridgeConfig supports dedicated dispatch sessions and custom executors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawhip-bridge-'));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(
    configPath,
    `
[providers.discord]
token = "discord-token"
default_channel = "123"

[[monitors.tmux.sessions]]
session = "claude-pilot"

[discord_bridge]
dispatch_session = "claude-pilot-dispatch"
shell_session = "claude-pilot-dispatch-shell"
default_executor = "omx"
executor_commands = ["claude", "omx", "codex"]
`
  );

  const config = loadBridgeConfig(configPath);
  assert.equal(config.monitorTmuxSession, 'claude-pilot');
  assert.equal(config.tmuxSession, 'claude-pilot-dispatch');
  assert.equal(config.shellTmuxSession, 'claude-pilot-dispatch-shell');
  assert.equal(config.defaultExecutor, 'omx');
  assert.deepEqual(config.executorCommands, ['claude', 'omx', 'codex']);
});

test('loadBridgeConfig supports alternate provider configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawhip-bridge-'));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(
    configPath,
    `
[providers.discord]
token = "discord-token"
default_channel = "123"

[bridge_transport]
provider = "telegram"

[bridge_provider.telegram]
bot_token = "telegram-token"
chat_id = "999"
`
  );

  const config = loadBridgeConfig(configPath);
  assert.equal(config.provider, 'telegram');
  assert.equal(config.providers.telegram.botToken, 'telegram-token');
  assert.equal(config.providers.telegram.chatId, '999');
});

test('getBridgeRuntimeOptions enables clawhip daemon notifications by default', () => {
  assert.equal(getBridgeRuntimeOptions({}).useClawhipNotifications, true);
  assert.equal(
    getBridgeRuntimeOptions({ CLAWHIP_BRIDGE_USE_DAEMON: '0' }).useClawhipNotifications,
    false
  );
  assert.equal(getBridgeRuntimeOptions({}).autoRegisterClawhipWatch, false);
  assert.equal(
    getBridgeRuntimeOptions({ CLAWHIP_BRIDGE_REGISTER_TMUX_WATCH: '1' }).autoRegisterClawhipWatch,
    true
  );
});

test('isAllowedCommand rejects shell metacharacters and enforces prefixes', () => {
  assert.equal(isAllowedCommand('echo hello', ['echo', 'git status']), true);
  assert.equal(isAllowedCommand('git status', ['echo', 'git status']), true);
  assert.equal(isAllowedCommand('rm -rf /', ['echo', 'git status']), false);
  assert.equal(isAllowedCommand('echo hello && whoami', ['echo']), false);
});

test('buildExecutorCommand maps claude, omx, and ralph tasks to safe shell commands', () => {
  assert.deepEqual(buildExecutorCommand('claude implement login'), {
    executor: 'claude',
    agent: null,
    task: 'implement login',
    shellCommand: "claude 'implement login'",
  });
  assert.deepEqual(buildExecutorCommand('@omx fix the flaky test'), {
    executor: 'omx',
    agent: null,
    task: 'fix the flaky test',
    shellCommand: "omx exec --dangerously-bypass-approvals-and-sandbox 'fix the flaky test'",
  });
  assert.deepEqual(buildExecutorCommand('ralph ship the discord bridge'), {
    executor: 'ralph',
    agent: null,
    task: 'ship the discord bridge',
    shellCommand: "ralph 'ship the discord bridge'",
  });
  assert.deepEqual(buildExecutorCommand('claude:architect review auth flow'), {
    executor: 'claude',
    agent: 'architect',
    task: 'review auth flow',
    shellCommand: "claude 'Use the architect agent for this task: review auth flow'",
  });
  assert.deepEqual(buildExecutorCommand('@omx:debugger trace login failure'), {
    executor: 'omx',
    agent: 'debugger',
    task: 'trace login failure',
    shellCommand: "omx exec --dangerously-bypass-approvals-and-sandbox 'Use the debugger agent for this task: trace login failure'",
  });
  assert.equal(buildExecutorCommand('echo hello'), null);
});

test('buildExecutorCommand supports configured executor commands', () => {
  assert.deepEqual(
    buildExecutorCommand('@codex implement the bridge', ['claude', 'omx', 'codex']),
    {
      executor: 'codex',
      agent: null,
      task: 'implement the bridge',
      shellCommand: "codex exec --dangerously-bypass-approvals-and-sandbox 'implement the bridge'",
    }
  );
});

test('buildExecutorCommandFromParts builds implicit executor commands', () => {
  assert.deepEqual(
    buildExecutorCommandFromParts({
      executor: 'claude',
      agent: 'architect',
      task: 'review the auth flow',
    }),
    {
      executor: 'claude',
      agent: 'architect',
      task: 'review the auth flow',
      shellCommand: "claude 'Use the architect agent for this task: review the auth flow'",
    }
  );
});

test('buildGitCommand maps safe git actions to tmux shell commands', () => {
  assert.deepEqual(buildGitCommand('git status'), {
    kind: 'git',
    action: 'status',
    description: 'git status',
    shellCommand: 'git status',
  });
  assert.deepEqual(buildGitCommand('git branch create feature/test'), {
    kind: 'git',
    action: 'branch-create',
    branch: 'feature/test',
    description: 'git branch create feature/test',
    shellCommand: "git switch -c 'feature/test'",
  });
  assert.deepEqual(buildGitCommand('git branch switch main'), {
    kind: 'git',
    action: 'branch-switch',
    branch: 'main',
    description: 'git branch switch main',
    shellCommand: "git switch 'main'",
  });
  assert.deepEqual(buildGitCommand('git commit checkpoint from discord'), {
    kind: 'git',
    action: 'commit',
    message: 'checkpoint from discord',
    description: 'git commit checkpoint from discord',
    shellCommand: "git add -A && git commit -m 'checkpoint from discord'",
  });
  assert.deepEqual(buildGitCommand('git commit repo checkpoint from discord'), {
    kind: 'git',
    action: 'commit-repo',
    message: 'checkpoint from discord',
    description: 'git commit repo checkpoint from discord',
    shellCommand:
      "git add -- 'apps' 'packages' 'prisma' 'svc-auth' 'svc-gateway' 'svc-vcs' 'svc-ingest' 'svc-review' 'svc-notify' 'svc-analytics' 'worker' 'tests' 'package.json' 'package-lock.json' 'turbo.json' 'tsconfig.base.json' 'docker-compose.yml' 'docker-compose.dev.yml' 'docker-compose.platform.yml' 'Dockerfile' && git commit -m 'checkpoint from discord'",
  });
  assert.deepEqual(buildGitCommand('git push'), {
    kind: 'git',
    action: 'push',
    description: 'git push',
    shellCommand: 'git push origin HEAD',
  });
  assert.deepEqual(buildGitCommand('git pr create ship auth fix'), {
    kind: 'git',
    action: 'pr-create',
    title: 'ship auth fix',
    description: 'git pr create ship auth fix',
    shellCommand: "gh pr create --fill --title 'ship auth fix'",
  });
  assert.deepEqual(buildGitCommand('git pr create'), {
    kind: 'git',
    action: 'pr-create',
    title: '',
    description: 'git pr create',
    shellCommand: 'gh pr create --fill',
  });
});

test('buildGitCommand rejects unsafe git payloads', () => {
  assert.equal(buildGitCommand('git branch create bad;rm'), null);
  assert.equal(buildGitCommand('git commit hello && whoami'), null);
});

test('shellSingleQuote escapes embedded single quotes', () => {
  assert.equal(shellSingleQuote("it's safe"), `'it'"'"'s safe'`);
});

test('detectTmuxExecutorFromSignals resolves Claude, OMX, and Ralph from tmux signals', () => {
  assert.equal(
    detectTmuxExecutorFromSignals('zsh', 'claude-pilot', 'Claude Code v1.0.0'),
    'claude'
  );
  assert.equal(
    detectTmuxExecutorFromSignals('zsh', 'omx-main', 'oh-my-codex is ready'),
    'omx'
  );
  assert.equal(
    detectTmuxExecutorFromSignals('zsh', 'ralph-run', 'waiting for BRIDGE_STATUS: complete'),
    'ralph'
  );
  assert.equal(detectTmuxExecutorFromSignals('python', '', ''), 'python');
});

test('extractMessageText falls back to embed and attachment content', () => {
  assert.equal(
    extractMessageText({
      content: '',
      embeds: [{ title: 'Deploy status', description: 'review-ready' }],
      attachments: [{ filename: 'log.txt' }],
    }),
    'Deploy status\nreview-ready\nlog.txt'
  );
});

test('provider factory creates a Discord adapter by default', () => {
  const adapter = createMessagingAdapter({
    provider: 'discord',
    providers: { discord: { token: 'discord-token', channelId: '123' } },
  });

  assert.equal(adapter.provider, 'discord');
  assert.equal(adapter.supportsPolling, true);
  assert.equal(adapter.supportsReactions, true);
});

test('provider factory creates relay and webhook-family adapters', () => {
  const relay = createMessagingAdapter({
    provider: 'relay',
    providers: {
      relay: {
        inboundUrl: 'https://example.com/inbound',
        outboundUrl: 'https://example.com/outbound',
        identityUrl: 'https://example.com/me',
      },
    },
  });
  assert.equal(relay.provider, 'relay');
  assert.equal(relay.supportsPolling, true);

  const teams = createMessagingAdapter({
    provider: 'teams-webhook',
    providers: {
      teamsWebhook: {
        webhookUrl: 'https://example.com/teams',
      },
    },
  });
  assert.equal(teams.provider, 'teams-webhook');
  assert.equal(teams.supportsPolling, false);
});

test('parseBridgeMetaCommand supports ralph control commands', () => {
  assert.deepEqual(parseBridgeMetaCommand('@ralph approve'), {
    kind: 'approve',
    executor: 'ralph',
  });
  assert.deepEqual(parseBridgeMetaCommand('@ralph approve always'), {
    kind: 'approve-always',
    executor: 'ralph',
  });
  assert.deepEqual(parseBridgeMetaCommand('ralph summary'), {
    kind: 'summary',
    executor: 'ralph',
  });
  assert.deepEqual(parseBridgeMetaCommand('status'), {
    kind: 'summary',
    executor: null,
  });
});

test('parseBridgeMetaCommand supports configured executors', () => {
  assert.deepEqual(parseBridgeMetaCommand('@codex continue', ['claude', 'omx', 'codex']), {
    kind: 'continue',
    executor: 'codex',
  });
});

test('routeBridgeCommand wraps executor tasks in the bridge autonomy contract', () => {
  const route = routeBridgeCommand('ralph build the k8s reviewer flow', {
    allowedCommandPrefixes: [],
    tmuxSession: 'claude-pilot',
    shellTmuxSession: 'claude-pilot-shell',
  });

  assert.equal(route.kind, 'dispatch');
  assert.equal(route.routeType, 'executor');
  assert.equal(route.targetSession, 'claude-pilot-ralph');
  assert.match(route.shellCommand, /^ralph '/);
  assert.match(route.shellCommand, /BRIDGE_STATUS: review-ready/);
  assert.match(route.shellCommand, /BRIDGE_STATUS: feedback-needed/);
  assert.match(route.shellCommand, /BRIDGE_STATUS: complete/);
});

test('routeBridgeCommand treats plain language as an autonomous executor task', () => {
  const route = routeBridgeCommand(
    'do a quick 50 words documentation',
    {
      allowedCommandPrefixes: [],
      tmuxSession: 'claude-pilot',
      shellTmuxSession: 'claude-pilot-shell',
    },
    { activeExecutor: 'claude' }
  );

  assert.equal(route.kind, 'dispatch');
  assert.equal(route.routeType, 'executor');
  assert.equal(route.targetSession, 'claude-pilot-claude');
  assert.equal(route.ackLabel, 'claude');
  assert.match(route.shellCommand, /^claude '/);
  assert.match(route.shellCommand, /do a quick 50 words documentation/);
});

test('routeBridgeCommand supports selective agent routing in normal language', () => {
  const route = routeBridgeCommand(
    'use architect agent to review the login refactor',
    {
      allowedCommandPrefixes: [],
      tmuxSession: 'claude-pilot',
      shellTmuxSession: 'claude-pilot-shell',
    },
    { activeExecutor: 'claude' }
  );

  assert.equal(route.kind, 'dispatch');
  assert.equal(route.routeType, 'executor');
  assert.equal(route.ackLabel, 'claude:architect');
  assert.equal(route.targetSession, 'claude-pilot-claude');
  assert.match(route.shellCommand, /Use the architect agent for this task:/);
  assert.match(route.shellCommand, /review the login refactor/);
});

test('routeBridgeCommand supports configured executor prefixes', () => {
  const route = routeBridgeCommand(
    '@codex implement the bridge',
    {
      allowedCommandPrefixes: [],
      tmuxSession: 'claude-pilot-dispatch',
      shellTmuxSession: 'claude-pilot-dispatch-shell',
      executorCommands: ['claude', 'omx', 'codex'],
      defaultExecutor: 'codex',
    },
    { activeExecutor: 'codex' }
  );

  assert.equal(route.kind, 'dispatch');
  assert.equal(route.routeType, 'executor');
  assert.equal(route.targetSession, 'claude-pilot-dispatch-codex');
  assert.equal(route.ackLabel, 'codex');
});

test('routeBridgeCommand supports natural-language executor selection', () => {
  const route = routeBridgeCommand(
    'use omx to plan the auth migration',
    {
      allowedCommandPrefixes: [],
      tmuxSession: 'claude-pilot-dispatch',
      shellTmuxSession: 'claude-pilot-dispatch-shell',
      executorCommands: ['claude', 'omx', 'codex'],
      defaultExecutor: 'claude',
    },
    { activeExecutor: 'claude' }
  );

  assert.equal(route.kind, 'dispatch');
  assert.equal(route.routeType, 'executor');
  assert.equal(route.ackLabel, 'omx');
  assert.equal(route.targetSession, 'claude-pilot-dispatch-omx');
  assert.match(route.shellCommand, /^omx exec /);
  assert.match(route.shellCommand, /plan the auth migration/);
});

test('dispatch state keeps recent history and active task status', () => {
  const state = {};
  const dispatch = buildStateDispatchRecord(
    {
      routeType: 'executor',
      targetSession: 'claude-pilot',
      ackLabel: 'ralph',
      task: 'ship the bridge',
    },
    'garima',
    '123',
    '2026-04-04T00:00:00.000Z'
  );

  recordDispatch(state, dispatch);
  assert.equal(state.lastDispatch.id, dispatch.id);
  assert.equal(state.activeDispatchId, dispatch.id);

  patchDispatch(state, dispatch.id, {
    status: 'review-ready',
    updatedAt: '2026-04-04T00:01:00.000Z',
    lastReplyExcerpt: 'BRIDGE_STATUS: review-ready',
  });
  assert.equal(state.lastDispatch.status, 'review-ready');
  assert.match(formatDispatchHistory(state), /review-ready/);

  patchDispatch(state, dispatch.id, {
    status: 'complete',
    updatedAt: '2026-04-04T00:02:00.000Z',
  });
  assert.equal(state.lastDispatch.status, 'complete');
  assert.equal(state.activeDispatchId, undefined);
});

test('dispatch lifecycle formatting includes elapsed, skills, and token usage', () => {
  const dispatch = buildStateDispatchRecord(
    {
      routeType: 'executor',
      targetSession: 'claude-pilot-dispatch',
      ackLabel: 'claude:architect',
      executorName: 'claude',
      agent: 'architect',
      skills: ['$ralph'],
      task: 'review auth flow',
    },
    'garima',
    '123',
    '2026-04-04T00:00:00.000Z'
  );

  dispatch.status = 'complete';
  dispatch.updatedAt = '2026-04-04T00:01:05.000Z';
  dispatch.tokenUsage = '12k';

  const message = formatDispatchLifecycleMessage(dispatch, 'complete');
  assert.match(message, /task complete/);
  assert.match(message, /1m 5s/);
  assert.match(message, /`architect`/);
  assert.match(message, /`\$ralph`/);
  assert.match(message, /`12k`/);
});

test('extractTokenUsage parses token summaries when present', () => {
  assert.equal(extractTokenUsage('total tokens: 12,345'), '12,345');
  assert.equal(extractTokenUsage('this run used 8.2k tokens overall'), '8.2k');
  assert.equal(extractTokenUsage('tokens used\n24,479'), '24,479');
  assert.equal(extractTokenUsage('no token info here'), null);
});

test('clawhip notifier shells out with send/watch commands', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const bridgeConfig = {
    configPath: '/tmp/clawhip.toml',
    channelId: '123',
  };

  const sendResult = sendBridgeNotificationViaClawhip('dispatch ready', bridgeConfig, run);
  const watchResult = watchBridgeSessionWithClawhip('claude-pilot', bridgeConfig, run);

  assert.equal(sendResult.ok, true);
  assert.equal(watchResult.ok, true);
  assert.deepEqual(calls[0], [
    'send',
    '--config',
    '/tmp/clawhip.toml',
    '--channel',
    '123',
    '--message',
    'dispatch ready',
  ]);
  assert.deepEqual(calls[1], [
    'tmux',
    'watch',
    '--config',
    '/tmp/clawhip.toml',
    '--session',
    'claude-pilot',
    '--channel',
    '123',
    '--format',
    'compact',
  ]);
});

test('reply-monitor extracts and formats bridge status markers', () => {
  const reply = 'Implemented the feature.\nBRIDGE_STATUS: review-ready';
  assert.equal(extractBridgeStatus(reply), 'review-ready');
  assert.equal(stripBridgeStatus(reply), 'Implemented the feature.');
  assert.equal(formatBridgeStatusNotice('review-ready'), '🔔 autonomous task is ready for review');
  assert.equal(formatBridgeStatusNotice('feedback-needed'), '📝 autonomous task is blocked on feedback');
  assert.equal(formatBridgeStatusNotice('complete'), '✅ autonomous task is complete');
});

test('reply-monitor detects tmux permission prompts and formats Discord instructions', () => {
  const reply = `Bash command\n\n  bash scripts/clawhip-discord-bridge-status.sh 2>&1\n  Show bridge runtime status\n\nThis command requires approval\n\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don’t ask again for: bash:*\n  3. No`;
  assert.deepEqual(detectPermissionRequest(reply), {
    command: 'bash scripts/clawhip-discord-bridge-status.sh 2>&1\n  Show bridge runtime status',
    allowAlways: true,
  });
  assert.match(formatPermissionRequest('claude-pilot', detectPermissionRequest(reply)), /approve always/);
  assert.match(formatPermissionRequest('claude-pilot', detectPermissionRequest(reply)), /claude-pilot/);
});

test('reply-monitor detects plain shell prompts', () => {
  assert.equal(hasShellPrompt('Garimas-MacBook-Pro%'), true);
  assert.equal(hasShellPrompt('root@box# '), true);
  assert.equal(hasShellPrompt('Garimas-MacBook-Pro% codex exec something\nworking...\nGarimas-MacBook-Pro%'), true);
  assert.equal(hasShellPrompt('Garimas-MacBook-Pro% codex exec something\nworking...'), false);
  assert.equal(hasShellPrompt('❯ status'), false);
  assert.equal(hasShellPrompt('no prompt here'), false);
});

test('reply-monitor sanitizes executor boilerplate for Discord', () => {
  const reply = `Garimas-MacBook-Pro% codex exec --dangerously-bypass-approvals-and-sandbox 'say hi'\nquote> Bridge autonomy contract:\nOpenAI Codex v0.118.0 (research preview)\n--------\nworkdir: /tmp/demo\nmodel: gpt-5.4\nprovider: openai\napproval: never\nsandbox: danger-full-access\nreasoning effort: high\nreasoning summaries: none\nsession id: abc\n--------\nuser\nsay hi\ncodex\nBridge is ready\n\ntokens used\n24,479\nGarimas-MacBook-Pro%\nBRIDGE_STATUS: complete`;
  assert.equal(sanitizeTmuxReply(reply), 'say hi\nBridge is ready\n\ntokens used: 24,479');
});

test('telegram adapter normalizes updates and posts messages', async () => {
  const calls = [];
  const adapter = new TelegramChatAdapter({
    botToken: 'telegram-token',
    chatId: '999',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('getUpdates')) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              result: [
                {
                  update_id: 42,
                  message: {
                    text: 'hello from telegram',
                    chat: { id: 999 },
                    from: { id: 7, username: 'agentic', first_name: 'A', last_name: 'Bot', is_bot: false },
                  },
                },
              ],
            };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return { ok: true, result: { ok: true } };
        },
      };
    },
  });

  const messages = await adapter.fetchRecentMessages({ afterCursor: '41' });
  assert.equal(messages[0].id, '42');
  assert.equal(adapter.extractMessageText(messages[0]), 'hello from telegram');
  assert.equal(adapter.getAuthorName(messages[0]), 'A Bot');

  await adapter.postMessage('reply back');
  assert.match(calls[1].url, /sendMessage/);
});

test('relay adapter uses generic inbound/outbound contract', async () => {
  const calls = [];
  const adapter = new RelayMessagingAdapter({
    inboundUrl: 'https://relay.example.com/inbound',
    outboundUrl: 'https://relay.example.com/outbound',
    identityUrl: 'https://relay.example.com/me',
    authHeaderName: 'X-Bridge-Key',
    authHeaderValue: 'secret',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/inbound')) {
        return {
          ok: true,
          async json() {
            return {
              messages: [
                {
                  id: 'm-2',
                  content: 'from relay',
                  author: { id: 'u-1', username: 'relay-user' },
                },
              ],
            };
          },
        };
      }
      if (String(url).includes('/me')) {
        return {
          ok: true,
          async json() {
            return { id: 'relay-bot' };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { ok: true };
        },
      };
    },
  });

  const messages = await adapter.fetchRecentMessages({ afterCursor: 'm-1' });
  assert.equal(messages[0].content, 'from relay');
  assert.equal(messages[0].author.username, 'relay-user');
  const identity = await adapter.fetchBotIdentity();
  assert.equal(identity.id, 'relay-bot');
  await adapter.postMessage('relay out');
  assert.equal(calls[0].init.headers['X-Bridge-Key'], 'secret');
});

test('relay normalizers cover slack, teams, telegram, and whatsapp payloads', () => {
  assert.equal(
    normalizeSlackEvent({ event: { text: 'slack hi', user: 'u1', username: 'slacker', channel: 'c1' } })[0].content,
    'slack hi'
  );
  assert.equal(
    normalizeTeamsWebhook({ text: 'teams hi', from: { id: 'u2', name: 'Teams User' } })[0].author.global_name,
    'Teams User'
  );
  assert.equal(
    normalizeTelegramUpdate({ message: { text: 'telegram hi', chat: { id: 99 }, from: { id: 4, first_name: 'Tele', last_name: 'Gram' } } })[0].channel,
    '99'
  );
  assert.equal(
    normalizeTwilioWhatsAppForm({ Body: 'whatsapp hi', From: 'whatsapp:+1', To: 'whatsapp:+2' })[0].provider,
    'whatsapp'
  );
});

test('relay state store appends and filters messages by cursor', () => {
  const state = readRelayState('/tmp/non-existent-relay-state.json');
  appendRelayMessages(state, [
    {
      content: 'one',
      author: { id: 'u1' },
      provider: 'generic',
    },
    {
      content: 'two',
      author: { id: 'u2' },
      provider: 'generic',
    },
  ]);

  const all = listRelayMessages(state, { limit: 10 });
  assert.equal(all.length, 2);
  const filtered = listRelayMessages(state, { after: all[0].id, limit: 10 });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].content, 'two');
});

test('repo-local init bootstrap creates .bridge sidecar files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-init-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'myproject' }));

  const result = spawnSync('node', [path.resolve('scripts/init.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.bridge', 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(dir, '.bridge', 'run.sh')), true);
  assert.equal(fs.existsSync(path.join(dir, '.bridge', 'doctor.sh')), true);
});

test('package cli exposes help and init commands', () => {
  const help = spawnSync('node', [path.resolve('scripts/cli.mjs'), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /clawhip-discord-bridge/);
  assert.match(help.stdout, /init/);
});

test('tmux helpers can inspect the bridge session when tmux is accessible', (t) => {
  try {
    assert.equal(typeof getTmuxCurrentCommand('claude-pilot'), 'string');
    assert.equal(typeof getTmuxPaneTitle('claude-pilot'), 'string');
    assert.equal(typeof captureTmuxTail('claude-pilot', 5), 'string');
    assert.equal(typeof detectTmuxExecutor('claude-pilot'), 'string');
  } catch (error) {
    if (/Operation not permitted|failed to connect|No such file or directory/i.test(String(error))) {
      t.skip(`tmux unavailable in this environment: ${error.message}`);
      return;
    }
    throw error;
  }
});
