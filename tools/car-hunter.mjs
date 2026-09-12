import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { collectPublicHaraj } from '../src/car-hunter/collector.js';
import { assessDeal, normalizeListing, rankDeals } from '../src/car-hunter/index.js';

async function readJson(file) {
  const resolved = path.resolve(process.cwd(), file);
  return JSON.parse(await fs.readFile(resolved, 'utf8'));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'collect') {
    const maxAdsArg = args.find((x) => /^--max-ads=/.test(x));
    const maxAds = maxAdsArg ? Number(maxAdsArg.split('=')[1]) : 20;
    const result = await collectPublicHaraj({ maxAds });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'score') {
    if (args.length < 2) throw new Error('usage: car-hunter score <listing.json> <comps.json>');
    const listing = normalizeListing(await readJson(args[0]));
    const comps = (await readJson(args[1])).map((item) => normalizeListing(item));
    console.log(JSON.stringify(assessDeal(listing, comps), null, 2));
    return;
  }

  if (command === 'rank') {
    if (args.length < 2) throw new Error('usage: car-hunter rank <listings.json> <comps-by-key.json>');
    const listings = await readJson(args[0]);
    const compsByKey = await readJson(args[1]);
    console.log(JSON.stringify(rankDeals(listings, compsByKey), null, 2));
    return;
  }

  throw new Error('usage: car-hunter <collect|score|rank> ...');
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  process.exit(1);
});
