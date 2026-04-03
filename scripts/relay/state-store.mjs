import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_RELAY_STATE_PATH = path.join(
  os.homedir(),
  ".clawhip",
  "bridge-relay-state.json"
);

function ensureStateShape(state) {
  return {
    lastInboundId: state?.lastInboundId ?? 0,
    messages: Array.isArray(state?.messages) ? state.messages : [],
  };
}

export function readRelayState(statePath = DEFAULT_RELAY_STATE_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return ensureStateShape(parsed);
  } catch {
    return ensureStateShape({});
  }
}

export function writeRelayState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(ensureStateShape(state), null, 2));
}

export function appendRelayMessages(state, messages) {
  const safeState = ensureStateShape(state);
  for (const message of messages) {
    safeState.lastInboundId += 1;
    safeState.messages.push({
      ...message,
      id: String(safeState.lastInboundId),
      receivedAt: message.receivedAt ?? new Date().toISOString(),
    });
  }
  return safeState;
}

export function listRelayMessages(state, { after = null, limit = 20 } = {}) {
  const safeState = ensureStateShape(state);
  const filtered = after == null
    ? safeState.messages
    : safeState.messages.filter((message) => BigInt(message.id) > BigInt(String(after)));
  return filtered.slice(-Math.max(limit, 1));
}
