/**
 * Safe math calculator tool.
 */
export default {
  name: 'calculator',
  description: 'Evaluate a math expression, e.g. "2 + 2 * 5" or "(10 - 3) / 2"',
  async run(input) {
    try {
      const expr = String(input)
        .replace(/^calculate\s+/i, '')
        .replace(/\^/g, '**')
        .trim();

      if (!expr) throw new Error('Expression is required');

      const stripped = expr.replace(/\*\*/g, '');
      if (!/^[0-9+\-*/().%\s]+$/.test(stripped)) {
        throw new Error('Invalid characters in expression');
      }

      const result = Function(`"use strict"; return (${expr})`)();
      return { result, expression: expr };
    } catch (err) {
      throw new Error(`Calculator failed: ${err.message}`);
    }
  },
};
