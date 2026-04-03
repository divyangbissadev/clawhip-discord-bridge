#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const doctorScript = path.join(cwd, '.bridge', 'doctor.sh');
const result = spawnSync('bash', [doctorScript], { stdio: 'inherit' });
process.exit(result.status ?? 0);
