#!/usr/bin/env node
import process from 'node:process';
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_STATE_PATH,
  loadBridgeConfig,
  readState,
  writeState,
} from './clawhip-discord-bridge-lib.mjs';
import { getBridgeRuntimeOptions } from './bridge/config.mjs';
import { createMessagingAdapter } from './messaging/provider-factory.mjs';
import { executeBridgeCommand, runBridge } from './bridge/runtime.mjs';

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const bridgeConfig = loadBridgeConfig(process.env.CLAWHIP_BRIDGE_CONFIG ?? DEFAULT_CONFIG_PATH);
  const statePath = process.env.CLAWHIP_BRIDGE_STATE ?? DEFAULT_STATE_PATH;
  const runtimeOptions = getBridgeRuntimeOptions(process.env);
  const inlineCommand = getArgValue('--process-command');

  if (inlineCommand) {
    await executeBridgeCommand({
      content: inlineCommand,
      authorName: 'local-test',
      bridgeConfig,
      runtimeOptions,
      notify: async (message) => {
        console.log(message);
      },
    });
    return;
  }

  const adapter = createMessagingAdapter(bridgeConfig);

  await runBridge({
    bridgeConfig,
    adapter,
    runtimeOptions,
    statePath,
    readState,
    writeState,
  });
}

main().catch((error) => {
  console.error('[clawhip-bridge] fatal:', error);
  process.exit(1);
});
