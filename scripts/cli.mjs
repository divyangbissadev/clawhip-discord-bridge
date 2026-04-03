#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const SCRIPT_BY_COMMAND = {
  init: "init.mjs",
  up: "up.mjs",
  down: "down.mjs",
  doctor: "doctor.mjs",
  start: "clawhip-discord-bridge.mjs",
  "relay:start": path.join("relay", "server.mjs"),
  relay: path.join("relay", "server.mjs"),
};

function printHelp() {
  console.log(`clawhip-discord-bridge

Usage:
  clawhip-discord-bridge init
  clawhip-discord-bridge up
  clawhip-discord-bridge down
  clawhip-discord-bridge doctor
  clawhip-discord-bridge start [bridge args]
  clawhip-discord-bridge relay

Examples:
  npx clawhip-discord-bridge init
  npx clawhip-discord-bridge up
  npx clawhip-discord-bridge doctor
  npx clawhip-discord-bridge start --process-command "git status"
`);
}

function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const scriptName = SCRIPT_BY_COMMAND[command];
  if (!scriptName) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), scriptName);
  const result = spawnSync("node", [scriptPath, ...rest], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

main();
