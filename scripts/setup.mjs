#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { initializeBridgeSidecar } from './init.mjs';
import { DEFAULT_CONFIG_PATH, loadBridgeConfig } from './clawhip-discord-bridge-lib.mjs';

function updateOrInsert(text, key, value) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*)(.+)$`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, `$1${value}`);
  }
  return `${text.trimEnd()}\n${key} = ${value}\n`;
}

function ensureTable(text, tableName) {
  if (new RegExp(`^\\s*\\[${tableName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\]\\s*$`, 'm').test(text)) {
    return text;
  }
  return `${text.trimEnd()}\n\n[${tableName}]\n`;
}

function applyTableValues(text, tableName, entries) {
  let next = ensureTable(text, tableName);
  const lines = next.split(/\r?\n/);
  const header = `[${tableName}]`;
  const startIndex = lines.findIndex((line) => line.trim() === header);
  if (startIndex < 0) return next;
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[i]) || /^\s*\[\[.*\]\]\s*$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }
  let block = lines.slice(startIndex, endIndex).join('\n');
  for (const [key, value] of Object.entries(entries)) {
    if (value == null) continue;
    block = updateOrInsert(block, key, value);
  }
  return [...lines.slice(0, startIndex), ...block.split('\n'), ...lines.slice(endIndex)].join('\n');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function quoteArray(values) {
  return `[${values.map((value) => JSON.stringify(String(value))).join(', ')}]`;
}

function setupDiscord(cwd) {
  const sidecar = initializeBridgeSidecar(cwd);
  const sourceConfigPath = process.env.CLAWHIP_BRIDGE_SOURCE_CONFIG ?? DEFAULT_CONFIG_PATH;
  const sourceConfig = loadBridgeConfig(sourceConfigPath);
  let configText = fs.readFileSync(sidecar.configPath, 'utf8');

  configText = applyTableValues(configText, 'providers.discord', {
    token: quote(sourceConfig.providers.discord.token ?? ''),
    default_channel: quote(sourceConfig.providers.discord.channelId ?? ''),
  });

  configText = applyTableValues(configText, 'discord_bridge', {
    default_executor: quote(sourceConfig.defaultExecutor ?? sidecar.defaultExecutor),
    executor_commands: quoteArray(sourceConfig.executorCommands ?? ['codex', 'omx', 'claude']),
    allowed_user_ids: quoteArray(sourceConfig.allowedUserIds ?? []),
    allowed_command_prefixes: quoteArray(sourceConfig.allowedCommandPrefixes ?? []),
  });

  fs.writeFileSync(sidecar.configPath, configText);

  console.log(`Configured Discord bridge sidecar for repo: ${sidecar.repoRoot}`);
  console.log(`Updated: ${sidecar.configPath}`);
  console.log(`Source config: ${sourceConfigPath}`);
  console.log('Ready to run:');
  console.log(`- ${path.join(sidecar.bridgeDir, 'doctor.sh')}`);
  console.log(`- ${path.join(sidecar.bridgeDir, 'run.sh')}`);
}

function main() {
  const [provider = 'discord'] = process.argv.slice(2);
  if (provider !== 'discord') {
    console.error(`Unsupported setup provider for now: ${provider}`);
    process.exit(1);
  }
  setupDiscord(process.cwd());
}

main();
