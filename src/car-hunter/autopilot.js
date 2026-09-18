import fs from 'node:fs/promises';
import path from 'node:path';

import { collectPublicHaraj } from './collector.js';
import { verifyRankedHarajCandidates } from './browser-verifier.js';
import { analyzePriceHistory, assessDeal, listingFingerprint } from './index.js';

const DAY = 24 * 60 * 60 * 1000;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

function marketKey(listing) {
  return `${listing.make || ''}:${listing.model || ''}:${listing.year || ''}`;
}

function compactListing(listing) {
  return {
    source: listing.source,
    externalId: listing.externalId || null,
    url: listing.url || null,
    sellerId: listing.sellerId || null,
    sellerUsername: listing.sellerUsername || null,
    title: listing.title || '',
    description: listing.description || '',
    make: listing.make || '',
    model: listing.model || '',
    year: listing.year || null,
    mileageKm: listing.mileageKm || null,
    priceSar: listing.priceSar || null,
    engineCode: listing.engineCode || null,
    city: listing.city || null,
    images: (listing.images || []).slice(0, 8),
    listingKind: listing.listingKind,
    riskFlags: listing.riskFlags || [],
    priceStructureRisk: listing.priceStructureRisk,
    nonCashPriceRisk: Boolean(listing.nonCashPriceRisk),
    trimClaimUnverified: Boolean(listing.trimClaimUnverified),
    sellerRisk: listing.sellerRisk || { score: 0, reasons: [] },
  };
}

export function buildHistoricalComps(state, nowMs = Date.now(), maxAgeDays = 45) {
  const cutoff = nowMs - maxAgeDays * DAY;
  const map = new Map();
  for (const entry of Object.values(state.entries || {})) {
    if (!entry?.listing || new Date(entry.lastSeenAt || 0).getTime() < cutoff) continue;
    const listing = entry.listing;
    if (listing.listingKind !== 'vehicle' || listing.nonCashPriceRisk) continue;
    if (!listing.make || !listing.model || !listing.year || !listing.priceSar) continue;
    const key = marketKey(listing);
    const bucket = map.get(key) || [];
    bucket.push(listing);
    map.set(key, bucket);
  }
  return map;
}

export function updateState(state, listings, nowIso = new Date().toISOString()) {
  const next = state && typeof state === 'object' ? structuredClone(state) : {};
  next.version = 1;
  next.entries ||= {};
  next.updatedAt = nowIso;

  for (const listing of listings) {
    const fingerprint = listingFingerprint(listing);
    const current = next.entries[fingerprint] || {
      fingerprint,
      firstSeenAt: nowIso,
      prices: [],
    };
    current.lastSeenAt = nowIso;
    current.listing = compactListing(listing);
    if (Number.isFinite(listing.priceSar) && listing.priceSar > 0) {
      const last = current.prices.at(-1);
      if (!last || last.priceSar !== listing.priceSar) {
        current.prices.push({ priceSar: listing.priceSar, at: nowIso });
        current.prices = current.prices.slice(-40);
      }
    }
    current.priceHistory = analyzePriceHistory(current.prices);
    next.entries[fingerprint] = current;
  }
  return next;
}

function pruneState(state, nowMs = Date.now(), options = {}) {
  const maxEntries = options.maxEntries ?? 5000;
  const maxAgeDays = options.maxAgeDays ?? 120;
  const cutoff = nowMs - maxAgeDays * DAY;
  const entries = Object.values(state.entries || {})
    .filter((entry) => new Date(entry.lastSeenAt || 0).getTime() >= cutoff)
    .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))
    .slice(0, maxEntries);
  state.entries = Object.fromEntries(entries.map((entry) => [entry.fingerprint, entry]));
  return state;
}

export async function runCarHunterCycle(options = {}) {
  const stateFile = options.stateFile || process.env.OSA_CAR_HUNTER_STATE || '/var/lib/osa-car-hunter/state.json';
  const latestFile = options.latestFile || process.env.OSA_CAR_HUNTER_LATEST || '/var/lib/osa-car-hunter/latest.json';
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const state = await readJson(stateFile, { version: 1, entries: {} });
  const collect = options.collectImpl || collectPublicHaraj;
  const collection = await collect({
    maxAds: options.maxAds ?? Number(process.env.OSA_CAR_HUNTER_MAX_ADS || 16),
    minDelayMs: options.minDelayMs ?? Number(process.env.OSA_CAR_HUNTER_DELAY_MS || 2000),
    fetchImpl: options.fetchImpl,
  });

  const vehicles = collection.listings.filter((x) => x.listingKind === 'vehicle');
  const updated = updateState(state, vehicles, nowIso);
  const comps = buildHistoricalComps(updated, now.getTime(), options.compMaxAgeDays ?? 45);
  const assessments = [];

  for (const listing of vehicles) {
    const key = marketKey(listing);
    const fingerprint = listingFingerprint(listing);
    const comparable = (comps.get(key) || []).filter((x) => listingFingerprint(x) !== fingerprint);
    const assessment = assessDeal(listing, comparable, options.scoring || {});
    const history = updated.entries[fingerprint]?.priceHistory || null;
    assessments.push({ ...assessment, fingerprint, priceHistory: history });
  }

  const statusPriority = { BUY_CANDIDATE: 6, INSPECT: 5, WATCH: 4, NEEDS_MORE_COMPS: 3, PASS: 2, HIGH_RISK: 1 };
  assessments.sort((a, b) =>
    (statusPriority[b.status] ?? 0) - (statusPriority[a.status] ?? 0)
      || b.scores.deal - a.scores.deal
      || (b.netUpsideSar || 0) - (a.netUpsideSar || 0));

  const visualVerify = options.visualVerify
    ?? String(process.env.OSA_CAR_HUNTER_VISUAL_VERIFY || '0') === '1';
  const visualVerifier = options.visualVerifier || verifyRankedHarajCandidates;
  let browserVerification = {
    enabled: visualVerify,
    attempted: 0,
    verified: [],
    attempts: [],
    unavailable: 0,
    sold: 0,
    blocked: 0,
    errors: 0,
  };

  if (visualVerify) {
    browserVerification = {
      enabled: true,
      ...(await visualVerifier(assessments, {
        maxCandidates: options.visualMaxCandidates
          ?? Number(process.env.OSA_CAR_HUNTER_VISUAL_MAX_CANDIDATES || 3),
        maxVerified: options.visualMaxVerified
          ?? Number(process.env.OSA_CAR_HUNTER_VISUAL_MAX_VERIFIED || 1),
        waitMs: options.visualWaitMs
          ?? Number(process.env.OSA_CAR_HUNTER_VISUAL_WAIT_MS || 1600),
        evidenceDir: options.evidenceDir
          || process.env.OSA_CAR_HUNTER_EVIDENCE_DIR
          || '/var/lib/osa-car-hunter/evidence',
        binary: options.browserBinary
          || process.env.OSA_CAR_HUNTER_BROWSER_BINARY
          || '/usr/local/bin/agent-browser',
        profile: options.browserProfile
          || process.env.OSA_CAR_HUNTER_BROWSER_PROFILE
          || '/var/lib/osa-car-hunter/browser-profile',
        browserRunner: options.browserRunner,
      })),
    };
  }

  pruneState(updated, now.getTime(), options.state || {});
  const eligibleAlerts = assessments
    .filter((x) => ['BUY_CANDIDATE', 'INSPECT'].includes(x.status))
    .slice(0, 12);
  const alerts = visualVerify ? browserVerification.verified : eligibleAlerts;
  const latest = {
    generatedAt: nowIso,
    source: collection.source,
    summary: {
      candidates: collection.candidateCount,
      listings: collection.listingCount,
      vehicles: vehicles.length,
      rejectedNoise: collection.listingCount - vehicles.length,
      errors: collection.errors.length,
      buyCandidates: assessments.filter((x) => x.status === 'BUY_CANDIDATE').length,
      inspectCandidates: assessments.filter((x) => x.status === 'INSPECT').length,
      browserEligible: eligibleAlerts.length,
      browserAttempted: browserVerification.attempted,
      browserVerified: browserVerification.verified.length,
      browserRejected: Math.max(0, browserVerification.attempted - browserVerification.verified.length),
    },
    alerts,
    browserVerification: {
      enabled: browserVerification.enabled,
      attempted: browserVerification.attempted,
      unavailable: browserVerification.unavailable,
      sold: browserVerification.sold,
      blocked: browserVerification.blocked,
      errors: browserVerification.errors,
      attempts: browserVerification.attempts.slice(0, 6),
    },
    top: assessments.slice(0, 30),
    collectionErrors: collection.errors.slice(0, 20),
  };

  await atomicWriteJson(stateFile, updated);
  await atomicWriteJson(latestFile, latest);
  return latest;
}
