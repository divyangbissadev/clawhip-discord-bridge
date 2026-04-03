# Discord Bridge Framework

This bridge is split into small modules so the Discord ingress, command routing, tmux driver, and reply handling can evolve independently.

## Modules

- `config.mjs`: runtime polling options
- `discord-adapter.mjs`: Discord REST adapter and message text extraction
- `command-router.mjs`: executor/git/meta routing plus the autonomous task contract
- `reply-monitor.mjs`: tmux reply diffing and `BRIDGE_STATUS` detection
- `runtime.mjs`: poll loop, allowlist enforcement, dispatch, and Discord notifications
- `../clawhip-discord-bridge.mjs`: thin entrypoint for Discord mode and local `--process-command` mode

## Supported command shapes

- `@claude <task>`
- `@omx <task>`
- `@ralph <task>`
- `@codex <task>` when `executor_commands` includes `codex`
- `claude <task>` / `omx <task>` / `ralph <task>`
- `approve`, `reject`, `abort`, `continue`, `summary`, `review`, `status` with optional executor prefix
- safe allowlisted shell commands and the curated git shortcuts from `clawhip-discord-bridge-lib.mjs`
- plain-language tasks (these default to the configured dispatch executor/session)
- natural-language executor selection such as `use omx to ...`
- natural-language agent selection such as `use architect agent to ...`

## Autonomous workflow markers

Executor tasks are wrapped with a bridge contract. The agent should end with one of:

- `BRIDGE_STATUS: review-ready`
- `BRIDGE_STATUS: feedback-needed`
- `BRIDGE_STATUS: complete`

When one of those markers appears in the tmux reply, the bridge posts the normal reply followed by a Discord notice for review, feedback, or completion.

## Local test mode

```bash
node scripts/clawhip-discord-bridge.mjs --process-command "@ralph build the review flow"
```

That uses the same routing/runtime path as Discord, but prints notifications to stdout instead of posting them.

## Dispatch-style state

The bridge persists dispatch history in bridge state so `summary` / `review` / `status`
can report both the live tmux tail and the latest queued task status.

Outbound bridge notifications are Clawhip-first:

- `clawhip send` is used for bridge acks, replies, review-ready, feedback-needed, and completion notices
- if the local Clawhip daemon is unavailable, the bridge falls back to direct Discord posts
- `clawhip tmux watch` registration is opt-in via `CLAWHIP_BRIDGE_REGISTER_TMUX_WATCH=1` because some `clawhip tmux watch` setups run as a long-lived process

## Unattended development mode

Use a dedicated dispatch session in config:

```toml
[discord_bridge]
dispatch_session = "claude-pilot-dispatch"
shell_session = "claude-pilot-dispatch-shell"
default_executor = "claude"
executor_commands = ["claude", "omx", "codex"]
```

When a task starts or changes state, the bridge posts a context message with:

- start time
- current task
- status
- elapsed time
- executor / agent
- applied `$skills`
- token usage when the CLI exposes it
