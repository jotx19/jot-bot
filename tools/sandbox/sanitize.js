import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Fix common LLM timer mistakes (e.g. timer.clear() → clearInterval(timer)). */
export function sanitizeSandboxCode(code) {
  let c = code;
  const timerVars = [];
  for (const m of c.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*setInterval/g)) {
    timerVars.push(m[1]);
  }
  for (const v of timerVars) {
    c = c.replace(new RegExp(`\\b${v}\\.clear\\(\\)`, 'g'), `clearInterval(${v})`);
  }
  return c;
}

/**
 * Parse-check script with node --check before save/run.
 */
export function validateSandboxSyntax(code) {
  const tmp = path.join(os.tmpdir(), `sandbox-syntax-${process.pid}-${Date.now()}.mjs`);
  try {
    fs.writeFileSync(tmp, code, 'utf8');
    const result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || 'Syntax error').trim();
      const line = detail.split('\n').find((l) => l.includes('SyntaxError')) || detail;
      throw new Error(line);
    }
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function prepareSandboxCode(code) {
  const cleaned = sanitizeSandboxCode(code);
  validateSandboxSyntax(cleaned);
  return cleaned;
}
