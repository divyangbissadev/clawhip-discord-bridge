#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const stopScript = path.join(cwd, '.bridge', 'stop.sh');
const result = spawnSync('bash', [stopScript], { stdio: 'inherit' });
process.exit(result.status ?? 0);
