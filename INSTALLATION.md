# Agent-centric installation guide

This bridge is designed for an **agent-first workflow**:

- you send plain-language tasks from a messaging app
- the bridge routes them into dedicated tmux sessions
- your coding CLI (`codex`, `omx`, `claude`, etc.) works unattended
- task context and concise replies flow back to the chat

## 1. Install prerequisites

Required:

- Node 20+
- `tmux`
- `clawhip`
- at least one executor CLI on PATH:
  - `codex`
  - `omx`
  - `claude`

Verify:

```bash
node --version
tmux -V
clawhip --version
codex --version || true
omx --version || true
claude --version || true
```

## 2. Clone the bridge

```bash
git clone https://github.com/divyangbissadev/clawhip-discord-bridge.git
cd clawhip-discord-bridge
```

## 3. Verify the bridge itself

```bash
npm test
npm run check
```

## 4. Choose a messaging transport

Supported transport modes:

- `discord` — native polling + native posting
- `telegram` — native polling + native posting
- `relay` — generic inbound/outbound HTTP relay for any messenger
- `slack-webhook` — outbound notifications via Slack incoming webhook
- `teams-webhook` — outbound notifications via Teams webhook
- `webhook` — generic outbound-only webhook

### Recommended transport choices

- **Discord**: easiest end-to-end setup
- **Telegram**: easiest second native option
- **Relay**: best option for Slack / Teams / WhatsApp / anything custom

## 5. Configure Clawhip

Edit `~/.clawhip/config.toml`.

### Common bridge config

```toml
[bridge_transport]
provider = "discord"

[discord_bridge]
dispatch_session = "agent-bridge-dispatch"
shell_session = "agent-bridge-shell"
default_executor = "codex"
executor_commands = ["codex", "omx", "claude"]
allowed_user_ids = ["YOUR_CHAT_USER_ID"]
allowed_command_prefixes = ["echo", "pwd", "ls", "git status"]
```

### Discord native

```toml
[providers.discord]
token = "YOUR_DISCORD_BOT_TOKEN"
default_channel = "YOUR_DISCORD_CHANNEL_ID"
```

### Telegram native

```toml
[bridge_transport]
provider = "telegram"

[bridge_provider.telegram]
bot_token = "YOUR_TELEGRAM_BOT_TOKEN"
chat_id = "YOUR_TELEGRAM_CHAT_ID"
```

### Generic relay for Slack / Teams / WhatsApp / custom tools

```toml
[bridge_transport]
provider = "relay"

[bridge_provider.relay]
inbound_url = "https://your-relay.example.com/inbound"
outbound_url = "https://your-relay.example.com/outbound"
identity_url = "https://your-relay.example.com/me"
auth_header_name = "X-Bridge-Key"
auth_header_value = "YOUR_SHARED_SECRET"
```

The relay should normalize inbound messages into:

```json
{
  "messages": [
    {
      "id": "cursor-or-message-id",
      "content": "fix login validation and run tests",
      "author": {
        "id": "user-123",
        "username": "divyang",
        "global_name": "Divyang",
        "bot": false
      }
    }
  ]
}
```

And accept outbound posts like:

```json
{
  "content": "✅ task complete ..."
}
```

This is the recommended integration path for:

- Slack
- Microsoft Teams
- WhatsApp
- internal chat tools
- any webhook-capable messaging platform

## 6. Start the bridge

```bash
bash scripts/clawhip-discord-bridge-run.sh
bash scripts/clawhip-discord-bridge-status.sh
```

## 7. Send agent-centric tasks

Examples:

Plain language:

```text
fix login validation and run tests
```

Choose an executor:

```text
@codex implement the dashboard fix
use omx to plan the auth refactor
@claude review the migration diff
```

Choose an agent:

```text
use architect agent to review auth flow
use debugger agent to trace webhook failures
```

Operational commands:

```text
status
git status
continue
abort
approve
reject
```

## 8. What you will see in chat

For each task, the bridge can send:

- queued acknowledgement
- task context:
  - start time
  - task
  - status
  - elapsed time
  - executor
  - agent
  - applied `$skills`
  - token usage when available
- concise task reply
- completion / review / feedback / approval notices

## 9. Recommended unattended setup

For “I’m away, keep developing” mode:

- use `default_executor = "codex"` or `default_executor = "omx"`
- reserve `@claude ...` for explicitly interactive tasks
- keep `dispatch_session` dedicated to bridge work
- keep `shell_session` separate for shell/git operations

This avoids one blocked executor trapping all future tasks.
