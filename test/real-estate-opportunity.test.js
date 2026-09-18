import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachOpportunityFeedback,
  defaultLearningState,
  recordOpportunityEvents,
  updateLearningState,
} from '../src/real-estate-hunter/learner.js';
import { scorePropertyOpportunity } from '../src/real-estate-hunter/opportunity.js';

function sale(title, priceSar, areaSqm) {
  return {
    title,
    listingType: 'sale',
    propertyType: 'building',
    district: 'الصفاء',
    dataQuality: 'GOOD',
    priceSar,
    areaSqm,
    pricePerSqmSar: Math.round(priceSar / areaSqm),
    city: 'Jeddah',
  };
}

function rent(title, priceSar, areaSqm) {
  return {
    title,
    listingType: 'rent',
    propertyType: 'apartment',
    district: 'الصفاء',
    dataQuality: 'GOOD',
    priceSar,
    areaSqm,
    pricePerSqmSar: Math.round(priceSar / areaSqm),
    city: 'Jeddah',
  };
}

test('district history can promote a deeply discounted, well-supported building to MUST_NOT_MISS', () => {
  let state = defaultLearningState();
  const now = new Date('2026-09-19T00:00:00Z');

  const comps = [
    sale('عمارة للبيع في شارع أ, حي الصفاء, مدينة جدة', 3_000_000, 500),
    sale('عمارة للبيع في شارع ب, حي الصفاء, مدينة جدة', 3_150_000, 500),
    sale('عمارة للبيع في شارع ج, حي الصفاء, مدينة جدة', 2_950_000, 500),
    sale('عمارة للبيع في شارع د, حي الصفاء, مدينة جدة', 3_100_000, 500),
    sale('عمارة للبيع في شارع هـ, حي الصفاء, مدينة جدة', 3_050_000, 500),
    rent('شقة للإيجار في شارع ر1, حي الصفاء, مدينة جدة', 60_000, 150),
    rent('شقة للإيجار في شارع ر2, حي الصفاء, مدينة جدة', 63_000, 150),
    rent('شقة للإيجار في شارع ر3, حي الصفاء, مدينة جدة', 57_000, 150),
  ];

  state = updateLearningState(state, comps, now, { healthyCycle: true });

  const target = sale('عمارة للبيع في شارع فرصة, حي الصفاء, مدينة جدة', 2_000_000, 500);
  state = updateLearningState(state, [...comps, target], new Date(now.getTime() + 30 * 60 * 1000), { healthyCycle: true });

  const scored = scorePropertyOpportunity(target, {
    learningState: state,
    officialJeddah: { mostActiveDistrict: 'جدة - الصفاء' },
  });

  assert.equal(scored.status, 'MUST_NOT_MISS');
  assert.ok(scored.score >= 86);
  assert.ok(scored.confidence >= 72);
  assert.ok(scored.discountPct >= 30);
  assert.ok(scored.districtSaleCompCount >= 3);
});

test('fast-exit proxy is learned only after repeated visibility then three healthy misses', () => {
  let state = defaultLearningState();
  const listing = sale('عمارة للبيع في شارع نادرة, حي الصفاء, مدينة جدة', 2_100_000, 500);
  const t0 = new Date('2026-09-19T00:00:00Z');

  state = updateLearningState(state, [listing], t0, { healthyCycle: true });
  state = updateLearningState(state, [listing], new Date(t0.getTime() + 30 * 60 * 1000), { healthyCycle: true });

  const trackedKey = Object.keys(state.listings)[0];
  state = attachOpportunityFeedback(state, [{
    fingerprint: trackedKey,
    status: 'STRONG_INSPECT',
    score: 82,
    discountPct: 24,
  }]);

  state = updateLearningState(state, [], new Date(t0.getTime() + 60 * 60 * 1000), { healthyCycle: true });
  state = updateLearningState(state, [], new Date(t0.getTime() + 90 * 60 * 1000), { healthyCycle: true });
  state = updateLearningState(state, [], new Date(t0.getTime() + 120 * 60 * 1000), { healthyCycle: true });

  assert.equal(state.outcomes.filter((x) => x.type === 'FAST_EXIT_PROXY').length, 1);
  assert.equal(state.stats.fastExitProxyCount, 1);
});

test('failed marketplace cycle does not teach a false fast-exit signal', () => {
  let state = defaultLearningState();
  const listing = sale('عمارة للبيع في شارع ثابت, حي الصفاء, مدينة جدة', 2_100_000, 500);
  const t0 = new Date('2026-09-19T00:00:00Z');

  state = updateLearningState(state, [listing], t0, { healthyCycle: true });
  state = updateLearningState(state, [listing], new Date(t0.getTime() + 30 * 60 * 1000), { healthyCycle: true });

  for (let i = 1; i <= 5; i += 1) {
    state = updateLearningState(state, [], new Date(t0.getTime() + (30 + i * 30) * 60 * 1000), { healthyCycle: false });
  }

  assert.equal(state.outcomes.length, 0);
});

test('opportunity events remain available after the listing disappears so alert checks can still catch them', () => {
  let state = defaultLearningState();
  const event = {
    fingerprint: 'abc',
    status: 'MUST_NOT_MISS',
    score: 94,
    priceSar: 2_000_000,
    district: 'الصفاء',
    title: 'عمارة فرصة',
  };
  const now = new Date('2026-09-19T00:00:00Z');

  state = recordOpportunityEvents(state, [event], now);
  assert.equal(state.opportunityEvents.length, 1);
  assert.equal(state.opportunityEvents[0].active, true);

  state = recordOpportunityEvents(state, [], new Date(now.getTime() + 30 * 60 * 1000));
  assert.equal(state.opportunityEvents[0].active, false);
  assert.ok(state.opportunityEvents[0].disappearedMs);
});
