import { learnedBaselines, listingFingerprint } from './learner.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDistrict(value = '') {
  return String(value).replace(/^جدة\s*-\s*/i, '').replace(/^حي\s+/i, '').trim();
}

function districtMatchesOfficial(listingDistrict, officialDistrict) {
  const a = normalizeDistrict(listingDistrict);
  const b = normalizeDistrict(officialDistrict);
  return a && b && (a.includes(b) || b.includes(a));
}

function confidenceFromBaseline(baseline, listing) {
  let confidence = 30;
  if (baseline.districtSaleCompCount >= 3) confidence += 30;
  else if (baseline.citySaleCompCount >= 8) confidence += 12;
  if (baseline.districtRentCompCount >= 3) confidence += 12;
  else if (baseline.cityRentCompCount >= 8) confidence += 5;
  if (listing.dataQuality !== 'LOW') confidence += 12;
  return clamp(confidence, 0, 100);
}

export function scorePropertyOpportunity(listing, context = {}) {
  const learningState = context.learningState;
  const baseline = learnedBaselines(learningState, listing);
  const referencePsm = baseline.districtSaleMedian || baseline.citySaleMedian;
  const referenceType = baseline.districtSaleMedian ? 'district_history' : 'city_history';
  const discountPct = Number.isFinite(referencePsm) && referencePsm > 0
    ? ((referencePsm - listing.pricePerSqmSar) / referencePsm) * 100
    : null;

  let score = 20;
  const reasons = [];
  const risks = [];

  if (Number.isFinite(discountPct)) {
    score += clamp(discountPct * 1.55, -25, 48);
    if (discountPct >= 15) reasons.push('asking_psm_below_learned_market');
    if (discountPct <= -20) risks.push('asking_psm_above_learned_market');
  } else {
    risks.push('insufficient_price_comps');
  }

  if (baseline.districtSaleCompCount >= 5) score += 12;
  else if (baseline.districtSaleCompCount >= 3) score += 8;
  else if (baseline.citySaleCompCount >= 12) score += 3;

  const official = context.officialJeddah || {};
  if (districtMatchesOfficial(listing.district, official.mostActiveDistrict)) {
    score += 7;
    reasons.push('officially_active_district');
  }

  const districtRentPsm = baseline.districtRentMedian;
  const cityRentPsm = baseline.cityRentMedian;
  if (Number.isFinite(districtRentPsm) && Number.isFinite(cityRentPsm) && cityRentPsm > 0) {
    const rentStrength = ((districtRentPsm - cityRentPsm) / cityRentPsm) * 100;
    if (rentStrength >= 10) {
      score += clamp(rentStrength / 5, 2, 8);
      reasons.push('strong_district_rent_signal');
    }
  }

  const tracked = learningState.listings?.[listingFingerprint(listing)];
  if (tracked && Number.isFinite(tracked.firstPriceSar) && tracked.firstPriceSar > listing.priceSar) {
    const dropPct = ((tracked.firstPriceSar - listing.priceSar) / tracked.firstPriceSar) * 100;
    score += clamp(dropPct * 0.8, 1, 8);
    reasons.push('price_cut_detected');
  }

  if (listing.dataQuality === 'LOW') {
    score -= 25;
    risks.push('low_data_quality');
  }

  if (listing.areaSqm < 80 || listing.areaSqm > 5000) {
    score -= 8;
    risks.push('unusual_area');
  }

  if (listing.priceSar < 350000) {
    score -= 10;
    risks.push('price_needs_manual_validation');
  }

  score = Math.round(clamp(score, 0, 100));
  const confidence = confidenceFromBaseline(baseline, listing);
  const thresholds = baseline.learnedThresholds || {
    mustNotMissScore: 86,
    strongInspectScore: 76,
    minDiscountPct: 18,
  };

  let status = 'PASS';
  if (
    score >= thresholds.mustNotMissScore
    && confidence >= 72
    && Number.isFinite(discountPct)
    && discountPct >= thresholds.minDiscountPct
    && baseline.districtSaleCompCount >= 3
    && listing.dataQuality !== 'LOW'
  ) {
    status = 'MUST_NOT_MISS';
  } else if (
    score >= thresholds.strongInspectScore
    && confidence >= 58
    && Number.isFinite(discountPct)
    && discountPct >= 10
  ) {
    status = 'STRONG_INSPECT';
  } else if (score >= 60 && Number.isFinite(discountPct) && discountPct >= 5) {
    status = 'WATCH';
  }

  return {
    fingerprint: baseline.fingerprint,
    status,
    score,
    confidence,
    title: listing.title,
    district: listing.district,
    propertyType: listing.propertyType,
    priceSar: listing.priceSar,
    areaSqm: listing.areaSqm,
    pricePerSqmSar: listing.pricePerSqmSar,
    referencePricePerSqmSar: Number.isFinite(referencePsm) ? Math.round(referencePsm) : null,
    referenceType,
    discountPct: Number.isFinite(discountPct) ? Math.round(discountPct * 10) / 10 : null,
    districtSaleCompCount: baseline.districtSaleCompCount,
    districtRentCompCount: baseline.districtRentCompCount,
    reasons,
    risks,
  };
}

export function rankPropertyOpportunities(listings = [], context = {}) {
  return listings
    .filter((x) => x.listingType === 'sale')
    .map((listing) => scorePropertyOpportunity(listing, context))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}
