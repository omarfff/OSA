import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHarajUrl,
  extractHarajCandidateLinks,
  parseHarajPublicPostHtml,
  parseHarajSearchHtml,
} from '../src/car-hunter/collector.js';

test('collector only allows public haraj pages and rejects internal API paths', () => {
  assert.match(assertPublicHarajUrl('https://haraj.com.sa/search/BMW/'), /haraj\.com\.sa/);
  assert.throws(() => assertPublicHarajUrl('https://graphql.haraj.com.sa/'), /unsupported_public_source/);
  assert.throws(() => assertPublicHarajUrl('https://haraj.com.sa/api/private'), /internal_endpoint_forbidden/);
});

test('search JSON-LD parses a live-style X5 listing price, mileage and year from public data', () => {
  const html = `<!doctype html><html><head>
    <script id="json-ld-search-results" type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SearchResultsPage',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: [{
        '@type': 'ListItem', position: 1, item: {
          '@context': 'https://schema.org', '@type': 'Thing',
          name: 'BMW x5 2015 للبيع',
          description: 'نوع السيارة : BMW الفئة : X5 الموديل :2015 الممشى : 180 الف حالة البدي رش كبوت. الابرباج اليمين طالع من حادث بسيط والشاص سليم وشرط. المطلوب :53 الف ريال',
          image: ['https://mimg.example/x5-1.jpg', 'https://mimg.example/x5-2.jpg'],
          url: 'https://haraj.com.sa/11188437904/BMW_x5_2015_للبيع/',
        },
        }],
      },
    })}</script></head><body></body></html>`;

  const [listing] = parseHarajSearchHtml(html, { make: 'BMW' });
  assert.equal(listing.externalId, '11188437904');
  assert.equal(listing.model, 'X5');
  assert.equal(listing.year, 2015);
  assert.equal(listing.mileageKm, 180000);
  assert.equal(listing.priceSar, 53000);
  assert.equal(listing.priceSource, 'description_explicit');
  assert.ok(listing.riskFlags.some((f) => f.key === 'airbag_damage'));
  assert.equal(listing.riskFlags.some((f) => f.key === 'chassis'), false, 'شاص سليم وشرط is not damage');
});

test('actual model year beats conversion year and conversion/repaint/airbag risks are retained', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
      '@type': 'Thing',
      name: 'BMW 730 محول 2022',
      description: 'بي ام دبليو 730Li الموديل 2018 محول 2022 الممشى :260 المحركات وكاله البدي رشوش متفرقه بسبب الترهيم أرباق المعاون طالع بسب حادث بسيط الحد 69 الف صامل فقط',
      image: ['https://mimg.example/730.jpg'],
      url: 'https://haraj.com.sa/11188433584/BMW_730_محول_2022/',
    }}],
  })}</script>`;
  const [listing] = parseHarajSearchHtml(html, { make: 'BMW' });
  assert.equal(listing.year, 2018);
  assert.equal(listing.mileageKm, 260000);
  assert.equal(listing.priceSar, 69000);
  assert.ok(listing.riskFlags.some((f) => f.key === 'body_conversion'));
  assert.ok(listing.riskFlags.some((f) => f.key === 'scattered_repaint'));
  assert.ok(listing.riskFlags.some((f) => f.key === 'airbag_damage'));
});

test('Product JSON-LD exposes seller/city/price but parts title is rejected as non-vehicle', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
      '@type': 'Product',
      name: 'مراية BMW 750 كاميرا 2015',
      description: 'مراية كاميرا بي ام دبليو 750 السعر 1000 متوفر يمين يسار',
      image: ['https://img.example/mirror.jpg'],
      url: 'https://haraj.com.sa/11188426739/مراية_BMW_750_كاميرا_2015/',
      offers: {
        '@type': 'Offer', price: 1000, priceCurrency: 'SAR',
        seller: { '@type': 'Person', name: 'mopar0815' },
        availableAtOrFrom: { '@type': 'City', name: 'الخبر' },
      },
    }}],
  })}</script>`;
  const [listing] = parseHarajSearchHtml(html, { make: 'BMW' });
  assert.equal(listing.priceSar, 1000);
  assert.equal(listing.priceSource, 'jsonld_offer');
  assert.equal(listing.sellerUsername, 'mopar0815');
  assert.equal(listing.city, 'الخبر');
  assert.equal(listing.listingKind, 'parts');
});

test('specific search hint cannot relabel a different BMW model', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'SearchResultsPage', mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
      '@type': 'Thing', name: '2026 BMW X6 xDrive 40i M',
      description: 'BMW X6 موديل 2026 السعر 399999 ريال',
      url: 'https://haraj.com.sa/11188342574/BMW_X6_2026/',
    }}] },
  })}</script>`;
  const [listing] = parseHarajSearchHtml(html, { make: 'BMW', model: '540I' });
  assert.equal(listing.model, 'X6');
});

test('specific search hint is retained when the ad text actually matches it', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'SearchResultsPage', mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
      '@type': 'Thing', name: 'BMW 530 2022',
      description: 'BMW 530 موديل 2022 المطلوب 167 الف',
      url: 'https://haraj.com.sa/11188387793/BMW_530_2022/',
    }}] },
  })}</script>`;
  const [listing] = parseHarajSearchHtml(html, { make: 'BMW', model: '530I' });
  assert.equal(listing.model, '530I');
});

test('mileage in miles is converted to kilometers before scoring', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'SearchResultsPage', mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
      '@type': 'Thing', name: '2026 BMW 540 i xDrive',
      description: 'الموديل: 2026 الممشى: 12 الف ميل السعر: 257132 ريال',
      url: 'https://haraj.com.sa/11184135023/2026_BMW_540_i_xDrive/',
    }}] },
  })}</script>`;
  const [listing] = parseHarajSearchHtml(html, { make: 'BMW', model: '540I' });
  assert.equal(listing.mileageKm, 19312);
});

test('structured search extraction deduplicates links', () => {
  const item = {
    '@type': 'Thing', name: 'BMW X5 2015', description: 'الموديل 2015 الممشى 180 الف المطلوب 53 الف',
    url: 'https://haraj.com.sa/11188437904/BMW_X5_2015/',
  };
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ItemList', itemListElement: [
      { '@type': 'ListItem', item },
      { '@type': 'ListItem', item },
    ],
  })}</script>`;
  const links = extractHarajCandidateLinks(html);
  assert.deepEqual(links, ['https://haraj.com.sa/11188437904/BMW_X5_2015/']);
});

test('direct public post fallback never steals the website shell year', () => {
  const html = `<!doctype html><html><head>
    <title>مرسيدس c200 | موقع حراج</title>
    <meta property="og:title" content="مرسيدس c200 | موقع حراج">
    <meta property="og:description" content="مرسيدس C200 الموديل 2017 ممشى 205 الف كت AMG رش جنب بسيط المطلوب 55 الف">
    <meta property="og:image" content="https://mimg.example/car.jpg">
    </head><body><footer>مؤسسة حراج 2026</footer></body></html>`;
  const listing = parseHarajPublicPostHtml(html, 'https://haraj.com.sa/11188250984/مرسيدس_c200/', { make: 'Mercedes-Benz' });
  assert.equal(listing.priceSar, 55000);
  assert.equal(listing.mileageKm, 205000);
  assert.equal(listing.year, 2017);
  assert.equal(listing.model, 'C200');
  assert.equal(listing.trimClaimUnverified, true);
});
