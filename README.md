# Clawhip Discord Bridge

Standalone Discord ↔ tmux bridge for unattended development workflows.

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
