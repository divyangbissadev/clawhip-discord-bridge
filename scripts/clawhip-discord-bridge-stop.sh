#!/bin/zsh
set -euo pipefail

SESSION="${CLAWHIP_BRIDGE_SESSION:-clawhip-discord-bridge}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  echo "stopped bridge session '$SESSION'"
else
  echo "bridge session '$SESSION' not running"
fi
