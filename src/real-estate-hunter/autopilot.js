import fs from 'node:fs/promises';
import path from 'node:path';

import { captureRealEstateSource } from './browser.js';
import { summarizeSourceCapture } from './parser.js';
import { REAL_ESTATE_SOURCES } from './sources.js';

function median(values = []) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : Math.round((clean[mid - 1] + clean[mid]) / 2);
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function appendHistory(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(value) + '\n', { mode: 0o600 });
}

function marketStats(sourceResults) {
  const aqar = sourceResults.filter((x) => x.platform === 'aqar');
  const sale = aqar.flatMap((x) => x.parsed?.listings || []).filter((x) => x.listingType === 'sale');
  const rent = aqar.flatMap((x) => x.parsed?.listings || []).filter((x) => x.listingType === 'rent');

  const reasonableSalePsm = sale
    .filter((x) => x.areaSqm >= 100 && x.areaSqm <= 5000)
    .map((x) => x.pricePerSqmSar);
  const reasonableRentPsm = rent
    .filter((x) => x.areaSqm >= 40 && x.areaSqm <= 1000)
    .map((x) => x.pricePerSqmSar);

  const regaJeddah = sourceResults.find((x) => x.sourceId === 'rega-indicators-jeddah');

  return {
    aqar: {
      saleListingsParsed: sale.length,
      rentListingsParsed: rent.length,
      medianAskingSalePricePerSqmSar: median(reasonableSalePsm),
      medianAnnualRentPerSqmSar: median(reasonableRentPsm),
    },
    officialJeddah: regaJeddah?.parsed || null,
  };
}

function slimSource(source) {
  return {
    sourceId: source.sourceId,
    platform: source.platform,
    kind: source.kind,
    city: source.city,
    state: source.state,
    usable: source.usable,
    reason: source.reason,
    url: source.url,
    finalUrl: source.finalUrl,
    pageTextLength: source.pageTextLength,
    screenshotFile: source.screenshotFile,
    capturedAt: source.capturedAt,
    parsed: source.parsed,
    error: source.error || null,
  };
}

export async function runRealEstateHunterCycle(options = {}) {
  const stateDir = options.stateDir
    || process.env.OSA_REAL_ESTATE_STATE_DIR
    || '/var/lib/osa-real-estate-hunter';
  const latestFile = options.latestFile
    || process.env.OSA_REAL_ESTATE_LATEST
    || path.join(stateDir, 'latest.json');
  const historyFile = options.historyFile
    || process.env.OSA_REAL_ESTATE_HISTORY
    || path.join(stateDir, 'history.jsonl');
  const sources = options.sources || REAL_ESTATE_SOURCES;
  const capture = options.captureImpl || captureRealEstateSource;
  const results = [];

  for (const source of sources) {
    const raw = await capture(source, {
      stateDir,
      evidenceDir: path.join(stateDir, 'evidence'),
      binary: options.browserBinary || process.env.OSA_REAL_ESTATE_BROWSER_BINARY,
      waitMs: options.waitMs || Number(process.env.OSA_REAL_ESTATE_WAIT_MS || 1800),
    });
    results.push(summarizeSourceCapture(raw));
  }

  const summary = {
    sources: results.length,
    live: results.filter((x) => x.state === 'LIVE').length,
    authRequired: results.filter((x) => x.state === 'AUTH_REQUIRED').length,
    blocked: results.filter((x) => x.state === 'BLOCKED').length,
    errors: results.filter((x) => x.state === 'ERROR').length,
    aqarListingsParsed: results
      .filter((x) => x.platform === 'aqar')
      .reduce((sum, x) => sum + Number(x.parsed?.listingCount || 0), 0),
  };

  const latest = {
    generatedAt: new Date().toISOString(),
    scope: {
      primaryCity: 'Jeddah',
      modes: ['investment', 'sale', 'rent', 'official-market-data'],
    },
    summary,
    market: marketStats(results),
    sources: results.map(slimSource),
    policy: {
      publicPagesOnly: true,
      nafathAutomation: false,
      securityGateBypass: false,
    },
  };

  await atomicWriteJson(latestFile, latest);
  await appendHistory(historyFile, {
    generatedAt: latest.generatedAt,
    summary: latest.summary,
    market: latest.market,
    sourceStates: latest.sources.map((x) => ({ sourceId: x.sourceId, state: x.state })),
  });

  return latest;
}
