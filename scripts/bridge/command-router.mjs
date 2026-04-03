import {
  DEFAULT_EXECUTOR_COMMANDS,
  buildExecutorCommand,
  buildExecutorCommandFromParts,
  buildExecutorInvocation,
  buildGitCommand,
  getExecutorSessionName,
  isAllowedCommand,
} from '../clawhip-discord-bridge-lib.mjs';

const DEFAULT_ALLOWED_COMMAND_PREFIXES = [
  'echo',
  'pwd',
  'ls',
  'git status',
  'npm run test',
  'npm run test:root',
  'npm run typecheck',
  'npm run typecheck:root',
  'npm run lint',
  'npm run build',
  'npm run build:root',
];

const BRIDGE_TASK_CONTRACT = [
  'Bridge autonomy contract:',
  '- Work independently until you hit a real blocker or reach a reviewable checkpoint.',
  '- If you need human review, end with exactly `BRIDGE_STATUS: review-ready`.',
  '- If you need human feedback or approval, end with exactly `BRIDGE_STATUS: feedback-needed`.',
  '- If the task is complete, end with exactly `BRIDGE_STATUS: complete`.',
  '- Keep the final response concise and operational.',
].join('\n');

export function getAllowedPrefixes(bridgeConfig) {
  return bridgeConfig.allowedCommandPrefixes.length > 0
    ? bridgeConfig.allowedCommandPrefixes
    : DEFAULT_ALLOWED_COMMAND_PREFIXES;
}

export function parseBridgeMetaCommand(command, executorCommands = DEFAULT_EXECUTOR_COMMANDS) {
  const trimmed = command.trim();
  const executorAlternation = executorCommands.map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const executorPrefix = executorAlternation.length > 0 ? `@?(?:${executorAlternation})` : '@?(?:claude|omx|ralph)';
  const decisionMatch = trimmed.match(new RegExp(`^(?:(${executorPrefix})\\s+)?(approve(?:[- ]always)?|reject|abort)$`, 'i'));
  if (decisionMatch) {
    const rawKind = decisionMatch[2].toLowerCase();
    return {
      kind: rawKind === 'approve always' || rawKind === 'approve-always'
        ? 'approve-always'
        : rawKind,
      executor: decisionMatch[1]?.replace(/^@/, '').toLowerCase() ?? null,
    };
  }

  const summaryMatch = trimmed.match(new RegExp(`^(?:(${executorPrefix})\\s+)?(summary|review|status)$`, 'i'));
  if (summaryMatch) {
    return {
      kind: 'summary',
      executor: summaryMatch[1]?.replace(/^@/, '').toLowerCase() ?? null,
    };
  }

  const continueMatch = trimmed.match(new RegExp(`^(?:(${executorPrefix})\\s+)?continue$`, 'i'));
  if (continueMatch) {
    return {
      kind: 'continue',
      executor: continueMatch[1]?.replace(/^@/, '').toLowerCase() ?? null,
    };
  }

  return null;
}

function parseNaturalLanguageAgentTask(command) {
  const trimmed = command.trim();
  const patterns = [
    /^use\s+(?:the\s+)?([a-z0-9-]+)\s+agent\s+(?:to|for)\s+(.+)$/i,
    /^([a-z0-9-]+)\s+agent\s*[:,-]?\s+(.+)$/i,
    /^with\s+(?:the\s+)?([a-z0-9-]+)\s+agent\s*[:,-]?\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        agent: match[1].toLowerCase(),
        task: match[2].trim(),
      };
    }
  }

  return null;
}

function parseNaturalLanguageExecutorTask(command, executorCommands) {
  const trimmed = command.trim();
  const executorAlternation = executorCommands.map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!executorAlternation) {
    return null;
  }

  const patterns = [
    new RegExp(`^use\\s+(${executorAlternation})\\s+(?:to|for)\\s+(.+)$`, 'i'),
    new RegExp(`^with\\s+(${executorAlternation})\\s*[:,-]?\\s+(.+)$`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        executor: match[1].toLowerCase(),
        task: match[2].trim(),
      };
    }
  }

  return null;
}

function extractSkillInvocations(text) {
  return [...text.matchAll(/(^|\s)\$([a-z0-9-]+)/gi)].map((match) => `$${match[2].toLowerCase()}`);
}

function buildExecutorRoute(selectedExecutorCommand, bridgeConfig) {
  const skills = extractSkillInvocations(selectedExecutorCommand.task);
  return {
    kind: 'dispatch',
    routeType: 'executor',
    targetSession: getExecutorSessionName(bridgeConfig.tmuxSession, selectedExecutorCommand.executor),
    shellCommand: buildExecutorShellCommand(selectedExecutorCommand),
    task: selectedExecutorCommand.task,
    executorName: selectedExecutorCommand.executor,
    agent: selectedExecutorCommand.agent ?? null,
    skills,
    ackLabel: selectedExecutorCommand.agent
      ? `${selectedExecutorCommand.executor}:${selectedExecutorCommand.agent}`
      : selectedExecutorCommand.executor,
  };
}

function buildExecutorShellCommand(executorCommand) {
  const taskPrompt = `${executorCommand.task}\n\n${BRIDGE_TASK_CONTRACT}`;
  const prompt = executorCommand.agent
    ? `Use the ${executorCommand.agent} agent for this task:\n\n${taskPrompt}`
    : taskPrompt;
  return buildExecutorInvocation(executorCommand.executor, prompt);
}

export function routeBridgeCommand(command, bridgeConfig, options = {}) {
  const configuredExecutors = bridgeConfig.executorCommands?.length > 0
    ? bridgeConfig.executorCommands
    : DEFAULT_EXECUTOR_COMMANDS;
  const executorCommand = buildExecutorCommand(command, configuredExecutors);
  const gitCommand = buildGitCommand(command);
  const metaCommand = parseBridgeMetaCommand(command, configuredExecutors);
  const naturalLanguageAgentTask = parseNaturalLanguageAgentTask(command);
  const naturalLanguageExecutorTask = parseNaturalLanguageExecutorTask(command, configuredExecutors);

  const implicitExecutorCommand = !executorCommand && !gitCommand && !metaCommand
    ? buildExecutorCommandFromParts({
        executor:
          naturalLanguageExecutorTask?.executor ??
          bridgeConfig.defaultExecutor ??
          configuredExecutors[0] ??
          DEFAULT_EXECUTOR_COMMANDS[0],
        agent: naturalLanguageAgentTask?.agent ?? null,
        task: naturalLanguageAgentTask?.task ?? naturalLanguageExecutorTask?.task ?? command.trim(),
      })
    : null;

  if (
    !executorCommand &&
    !gitCommand &&
    !metaCommand &&
    !implicitExecutorCommand &&
    !isAllowedCommand(command, getAllowedPrefixes(bridgeConfig))
  ) {
    return {
      kind: 'rejected',
      message: `⛔ command rejected: \`${command}\` is not a supported executor/git/meta task or safe allowlisted command`,
    };
  }

  if (metaCommand) {
    return { kind: 'meta', metaCommand };
  }

  const selectedExecutorCommand = executorCommand ?? implicitExecutorCommand;
  if (selectedExecutorCommand) {
    return buildExecutorRoute(selectedExecutorCommand, bridgeConfig);
  }

  if (gitCommand) {
    return {
      kind: 'dispatch',
      routeType: 'git',
      targetSession: bridgeConfig.shellTmuxSession,
      shellCommand: gitCommand.shellCommand,
      description: gitCommand.description,
    };
  }

  return {
    kind: 'dispatch',
    routeType: 'shell',
    targetSession: bridgeConfig.shellTmuxSession,
    shellCommand: command,
    description: command,
  };
}
