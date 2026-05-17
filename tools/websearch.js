import fetch from 'node-fetch';
import { callLLM } from '../core/llm.js';

const TIMEOUT_MS = 5000;
const YAHOO_UA = 'Mozilla/5.0 (compatible; qwen-agent/1.0)';

/**
 * Fetch with 5s timeout per provider.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify query for smart provider routing.
 */
function classifyQuery(query) {
  const q = query.toLowerCase();

  if (
    /\b(stock|stocks|price|market|shares|crypto|bitcoin|ethereum|nasdaq|nyse|earnings|revenue|invest|investing|ticker|market cap|52.week|dividend)\b/.test(q) ||
    /\$[a-z]{1,5}\b/i.test(query) ||
    /\b(AAPL|TSLA|MSFT|GOOGL|GOOG|AMZN|META|NVDA|NFLX|AMD|INTC|IBM|ORCL|CRM|UBER|LYFT|COIN|BTC|ETH)\b/i.test(query)
  ) {
    return 'financial';
  }

  if (
    /^(what is|who is|what are|who are|define|explain|history of|when was|when were|where is|where are)\b/i.test(q.trim()) ||
    /\b(definition|meaning of|biography of)\b/.test(q)
  ) {
    return 'factual';
  }

  return 'general';
}

/**
 * Build provider attempt order based on query type.
 */
function getProviderOrder(queryType) {
  const hasSerper = Boolean(process.env.SERPER_API_KEY);
  const serper = hasSerper ? 'serper' : null;
  const wiki = 'wikipedia';
  const yahoo = 'yahoo-finance';
  const ddg = 'duckduckgo';

  if (queryType === 'financial') {
    return [yahoo, serper, ddg].filter(Boolean);
  }
  if (queryType === 'factual') {
    return [wiki, serper, ddg].filter(Boolean);
  }
  return [serper, wiki, ddg].filter(Boolean);
}

/**
 * Extract likely stock ticker from query.
 */
function extractTicker(query) {
  const dollar = query.match(/\$([A-Za-z]{1,5})\b/);
  if (dollar) return dollar[1].toUpperCase();

  const known = query.match(
    /\b(AAPL|TSLA|MSFT|GOOGL|GOOG|AMZN|META|NVDA|NFLX|AMD|INTC|IBM|ORCL|CRM|UBER|LYFT|COIN|BTC|ETH)\b/i
  );
  if (known) return known[1].toUpperCase();

  const words = query.split(/\s+/);
  for (const w of words) {
    if (/^[A-Z]{1,5}$/.test(w)) return w;
  }
  return null;
}

/**
 * Wikipedia-friendly title from query.
 */
function wikiTitleFromQuery(query) {
  const cleaned = query
    .replace(/^(what is|who is|what are|who are|define|explain|history of)\s+/i, '')
    .replace(/\?+$/, '')
    .trim();

  return cleaned.replace(/\s+/g, '_');
}

// ─── PROVIDER 1: Serper ───────────────────────────────────────────────────

async function searchSerper(query) {
  if (!process.env.SERPER_API_KEY) return null;

  const res = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });

  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);

  const data = await res.json();
  const snippets = [];
  const sources = [];

  if (data.answerBox?.answer) {
    snippets.push(`Direct answer: ${data.answerBox.answer}`);
  } else if (data.answerBox?.snippet) {
    snippets.push(`Direct answer: ${data.answerBox.snippet}`);
  }

  if (data.knowledgeGraph?.description) {
    snippets.push(`Knowledge: ${data.knowledgeGraph.description}`);
    if (data.knowledgeGraph.descriptionLink) {
      sources.push(data.knowledgeGraph.descriptionLink);
    }
  }

  for (const item of (data.organic || []).slice(0, 5)) {
    if (item.snippet) {
      snippets.push(`${item.title || 'Result'}: ${item.snippet}`);
    }
    if (item.link) sources.push(item.link);
  }

  if (!snippets.length) return null;

  console.log('[websearch] provider: serper');
  return { snippets, sources: [...new Set(sources)] };
}

// ─── PROVIDER 2: Wikipedia ──────────────────────────────────────────────────

async function fetchWikiSummary(title) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const res = await fetchWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
  );

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia summary HTTP ${res.status}`);

  return res.json();
}

async function searchWikipedia(query) {
  let data = await fetchWikiSummary(wikiTitleFromQuery(query));

  if (!data) {
    const q = encodeURIComponent(query);
    const searchRes = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&srlimit=3`
    );
    if (!searchRes.ok) throw new Error(`Wikipedia search HTTP ${searchRes.status}`);

    const searchData = await searchRes.json();
    const first = searchData.query?.search?.[0]?.title;
    if (!first) return null;

    data = await fetchWikiSummary(first);
    if (!data) return null;
  }

  const snippets = [];
  const sources = [];

  if (data.extract) snippets.push(`${data.title}: ${data.extract}`);
  if (data.description) snippets.push(data.description);
  if (data.content_urls?.desktop?.page) sources.push(data.content_urls.desktop.page);

  if (!snippets.length) return null;

  console.log('[websearch] provider: wikipedia');
  return { snippets, sources: [...new Set(sources)] };
}

// ─── PROVIDER 3: Yahoo Finance ──────────────────────────────────────────────

async function yahooChart(ticker) {
  const res = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    { headers: { 'User-Agent': YAHOO_UA } }
  );
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);

  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;

  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    exchange: meta.exchangeName,
    name: meta.longName || meta.shortName,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    prevClose: meta.chartPreviousClose || meta.previousClose,
  };
}

async function yahooQuoteSummary(ticker) {
  const modules = 'assetProfile,summaryDetail,financialData';
  const res = await fetchWithTimeout(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`,
    { headers: { 'User-Agent': YAHOO_UA } }
  );
  if (!res.ok) return null;

  const data = await res.json();
  const result = data.quoteSummary?.result?.[0];
  if (!result) return null;

  const profile = result.assetProfile || {};
  const summary = result.summaryDetail || {};
  const financial = result.financialData || {};

  return { profile, summary, financial };
}

async function yahooFinanceSearch(query) {
  const res = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': YAHOO_UA } }
  );
  if (!res.ok) throw new Error(`Yahoo search HTTP ${res.status}`);

  const data = await res.json();
  const quotes = data.quotes || [];
  if (!quotes.length) return null;

  const snippets = quotes.slice(0, 3).map((q) => {
    const sym = q.symbol || '';
    const name = q.shortname || q.longname || sym;
    const type = q.quoteType || '';
    return `${name} (${sym}) — ${type}`;
  });

  return { snippets, sources: [`https://finance.yahoo.com/quote/${quotes[0].symbol}`] };
}

async function searchYahooFinance(query) {
  const ticker = extractTicker(query);
  const snippets = [];
  const sources = [];

  if (ticker) {
    const chart = await yahooChart(ticker);
    if (chart?.price != null) {
      snippets.push(
        `${chart.name || ticker}: ${chart.price} ${chart.currency || ''} (${chart.exchange || 'market'})`
      );
      if (chart.dayHigh != null && chart.dayLow != null) {
        snippets.push(`Day range: ${chart.dayLow} – ${chart.dayHigh}`);
      }
      if (chart.prevClose != null) {
        snippets.push(`Previous close: ${chart.prevClose}`);
      }
      sources.push(`https://finance.yahoo.com/quote/${ticker}`);
    }

    const details = await yahooQuoteSummary(ticker);
    if (details) {
      const { profile, summary, financial } = details;
      if (profile.longBusinessSummary) {
        snippets.push(`Company: ${profile.longBusinessSummary.slice(0, 400)}`);
      }
      if (summary.marketCap?.fmt) snippets.push(`Market cap: ${summary.marketCap.fmt}`);
      if (summary.fiftyTwoWeekHigh?.fmt && summary.fiftyTwoWeekLow?.fmt) {
        snippets.push(
          `52-week range: ${summary.fiftyTwoWeekLow.fmt} – ${summary.fiftyTwoWeekHigh.fmt}`
        );
      }
      if (financial.revenuePerShare?.fmt) {
        snippets.push(`Revenue per share: ${financial.revenuePerShare.fmt}`);
      }
    }
  } else {
    const searchHits = await yahooFinanceSearch(query);
    if (searchHits) {
      snippets.push(...searchHits.snippets);
      sources.push(...searchHits.sources);
    }
  }

  if (!snippets.length) return null;

  console.log('[websearch] provider: yahoo-finance');
  return { snippets, sources: [...new Set(sources)] };
}

// ─── PROVIDER 4: DuckDuckGo ────────────────────────────────────────────────

async function searchDuckDuckGo(query) {
  const q = encodeURIComponent(query);
  const res = await fetchWithTimeout(
    `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`
  );

  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);

  const data = await res.json();
  const snippets = [];
  const sources = [];

  if (data.AbstractText?.trim()) {
    snippets.push(
      data.Heading ? `[${data.Heading}] ${data.AbstractText}` : data.AbstractText
    );
    if (data.AbstractURL) sources.push(data.AbstractURL);
  }
  if (data.Answer?.trim()) snippets.push(`Answer: ${data.Answer}`);

  const topics = (data.RelatedTopics || [])
    .flatMap((t) => (t.Topics ? t.Topics : [t]))
    .filter((t) => t.Text)
    .slice(0, 3)
    .map((t) => t.Text);

  snippets.push(...topics);

  if (!snippets.length) return null;

  console.log('[websearch] provider: duckduckgo');
  return { snippets: snippets.slice(0, 5), sources: [...new Set(sources)] };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

const PROVIDERS = {
  serper: searchSerper,
  wikipedia: searchWikipedia,
  'yahoo-finance': searchYahooFinance,
  duckduckgo: searchDuckDuckGo,
};

/**
 * Try providers in order until one returns snippets.
 */
async function collectFromProviders(query) {
  const queryType = classifyQuery(query);
  const order = getProviderOrder(queryType);

  console.log(`[websearch] route: ${queryType} → ${order.join(' → ')}`);

  for (const name of order) {
    const fn = PROVIDERS[name];
    if (!fn) continue;

    try {
      const result = await fn(query);
      if (result?.snippets?.length) {
        return {
          snippets: result.snippets,
          sources: result.sources || [],
          provider: name,
        };
      }
    } catch (err) {
      console.warn(`[websearch] ${name} error:`, err.message);
    }
  }

  return null;
}

/**
 * Summarize combined search results with LLM.
 */
async function summarizeWithLLM(query, combinedResults) {
  const prompt = `Using these search results answer the query directly.
Include specific facts, numbers, dates where available.

Query: ${query}
Results: ${combinedResults}

Be direct and specific. For financial data include current prices and key metrics. For facts give a concise accurate summary.`;

  const answer = await callLLM(
    [{ role: 'user', content: prompt }],
    '',
    { stream: false, includeBasePrompt: true }
  );

  return answer.trim();
}

export default {
  name: 'websearch',
  description:
    'Multi-provider web search: Serper, Wikipedia, Yahoo Finance, DuckDuckGo',
  async run(input) {
    const query = String(input).trim();
    if (!query) throw new Error('Search query is required');

    try {
      const collected = await collectFromProviders(query);

      if (!collected) {
        return {
          query,
          answer: 'Search unavailable right now. Please try again.',
          summary: 'Search unavailable right now. Please try again.',
          provider: 'none',
          sources: [],
        };
      }

      const combinedResults = collected.snippets
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n\n');

      const answer = await summarizeWithLLM(query, combinedResults);

      return {
        query,
        answer,
        summary: answer,
        provider: collected.provider,
        sources: collected.sources.slice(0, 10),
        snippets: combinedResults,
      };
    } catch (err) {
      throw new Error(`Web search failed: ${err.message}`);
    }
  },
};
