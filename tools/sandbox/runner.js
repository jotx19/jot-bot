import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordScriptRun } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const STATE_DIR = path.join(__dirname, 'state');
const DEFAULT_TIMEOUT = 15000;

function ensureDirs() {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function nameFromScriptPath(scriptPath) {
  const base = path.basename(scriptPath || '', '.mjs');
  return base || null;
}

function runChild(scriptPath, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, SANDBOX_STATE_DIR: STATE_DIR },
      cwd: path.dirname(scriptPath),
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ scriptPath, stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        scriptPath,
        stdout,
        stderr: stderr + err.message,
        exitCode: 1,
        timedOut,
      });
    });
  });
}

async function trackRun(scriptPath, result) {
  const name = nameFromScriptPath(scriptPath);
  if (!name) return result;
  await recordScriptRun(name, {
    exitCode: result?.exitCode ?? 1,
    timedOut: Boolean(result?.timedOut),
  });
  return result;
}

export async function writeAndRun(name, code, timeoutMs = DEFAULT_TIMEOUT) {
  ensureDirs();
  const scriptPath = path.join(SCRIPTS_DIR, `${name}.mjs`);
  fs.writeFileSync(scriptPath, code, 'utf8');
  console.log(`[sandbox] wrote ${scriptPath}`);
  const result = await runChild(scriptPath, timeoutMs);
  await trackRun(scriptPath, result);
  return result;
}

export async function runScript(scriptPath, timeoutMs = DEFAULT_TIMEOUT) {
  ensureDirs();
  const result = await runChild(scriptPath, timeoutMs);
  await trackRun(scriptPath, result);
  return result;
}
