import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHarajUrl,
  extractHarajCandidateLinks,
  parseHarajPublicPostHtml,
} from '../src/car-hunter/collector.js';

test('collector only allows public haraj pages and rejects internal API paths', () => {
  assert.match(assertPublicHarajUrl('https://haraj.com.sa/search/BMW/'), /haraj\.com\.sa/);
  assert.throws(() => assertPublicHarajUrl('https://graphql.haraj.com.sa/'), /unsupported_public_source/);
  assert.throws(() => assertPublicHarajUrl('https://haraj.com.sa/api/private'), /internal_endpoint_forbidden/);
});

test('search HTML extraction deduplicates public ad links', () => {
  const html = `
    <a href="/11188250984/مرسيدس_c200/">C200</a>
    <a href="/11188250984/مرسيدس_c200/">same</a>
    <a href="/11199999999/BMW_530i/">BMW</a>`;
  const links = extractHarajCandidateLinks(html);
  assert.equal(links.length, 2);
  assert.ok(links.some((x) => x.includes('11188250984')));
});

test('public post parser extracts price/mileage/year without private endpoints', () => {
  const html = `<!doctype html><html><head>
    <title>مرسيدس c200 | موقع حراج</title>
    <meta property="og:title" content="مرسيدس c200 | موقع حراج">
    <meta property="og:description" content="مرسيدس C200 موديل 2017 ممشى 205 الف كت AMG رش جنب بسيط">
    <meta property="og:image" content="https://mimg.example/car.jpg">
    </head><body>
    <script>window.payload={"mileage":205,"price":{"inputPrice":"55"}}</script>
    </body></html>`;
  const listing = parseHarajPublicPostHtml(html, 'https://haraj.com.sa/11188250984/مرسيدس_c200/', { make: 'Mercedes-Benz' });
  assert.equal(listing.priceSar, 55000);
  assert.equal(listing.mileageKm, 205000);
  assert.equal(listing.year, 2017);
  assert.equal(listing.model, 'C200');
  assert.equal(listing.trimClaimUnverified, true);
});
