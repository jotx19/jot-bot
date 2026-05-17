import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const STATE_DIR = path.join(__dirname, 'state');
const DEFAULT_TIMEOUT = 15000;

function ensureDirs() {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
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

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ scriptPath, stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ scriptPath, stdout, stderr: stderr + err.message, exitCode: 1, timedOut });
    });
  });
}

export async function writeAndRun(name, code, timeoutMs = DEFAULT_TIMEOUT) {
  ensureDirs();
  const scriptPath = path.join(SCRIPTS_DIR, `${name}.mjs`);
  fs.writeFileSync(scriptPath, code, 'utf8');
  console.log(`[sandbox] wrote ${scriptPath}`);
  return runChild(scriptPath, timeoutMs);
}

export async function runScript(scriptPath, timeoutMs = DEFAULT_TIMEOUT) {
  ensureDirs();
  return runChild(scriptPath, timeoutMs);
}
