import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../core/llm.js';
import { registerTool } from './registry.js';
import { writeAndRun, runScript } from './sandbox/runner.js';
import { schedule, listScheduled } from './sandbox/scheduler.js';
import {
  saveScript,
  removeFromDisk,
  materializeOnDisk,
  extractScriptNameFromInput,
  suggestScriptNameFromInput,
  ensureUniqueScriptName,
  isScriptOverwriteRequest,
  removeLegacyToolFile,
} from './sandbox/store.js';
import { prepareSandboxCode } from './sandbox/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERATE_SYSTEM = `You write Node.js ESM tool modules for qwen-agent.
Export default { name, description, async run(input) { ... } }.
The run function receives a string input and returns a JSON-serializable object.
Use only built-in Node modules (no npm installs). Keep code under 40 lines.
Return ONLY the JavaScript file content, no markdown fences.`;

function parseInterval(match) {
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { ms: 1, second: 1000, minute: 60000, hour: 3600000 };
  return n * (multipliers[unit] || 1000);
}

/**
 * Write a new generated tool file and register it at runtime.
 * @param {string} name - Tool name (alphanumeric + underscore)
 * @param {string} description
 * @param {string} codeLogic - Natural language description of tool behavior
 */
export async function buildTool(name, description, codeLogic, opts = {}) {
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (!safeName) throw new Error('Invalid tool name');

  const prompt = `Create a tool named "${safeName}".
Description: ${description}
Behavior: ${codeLogic}`;

  const code = await callLLM(
    [{ role: 'user', content: prompt }],
    GENERATE_SYSTEM,
    { stream: false }
  );

  const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

  const filename = `${safeName}.generated.js`;
  const filepath = path.join(__dirname, filename);

  await fs.writeFile(filepath, cleaned, 'utf8');

  if (!opts.skipImport) {
    const mod = await import(`./${filename}?t=${Date.now()}`);
    const tool = mod.default;
    if (!tool?.name || typeof tool.run !== 'function') {
      throw new Error('Generated tool is missing name or run()');
    }
    registerTool(tool);
    return { name: tool.name, file: filename, description: tool.description, code: cleaned };
  }

  return { name: safeName, file: filename, description, code: cleaned };
}

export default {
  name: 'selfbuild',
  description:
    'Create a new custom tool at runtime. Input JSON: {"name":"tool_name","description":"what it does","codeLogic":"how it works"}',
  async run(input) {
    try {
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      const extractedName = extractScriptNameFromInput(inputStr);
      const suggestedName = suggestScriptNameFromInput(inputStr);
      const allowOverwrite = isScriptOverwriteRequest(inputStr);

      let payload = input;
      if (typeof input === 'string') {
        try {
          payload = JSON.parse(input);
        } catch {
          payload = {
            name: suggestedName,
            description: input,
            codeLogic: input,
          };
        }
      }

      if (extractedName) payload.name = extractedName;
      else if (!payload.name || payload.name === 'sandbox_script') {
        payload.name = suggestedName;
      }

      const { name, description, codeLogic } = payload;
      if (!name || !description || !codeLogic) {
        throw new Error('Requires name, description, and codeLogic');
      }

      const shouldRun = /\b(run|execute|test|try)\b/i.test(inputStr);
      const shouldSave =
        /\b(?:save|store|persist)\b/i.test(inputStr) &&
        (/\bsandbox\b/i.test(inputStr) || /\bscript\b/i.test(inputStr));
      const scheduleMatch = inputStr.match(/every\s+(\d+)\s*(ms|second|minute|hour)/i);
      const intervalMs = scheduleMatch ? parseInterval(scheduleMatch) : null;
      const buildLegacyTool =
        /\b(build|create)\b.*\btool\b/i.test(inputStr) && !/\bscript\b/i.test(inputStr);
      const sandboxMode =
        !buildLegacyTool &&
        (shouldRun || intervalMs || shouldSave || /\bscript\b/i.test(inputStr));

      let built;
      if (sandboxMode) {
        const safeName = (extractedName || suggestedName || name)
          .replace(/[^a-zA-Z0-9_]/g, '_')
          .toLowerCase();
        const consoleOnly =
          /\bconsole\.log\s+only\b/i.test(inputStr) ||
          (!/\b(counter|persist|state|save between|increment|cache)\b/i.test(inputStr) &&
            /\b(log|fetch|print|show)\b/i.test(inputStr));

        const scheduleRules = intervalMs
          ? `
SCHEDULED JOB (tinyjot re-runs this file every ${intervalMs}ms):
- Run your logic ONCE, console.log the result, then exit. No internal timers.
- Do NOT use setInterval, setTimeout loops, process.on("SIGINT"), or process.on("exit").
- Do NOT import from "timers/promises" for repeating work.
- To clear timers use clearInterval(id), never id.clear().
- Example shape: (async () => { console.log(new Date().toISOString()); })();
`
          : '';

        const sandboxPrompt = `
Write a standalone Node.js ESM script that runs immediately 
when executed with node. 

RULES:
- No export default, no export, no module.exports
- No function wrappers around the main logic
- All code runs at the top level
- Use only Node built-ins and globals (fetch is available in Node 18+)
- Use console.log() for all user-visible output — results go to chat only
- Do NOT use writeFile, appendFile, or fs promises to write output/result files unless the task explicitly needs a counter or cache between runs
- Never write .txt files. Only use SANDBOX_STATE_DIR + .json when the user asks to persist state across runs (e.g. increment a counter)
${consoleOnly ? '- CONSOLE ONLY: no file I/O at all — fetch/compute then console.log and exit' : ''}
- Double-check all parentheses and brackets are balanced before finishing
- End the script cleanly (no hanging promises without await)
- Wrap async code in an immediately invoked async function:
  (async () => { ... your code here ... })()
- Node timers: use clearInterval(timerId), never timerId.clear()
${scheduleRules}
Task: ${input}
`;

        const code = await callLLM(
          [{ role: 'user', content: sandboxPrompt }],
          'Return ONLY the JavaScript file content, no markdown fences.',
          { stream: false }
        );

        const cleaned = prepareSandboxCode(
          code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim()
        );
        built = { name: safeName, description, code: cleaned };

        if (intervalMs && /\bsetInterval\s*\(/.test(built.code)) {
          throw new Error(
            'Scheduled scripts must not use setInterval — tinyjot already re-runs the file on your interval. Ask again; the script should only log once and exit.'
          );
        }
      } else {
        built = await buildTool(name, description, codeLogic);
      }

      let scriptName = sandboxMode
        ? (extractedName || built.name || suggestedName)
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .toLowerCase()
        : built.name;
      if (sandboxMode && !allowOverwrite) {
        scriptName = await ensureUniqueScriptName(scriptName);
      }
      if (sandboxMode) {
        built.name = scriptName;
        removeLegacyToolFile(scriptName);
      }

      const result = {
        message: sandboxMode
          ? `Script "${scriptName}" saved in sandbox`
          : `Tool "${built.name}" created and registered`,
        ...built,
        scriptPath: path.join(__dirname, 'sandbox', 'scripts', `${scriptName}.mjs`),
      };

      if (intervalMs) {
        const runResult = await writeAndRun(scriptName, built.code);
        if (runResult.exitCode !== 0) {
          throw new Error(runResult.stderr || 'Script failed');
        }
        const saved = await saveScript({
          name: scriptName,
          code: built.code,
          scheduled: true,
          intervalMs,
        });
        schedule(scriptName, runResult.scriptPath, intervalMs, runScript);
        const n = scheduleMatch[1];
        const unit = scheduleMatch[2];
        return {
          ...result,
          message: `Script ${built.name} running every ${n} ${unit} (persisted${saved.persisted ? ' to MongoDB' : ''}). First run output: ${runResult.stdout}`,
          scriptPath: runResult.scriptPath,
          persisted: saved.persisted,
          sandbox: runResult,
          scheduled: listScheduled(),
        };
      }

      if (shouldRun) {
        const runResult = await writeAndRun(scriptName, built.code);
        result.sandbox = runResult;
        result.scriptPath = runResult.scriptPath;
        if (runResult.stdout) result.stdout = runResult.stdout;
        if (runResult.stderr) result.stderr = runResult.stderr;
        if (runResult.timedOut) result.timeout = 'Script timed out after 15s';
        if (runResult.exitCode !== 0) result.error = runResult.stderr;
        if (runResult.exitCode === 0 && shouldSave) {
          const saved = await saveScript({ name: scriptName, code: built.code, scheduled: false });
          result.persisted = saved.persisted;
          result.message = `Script "${scriptName}" ran and saved in sandbox.`;
        } else if (runResult.exitCode === 0) {
          removeFromDisk(scriptName);
          result.message = `Script "${scriptName}" ran once (not saved — say "save in sandbox" or schedule it).`;
        }
        return result;
      }

      if (sandboxMode && (shouldSave || !buildLegacyTool)) {
        const scriptPath = materializeOnDisk(scriptName, built.code);
        const saved = await saveScript({ name: scriptName, code: built.code, scheduled: false });
        return {
          ...result,
          message: `Script "${scriptName}" saved in sandbox${saved.persisted ? ' (MongoDB)' : ''}.`,
          scriptPath,
          persisted: saved.persisted,
        };
      }

      return { message: `Tool "${built.name}" created and registered`, ...built };
    } catch (err) {
      throw new Error(`Self-build failed: ${err.message}`);
    }
  },
};
