import { normalizeListing } from './index.js';

export const PUBLIC_SEARCHES = Object.freeze([
  { name: 'haraj-bmw', url: 'https://haraj.com.sa/search/BMW/', make: 'BMW' },
  { name: 'haraj-bmw-x5', url: 'https://haraj.com.sa/search/BMW%20X5/', make: 'BMW', model: 'X5' },
  { name: 'haraj-bmw-530', url: 'https://haraj.com.sa/search/BMW%20530/', make: 'BMW', model: '530I' },
  { name: 'haraj-bmw-540', url: 'https://haraj.com.sa/search/BMW%20540/', make: 'BMW', model: '540I' },
  { name: 'haraj-mercedes', url: 'https://haraj.com.sa/search/mercedes/', make: 'Mercedes-Benz' },
  { name: 'haraj-c200', url: 'https://haraj.com.sa/search/C200/', make: 'Mercedes-Benz', model: 'C200' },
  { name: 'haraj-e300', url: 'https://haraj.com.sa/search/E300/', make: 'Mercedes-Benz', model: 'E300' },
  { name: 'haraj-glc', url: 'https://haraj.com.sa/search/GLC/', make: 'Mercedes-Benz', model: 'GLC' },
]);

const ALLOWED_HOSTS = new Set(['haraj.com.sa', 'www.haraj.com.sa']);

function decodeEntities(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const m = String(value).replace(/[,،]/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseThousandsNumber(rawNumber, suffix = '') {
  const n = numeric(rawNumber);
  if (!Number.isFinite(n)) return null;
  return /(?:الف|ألف|k)\b/i.test(String(suffix)) ? Math.round(n * 1000) : Math.round(n);
}

function parseExplicitPrice(text = '') {
  const clean = stripTags(text).replace(/\u2068|\u2069/g, ' ');
  if (/السعر\s+(?:على\s+)?السوم|على\s+السوم/i.test(clean) && !/(?:المطلوب|الحد|حدي|السعر\s+(?:النهائي|كاش))\s*[:\-]?\s*\d/i.test(clean)) {
    return null;
  }
  const patterns = [
    /(?:المطلوب|الحد|حدي|حدنا|السعر\s+(?:النهائي|كاش)|السعر)\s*[:\-]?\s*([\d,.،]+)\s*(الف|ألف|k)?\s*(?:ريال|ر\.س)?/i,
    /(?:مطلوب)\s*([\d,.،]+)\s*(الف|ألف|k)?/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (!m) continue;
    const value = parseThousandsNumber(m[1], m[2]);
    if (value != null && value >= 500) return value;
  }
  return null;
}

function parseMileage(text = '') {
  const clean = stripTags(text).replace(/\u2068|\u2069/g, ' ');
  const patterns = [
    /(?:الممشى|ممشى\s+السيارة|ممشى|العداد|عداد)\s*[:\-]?\s*([\d,.،]+)\s*(الف|ألف|k|كم|كيلو)?/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (!m) continue;
    const n = parseThousandsNumber(m[1], m[2]);
    if (n != null) return n;
  }
  return null;
}

function parseModelYear(title = '', description = '') {
  const desc = stripTags(description);
  const titleText = stripTags(title);
  const explicit = desc.match(/(?:الموديل|موديل)\s*[:\/\-]?\s*((?:19|20)\d{2})/i)
    || titleText.match(/(?:الموديل|موديل)\s*[:\/\-]?\s*((?:19|20)\d{2})/i);
  if (explicit) return Number(explicit[1]);
  const fallback = `${titleText}\n${desc}`.match(/\b((?:19|20)\d{2})\b/);
  return fallback ? Number(fallback[1]) : null;
}

function normalizeImages(image) {
  if (!image) return [];
  if (Array.isArray(image)) return image.flatMap(normalizeImages).filter(Boolean);
  if (typeof image === 'string') return [image];
  if (typeof image === 'object') {
    const candidate = image.url || image.contentUrl || image.src;
    return candidate ? [String(candidate)] : [];
  }
  return [];
}

function getSchemaTypes(node) {
  const raw = node?.['@type'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => String(x));
}

function findItemNodes(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) findItemNodes(item, out);
    return out;
  }
  if (value.itemListElement && Array.isArray(value.itemListElement)) {
    for (const element of value.itemListElement) {
      const item = element?.item || element;
      if (item && typeof item === 'object') out.push(item);
    }
  }
  if (Array.isArray(value['@graph'])) findItemNodes(value['@graph'], out);
  return out;
}

export function extractJsonLd(html) {
  const documents = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html)))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      documents.push(JSON.parse(raw));
    } catch {
      // Ignore malformed structured-data blocks; other blocks may still be valid.
    }
  }
  return documents;
}

export function assertPublicHarajUrl(rawUrl) {
  const u = new URL(String(rawUrl));
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error(`unsupported_public_source:${u.hostname}`);
  }
  if (/graphql|api\//i.test(u.pathname)) throw new Error('internal_endpoint_forbidden');
  return u.toString();
}

function externalIdFromUrl(url) {
  try {
    return new URL(url).pathname.match(/\/(\d{8,})(?:\/|$)/)?.[1] || null;
  } catch {
    return null;
  }
}

function offerDetails(offers) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer || typeof offer !== 'object') return {};
  return {
    price: numeric(offer.price ?? offer.lowPrice),
    priceCurrency: offer.priceCurrency || null,
    sellerUsername: offer.seller?.name || null,
    city: offer.availableAtOrFrom?.name || offer.areaServed?.name || null,
  };
}

export function listingFromJsonLdItem(item, hints = {}) {
  if (!item || typeof item !== 'object') return null;
  const title = stripTags(item.name || item.headline || '');
  const description = stripTags(item.description || '');
  const url = item.url ? new URL(String(item.url), hints.baseUrl || 'https://haraj.com.sa/').toString() : null;
  if (!url || !ALLOWED_HOSTS.has(new URL(url).hostname.toLowerCase())) return null;
  const offer = offerDetails(item.offers);
  const structuredPrice = offer.price != null && /SAR|ر\.س|ريال/i.test(String(offer.priceCurrency || 'SAR')) ? offer.price : null;
  const explicitPrice = parseExplicitPrice(description);
  const price = structuredPrice ?? explicitPrice;
  const mileage = parseMileage(description);
  const year = parseModelYear(title, description);
  const schemaTypes = getSchemaTypes(item);

  return normalizeListing({
    source: 'haraj',
    externalId: externalIdFromUrl(url),
    url,
    sellerUsername: offer.sellerUsername,
    title,
    description,
    make: hints.make,
    model: hints.model,
    year,
    mileage,
    price,
    priceSource: structuredPrice != null ? 'jsonld_offer' : explicitPrice != null ? 'description_explicit' : null,
    city: offer.city || null,
    images: normalizeImages(item.image),
    schemaType: schemaTypes.join(','),
  }, hints);
}

export function parseHarajSearchHtml(html, hints = {}) {
  const seen = new Set();
  const listings = [];
  for (const doc of extractJsonLd(html)) {
    for (const item of findItemNodes(doc)) {
      const listing = listingFromJsonLdItem(item, hints);
      if (!listing?.url) continue;
      const key = listing.externalId || listing.url;
      if (seen.has(key)) continue;
      seen.add(key);
      listings.push(listing);
    }
  }
  return listings;
}

export function extractHarajCandidateLinks(html, baseUrl = 'https://haraj.com.sa/') {
  const links = new Set(parseHarajSearchHtml(html, { baseUrl }).map((x) => x.url));
  if (links.size) return [...links];
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
  const docs = extractJsonLd(html);
  for (const doc of docs) {
    const items = findItemNodes(doc);
    for (const item of items) {
      const listing = listingFromJsonLdItem(item, { ...hints, baseUrl: url });
      if (listing && (!listing.externalId || listing.externalId === externalIdFromUrl(url))) return listing;
    }
  }

  const raw = String(html);
  const title = stripTags(raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '').replace(/\s*\|\s*موقع حراج\s*$/i, '');
  const description = stripTags(raw.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)?.[1] || '');
  const image = raw.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
  return normalizeListing({
    source: 'haraj',
    externalId: externalIdFromUrl(url),
    url,
    title,
    description,
    make: hints.make,
    model: hints.model,
    year: parseModelYear(title, description),
    mileage: parseMileage(description),
    price: parseExplicitPrice(description),
    priceSource: parseExplicitPrice(description) != null ? 'description_explicit' : null,
    city: hints.city || null,
    images: image ? [image] : [],
  }, hints);
}

async function fetchText(url, options = {}) {
  const safeUrl = assertPublicHarajUrl(url);
  const res = await (options.fetchImpl || fetch)(safeUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': options.userAgent || 'Mozilla/5.0 (compatible; OSA-Car-Hunter/1.1; public-search-monitor)',
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

function roundRobin(buckets, maxAds) {
  const output = [];
  let index = 0;
  while (output.length < maxAds) {
    let added = false;
    for (const bucket of buckets) {
      if (index >= bucket.items.length) continue;
      output.push(bucket.items[index]);
      added = true;
      if (output.length >= maxAds) break;
    }
    if (!added) break;
    index += 1;
  }
  return output;
}

function addBatchSellerRisk(listings) {
  const counts = new Map();
  for (const listing of listings) {
    const seller = listing.sellerUsername;
    if (!seller) continue;
    counts.set(seller, (counts.get(seller) || 0) + 1);
  }
  return listings.map((listing) => normalizeListing({
    ...listing,
    sellerStats: listing.sellerUsername ? { activeVehicleListings: counts.get(listing.sellerUsername) || 0 } : {},
  }));
}

export async function collectPublicHaraj(options = {}) {
  const searches = options.searches || PUBLIC_SEARCHES;
  const maxAds = Math.max(1, Math.min(Number(options.maxAds || 80), 160));
  const perSearchLimit = Math.max(1, Math.min(Number(options.perSearchLimit || 24), 50));
  const minDelayMs = Math.max(750, Number(options.minDelayMs || 1500));
  const errors = [];
  const buckets = [];

  for (const search of searches) {
    try {
      const html = await fetchText(search.url, options);
      const parsed = parseHarajSearchHtml(html, {
        make: search.make,
        model: search.model,
        baseUrl: search.url,
      }).slice(0, perSearchLimit).map((listing) => ({
        ...listing,
        discoveredBy: search.name,
        collectedAt: new Date().toISOString(),
      }));
      buckets.push({ search: search.name, items: parsed });
    } catch (error) {
      errors.push({ stage: 'search', search: search.name, error: String(error?.message || error) });
      buckets.push({ search: search.name, items: [] });
    }
    if (minDelayMs) await sleep(minDelayMs);
  }

  const selected = roundRobin(buckets, maxAds);
  const unique = [];
  const seen = new Set();
  for (const listing of selected) {
    const key = listing.externalId || listing.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(listing);
  }
  const listings = addBatchSellerRisk(unique);

  return {
    source: 'haraj-public-jsonld-search',
    searches: searches.map((s) => s.name),
    candidateCount: buckets.reduce((sum, bucket) => sum + bucket.items.length, 0),
    listingCount: listings.length,
    listings,
    errors,
  };
}
