import crypto from 'node:crypto';
import { engineProfile, modelLiquidity } from './risk-library.js';

const PAYMENT_RISK_PATTERNS = [
  /دفعة(?:\s+أولى)?/i,
  /تنازل/i,
  /قسط|أقساط|اقساط/i,
  /باقي(?:\s+الأقساط|\s+الاقساط)?/i,
  /تمويل/i,
  /down\s*payment/i,
];

const HIGH_RISK_PATTERNS = [
  { key: 'chassis', re: /شاص|شاصي|شاسيه|قص\s+ولحام|قص\s+لحام/i, penalty: 35, reserve: 12000 },
  { key: 'overheat', re: /حرارة|سخون|overheat/i, penalty: 30, reserve: 10000 },
  { key: 'engine_rebuilt', re: /توضيب|مكينة\s+مجددة|مكينه\s+مجدده|engine\s+rebuilt/i, penalty: 28, reserve: 9000 },
  { key: 'engine_changed', re: /مكينة\s+مغيرة|مكينه\s+مغيره|engine\s+replaced/i, penalty: 20, reserve: 7000 },
  { key: 'gearbox_changed', re: /قير\s+مغير|جير\s+مغير|gearbox\s+replaced/i, penalty: 18, reserve: 6000 },
  { key: 'airbag', re: /ايرباق|إيرباق|airbag/i, penalty: 25, reserve: 7000 },
  { key: 'full_repaint', re: /رش\s+كامل|مرشوش(?:ة)?\s+كامل/i, penalty: 12, reserve: 2500 },
  { key: 'side_repaint', re: /رش\s+(?:على\s+)?الجانب|رش\s+جنب|مرشوش\s+جنب/i, penalty: 5, reserve: 1000 },
  { key: 'american_import', re: /وارد\s+امريكي|وارد\s+أمريكي|امريكي|أمريكي/i, penalty: 8, reserve: 1500 },
];

const UNVERIFIED_TRIM_PATTERNS = [
  /كت\s*AMG/i,
  /AMG\s*kit/i,
  /M\s*Sport\s*kit/i,
  /كت\s*M/i,
];

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : null;
}

function normalizeMake(make = '') {
  const v = String(make).trim().toUpperCase();
  if (/MERCEDES|مرسيدس/.test(v)) return 'Mercedes-Benz';
  if (/BMW|بي\s*ام|بي\s*إم/.test(v)) return 'BMW';
  return String(make).trim();
}

function normalizeModel(model = '') {
  return String(model)
    .trim()
    .toUpperCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^MERCEDES\s+/, '')
    .replace(/^BMW\s+/, '');
}

function conventionsFor(source) {
  const s = String(source || '').toLowerCase();
  if (s === 'haraj' || s === 'haraj-shared-post') {
    return { priceThousandsWhenSmall: true, mileageThousandsWhenSmall: true };
  }
  return { priceThousandsWhenSmall: false, mileageThousandsWhenSmall: false };
}

function normalizePrice(value, source) {
  const n = numeric(value);
  if (n == null) return null;
  const c = conventionsFor(source);
  if (c.priceThousandsWhenSmall && n > 0 && n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

function normalizeMileage(value, source) {
  const n = numeric(value);
  if (n == null) return null;
  const c = conventionsFor(source);
  if (c.mileageThousandsWhenSmall && n > 0 && n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

function riskFlagsFromText(text = '') {
  const flags = [];
  for (const item of HIGH_RISK_PATTERNS) {
    if (item.re.test(text)) flags.push(item);
  }
  return flags;
}

function paymentRisk(text = '') {
  return PAYMENT_RISK_PATTERNS.some((re) => re.test(text));
}

function hasUnverifiedTrimClaim(text = '') {
  return UNVERIFIED_TRIM_PATTERNS.some((re) => re.test(text));
}

export function fromHarajSharedPost(item) {
  if (!item) throw new Error('haraj item is required');
  return {
    source: 'haraj',
    externalId: item.id != null ? String(item.id) : null,
    url: item.URL ? `https://haraj.com.sa/${String(item.URL).replace(/^\//, '')}` : null,
    sellerId: item.authorId != null ? String(item.authorId) : null,
    sellerUsername: item.authorUsername || item.handler || null,
    title: item.title || '',
    description: item.bodyTEXT || '',
    city: item.city || item.geoCity || null,
    year: numeric(item.carInfo?.model),
    mileage: item.carInfo?.mileage,
    price: item.price?.inputPrice ?? item.price?.formattedPrice,
    fuel: item.carInfo?.fuel || null,
    transmission: item.carInfo?.gear || null,
    images: Array.isArray(item.imagesList) ? item.imagesList : [],
    raw: item,
  };
}

export function normalizeListing(input, options = {}) {
  const source = input.source || options.source || 'unknown';
  const text = `${input.title || ''}\n${input.description || ''}`;
  const make = normalizeMake(input.make || options.make || inferMake(text));
  const model = normalizeModel(input.model || options.model || inferModel(text));
  const priceSar = normalizePrice(input.price, source);
  const mileageKm = normalizeMileage(input.mileage, source);
  const year = numeric(input.year);
  const flags = riskFlagsFromText(text);
  const nonCashPriceRisk = paymentRisk(text) || input.priceType === 'down-payment';
  const trimClaimUnverified = hasUnverifiedTrimClaim(text) && !input.vinVerifiedTrim;

  return {
    ...input,
    source,
    make,
    model,
    year: year == null ? null : Math.round(year),
    priceSar,
    mileageKm,
    engineCode: input.engineCode ? String(input.engineCode).toUpperCase() : null,
    description: input.description || '',
    title: input.title || '',
    riskFlags: flags.map(({ key, penalty, reserve }) => ({ key, penalty, reserve })),
    nonCashPriceRisk,
    trimClaimUnverified,
    images: Array.isArray(input.images) ? input.images : [],
  };
}

function inferMake(text) {
  if (/مرسيدس|mercedes/i.test(text)) return 'Mercedes-Benz';
  if (/\bbmw\b|بي\s*ام|بي\s*إم/i.test(text)) return 'BMW';
  return '';
}

function inferModel(text) {
  const patterns = [
    /\b(C\s?200|C\s?300|E\s?200|E\s?300|GLC\s?\d*|GLE\s?\d*)\b/i,
    /\b(320I|330I|420I|430I|520I|530I|540I|X3|X5)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/\s+/g, '');
  }
  return '';
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function mad(values, med = median(values)) {
  if (med == null) return null;
  return median(values.map((v) => Math.abs(v - med)));
}

function compatibleComp(target, comp, options = {}) {
  if (!comp || comp.nonCashPriceRisk || !Number.isFinite(comp.priceSar)) return false;
  if (target.make && comp.make && target.make !== comp.make) return false;
  if (target.model && comp.model && target.model !== comp.model) return false;
  const yearWindow = options.yearWindow ?? 1;
  if (target.year && comp.year && Math.abs(target.year - comp.year) > yearWindow) return false;
  if (target.mileageKm && comp.mileageKm) {
    const kmWindow = Math.max(options.minMileageWindowKm ?? 70000, target.mileageKm * (options.mileageWindowRatio ?? 0.45));
    if (Math.abs(target.mileageKm - comp.mileageKm) > kmWindow) return false;
  }
  return !comp.riskFlags?.some((f) => ['chassis', 'overheat', 'engine_rebuilt'].includes(f.key));
}

function adjustCompPriceToTarget(target, comp, options = {}) {
  let value = comp.priceSar;
  if (target.mileageKm && comp.mileageKm) {
    const mileageSarPerKm = options.mileageSarPerKm ?? 0.075;
    value += (comp.mileageKm - target.mileageKm) * mileageSarPerKm;
  }
  if (target.year && comp.year) {
    const yearAdjustmentSar = options.yearAdjustmentSar ?? 3500;
    value += (target.year - comp.year) * yearAdjustmentSar;
  }
  return Math.max(0, value);
}

export function estimateMarketValue(targetInput, compInputs, options = {}) {
  const target = targetInput.priceSar !== undefined ? targetInput : normalizeListing(targetInput);
  const comps = compInputs.map((c) => (c.priceSar !== undefined ? c : normalizeListing(c)));
  const compatible = comps.filter((c) => compatibleComp(target, c, options));
  const adjusted = compatible.map((c) => adjustCompPriceToTarget(target, c, options));

  if (adjusted.length < (options.minComps ?? 3)) {
    return {
      compCount: adjusted.length,
      medianAskSar: median(adjusted),
      conservativeValueSar: null,
      quickSaleValueSar: null,
      dispersionSar: adjusted.length ? mad(adjusted) : null,
      confidence: Math.min(45, 10 + adjusted.length * 10),
      reason: 'INSUFFICIENT_COMPS',
    };
  }

  const med = median(adjusted);
  const dispersion = mad(adjusted, med) || 0;
  const robust = dispersion > 0 ? adjusted.filter((v) => Math.abs(v - med) <= dispersion * 3.5) : adjusted;
  const robustMedian = median(robust) ?? med;
  const conservativeFactor = options.conservativeFactor ?? 0.97;
  const quickSaleFactor = options.quickSaleFactor ?? 0.92;
  const conservativeValueSar = Math.round(robustMedian * conservativeFactor);
  const quickSaleValueSar = Math.round(robustMedian * quickSaleFactor);
  const countScore = Math.min(40, robust.length * 5);
  const dispersionRatio = robustMedian > 0 ? dispersion / robustMedian : 1;
  const stabilityScore = Math.max(0, 30 - dispersionRatio * 100);
  const confidence = Math.round(Math.min(95, 25 + countScore + stabilityScore));

  return {
    compCount: robust.length,
    medianAskSar: Math.round(robustMedian),
    conservativeValueSar,
    quickSaleValueSar,
    dispersionSar: Math.round(dispersion),
    confidence,
    reason: 'OK',
  };
}

export function estimateMaintenanceReserve(listingInput, options = {}) {
  const listing = listingInput.priceSar !== undefined ? listingInput : normalizeListing(listingInput);
  const profile = engineProfile(listing.engineCode);
  let reserve = profile.reserveSar;
  let risk = profile.baseRisk;
  const km = listing.mileageKm || 0;

  if (km >= 300000) { reserve += 8000; risk += 24; }
  else if (km >= 220000) { reserve += 5000; risk += 16; }
  else if (km >= 160000) { reserve += 3000; risk += 10; }
  else if (km >= 100000) { reserve += 1500; risk += 5; }

  for (const flag of listing.riskFlags || []) {
    reserve += flag.reserve || 0;
    risk += flag.penalty || 0;
  }
  if (listing.trimClaimUnverified) risk += 3;
  if (!listing.engineCode) risk += 5;
  if (!listing.vin) risk += 4;

  reserve += options.transactionBufferSar ?? 1500;
  return {
    reserveSar: Math.round(reserve),
    mechanicalRisk: Math.max(0, Math.min(100, Math.round(risk))),
    engineProfile: profile,
  };
}

export function listingFingerprint(listingInput) {
  const listing = listingInput.priceSar !== undefined ? listingInput : normalizeListing(listingInput);
  const imageIds = (listing.images || [])
    .slice(0, 3)
    .map((url) => String(url).split('/').pop()?.split('?')[0] || '')
    .filter(Boolean)
    .sort();
  const identity = [
    listing.source,
    listing.sellerId || listing.sellerUsername || '',
    listing.make,
    listing.model,
    listing.year || '',
    listing.mileageKm || '',
    imageIds.join('|'),
  ].join('::').toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex');
}

export function analyzePriceHistory(snapshots = []) {
  const clean = snapshots
    .map((s) => ({ priceSar: numeric(s.priceSar ?? s.price), at: new Date(s.at || s.date || 0).getTime() }))
    .filter((s) => Number.isFinite(s.priceSar) && Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);
  if (clean.length < 2) return { drops: 0, totalDropSar: 0, totalDropPct: 0, urgencyScore: 0 };
  let drops = 0;
  for (let i = 1; i < clean.length; i += 1) if (clean[i].priceSar < clean[i - 1].priceSar) drops += 1;
  const first = clean[0].priceSar;
  const last = clean.at(-1).priceSar;
  const totalDropSar = Math.max(0, first - last);
  const totalDropPct = first > 0 ? totalDropSar / first : 0;
  const urgencyScore = Math.min(100, Math.round(drops * 15 + totalDropPct * 200));
  return { drops, totalDropSar: Math.round(totalDropSar), totalDropPct, urgencyScore };
}

export function assessDeal(listingInput, compInputs = [], options = {}) {
  const listing = listingInput.priceSar !== undefined ? listingInput : normalizeListing(listingInput, options);
  const market = estimateMarketValue(listing, compInputs, options.market || {});
  const maintenance = estimateMaintenanceReserve(listing, options.maintenance || {});
  const liquidity = modelLiquidity(listing.make, listing.model);

  if (listing.nonCashPriceRisk) {
    return decision(listing, market, maintenance, liquidity, 0, 0, 'REJECT_PRICE_UNRELIABLE');
  }
  if (!Number.isFinite(listing.priceSar) || listing.priceSar <= 0) {
    return decision(listing, market, maintenance, liquidity, 0, 0, 'REJECT_MISSING_PRICE');
  }
  if (!market.quickSaleValueSar) {
    return decision(listing, market, maintenance, liquidity, 0, 0, 'NEEDS_MORE_COMPS');
  }

  const acquisitionCostsSar = options.acquisitionCostsSar ?? 1200;
  const uncertaintyBufferSar = Math.max(
    options.minUncertaintyBufferSar ?? 1500,
    Math.round((market.dispersionSar || 0) * (options.dispersionBufferFactor ?? 0.5)),
  );
  const allInCostSar = listing.priceSar + maintenance.reserveSar + acquisitionCostsSar + uncertaintyBufferSar;
  const netUpsideSar = market.quickSaleValueSar - allInCostSar;
  const netUpsidePct = market.quickSaleValueSar > 0 ? netUpsideSar / market.quickSaleValueSar : 0;

  const marginScore = Math.max(0, Math.min(100, Math.round((netUpsidePct + 0.02) * 500)));
  const riskDrag = Math.round(maintenance.mechanicalRisk * 0.22);
  const dealScore = Math.max(0, Math.min(100, Math.round(marginScore * 0.75 + liquidity * 0.25 - riskDrag)));
  let confidence = market.confidence;
  if (listing.vin) confidence += 8;
  if (listing.engineCode) confidence += 5;
  if (listing.images?.length >= 5) confidence += 3;
  if (listing.trimClaimUnverified) confidence -= 5;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  let status = 'PASS';
  if (maintenance.mechanicalRisk >= 75) status = 'HIGH_RISK';
  else if (netUpsideSar <= 0) status = 'PASS';
  else if (dealScore >= 85 && confidence >= 65 && maintenance.mechanicalRisk <= 55) status = 'BUY_CANDIDATE';
  else if (dealScore >= 68 && confidence >= 50) status = 'INSPECT';
  else if (netUpsideSar > 0) status = 'WATCH';

  return {
    ...decision(listing, market, maintenance, liquidity, dealScore, confidence, status),
    acquisitionCostsSar,
    uncertaintyBufferSar,
    allInCostSar,
    netUpsideSar: Math.round(netUpsideSar),
    netUpsidePct,
    maxBuySar: Math.max(0, Math.round(market.quickSaleValueSar - maintenance.reserveSar - acquisitionCostsSar - uncertaintyBufferSar - (options.targetProfitSar ?? 4000))),
  };
}

function decision(listing, market, maintenance, liquidity, dealScore, confidence, status) {
  return {
    status,
    listing,
    market,
    maintenance,
    scores: {
      deal: Math.round(dealScore),
      mechanicalRisk: maintenance.mechanicalRisk,
      liquidity: Math.round(liquidity),
      confidence: Math.round(confidence),
    },
  };
}

export function rankDeals(listings, compsByKey = new Map(), options = {}) {
  const assessed = listings.map((raw) => {
    const listing = raw.priceSar !== undefined ? raw : normalizeListing(raw, options);
    const key = `${listing.make}:${listing.model}:${listing.year || ''}`;
    const comps = compsByKey instanceof Map ? (compsByKey.get(key) || []) : (compsByKey[key] || []);
    return assessDeal(listing, comps, options);
  });
  return assessed.sort((a, b) => {
    const priority = { BUY_CANDIDATE: 5, INSPECT: 4, WATCH: 3, NEEDS_MORE_COMPS: 2, PASS: 1, HIGH_RISK: 0, REJECT_PRICE_UNRELIABLE: -1, REJECT_MISSING_PRICE: -2 };
    return (priority[b.status] ?? 0) - (priority[a.status] ?? 0) || b.scores.deal - a.scores.deal;
  });
}
