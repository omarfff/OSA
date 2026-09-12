import { normalizeListing } from './index.js';

export const PUBLIC_SEARCHES = Object.freeze([
  { name: 'haraj-bmw', url: 'https://haraj.com.sa/search/BMW/', make: 'BMW' },
  { name: 'haraj-mercedes', url: 'https://haraj.com.sa/search/mercedes/', make: 'Mercedes-Benz' },
]);

const ALLOWED_HOSTS = new Set(['haraj.com.sa', 'www.haraj.com.sa']);

function decodeEntities(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

function numericFromPatterns(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function assertPublicHarajUrl(rawUrl) {
  const u = new URL(String(rawUrl));
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error(`unsupported_public_source:${u.hostname}`);
  }
  if (/graphql|api\//i.test(u.pathname)) throw new Error('internal_endpoint_forbidden');
  return u.toString();
}

export function extractHarajCandidateLinks(html, baseUrl = 'https://haraj.com.sa/') {
  const links = new Set();
  const re = /href=["'](\/?\d{8,}\/[^"'#?]+\/?)["']/gi;
  let match;
  while ((match = re.exec(String(html)))) {
    try {
      const u = new URL(match[1], baseUrl);
      if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) continue;
      links.add(u.toString());
    } catch {
      // Ignore malformed candidate URLs.
    }
  }
  return [...links];
}

export function parseHarajPublicPostHtml(html, url, hints = {}) {
  const source = 'haraj';
  const raw = String(html);
  const lightlyDecoded = raw
    .replace(/\\u0026/g, '&')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"');

  const title = pick(raw, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]) || '';
  const description = pick(raw, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  ]) || '';
  const image = pick(raw, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  ]);

  const price = numericFromPatterns(lightlyDecoded, [
    /"inputPrice"\s*:\s*"?([\d,.]+)"?/i,
    /"formattedPrice"\s*:\s*"?([\d,.]+)"?/i,
  ]);
  const mileage = numericFromPatterns(lightlyDecoded, [
    /"mileage"\s*:\s*"?([\d,.]+)"?/i,
    /(?:الممشى|ممشى)\s*[:\/\-]?\s*([\d,.]+)\s*(?:الف|ألف|كم|كيلو)?/i,
  ]);
  const year = numericFromPatterns(`${title}\n${description}\n${lightlyDecoded.slice(0, 120000)}`, [
    /(?:الموديل|موديل)\s*[:\/\-]?\s*(20\d{2}|19\d{2})/i,
    /\b(20\d{2}|19\d{2})\b/,
  ]);

  const externalId = (() => {
    try {
      return new URL(url).pathname.match(/\/(\d{8,})\//)?.[1] || null;
    } catch {
      return null;
    }
  })();

  return normalizeListing({
    source,
    externalId,
    url,
    title: stripTags(title.replace(/\s*\|\s*موقع حراج\s*$/i, '')),
    description: stripTags(description),
    make: hints.make,
    model: hints.model,
    year,
    mileage,
    price,
    city: hints.city || null,
    images: image ? [image] : [],
  }, hints);
}

async function fetchText(url, options = {}) {
  const safeUrl = assertPublicHarajUrl(url);
  const res = await (options.fetchImpl || fetch)(safeUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': options.userAgent || 'Mozilla/5.0 (compatible; OSA-Car-Hunter/1.0; public-page-monitor)',
      'accept-language': 'ar-SA,ar;q=0.9,en;q=0.6',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`public_fetch_failed:${res.status}`);
  return await res.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectPublicHaraj(options = {}) {
  const searches = options.searches || PUBLIC_SEARCHES;
  const maxAds = Math.max(1, Math.min(Number(options.maxAds || 24), 60));
  const minDelayMs = Math.max(750, Number(options.minDelayMs || 1500));
  const seen = new Set();
  const candidates = [];
  const errors = [];

  for (const search of searches) {
    if (candidates.length >= maxAds) break;
    try {
      const searchHtml = await fetchText(search.url, options);
      for (const url of extractHarajCandidateLinks(searchHtml, search.url)) {
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push({ url, make: search.make, search: search.name });
        if (candidates.length >= maxAds) break;
      }
    } catch (error) {
      errors.push({ stage: 'search', search: search.name, error: String(error?.message || error) });
    }
    if (minDelayMs) await sleep(minDelayMs);
  }

  const listings = [];
  for (const candidate of candidates) {
    try {
      const html = await fetchText(candidate.url, options);
      const listing = parseHarajPublicPostHtml(html, candidate.url, { make: candidate.make });
      listings.push({ ...listing, discoveredBy: candidate.search, collectedAt: new Date().toISOString() });
    } catch (error) {
      errors.push({ stage: 'post', url: candidate.url, error: String(error?.message || error) });
    }
    if (minDelayMs) await sleep(minDelayMs);
  }

  return {
    source: 'haraj-public-web',
    searches: searches.map((s) => s.name),
    candidateCount: candidates.length,
    listingCount: listings.length,
    listings,
    errors,
  };
}
