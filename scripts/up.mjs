#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const runScript = path.join(cwd, '.bridge', 'run.sh');
const result = spawnSync('bash', [runScript], { stdio: 'inherit' });
process.exit(result.status ?? 0);
