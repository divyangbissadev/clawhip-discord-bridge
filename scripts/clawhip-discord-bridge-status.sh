#!/bin/zsh
set -euo pipefail

SESSION="${CLAWHIP_BRIDGE_SESSION:-clawhip-discord-bridge}"
LOGFILE="${CLAWHIP_BRIDGE_LOG:-/tmp/clawhip-discord-bridge.log}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "bridge session '$SESSION' is running"
  tmux list-panes -t "$SESSION" -F '#{session_name} #{pane_id} #{pane_current_command} #{pane_dead}'
else
  echo "bridge session '$SESSION' is not running"
fi

if [[ -f "$LOGFILE" ]]; then
  echo "--- recent bridge log ---"
  tail -n 20 "$LOGFILE"
fi
