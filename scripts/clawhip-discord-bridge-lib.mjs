import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".clawhip", "config.toml");
export const DEFAULT_STATE_PATH = path.join(
  os.homedir(),
  ".clawhip",
  "discord-command-bridge-state.json"
);
export const DEFAULT_EXECUTOR_COMMANDS = ["claude", "omx", "ralph"];

function readTomlString(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"));
  return match?.[1] ?? null;
}

function readTomlStringArray(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[(.*?)\\]\\s*$`, "ms"));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function escapeTomlTableName(tableName) {
  return tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTomlTable(text, tableName) {
  const lines = text.split(/\r?\n/);
  const header = `[${tableName}]`;
  const collected = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inTable) {
      if (trimmed === header) {
        inTable = true;
        collected.push(line);
      }
      continue;
    }

    if (/^\s*\[.*\]\s*$/.test(line) || /^\s*\[\[.*\]\]\s*$/.test(line)) {
      break;
    }

    collected.push(line);
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

function readFirstTmuxSession(text) {
  const blockMatch = text.match(/\[\[monitors\.tmux\.sessions\]\][\s\S]*?(?=\n\[\[|\n\[|$)/);
  if (!blockMatch) return null;
  return readTomlString(blockMatch[0], "session");
}

function readFirstGitRepoPath(text) {
  const blockMatch = text.match(/\[\[monitors\.git\.repos\]\][\s\S]*?(?=\n\[\[|\n\[|$)/);
  if (!blockMatch) return null;
  return readTomlString(blockMatch[0], "path");
}

export function loadBridgeConfig(configPath = DEFAULT_CONFIG_PATH) {
  const text = fs.readFileSync(configPath, "utf8");
  const bridgeBlock = readTomlTable(text, "discord_bridge") ?? "";
  const transportBlock = readTomlTable(text, "bridge_transport") ?? bridgeBlock;
  const discordProviderBlock = readTomlTable(text, "bridge_provider.discord") ?? readTomlTable(text, "providers.discord") ?? "";
  const telegramProviderBlock = readTomlTable(text, "bridge_provider.telegram") ?? "";
  const relayProviderBlock = readTomlTable(text, "bridge_provider.relay") ?? "";
  const webhookProviderBlock = readTomlTable(text, "bridge_provider.webhook") ?? "";
  const slackWebhookProviderBlock = readTomlTable(text, "bridge_provider.slack_webhook") ?? "";
  const teamsWebhookProviderBlock = readTomlTable(text, "bridge_provider.teams_webhook") ?? "";
  const provider =
    (process.env.CLAWHIP_BRIDGE_PROVIDER ??
      readTomlString(transportBlock, "provider") ??
      "discord").toLowerCase();
  const token =
    readTomlString(discordProviderBlock, "token") ??
    readTomlString(text, "token");
  const channelId =
    readTomlString(discordProviderBlock, "channel_id") ??
    readTomlString(discordProviderBlock, "default_channel") ??
    readTomlString(text, "default_channel");
  const monitorTmuxSession = readFirstTmuxSession(text) ?? "claude-pilot";
  const tmuxSession =
    process.env.CLAWHIP_BRIDGE_DISPATCH_SESSION ??
    readTomlString(bridgeBlock, "dispatch_session") ??
    monitorTmuxSession;
  const shellTmuxSession =
    process.env.CLAWHIP_BRIDGE_SHELL_SESSION ??
    readTomlString(bridgeBlock, "shell_session") ??
    `${tmuxSession}-shell`;
  const workingDirectory = readFirstGitRepoPath(text) ?? process.cwd();
  const allowedUserIds = readTomlStringArray(bridgeBlock, "allowed_user_ids");
  const allowedCommandPrefixes = readTomlStringArray(bridgeBlock, "allowed_command_prefixes");
  const executorCommands = [
    ...new Set(
      (
        readTomlStringArray(bridgeBlock, "executor_commands").length > 0
          ? readTomlStringArray(bridgeBlock, "executor_commands")
          : DEFAULT_EXECUTOR_COMMANDS
      ).map((entry) => entry.toLowerCase())
    ),
  ];
  const defaultExecutor = (
    process.env.CLAWHIP_BRIDGE_DEFAULT_EXECUTOR ??
    readTomlString(bridgeBlock, "default_executor") ??
    executorCommands[0] ??
    DEFAULT_EXECUTOR_COMMANDS[0]
  ).toLowerCase();

  if (provider === "discord") {
    if (!token) {
      throw new Error(`No Discord bot token found in ${configPath}`);
    }

    if (!channelId) {
      throw new Error(`No default Discord channel found in ${configPath}`);
    }
  }

  return {
    configPath,
    provider,
    token,
    channelId,
    monitorTmuxSession,
    tmuxSession,
    shellTmuxSession,
    workingDirectory,
    allowedUserIds,
    allowedCommandPrefixes,
    executorCommands,
    defaultExecutor,
    providers: {
      discord: {
        token,
        channelId,
      },
      telegram: {
        botToken:
          process.env.CLAWHIP_BRIDGE_TELEGRAM_BOT_TOKEN ??
          readTomlString(telegramProviderBlock, "bot_token"),
        chatId:
          process.env.CLAWHIP_BRIDGE_TELEGRAM_CHAT_ID ??
          readTomlString(telegramProviderBlock, "chat_id"),
        apiBaseUrl:
          process.env.CLAWHIP_BRIDGE_TELEGRAM_API_BASE_URL ??
          readTomlString(telegramProviderBlock, "api_base_url") ??
          "https://api.telegram.org",
      },
      relay: {
        inboundUrl:
          process.env.CLAWHIP_BRIDGE_RELAY_INBOUND_URL ??
          readTomlString(relayProviderBlock, "inbound_url"),
        outboundUrl:
          process.env.CLAWHIP_BRIDGE_RELAY_OUTBOUND_URL ??
          readTomlString(relayProviderBlock, "outbound_url"),
        identityUrl:
          process.env.CLAWHIP_BRIDGE_RELAY_IDENTITY_URL ??
          readTomlString(relayProviderBlock, "identity_url"),
        selfId:
          process.env.CLAWHIP_BRIDGE_RELAY_SELF_ID ??
          readTomlString(relayProviderBlock, "self_id"),
        authHeaderName:
          process.env.CLAWHIP_BRIDGE_RELAY_AUTH_HEADER_NAME ??
          readTomlString(relayProviderBlock, "auth_header_name"),
        authHeaderValue:
          process.env.CLAWHIP_BRIDGE_RELAY_AUTH_HEADER_VALUE ??
          readTomlString(relayProviderBlock, "auth_header_value"),
      },
      webhook: {
        webhookUrl:
          process.env.CLAWHIP_BRIDGE_WEBHOOK_URL ??
          readTomlString(webhookProviderBlock, "webhook_url"),
      },
      slackWebhook: {
        webhookUrl:
          process.env.CLAWHIP_BRIDGE_SLACK_WEBHOOK_URL ??
          readTomlString(slackWebhookProviderBlock, "webhook_url"),
      },
      teamsWebhook: {
        webhookUrl:
          process.env.CLAWHIP_BRIDGE_TEAMS_WEBHOOK_URL ??
          readTomlString(teamsWebhookProviderBlock, "webhook_url"),
      },
    },
  };
}

export function parseFixCommand(content) {
  const trimmed = content.trim();
  if (trimmed === "fix" || trimmed === "!fix") {
    return "fix";
  }
  if (trimmed.startsWith("fix ")) {
    return trimmed.slice(4).trim() || "fix";
  }
  if (trimmed.startsWith("!fix ")) {
    return trimmed.slice(5).trim() || "fix";
  }
  return null;
}

const DANGEROUS_TOKENS = ["&&", "||", ";", "|", ">", "<", "`", "$("];
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const REPO_COMMIT_PATHS = [
  "apps",
  "packages",
  "prisma",
  "svc-auth",
  "svc-gateway",
  "svc-vcs",
  "svc-ingest",
  "svc-review",
  "svc-notify",
  "svc-analytics",
  "worker",
  "tests",
  "package.json",
  "package-lock.json",
  "turbo.json",
  "tsconfig.base.json",
  "docker-compose.yml",
  "docker-compose.dev.yml",
  "docker-compose.platform.yml",
  "Dockerfile",
];

export function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

export function buildExecutorInvocation(executor, prompt) {
  const quotedPrompt = shellSingleQuote(prompt);
  switch (executor) {
    case "omx":
      return `omx exec --dangerously-bypass-approvals-and-sandbox ${quotedPrompt}`;
    case "codex":
      return `codex exec --dangerously-bypass-approvals-and-sandbox ${quotedPrompt}`;
    default:
      return `${executor} ${quotedPrompt}`;
  }
}

export function getExecutorSessionName(baseSession, executor) {
  return `${baseSession}-${executor}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildExecutorCommand(command, executorCommands = DEFAULT_EXECUTOR_COMMANDS) {
  const trimmed = command.trim();
  const executorAlternation = executorCommands.map(escapeRegExp).join("|");
  const match = trimmed.match(new RegExp(`^@?(${executorAlternation})(?::([a-z0-9-]+))?\\s+(.+)$`, "i"));
  if (!match) return null;

  return buildExecutorCommandFromParts({
    executor: match[1].toLowerCase(),
    agent: match[2]?.toLowerCase() ?? null,
    task: match[3].trim(),
  });
}

export function buildExecutorCommandFromParts({ executor, agent = null, task }) {
  if (!task) return null;

  const prompt = agent
    ? `Use the ${agent} agent for this task: ${task}`
    : task;

  return {
    executor,
    agent,
    task,
    shellCommand: buildExecutorInvocation(executor, prompt),
  };
}

export function buildGitCommand(command) {
  const trimmed = command.trim();
  const statusMatch = trimmed.match(/^git\s+status$/i);
  if (statusMatch) {
    return {
      kind: "git",
      action: "status",
      description: "git status",
      shellCommand: "git status",
    };
  }

  const branchCurrentMatch = trimmed.match(/^git\s+branch\s+current$/i);
  if (branchCurrentMatch) {
    return {
      kind: "git",
      action: "branch-current",
      description: "git branch current",
      shellCommand: "git branch --show-current",
    };
  }

  const branchListMatch = trimmed.match(/^git\s+branch\s+list$/i);
  if (branchListMatch) {
    return {
      kind: "git",
      action: "branch-list",
      description: "git branch list",
      shellCommand: "git branch --list",
    };
  }

  const branchCreateMatch = trimmed.match(/^git\s+branch\s+(?:create|new)\s+([A-Za-z0-9._/-]+)$/i);
  if (branchCreateMatch) {
    const branch = branchCreateMatch[1];
    if (!SAFE_BRANCH_RE.test(branch)) return null;
    return {
      kind: "git",
      action: "branch-create",
      branch,
      description: `git branch create ${branch}`,
      shellCommand: `git switch -c ${shellSingleQuote(branch)}`,
    };
  }

  const branchSwitchMatch = trimmed.match(/^git\s+branch\s+(?:switch|checkout)\s+([A-Za-z0-9._/-]+)$/i);
  if (branchSwitchMatch) {
    const branch = branchSwitchMatch[1];
    if (!SAFE_BRANCH_RE.test(branch)) return null;
    return {
      kind: "git",
      action: "branch-switch",
      branch,
      description: `git branch switch ${branch}`,
      shellCommand: `git switch ${shellSingleQuote(branch)}`,
    };
  }

  const repoCommitMatch = trimmed.match(/^git\s+commit\s+(?:repo|code)\s+(.+)$/i);
  if (repoCommitMatch) {
    const message = repoCommitMatch[1].trim();
    if (!message || DANGEROUS_TOKENS.some((token) => message.includes(token))) {
      return null;
    }
    const quotedPaths = REPO_COMMIT_PATHS.map((entry) => shellSingleQuote(entry)).join(" ");
    return {
      kind: "git",
      action: "commit-repo",
      message,
      description: `git commit repo ${message}`,
      shellCommand: `git add -- ${quotedPaths} && git commit -m ${shellSingleQuote(message)}`,
    };
  }

  const commitMatch = trimmed.match(/^git\s+commit\s+(.+)$/i);
  if (commitMatch) {
    const message = commitMatch[1].trim();
    if (!message || DANGEROUS_TOKENS.some((token) => message.includes(token))) {
      return null;
    }
    return {
      kind: "git",
      action: "commit",
      message,
      description: `git commit ${message}`,
      shellCommand: `git add -A && git commit -m ${shellSingleQuote(message)}`,
    };
  }

  const pushMatch = trimmed.match(/^git\s+push$/i);
  if (pushMatch) {
    return {
      kind: "git",
      action: "push",
      description: "git push",
      shellCommand: "git push origin HEAD",
    };
  }

  const prCreateMatch = trimmed.match(/^git\s+pr\s+create(?:\s+(.+))?$/i);
  if (prCreateMatch) {
    const title = prCreateMatch[1]?.trim() ?? "";
    if (title && DANGEROUS_TOKENS.some((token) => title.includes(token))) {
      return null;
    }
    return {
      kind: "git",
      action: "pr-create",
      title,
      description: title ? `git pr create ${title}` : "git pr create",
      shellCommand: title
        ? `gh pr create --fill --title ${shellSingleQuote(title)}`
        : "gh pr create --fill",
    };
  }

  return null;
}

export function isAllowedCommand(command, allowedPrefixes) {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (DANGEROUS_TOKENS.some((token) => trimmed.includes(token))) {
    return false;
  }

  return allowedPrefixes.some((prefix) => {
    const normalized = prefix.trim();
    return trimmed === normalized || trimmed.startsWith(normalized + " ");
  });
}

export function ensureTmuxSession(session, cwd) {
  const existing = spawnSync("tmux", ["has-session", "-t", session], { encoding: "utf8" });
  if (existing.status === 0) {
    return { created: false };
  }

  const created = spawnSync(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      session,
      "-c",
      cwd,
      '/bin/zsh -f -c "echo Discord bridge ready; exec /bin/zsh -f"',
    ],
    { encoding: "utf8", shell: true }
  );

  if (created.status !== 0) {
    throw new Error(created.stderr?.trim() || created.stdout?.trim() || "Failed to create tmux session");
  }

  return { created: true };
}

export function sendCommandToTmux(session, command) {
  const result = spawnSync("tmux", ["send-keys", "-t", session, command, "Enter"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to send tmux command");
  }
}

export function sendKeysToTmux(session, keys) {
  const result = spawnSync("tmux", ["send-keys", "-t", session, ...keys], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to send tmux keys");
  }
}

export function getTmuxCurrentCommand(session) {
  const result = spawnSync("tmux", ["display-message", "-p", "-t", session, "#{pane_current_command}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to read tmux pane command");
  }
  return result.stdout.trim();
}

export function getTmuxPaneTitle(session) {
  const result = spawnSync("tmux", ["display-message", "-p", "-t", session, "#{pane_title}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to read tmux pane title");
  }
  return result.stdout.trim();
}

export function captureTmuxTail(session, lines = 20) {
  const result = spawnSync(
    "tmux",
    ["capture-pane", "-p", "-t", `${session}:0.0`, "-S", `-${Math.max(lines, 1)}`],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Failed to capture tmux pane");
  }
  return result.stdout.trim();
}

export function detectTmuxExecutorFromSignals(currentCommand, paneTitle = "", tail = "") {
  if (currentCommand === "claude" || currentCommand === "omx" || currentCommand === "ralph") {
    return currentCommand;
  }

  if (/^\d+\.\d+\.\d+$/.test(currentCommand) && paneTitle) {
    return "claude";
  }

  if (/\bralph\b/i.test(paneTitle) || /\bralph\b/i.test(tail)) {
    return "ralph";
  }

  if (/\bomx\b/i.test(paneTitle) || /\bomx\b/i.test(tail) || /oh-my-codex/i.test(tail)) {
    return "omx";
  }

  if (/\bclaude\b/i.test(paneTitle) || /Claude Code v/i.test(tail)) {
    return "claude";
  }

  return currentCommand;
}

export function detectTmuxExecutor(session) {
  const currentCommand = getTmuxCurrentCommand(session);
  const paneTitle = getTmuxPaneTitle(session);
  const tail = captureTmuxTail(session, 80);
  return detectTmuxExecutorFromSignals(currentCommand, paneTitle, tail);
}

export function readState(statePath = DEFAULT_STATE_PATH) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

export function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function isSnowflakeGreater(a, b) {
  return BigInt(a) > BigInt(b);
}
