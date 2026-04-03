# Clawhip Discord Bridge

Standalone Discord ↔ tmux bridge for unattended development workflows.

[![CI](https://github.com/divyangbissadev/clawhip-discord-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/divyangbissadev/clawhip-discord-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Run natural-language coding tasks from Discord, route them into dedicated tmux
sessions, and get concise replies plus task lifecycle updates back in-channel.

## Features

- Plain-language task dispatch from Discord
- Selective executor routing: `@claude`, `@omx`, `@codex`
- Selective agent routing: `use architect agent to ...`
- Dedicated per-executor tmux sessions
- Shell/git command routing to a separate shell session
- Task lifecycle context messages:
  - start time
  - current task
  - status
  - elapsed time
  - executor / agent
  - applied `$skills`
  - token usage when available
- Permission prompt relay (`approve`, `approve always`, `reject`, `abort`, `continue`)

## Layout

- `scripts/clawhip-discord-bridge.mjs` — entrypoint
- `scripts/clawhip-discord-bridge-lib.mjs` — config/tmux helpers
- `scripts/bridge/` — router, runtime, reply formatting, state, notifications
- `scripts/clawhip-discord-bridge.test.mjs` — regression tests

## Quick start

1. Install prerequisites:
   - Node 20+
   - `tmux`
   - `clawhip`
   - one or more executor CLIs on PATH (`claude`, `omx`, `codex`, etc.)
2. Configure your Discord bot and Clawhip daemon.
3. Add a `[discord_bridge]` section to your `~/.clawhip/config.toml`.
4. Start the bridge:

```bash
bash scripts/clawhip-discord-bridge-run.sh
```

5. Send a Discord message such as:

```text
fix login validation and run tests
```

## Requirements

- Node 20+
- `tmux`
- `clawhip`
- one or more executor CLIs available on PATH (`claude`, `omx`, `codex`, etc.)
- a configured Discord bot token in your Clawhip config

## Scripts

```bash
npm test
npm run check
node scripts/clawhip-discord-bridge.mjs --process-command "git status"
node scripts/clawhip-discord-bridge.mjs
bash scripts/clawhip-discord-bridge-run.sh
bash scripts/clawhip-discord-bridge-status.sh
bash scripts/clawhip-discord-bridge-stop.sh
```

## Example `~/.clawhip/config.toml` bridge section

```toml
[discord_bridge]
dispatch_session = "claude-pilot-dispatch"
shell_session = "claude-pilot-dispatch-shell"
default_executor = "codex"
executor_commands = ["claude", "omx", "codex"]
allowed_user_ids = ["YOUR_DISCORD_USER_ID"]
allowed_command_prefixes = ["echo", "pwd", "ls", "git status"]
```

Optional:

- `dispatch_session` isolates unattended executor work
- `shell_session` isolates shell/git commands
- `default_executor` controls where plain-language tasks go
- `executor_commands` declares allowed executor prefixes in Discord

## What Discord receives

For each task, the bridge can send:

- an initial queued acknowledgement
- a task context card with:
  - task id
  - status
  - start time
  - elapsed time
  - executor / agent
  - applied `$skills`
  - token usage when exposed by the CLI
- a concise terminal reply
- a completion / review / feedback / approval notice

## Dedicated executor sessions

Executor tasks are isolated into per-executor tmux sessions:

- `claude-pilot-dispatch-claude`
- `claude-pilot-dispatch-omx`
- `claude-pilot-dispatch-codex`

This prevents a blocked executor from trapping unrelated tasks.

## Discord usage examples

- Plain language: `fix login validation and run tests`
- Explicit executor: `@codex implement the dashboard fix`
- Natural executor selection: `use omx to plan the auth refactor`
- Agent selection: `use architect agent to review auth flow`
- Shell/git: `git status`, `pwd`
- Control: `status`, `continue`, `abort`, `approve`, `reject`

## Notes

- Plain language goes to the configured `default_executor`.
- Executors are isolated into separate tmux sessions derived from `dispatch_session`.
- Shell/git commands use `shell_session`.
- For unattended work, prefer `codex` or `omx`; use `@claude ...` when you specifically want Claude.

## Safety notes

- Keep secrets only in your local `~/.clawhip/config.toml`, never in this repo.
- Restrict `allowed_user_ids` so only trusted Discord users can dispatch work.
- Prefer allowlisted shell commands for routine operational tasks.

## Development

```bash
npm test
npm run check
```

CI runs both commands on pushes and pull requests.
