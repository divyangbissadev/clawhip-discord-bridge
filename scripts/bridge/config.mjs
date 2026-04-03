import process from 'node:process';

export function getBridgeRuntimeOptions(env = process.env) {
  return {
    pollMs: Number(env.CLAWHIP_BRIDGE_POLL_MS ?? 1000),
    responsePollMs: Number(env.CLAWHIP_BRIDGE_RESPONSE_POLL_MS ?? 500),
    responseTimeoutMs: Number(env.CLAWHIP_BRIDGE_RESPONSE_TIMEOUT_MS ?? 90000),
    allowBotMessages: env.CLAWHIP_BRIDGE_ALLOW_BOT_MESSAGES === '1',
    useClawhipNotifications: env.CLAWHIP_BRIDGE_USE_DAEMON !== '0',
    autoRegisterClawhipWatch: env.CLAWHIP_BRIDGE_REGISTER_TMUX_WATCH === '1',
  };
}
