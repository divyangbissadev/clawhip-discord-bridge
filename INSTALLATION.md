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

## 3b. Repo-local bootstrap option

If you want the bridge to feel local to your codebase, run:

```bash
cd /path/to/your-target-repo
node /path/to/clawhip-discord-bridge/scripts/init.mjs
```

This creates a `.bridge/` folder in the target repo with:

- `config.toml`
- `.env.example`
- `run.sh`
- `status.sh`
- `stop.sh`
- `doctor.sh`

Then:

```bash
cd /path/to/your-target-repo
.bridge/doctor.sh
.bridge/run.sh
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

## 5b. Run the one-port relay server

If you want Slack / Teams / WhatsApp / custom chat support on a single port,
run the built-in relay:

```bash
BRIDGE_RELAY_PORT=3031 \
BRIDGE_RELAY_AUTH_TOKEN="YOUR_SHARED_SECRET" \
BRIDGE_RELAY_OUTBOUND_MODE=stdout \
npm run relay:start
```

Main endpoints:

- `GET /healthz`
- `GET /me`
- `GET /inbound?after=<cursor>&limit=<n>`
- `POST /outbound`
- `POST /ingest/slack`
- `POST /ingest/teams`
- `POST /ingest/telegram`
- `POST /ingest/whatsapp`
- `POST /ingest/generic`

Auth:

- set `BRIDGE_RELAY_AUTH_TOKEN`
- send `Authorization: Bearer YOUR_SHARED_SECRET`

### Relay outbound modes

- `stdout` — prints bridge messages to stdout
- `webhook` — generic outbound webhook
- `slack-webhook` — Slack incoming webhook payload
- `teams-webhook` — Teams webhook payload
- `telegram` — direct Telegram delivery

Example:

```bash
BRIDGE_RELAY_OUTBOUND_MODE=slack-webhook \
BRIDGE_RELAY_WEBHOOK_URL="https://hooks.slack.com/services/..." \
npm run relay:start
```

Then point the bridge to the relay:

```toml
[bridge_transport]
provider = "relay"

[bridge_provider.relay]
inbound_url = "http://127.0.0.1:3031/inbound"
outbound_url = "http://127.0.0.1:3031/outbound"
identity_url = "http://127.0.0.1:3031/me"
auth_header_name = "Authorization"
auth_header_value = "Bearer YOUR_SHARED_SECRET"
```

### Ingest examples

Slack-style event:

```bash
curl -X POST http://127.0.0.1:3031/ingest/slack \
  -H "Authorization: Bearer YOUR_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event":{"text":"fix login validation","user":"U123","username":"divyang","channel":"C123"}}'
```

Teams-style webhook:

```bash
curl -X POST http://127.0.0.1:3031/ingest/teams \
  -H "Authorization: Bearer YOUR_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text":"review auth migration","from":{"id":"user-1","name":"Divyang"}}'
```

Twilio WhatsApp-style webhook:

```bash
curl -X POST http://127.0.0.1:3031/ingest/whatsapp \
  -H "Authorization: Bearer YOUR_SHARED_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'Body=fix+login+validation&From=whatsapp%3A%2B10000000000&To=whatsapp%3A%2B19999999999'
```

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
