#!/usr/bin/env node
/**
 * Seed runner (thin wrapper around init.js).
 *   node src/db/seed.js [--force]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const init = path.join(here, 'init.js');
const args = ['seed', 'defaults', ...process.argv.slice(2)];
const child = spawn(process.execPath, [init, ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
