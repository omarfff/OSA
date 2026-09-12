import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildHistoricalComps, runCarHunterCycle, updateState } from '../src/car-hunter/autopilot.js';
import { normalizeListing } from '../src/car-hunter/index.js';

function car(price, mileage = 100000, externalId = String(price)) {
  return normalizeListing({
    source: 'manual',
    externalId,
    sellerId: `seller-${externalId}`,
    make: 'BMW',
    model: '530i',
    year: 2019,
    mileage,
    price,
    engineCode: 'B48',
    title: 'BMW 530i 2019',
    description: 'بدي وكالة وصيانة موثقة',
    images: [`https://cdn.example/${externalId}.jpg`],
  });
}

test('state keeps price history and historical comps', () => {
  const first = updateState({ version: 1, entries: {} }, [car(80000, 100000, 'a')], '2026-09-01T00:00:00Z');
  const second = updateState(first, [car(75000, 100000, 'a')], '2026-09-05T00:00:00Z');
  const entry = Object.values(second.entries)[0];
  assert.equal(entry.prices.length, 2);
  assert.equal(entry.priceHistory.totalDropSar, 5000);
  const comps = buildHistoricalComps(second, new Date('2026-09-06T00:00:00Z').getTime());
  assert.equal(comps.get('BMW:530I:2019').length, 1);
});

test('autopilot writes state/latest atomically and scores current listings from history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osa-car-hunter-'));
  const stateFile = path.join(dir, 'state.json');
  const latestFile = path.join(dir, 'latest.json');

  let state = { version: 1, entries: {} };
  state = updateState(state, [
    car(80000, 100000, 'c1'),
    car(79000, 110000, 'c2'),
    car(82000, 90000, 'c3'),
    car(81000, 105000, 'c4'),
  ], '2026-09-01T00:00:00Z');
  await fs.writeFile(stateFile, JSON.stringify(state));

  const target = car(45000, 100000, 'target');
  target.vin = 'WBA00000000000000';
  target.images = Array.from({ length: 6 }, (_, i) => `https://cdn.example/target-${i}.jpg`);

  const latest = await runCarHunterCycle({
    stateFile,
    latestFile,
    now: new Date('2026-09-02T00:00:00Z'),
    minDelayMs: 0,
    collectImpl: async () => ({
      source: 'test',
      candidateCount: 1,
      listingCount: 1,
      listings: [target],
      errors: [],
    }),
  });

  assert.equal(latest.summary.listings, 1);
  assert.equal(latest.top.length, 1);
  assert.ok(['BUY_CANDIDATE', 'INSPECT'].includes(latest.top[0].status));
  const written = JSON.parse(await fs.readFile(latestFile, 'utf8'));
  assert.equal(written.generatedAt, '2026-09-02T00:00:00.000Z');
  await fs.rm(dir, { recursive: true, force: true });
});
