import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePriceHistory,
  assessDeal,
  fromHarajSharedPost,
  listingFingerprint,
  normalizeListing,
} from '../src/car-hunter/index.js';

function comp(price, mileage = 205000, year = 2017) {
  return normalizeListing({
    source: 'manual',
    make: 'Mercedes-Benz',
    model: 'C200',
    year,
    mileage,
    price,
    engineCode: 'M274',
    description: 'نظيف بدون حوادث',
  });
}

test('Haraj shared-post adapter converts thousand-style price and mileage safely', () => {
  const raw = fromHarajSharedPost({
    id: 188250984,
    authorId: 12491350,
    authorUsername: 'seller',
    title: 'مرسيدس c200',
    bodyTEXT: 'مرسيدس C200 2017 كت AMG رش على الجانب الأيمن بسيط',
    city: 'جده',
    carInfo: { model: 2017, mileage: 205, fuel: 'GASOLINE', gear: 'AUTO' },
    price: { inputPrice: '55' },
    imagesList: ['https://cdn.example/a.jpg'],
  });
  const n = normalizeListing(raw, { make: 'Mercedes-Benz', model: 'C200' });
  assert.equal(n.priceSar, 55000);
  assert.equal(n.mileageKm, 205000);
  assert.equal(n.trimClaimUnverified, true);
  assert.ok(n.riskFlags.some((f) => f.key === 'side_repaint'));
});

test('hard down-payment/installment structure is rejected before market scoring', () => {
  const listing = normalizeListing({
    source: 'manual',
    make: 'BMW',
    model: '530i',
    year: 2019,
    mileage: 120000,
    price: 15000,
    engineCode: 'B48',
    description: 'دفعة أولى 15 ألف والباقي أقساط',
  });
  const result = assessDeal(listing, []);
  assert.equal(result.status, 'REJECT_PRICE_UNRELIABLE');
});

test('mentioning finance alone is soft risk, not an automatic rejection', () => {
  const listing = normalizeListing({
    source: 'manual', make: 'Mercedes-Benz', model: 'C200', year: 2019,
    mileage: 120000, price: 80000, engineCode: 'M274',
    description: 'السعر كاش 80 ألف ويوجد تمويل عن طريق البنك',
  });
  assert.equal(listing.nonCashPriceRisk, false);
  assert.equal(listing.priceStructureRisk.level, 'soft');
});

test('positive chassis guarantee is not treated as chassis damage', () => {
  const listing = normalizeListing({
    source: 'manual', make: 'BMW', model: '530i', year: 2019,
    mileage: 130000, price: 70000, engineCode: 'B48',
    description: 'مكينة شرط قير شرط شاص شرط والبدي نظيف',
  });
  assert.equal(listing.riskFlags.some((f) => f.key === 'chassis'), false);
});

test('parts/rental noise is rejected as non-vehicle', () => {
  const listing = normalizeListing({
    source: 'haraj', make: 'BMW', title: 'شمعات BMW 500 2020', price: 800,
    description: 'قطع غيار للبيع',
  });
  const result = assessDeal(listing, []);
  assert.equal(listing.listingKind, 'parts');
  assert.equal(result.status, 'REJECT_NON_VEHICLE');
});

test('import price that excludes customs or VAT is rejected as unreliable', () => {
  const listing = normalizeListing({
    source: 'haraj', make: 'BMW', model: '540I', year: 2026, mileage: 19312, price: 257132,
    title: '2026 BMW 540 i xDrive',
    description: 'السعر شامل الشحن واصل إلى ميناء جدة الإسلامي، السعر لا يشمل الجمارك والضريبة 20٪',
  });
  const result = assessDeal(listing, []);
  assert.equal(listing.priceStructureRisk.level, 'hard');
  assert.ok(listing.priceStructureRisk.reasons.includes('excluded_import_costs'));
  assert.equal(result.status, 'REJECT_PRICE_UNRELIABLE');
});

test('commercial vehicles are rejected from passenger-car deal ranking', () => {
  const listing = normalizeListing({ source: 'haraj', make: 'Mercedes-Benz', title: 'شاحنة مرسيدس 2006', price: 144000 });
  const result = assessDeal(listing, []);
  assert.equal(listing.listingKind, 'commercial_vehicle');
  assert.equal(result.status, 'REJECT_NON_VEHICLE');
});

test('explicit full-repaint / chassis damage / overheat language increases reserve and risk', () => {
  const risky = normalizeListing({
    source: 'manual',
    make: 'BMW',
    model: 'X5',
    year: 2015,
    mileage: 299000,
    price: 37000,
    engineCode: 'N55',
    description: 'مرشوش كامل وفيها ضربة شاص وسبق رفعت الحرارة',
  });
  const result = assessDeal(risky, [
    normalizeListing({ source: 'manual', make: 'BMW', model: 'X5', year: 2015, mileage: 270000, price: 58000, engineCode: 'N55' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: 'X5', year: 2015, mileage: 300000, price: 54000, engineCode: 'N55' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: 'X5', year: 2016, mileage: 290000, price: 61000, engineCode: 'N55' }),
  ]);
  assert.ok(result.scores.mechanicalRisk >= 75);
  assert.ok(result.maintenance.reserveSar >= 30000);
  assert.equal(result.status, 'HIGH_RISK');
});

test('cheap asking price is not a deal when all-in cost consumes quick-sale margin', () => {
  const target = normalizeListing({
    source: 'manual', make: 'Mercedes-Benz', model: 'C200', year: 2017,
    mileage: 205000, price: 55000, engineCode: 'M274', description: 'رش جنب بسيط',
  });
  const comps = [comp(62000, 190000), comp(65000, 210000), comp(64000, 200000), comp(66000, 220000)];
  const result = assessDeal(target, comps, { targetProfitSar: 4000 });
  assert.ok(result.market.quickSaleValueSar > 0);
  assert.ok(result.allInCostSar > target.priceSar);
  assert.ok(result.maxBuySar < result.market.quickSaleValueSar);
  assert.notEqual(result.status, 'BUY_CANDIDATE');
});

test('genuine under-market car can become BUY_CANDIDATE only with enough comps and tolerable risk', () => {
  const target = normalizeListing({
    source: 'manual', make: 'BMW', model: '530i', year: 2019,
    mileage: 110000, price: 45000, engineCode: 'B48', vin: 'WBA00000000000000',
    images: Array.from({ length: 6 }, (_, i) => `https://cdn.example/${i}.jpg`),
    description: 'بدي وكالة وصيانة موثقة',
  });
  const comps = [
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 100000, price: 80000, engineCode: 'B48' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 120000, price: 78000, engineCode: 'B48' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2020, mileage: 115000, price: 84000, engineCode: 'B48' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2018, mileage: 105000, price: 75000, engineCode: 'B48' }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 90000, price: 82000, engineCode: 'B48' }),
  ];
  const result = assessDeal(target, comps, { targetProfitSar: 4000 });
  assert.equal(result.status, 'BUY_CANDIDATE');
  assert.ok(result.netUpsideSar > 4000);
  assert.ok(result.scores.confidence >= 65);
});

test('high-volume seller reduces confidence without pretending the car itself is mechanically bad', () => {
  const target = normalizeListing({
    source: 'manual', make: 'BMW', model: '530i', year: 2019,
    mileage: 110000, price: 45000, engineCode: 'B48', vin: 'WBA00000000000000',
    sellerStats: { activeVehicleListings: 25, accountAgeDays: 500 },
  });
  assert.ok(target.sellerRisk.score >= 30);
  const result = assessDeal(target, [
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 100000, price: 80000 }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 120000, price: 79000 }),
    normalizeListing({ source: 'manual', make: 'BMW', model: '530i', year: 2019, mileage: 90000, price: 82000 }),
  ]);
  assert.equal(result.scores.sellerRisk, target.sellerRisk.score);
  assert.ok(result.scores.mechanicalRisk < 75);
});

test('fingerprint ignores price changes so relisted vehicle can retain identity', () => {
  const base = {
    source: 'haraj', sellerId: '123', make: 'BMW', model: '530i', year: 2019,
    mileage: 120000, images: ['https://cdn.example/car-a.jpg'],
  };
  const a = normalizeListing({ ...base, price: 70000 });
  const b = normalizeListing({ ...base, price: 65000 });
  assert.equal(listingFingerprint(a), listingFingerprint(b));
});

test('price history detects repeated drops and seller urgency', () => {
  const history = analyzePriceHistory([
    { priceSar: 70000, at: '2026-09-01T00:00:00Z' },
    { priceSar: 65000, at: '2026-09-05T00:00:00Z' },
    { priceSar: 59000, at: '2026-09-10T00:00:00Z' },
  ]);
  assert.equal(history.drops, 2);
  assert.equal(history.totalDropSar, 11000);
  assert.ok(history.urgencyScore >= 50);
});
