import fetch from 'node-fetch';
import { callLLM } from '../core/llm.js';

/**
 * Strip HTML tags and collapse whitespace from fetched pages.
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Summarize a URL using Qwen.
 */
export default {
  name: 'summarize',
  description: 'Fetch a URL and return a concise summary of its content',
  async run(input) {
    try {
      const urlMatch = String(input).match(/https?:\/\/[^\s]+/i);
      const url = urlMatch ? urlMatch[0] : String(input).trim();

      if (!url.startsWith('http')) {
        throw new Error('A valid http(s) URL is required');
      }

      const res = await fetch(url, {
        headers: { 'User-Agent': 'qwen-agent/1.0' },
        redirect: 'follow',
      });

      if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);

      const html = await res.text();
      const text = stripHtml(html).slice(0, 12000);

      if (!text) throw new Error('No readable text found at URL');

      const summary = await callLLM(
        [{ role: 'user', content: `Summarize this web page content in 5-8 bullet points:\n\n${text}` }],
        'You are a concise summarizer. Output clean bullet points only.',
        { stream: false }
      );

      return { url, summary: summary.trim() };
    } catch (err) {
      throw new Error(`Summarize failed: ${err.message}`);
    }
  },
};
