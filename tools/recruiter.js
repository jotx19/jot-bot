import fetch from 'node-fetch';
import { callLLM } from '../core/llm.js';

const TIMEOUT_MS = 8000;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED_LOCAL = [
  'noreply',
  'no-reply',
  'donotreply',
  'newsletter',
  'marketing',
  'unsubscribe',
];

function parseJsonSafe(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonStr);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchSerper(query) {
  if (!process.env.SERPER_API_KEY) return null;

  const res = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 8 }),
  });

  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);

  const data = await res.json();
  const parts = [];
  const sources = [];

  for (const item of data.organic || []) {
    if (item.snippet) parts.push(`${item.title || ''}: ${item.snippet}`);
    if (item.link) sources.push(item.link);
  }

  return parts.length ? { text: parts.join('\n'), sources } : null;
}

async function hunterDomainSearch(domain) {
  if (!process.env.HUNTER_API_KEY || !domain) return [];

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${process.env.HUNTER_API_KEY}&limit=10`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];

  const data = await res.json();
  return (data.data?.emails || [])
    .filter((e) => e.value && e.type !== 'generic')
    .map((e) => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      role: e.position || e.department || 'contact',
      source: 'hunter.io',
      confidence: e.confidence,
    }));
}

function extractEmailsFromText(text) {
  const found = new Set();
  const matches = text.match(EMAIL_RE) || [];

  for (let email of matches) {
    email = email.toLowerCase();
    const local = email.split('@')[0];
    if (BLOCKED_LOCAL.some((b) => local.includes(b))) continue;
    if (email.endsWith('.png') || email.endsWith('.jpg')) continue;
    found.add(email);
  }
  return [...found];
}

function guessDomain(company, website) {
  if (website) {
    try {
      const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
      return host.replace(/^www\./, '');
    } catch {
      /* skip */
    }
  }
  if (!company) return null;
  return `${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
}

async function parseJobPosting(input) {
  const raw = await callLLM(
    [{ role: 'user', content: input }],
    `Extract job posting details. Reply with ONLY JSON:
{"company":"Company name","role":"Job title","location":"city or remote","website":"company website if mentioned or empty string","domain":"company email domain if obvious e.g. stripe.com"}`,
    { stream: false, includeBasePrompt: false }
  );

  try {
    const parsed = parseJsonSafe(raw);
    return {
      company: parsed.company || '',
      role: parsed.role || '',
      location: parsed.location || '',
      website: parsed.website || '',
      domain: parsed.domain || guessDomain(parsed.company, parsed.website),
    };
  } catch {
    return { company: '', role: '', location: '', website: '', domain: null };
  }
}

async function gatherSearchResults(job) {
  const company = job.company || 'company';
  const role = job.role || 'recruiter';

  const queries = [
    `"${company}" recruiter email`,
    `"${company}" talent acquisition contact email`,
    `"${company}" "${role}" hiring manager email`,
    `site:linkedin.com "${company}" recruiter OR "talent acquisition"`,
    `"${company}" careers contact email`,
  ];

  const results = await Promise.all(queries.map((q) => searchSerper(q)));
  const snippets = [];
  const sources = [];

  for (const r of results) {
    if (!r) continue;
    snippets.push(r.text);
    sources.push(...r.sources);
  }

  return {
    combined: snippets.join('\n\n'),
    sources: [...new Set(sources)].slice(0, 12),
  };
}

function rankEmails(emails, hunterHits) {
  const ranked = [];

  for (const h of hunterHits) {
    ranked.push({
      email: h.email,
      label: h.name ? `${h.name} (${h.role})` : h.role,
      source: h.source,
    });
  }

  for (const email of emails) {
    if (ranked.some((r) => r.email === email)) continue;
    ranked.push({ email, label: 'from web search', source: 'search' });
  }

  return ranked;
}

async function formatAnswer(job, ranked, searchBlob, ctx) {
  const emailList = ranked.length
    ? ranked.map((r, i) => `${i + 1}. **${r.email}** — ${r.label} (${r.source})`).join('\n')
    : 'No verified emails found in search results.';

  const prompt = `The user wants recruiter / hiring contact emails for a job application.

Company: ${job.company || 'unknown'}
Role: ${job.role || 'unknown'}
Location: ${job.location || 'unknown'}
Domain: ${job.domain || 'unknown'}

Emails found:
${emailList}

Web search excerpts:
${searchBlob.slice(0, 6000)}

Write a clear reply:
1. Company + role (one line)
2. **Best emails to try** (bullet list, copy-paste ready)
3. If none found: suggest likely patterns like firstname.lastname@${job.domain || 'company.com'} and where to look (careers page, LinkedIn)
4. Keep it short and actionable. Do not refuse. Do not mention Qwen or Alibaba.`;

  return callLLM(
    [{ role: 'user', content: prompt }],
    'You help with professional job outreach. Be direct.',
    {
      stream: Boolean(ctx.onToken),
      onToken: ctx.onToken,
      includeBasePrompt: true,
    }
  );
}

export default {
  name: 'recruiter',
  description:
    'Find recruiter / hiring manager emails from a job posting or company name (web search + optional Hunter.io)',
  async run(input, ctx = {}) {
    const text = String(input).trim();
    if (!text) throw new Error('Job posting or company details required');

    if (!process.env.SERPER_API_KEY) {
      const msg =
        'Recruiter lookup needs SERPER_API_KEY in .env (get one at serper.dev).';
      if (ctx.onToken) ctx.onToken(msg);
      return { answer: msg, emails: [] };
    }

    const job = await parseJobPosting(text);
    const [search, hunterHits] = await Promise.all([
      gatherSearchResults(job),
      hunterDomainSearch(job.domain),
    ]);

    const scrapedEmails = extractEmailsFromText(search.combined);
    const ranked = rankEmails(scrapedEmails, hunterHits);

    const answer = await formatAnswer(job, ranked, search.combined, ctx);

    return {
      company: job.company,
      role: job.role,
      domain: job.domain,
      emails: ranked.map((r) => r.email),
      contacts: ranked,
      sources: search.sources,
      answer: answer.trim(),
    };
  },
};
