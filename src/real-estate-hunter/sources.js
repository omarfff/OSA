export const REAL_ESTATE_SOURCES = Object.freeze([
  {
    id: 'aqar-buildings-sale-jeddah',
    platform: 'aqar',
    kind: 'listing_market',
    city: 'Jeddah',
    url: 'https://sa.aqar.fm/%D8%B9%D9%85%D8%A7%D8%A6%D8%B1-%D9%84%D9%84%D8%A8%D9%8A%D8%B9/%D8%AC%D8%AF%D8%A9',
  },
  {
    id: 'aqar-apartments-rent-jeddah',
    platform: 'aqar',
    kind: 'rental_market',
    city: 'Jeddah',
    url: 'https://sa.aqar.fm/%D8%B4%D9%82%D9%82-%D9%84%D9%84%D8%A5%D9%8A%D8%AC%D8%A7%D8%B1/%D8%AC%D8%AF%D8%A9',
  },
  {
    id: 'rega-indicators-jeddah',
    platform: 'rega',
    kind: 'official_indicators',
    city: 'Jeddah',
    url: 'https://rei.rega.gov.sa/ar/cities/%D8%AC%D8%AF%D8%A9',
  },
  {
    id: 'rega-advanced-search',
    platform: 'rega',
    kind: 'official_transactions',
    city: 'Saudi Arabia',
    url: 'https://rei.rega.gov.sa/ar/advanced-search',
  },
  {
    id: 'suhail-market-map',
    platform: 'suhail',
    kind: 'market_intelligence',
    city: 'Saudi Arabia',
    url: 'https://suhail.ai/',
  },
  {
    id: 'srem-offers-service',
    platform: 'srem',
    kind: 'official_exchange',
    city: 'Saudi Arabia',
    url: 'https://www.moj.gov.sa/ar/eServices/Pages/1fcb5dc7-ad69-4578-821a-1009b73dcc43.aspx',
    authExpected: true,
  },
]);

export const ALLOWED_REAL_ESTATE_HOSTS = new Set([
  'sa.aqar.fm',
  'aqar.fm',
  'rei.rega.gov.sa',
  'suhail.ai',
  'www.suhail.ai',
  'nafath-srem.moj.gov.sa',
  'www.moj.gov.sa',
  'moj.gov.sa',
]);

export function assertPublicRealEstateUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || !ALLOWED_REAL_ESTATE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('real_estate_source_not_allowed');
  }
  if (/\/(?:api|graphql)(?:\/|$)/i.test(url.pathname)) {
    throw new Error('real_estate_internal_endpoint_forbidden');
  }
  return url.toString();
}
