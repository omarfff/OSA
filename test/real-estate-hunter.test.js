import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyRealEstatePage } from '../src/real-estate-hunter/browser.js';
import { runRealEstateHunterCycle } from '../src/real-estate-hunter/autopilot.js';
import { extractAqarListings, extractRegaMetrics } from '../src/real-estate-hunter/parser.js';
import { assertPublicRealEstateUrl } from '../src/real-estate-hunter/sources.js';

test('Real Estate Hunter only permits approved public platform hosts', () => {
  assert.equal(new URL(assertPublicRealEstateUrl('https://sa.aqar.fm/')).hostname, 'sa.aqar.fm');
  assert.equal(new URL(assertPublicRealEstateUrl('https://rei.rega.gov.sa/ar')).hostname, 'rei.rega.gov.sa');
  assert.throws(() => assertPublicRealEstateUrl('https://example.com/'), /not_allowed/);
  assert.throws(() => assertPublicRealEstateUrl('https://suhail.ai/api/private'), /internal_endpoint/);
});

test('REGA Jeddah summary metrics are parsed from rendered public text', () => {
  const metrics = extractRegaMetrics([
    '9.2 ألف',
    'عدد الصفقات',
    '14.3 مليار',
    'إجمالي قيم الصفقات',
    'جدة - الصفاء',
    'الحي الأكثر نشاطًا',
    'شقة',
    'نوع العقار الأكثر نشاطًا',
    '327.8 مليون',
    'الصفقة الأعلى قيمة',
    'متوسط سعر المتر لصفقات بيع العقارات',
    'الرقم القياسي لأسعار الإيجارات',
    'مؤشر نسبة الايجار الى الدخل - المجمع',
  ].join('\n'));

  assert.equal(metrics.dealCount, 9200);
  assert.equal(metrics.totalDealValueSar, 14300000000);
  assert.equal(metrics.highestDealSar, 327800000);
  assert.equal(metrics.mostActiveDistrict, 'جدة - الصفاء');
  assert.equal(metrics.mostActivePropertyType, 'شقة');
  assert.equal(metrics.hasSalePricePerSqmIndicator, true);
  assert.equal(metrics.hasRentalIndex, true);
  assert.equal(metrics.hasRentToIncomeIndicator, true);
});

test('Aqar rendered cards produce normalized listing and price-per-square-meter data', () => {
  const listings = extractAqarListings([
    'عمارة للبيع في شارع محمد بن حمادي, حي الصفاء, مدينة جدة, منطقة مكة المكرمة 4,000,000 §750م²25م سكني',
    'شقة للإيجار في شارع الهذايل, حي الصفاء, مدينة جدة, منطقة مكة المكرمة 24,000 §/سنوي 65م²2 1 1',
  ].join('\n'));

  assert.equal(listings.length, 2);
  assert.equal(listings[0].listingType, 'sale');
  assert.equal(listings[0].priceSar, 4000000);
  assert.equal(listings[0].areaSqm, 750);
  assert.equal(listings[0].pricePerSqmSar, 5333);
  assert.equal(listings[1].listingType, 'rent');
  assert.equal(listings[1].priceSar, 24000);
});

test('SREM Nafath page is treated as an expected authentication boundary', () => {
  const state = classifyRealEstatePage(
    'تسجيل الدخول إلى البورصة العقارية يتطلب تطبيق نفاذ والتحقق عبر النفاذ الوطني'.repeat(10),
    { authExpected: true },
  );
  assert.equal(state.state, 'AUTH_REQUIRED');
  assert.equal(state.usable, true);
});

test('autopilot combines Aqar, REGA, Suhail and SREM captures into one snapshot', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'real-estate-hunter-'));
  const sources = [
    { id: 'aqar-buildings-sale-jeddah', platform: 'aqar', kind: 'listing_market', city: 'Jeddah', url: 'https://sa.aqar.fm/' },
    { id: 'rega-indicators-jeddah', platform: 'rega', kind: 'official_indicators', city: 'Jeddah', url: 'https://rei.rega.gov.sa/ar' },
    { id: 'suhail-market-map', platform: 'suhail', kind: 'market_intelligence', city: 'Saudi Arabia', url: 'https://suhail.ai/' },
    { id: 'srem-gateway', platform: 'srem', kind: 'official_exchange', city: 'Saudi Arabia', url: 'https://nafath-srem.moj.gov.sa/', authExpected: true },
  ];

  const captureImpl = async (source) => ({
    sourceId: source.id,
    platform: source.platform,
    kind: source.kind,
    city: source.city,
    state: source.platform === 'srem' ? 'AUTH_REQUIRED' : 'LIVE',
    usable: true,
    reason: 'test',
    url: source.url,
    finalUrl: source.url,
    pageText:
      source.platform === 'aqar'
        ? 'عمارة للبيع في شارع مثال, حي الصفاء, مدينة جدة 4,000,000 §750م²20م سكني'
        : source.platform === 'rega'
          ? '9.2 ألف\nعدد الصفقات\n14.3 مليار\nإجمالي قيم الصفقات'
          : source.platform === 'suhail'
            ? 'الخريطة العقارية الصفقات مقارنة الأسعار المعلومات العمرانية المخططات'
            : 'تسجيل الدخول نفاذ النفاذ الوطني'.repeat(10),
    pageTextLength: 500,
    screenshotFile: null,
    capturedAt: new Date().toISOString(),
  });

  const result = await runRealEstateHunterCycle({ stateDir, sources, captureImpl });
  assert.equal(result.summary.sources, 4);
  assert.equal(result.summary.live, 3);
  assert.equal(result.summary.authRequired, 1);
  assert.equal(result.market.aqar.saleListingsParsed, 1);
  assert.equal(result.market.officialJeddah.dealCount, 9200);

  const latest = JSON.parse(await fs.readFile(path.join(stateDir, 'latest.json'), 'utf8'));
  assert.equal(latest.policy.nafathAutomation, false);

  await fs.rm(stateDir, { recursive: true, force: true });
});
