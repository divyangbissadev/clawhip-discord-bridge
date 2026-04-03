#!/usr/bin/env bash
set -euo pipefail

SESSION="${CLAWHIP_BRIDGE_SESSION:-clawhip-discord-bridge}"
WORKDIR="${CLAWHIP_BRIDGE_WORKDIR:-$PWD}"
LOGFILE="${CLAWHIP_BRIDGE_LOG:-/tmp/clawhip-discord-bridge.log}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "bridge session '$SESSION' already running"
  exit 0
fi

touch "$LOGFILE"
WORKDIR_ESCAPED=$(printf '%q' "$WORKDIR")
LOGFILE_ESCAPED=$(printf '%q' "$LOGFILE")
tmux new-session -d -s "$SESSION" \
  /bin/zsh -lc "cd ${WORKDIR_ESCAPED} && node scripts/clawhip-discord-bridge.mjs >> ${LOGFILE_ESCAPED} 2>&1"
echo "started bridge in tmux session '$SESSION'"
echo "log: $LOGFILE"
