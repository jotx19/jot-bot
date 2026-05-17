import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {Map<string, { name: string, description: string, run: Function }>} */
const tools = new Map();

const BUILTIN_FILES = [
  'websearch.js',
  'recruiter.js',
  'summarize.js',
  'calculator.js',
  'selfbuild.js',
];

/**
 * Register a tool in the in-memory registry.
 */
export function registerTool(tool) {
  if (!tool?.name || typeof tool.run !== 'function') {
    throw new Error('Tool must have name and run(input)');
  }
  tools.set(tool.name, tool);
}

export function unregisterTool(name) {
  return tools.delete(name);
}

/**
 * Load a tool module from disk and register it.
 */
async function loadToolFile(filename) {
  const filepath = path.join(__dirname, filename);
  if (!fs.existsSync(filepath)) return;

  const url = `${pathToFileURL(filepath).href}?v=${Date.now()}`;
  const mod = await import(url);
  const tool = mod.default;
  if (tool?.name) registerTool(tool);
}

/**
 * Load all built-in tools and any *.generated.js files.
 */
export async function loadTools() {
  tools.clear();

  for (const file of BUILTIN_FILES) {
    try {
      await loadToolFile(file);
    } catch (err) {
      console.warn(`[tools] failed to load ${file}:`, err.message);
    }
  }

  const generated = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.generated.js'));

  for (const file of generated) {
    try {
      await loadToolFile(file);
    } catch (err) {
      console.warn(`[tools] failed to load ${file}:`, err.message);
    }
  }

  console.log(`[tools] loaded: ${[...tools.keys()].join(', ')}`);
}

/**
 * Get a tool by name.
 */
export function getTool(name) {
  return tools.get(name) || null;
}

/**
 * List all registered tools (name + description).
 */
export function listTools() {
  return [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
  }));
}

/**
 * Execute a tool by name with string input.
 */
export async function executeTool(name, input) {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  try {
    const result = await tool.run(input);
    return { tool: name, result };
  } catch (err) {
    throw new Error(`Tool "${name}" failed: ${err.message}`);
  }
}
