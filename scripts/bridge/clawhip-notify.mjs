import { spawnSync } from 'node:child_process';
import { DEFAULT_CONFIG_PATH } from '../clawhip-discord-bridge-lib.mjs';

export function runClawhip(args, { encoding = 'utf8' } = {}) {
  return spawnSync('clawhip', args, { encoding });
}

export function sendBridgeNotificationViaClawhip(message, bridgeConfig, run = runClawhip) {
  const configPath = bridgeConfig.configPath ?? process.env.CLAWHIP_CONFIG ?? DEFAULT_CONFIG_PATH;
  const args = ['send', '--config', configPath, '--channel', bridgeConfig.channelId, '--message', message];
  const result = run(args);
  const ok = result.status === 0;

  return {
    ok,
    args,
    error: ok
      ? null
      : result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'clawhip send failed',
  };
}

export function watchBridgeSessionWithClawhip(session, bridgeConfig, run = runClawhip) {
  const configPath = bridgeConfig.configPath ?? process.env.CLAWHIP_CONFIG ?? DEFAULT_CONFIG_PATH;
  const args = [
    'tmux',
    'watch',
    '--config',
    configPath,
    '--session',
    session,
    '--channel',
    bridgeConfig.channelId,
    '--format',
    'compact',
  ];

  const result = run(args);
  return {
    ok: result.status === 0,
    args,
    error:
      result.status === 0
        ? null
        : result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'clawhip tmux watch failed',
  };
}
