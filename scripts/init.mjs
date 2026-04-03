#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

export function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function readPackageName(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
  } catch {
    return null;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function detectExecutor() {
  for (const executor of ['codex', 'omx', 'claude']) {
    const result = spawnSync('bash', ['-lc', `command -v ${executor}`], { encoding: 'utf8' });
    if (result.status === 0) {
      return executor;
    }
  }
  return 'codex';
}

export function initializeBridgeSidecar(cwd = process.cwd()) {
  const repoRoot = findRepoRoot(cwd);
  const repoName = readPackageName(repoRoot) ?? path.basename(repoRoot);
  const slug = slugify(repoName);
  const bridgeDir = path.join(repoRoot, '.bridge');
  const configPath = path.join(bridgeDir, 'config.toml');
  const envExamplePath = path.join(bridgeDir, '.env.example');
  const runPath = path.join(bridgeDir, 'run.sh');
  const statusPath = path.join(bridgeDir, 'status.sh');
  const stopPath = path.join(bridgeDir, 'stop.sh');
  const doctorPath = path.join(bridgeDir, 'doctor.sh');
  const defaultExecutor = detectExecutor();
  const bridgeRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  ensureDir(bridgeDir);

  const configToml = `[providers.discord]\ntoken = \"YOUR_DISCORD_BOT_TOKEN\"\ndefault_channel = \"YOUR_DISCORD_CHANNEL_ID\"\n\n[[monitors.git.repos]]\npath = \"${repoRoot}\"\nname = \"${slug}\"\nremote = \"origin\"\nemit_commits = true\nemit_branch_changes = true\nchannel = \"YOUR_DISCORD_CHANNEL_ID\"\nformat = \"compact\"\n\n[[monitors.tmux.sessions]]\nsession = \"${slug}\"\nkeywords = [\"FAILED\", \"panic\"]\nkeyword_window_secs = 30\nstale_minutes = 30\nchannel = \"YOUR_DISCORD_CHANNEL_ID\"\nformat = \"alert\"\n\n[bridge_transport]\nprovider = \"discord\"\n\n[discord_bridge]\ndispatch_session = \"${slug}-dispatch\"\nshell_session = \"${slug}-shell\"\ndefault_executor = \"${defaultExecutor}\"\nexecutor_commands = [\"codex\", \"omx\", \"claude\"]\nallowed_user_ids = [\"YOUR_CHAT_USER_ID\"]\nallowed_command_prefixes = [\"echo\", \"pwd\", \"ls\", \"git status\", \"npm test\", \"npm run check\"]\n`;

  writeFileIfMissing(configPath, configToml);
  writeFileIfMissing(envExamplePath, `# Copy values into ~/.clawhip/config.toml or export as env\n# Example relay settings\n# BRIDGE_RELAY_PORT=3031\n# BRIDGE_RELAY_AUTH_TOKEN=replace-me\n`);
  writeFileIfMissing(runPath, `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(bridgeRoot)}\nexport CLAWHIP_BRIDGE_CONFIG=${JSON.stringify(configPath)}\nexport CLAWHIP_BRIDGE_WORKDIR=${JSON.stringify(repoRoot)}\nbash scripts/clawhip-discord-bridge-run.sh\n`);
  writeFileIfMissing(statusPath, `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(bridgeRoot)}\nexport CLAWHIP_BRIDGE_CONFIG=${JSON.stringify(configPath)}\nbash scripts/clawhip-discord-bridge-status.sh\n`);
  writeFileIfMissing(stopPath, `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(bridgeRoot)}\nexport CLAWHIP_BRIDGE_CONFIG=${JSON.stringify(configPath)}\nbash scripts/clawhip-discord-bridge-stop.sh\n`);
  writeFileIfMissing(doctorPath, `#!/usr/bin/env bash\nset -euo pipefail\nnode --version\ntmux -V\nclawhip --version\ncommand -v codex || true\ncommand -v omx || true\ncommand -v claude || true\n`);

  for (const file of [runPath, statusPath, stopPath, doctorPath]) {
    fs.chmodSync(file, 0o755);
  }

  return {
    repoRoot,
    repoName,
    slug,
    bridgeDir,
    configPath,
    envExamplePath,
    runPath,
    statusPath,
    stopPath,
    doctorPath,
    defaultExecutor,
    bridgeRoot,
  };
}

function main() {
  const result = initializeBridgeSidecar(process.cwd());
  console.log(`Initialized bridge sidecar for repo: ${result.repoRoot}`);
  console.log(`Created: ${result.configPath}`);
  console.log(`Created: ${result.envExamplePath}`);
  console.log(`Created: ${result.runPath}`);
  console.log(`Created: ${result.statusPath}`);
  console.log(`Created: ${result.stopPath}`);
  console.log(`Created: ${result.doctorPath}`);
  console.log('Next steps:');
  console.log(`1. Fill in messaging credentials in ${result.configPath}`);
  console.log(`2. Run ${path.join(result.bridgeDir, 'doctor.sh')}`);
  console.log(`3. Run ${path.join(result.bridgeDir, 'run.sh')}`);
}

main();
