import { createHash } from 'node:crypto';

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function listingFingerprint(listing = {}) {
  const stable = [
    cleanText(listing.title || ''),
    String(Math.round(Number(listing.areaSqm || 0))),
    cleanText(listing.district || ''),
    cleanText(listing.propertyType || ''),
  ].join('|');
  return createHash('sha1').update(stable).digest('hex').slice(0, 20);
}

function median(values = []) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function percentile(values = [], p = 0.5) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const idx = Math.max(0, Math.min(clean.length - 1, Math.round((clean.length - 1) * p)));
  return clean[idx];
}

function boundedArray(values = [], max = 240) {
  return values.slice(Math.max(0, values.length - max));
}

export function defaultLearningState() {
  return {
    version: 1,
    listings: {},
    saleSamplesByDistrict: {},
    rentSamplesByDistrict: {},
    outcomes: [],
    opportunityEvents: [],
    thresholds: {
      mustNotMissScore: 86,
      strongInspectScore: 76,
      minDiscountPct: 18,
    },
    stats: {
      cycles: 0,
      fastExitProxyCount: 0,
      staleProxyCount: 0,
    },
  };
}

function addDistrictSample(bucket, district, sample) {
  if (!district || !Number.isFinite(sample.pricePerSqmSar)) return;
  const list = Array.isArray(bucket[district]) ? bucket[district] : [];
  const existing = list.findIndex((x) => x.fingerprint === sample.fingerprint);
  if (existing >= 0) list[existing] = sample;
  else list.push(sample);
  bucket[district] = boundedArray(list, 240);
}

function pruneOldSamples(bucket, nowMs, maxAgeMs = 90 * 24 * 3600 * 1000) {
  for (const [district, samples] of Object.entries(bucket || {})) {
    bucket[district] = (samples || []).filter((x) => nowMs - Number(x.lastSeenMs || 0) <= maxAgeMs);
    if (!bucket[district].length) delete bucket[district];
  }
}

function recordOutcome(state, outcome) {
  const key = outcome.fingerprint + ':' + outcome.type;
  if (state.outcomes.some((x) => x.key === key)) return;
  state.outcomes.push({ ...outcome, key });
  state.outcomes = boundedArray(state.outcomes, 400);
}

function refreshThresholds(state) {
  const fast = state.outcomes
    .filter((x) => x.type === 'FAST_EXIT_PROXY' && Number.isFinite(x.score))
    .map((x) => x.score);

  if (fast.length >= 5) {
    const q25 = percentile(fast, 0.25);
    const learned = Math.round(Math.max(80, Math.min(92, q25 ?? 86)));
    state.thresholds.mustNotMissScore = learned;
  }

  const discounts = state.outcomes
    .filter((x) => x.type === 'FAST_EXIT_PROXY' && Number.isFinite(x.discountPct))
    .map((x) => x.discountPct);

  if (discounts.length >= 5) {
    const q25 = percentile(discounts, 0.25);
    state.thresholds.minDiscountPct = Math.round(Math.max(12, Math.min(30, q25 ?? 18)));
  }

  state.stats.fastExitProxyCount = fast.length;
  state.stats.staleProxyCount = state.outcomes.filter((x) => x.type === 'STALE_PROXY').length;
}

export function updateLearningState(previousState, listings = [], now = new Date(), options = {}) {
  const state = previousState && previousState.version === 1
    ? structuredClone(previousState)
    : defaultLearningState();

  state.listings ||= {};
  state.saleSamplesByDistrict ||= {};
  state.rentSamplesByDistrict ||= {};
  state.outcomes ||= [];
  state.opportunityEvents ||= [];
  state.thresholds ||= {
    mustNotMissScore: 86,
    strongInspectScore: 76,
    minDiscountPct: 18,
  };
  state.stats ||= { cycles: 0, fastExitProxyCount: 0, staleProxyCount: 0 };

  const nowMs = now.getTime();
  const current = new Map();

  for (const listing of listings) {
    if (!listing?.title || !Number.isFinite(listing?.pricePerSqmSar)) continue;
    const fingerprint = listingFingerprint(listing);
    current.set(fingerprint, listing);

    const prior = state.listings[fingerprint] || {
      fingerprint,
      firstSeenMs: nowMs,
      lastSeenMs: nowMs,
      seenRuns: 0,
      missingRuns: 0,
      firstPriceSar: listing.priceSar,
      lowestPriceSar: listing.priceSar,
      latestPriceSar: listing.priceSar,
      latestScore: null,
      latestDiscountPct: null,
      district: listing.district || null,
      propertyType: listing.propertyType || null,
      status: 'ACTIVE',
    };

    prior.lastSeenMs = nowMs;
    prior.seenRuns += 1;
    prior.missingRuns = 0;
    prior.latestPriceSar = listing.priceSar;
    prior.lowestPriceSar = Math.min(Number(prior.lowestPriceSar || listing.priceSar), listing.priceSar);
    prior.district = listing.district || prior.district;
    prior.propertyType = listing.propertyType || prior.propertyType;
    prior.status = 'ACTIVE';
    state.listings[fingerprint] = prior;

    const sample = {
      fingerprint,
      pricePerSqmSar: listing.pricePerSqmSar,
      lastSeenMs: nowMs,
      priceSar: listing.priceSar,
      areaSqm: listing.areaSqm,
    };
    if (listing.listingType === 'sale' && listing.dataQuality !== 'LOW') {
      addDistrictSample(state.saleSamplesByDistrict, listing.district, sample);
    }
    if (listing.listingType === 'rent' && listing.dataQuality !== 'LOW') {
      addDistrictSample(state.rentSamplesByDistrict, listing.district, sample);
    }
  }

  for (const tracked of Object.values(state.listings)) {
    if (current.has(tracked.fingerprint)) continue;
    if (options.healthyCycle === false) continue;
    tracked.missingRuns = Number(tracked.missingRuns || 0) + 1;

    const ageMs = nowMs - Number(tracked.firstSeenMs || nowMs);
    if (
      tracked.status === 'ACTIVE'
      && tracked.seenRuns >= 2
      && tracked.missingRuns >= 3
      && ageMs <= 72 * 3600 * 1000
    ) {
      tracked.status = 'FAST_EXIT_PROXY';
      recordOutcome(state, {
        fingerprint: tracked.fingerprint,
        type: 'FAST_EXIT_PROXY',
        atMs: nowMs,
        score: tracked.latestScore,
        discountPct: tracked.latestDiscountPct,
        district: tracked.district,
        seenRuns: tracked.seenRuns,
      });
    }

    if (
      tracked.status === 'ACTIVE'
      && ageMs >= 7 * 24 * 3600 * 1000
      && tracked.seenRuns >= 24
    ) {
      tracked.status = 'STALE_PROXY';
      recordOutcome(state, {
        fingerprint: tracked.fingerprint,
        type: 'STALE_PROXY',
        atMs: nowMs,
        score: tracked.latestScore,
        discountPct: tracked.latestDiscountPct,
        district: tracked.district,
        seenRuns: tracked.seenRuns,
      });
    }
  }

  pruneOldSamples(state.saleSamplesByDistrict, nowMs);
  pruneOldSamples(state.rentSamplesByDistrict, nowMs);
  state.stats.cycles = Number(state.stats.cycles || 0) + 1;
  refreshThresholds(state);
  return state;
}

export function attachOpportunityFeedback(state, opportunities = []) {
  for (const item of opportunities) {
    const tracked = state.listings?.[item.fingerprint];
    if (!tracked) continue;
    tracked.latestScore = item.score;
    tracked.latestDiscountPct = item.discountPct;
    tracked.latestStatus = item.status;
  }
  refreshThresholds(state);
  return state;
}

export function recordOpportunityEvents(state, opportunities = [], now = new Date()) {
  const nowMs = now.getTime();
  const active = new Set();

  for (const item of opportunities.filter((x) => ['MUST_NOT_MISS', 'STRONG_INSPECT'].includes(x.status))) {
    active.add(item.fingerprint);
    let event = state.opportunityEvents.find((x) => x.fingerprint === item.fingerprint);
    if (!event) {
      event = {
        fingerprint: item.fingerprint,
        firstSeenMs: nowMs,
        lastSeenMs: nowMs,
        status: item.status,
        bestStatus: item.status,
        maxScore: item.score,
        currentScore: item.score,
        currentPriceSar: item.priceSar,
        lowestPriceSar: item.priceSar,
        district: item.district,
        title: item.title,
        active: true,
      };
      state.opportunityEvents.push(event);
    } else {
      event.lastSeenMs = nowMs;
      event.status = item.status;
      if (item.status === 'MUST_NOT_MISS') event.bestStatus = 'MUST_NOT_MISS';
      event.maxScore = Math.max(Number(event.maxScore || 0), item.score);
      event.currentScore = item.score;
      event.currentPriceSar = item.priceSar;
      event.lowestPriceSar = Math.min(Number(event.lowestPriceSar || item.priceSar), item.priceSar);
      event.active = true;
    }
  }

  for (const event of state.opportunityEvents) {
    if (!active.has(event.fingerprint) && event.active) {
      event.active = false;
      event.disappearedMs = nowMs;
    }
  }

  state.opportunityEvents = state.opportunityEvents
    .filter((x) => nowMs - Number(x.lastSeenMs || x.firstSeenMs || 0) <= 7 * 24 * 3600 * 1000)
    .slice(-300);

  return state;
}

function districtSamples(bucket, district, excludeFingerprint) {
  return (bucket?.[district] || [])
    .filter((x) => x.fingerprint !== excludeFingerprint)
    .map((x) => x.pricePerSqmSar)
    .filter(Number.isFinite);
}

export function learnedBaselines(state, listing) {
  const fingerprint = listingFingerprint(listing);
  const sale = districtSamples(state.saleSamplesByDistrict, listing.district, fingerprint);
  const rent = districtSamples(state.rentSamplesByDistrict, listing.district, fingerprint);

  const allSale = Object.values(state.saleSamplesByDistrict || {})
    .flat()
    .filter((x) => x.fingerprint !== fingerprint)
    .map((x) => x.pricePerSqmSar)
    .filter(Number.isFinite);
  const allRent = Object.values(state.rentSamplesByDistrict || {})
    .flat()
    .filter((x) => x.fingerprint !== fingerprint)
    .map((x) => x.pricePerSqmSar)
    .filter(Number.isFinite);

  return {
    fingerprint,
    districtSaleMedian: sale.length >= 3 ? median(sale) : null,
    districtSaleCompCount: sale.length,
    districtRentMedian: rent.length >= 3 ? median(rent) : null,
    districtRentCompCount: rent.length,
    citySaleMedian: allSale.length >= 8 ? median(allSale) : null,
    citySaleCompCount: allSale.length,
    cityRentMedian: allRent.length >= 8 ? median(allRent) : null,
    cityRentCompCount: allRent.length,
    learnedThresholds: state.thresholds,
  };
}
