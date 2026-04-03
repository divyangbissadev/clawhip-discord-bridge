# Quickstart

This is the shortest path to get the bridge running against a repo like `myproject`.

## 1. Prerequisites

Install these first:

- Node 20+
- npm
- git
- tmux
- clawhip
- at least one executor CLI:
  - `codex` recommended
  - `omx`
  - `claude`

Check:

```bash
node --version
npm --version
git --version
tmux -V
clawhip --version
codex --version || true
omx --version || true
claude --version || true
```

## 2. Recommended layout

```bash
~/Workspace/
  myproject/
  clawhip-discord-bridge/
```

- `myproject` = your app repo
- `clawhip-discord-bridge` = the bridge/control plane

## 3. Clone and verify the bridge

```bash
cd ~/Workspace
git clone https://github.com/divyangbissadev/clawhip-discord-bridge.git
cd clawhip-discord-bridge
npm test
npm run check
```

## 4. Make sure your app repo exists locally

```bash
cd ~/Workspace
git clone <YOUR_MYPROJECT_REPO_URL> myproject
```

## 5. Simplest repo-local setup

Inside your target repo:

```bash
cd ~/Workspace/myproject
node /Users/garima/Workspace/clawhip-discord-bridge/scripts/init.mjs
```

This creates:

```bash
myproject/.bridge/
  config.toml
  .env.example
  run.sh
  status.sh
  stop.sh
  doctor.sh
```

Then run:

```bash
cd ~/Workspace/myproject
.bridge/doctor.sh
```

## 6. Configure credentials

Edit:

```bash
~/Workspace/myproject/.bridge/config.toml
```

Fill in the placeholders:

- bot token / channel id
- allowed user id
- transport selection

## 7. Start Clawhip daemon

```bash
clawhip start
```

Verify:

```bash
clawhip status
```

## 8. Start the bridge from your repo

```bash
cd ~/Workspace/myproject
.bridge/run.sh
.bridge/status.sh
```

## 9. Alternative manual config path

If you want manual global config instead of repo-local sidecar, use:

Edit:

```bash
~/.clawhip/config.toml
```

Use this starter config:

```toml
[providers.discord]
token = "YOUR_DISCORD_BOT_TOKEN"
default_channel = "YOUR_DISCORD_CHANNEL_ID"

[[monitors.git.repos]]
path = "/Users/garima/Workspace/myproject"
name = "myproject"
remote = "origin"
emit_commits = true
emit_branch_changes = true
channel = "YOUR_DISCORD_CHANNEL_ID"
format = "compact"

[[monitors.tmux.sessions]]
session = "myproject"
keywords = ["FAILED", "panic"]
keyword_window_secs = 30
stale_minutes = 30
channel = "YOUR_DISCORD_CHANNEL_ID"
format = "alert"

[bridge_transport]
provider = "discord"

[discord_bridge]
dispatch_session = "myproject-dispatch"
shell_session = "myproject-shell"
default_executor = "codex"
executor_commands = ["codex", "omx", "claude"]
allowed_user_ids = ["YOUR_DISCORD_USER_ID"]
allowed_command_prefixes = ["echo", "pwd", "ls", "git status", "npm test", "npm run check"]
```

## 10. Send messages from Discord

Try these:

### Plain language

```text
fix login validation and run tests
```

### Explicit executor

```text
@codex implement dashboard pagination
use omx to plan the auth refactor
@claude review the migration diff
```

### Agent selection

```text
use architect agent to review auth flow
use debugger agent to trace webhook failures
```

### Operational commands

```text
status
git status
continue
abort
approve
reject
```

## 11. What you should see back

The bridge can send:

- queued acknowledgement
- task context
- concise terminal reply
- completion / review / approval notice

Task context includes:

- task id
- status
- start time
- elapsed time
- executor
- agent
- skills
- token usage when available

## 12. Best default for unattended work

Use:

```toml
default_executor = "codex"
```

Reason:
- better unattended flow
- less likely to get stuck in an interactive prompt than Claude

Use `@claude ...` only when you explicitly want Claude.

## 13. Useful commands

Check bridge status:

```bash
bash scripts/clawhip-discord-bridge-status.sh
```

Stop bridge:

```bash
bash scripts/clawhip-discord-bridge-stop.sh
```

Restart bridge:

```bash
bash scripts/clawhip-discord-bridge-stop.sh
bash scripts/clawhip-discord-bridge-run.sh
```

## 14. If you want Slack / Teams / WhatsApp later

Use the built-in relay path described in:

- `INSTALLATION.md`

Start relay:

```bash
npm run relay:start
```

## 15. If something does not work

Check in order:

```bash
clawhip status
bash scripts/clawhip-discord-bridge-status.sh
tmux ls
```

Expected tmux sessions usually include:

- `myproject`
- `myproject-shell`
- `myproject-dispatch-codex`
- `myproject-dispatch-omx`
- `myproject-dispatch-claude`
- `clawhip-discord-bridge`

## 16. Next docs

- `README.md` = overview
- `INSTALLATION.md` = detailed setup
- `QUICKSTART.md` = fastest setup path
