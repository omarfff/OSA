# OSA Car Hunter

OSA Car Hunter is a separate vehicle-opportunity module for BMW and Mercedes listings. It is intentionally isolated from psychiatry and revenue agents.

## Goal

Find *mispriced but inspectable* cars, not merely cheap ads. Every candidate is evaluated on:

- conservative quick-sale value,
- mechanical reserve,
- acquisition and uncertainty buffers,
- model liquidity,
- engine/mileage risk,
- suspicious payment language,
- repaint/chassis/overheat/rebuild language,
- relisting identity and price-drop history,
- confidence in the available data.

The core economic rule is:

`net upside = quick-sale value - purchase price - maintenance reserve - acquisition costs - uncertainty buffer`

## Decision statuses

- `BUY_CANDIDATE`: strong margin, adequate confidence, tolerable mechanical risk.
- `INSPECT`: attractive enough to justify workshop/VIN/history checks.
- `WATCH`: positive theoretical margin but insufficient strength/confidence.
- `NEEDS_MORE_COMPS`: not enough comparable listings.
- `PASS`: all-in economics do not work.
- `HIGH_RISK`: mechanical/body risk dominates the apparent discount.
- `REJECT_PRICE_UNRELIABLE`: price appears to be a down payment/installment/waiver figure.

## Public collection policy

The collector uses ordinary public web pages only. It does **not** depend on private/internal GraphQL keys, login bypasses, CAPTCHA bypasses, or high-rate crawling.

Default searches:

- `https://haraj.com.sa/search/BMW/`
- `https://haraj.com.sa/search/mercedes/`

Collection is deliberately sequential and rate-limited. A top candidate can then be visually checked using the existing `agent-browser` runtime under the `haraj` site entry.

## CLI

```bash
# Collect a small public batch
npm run car:hunt -- collect --max-ads=20

# Score one normalized/raw listing against comps
npm run car:hunt -- score listing.json comps.json

# Rank multiple listings
npm run car:hunt -- rank listings.json comps-by-key.json
```

## Haraj units

Haraj often exposes compact numbers such as price `55` for 55,000 SAR and mileage `205` for 205,000 km in listing metadata. The Haraj normalizer applies the thousand conversion only for Haraj source records and only when values are below 1,000.

## Storage

`ops/car-hunter/schema.sql` defines locked-down Supabase tables for listings, price snapshots, assessments and collection runs. RLS is enabled and `anon`/`authenticated` privileges are revoked; the intended writer is a server-side/service-role process.

## Inspection gate

A `BUY_CANDIDATE` is still not a purchase approval. Before buying, require VIN/spec verification, history report where available, cold-start inspection, diagnostic scan, gearbox/drivetrain checks, body/chassis inspection and a model-specific workshop check.

## Engine library

Initial profiles include BMW N20/N55/B48/B58 and Mercedes M274/M264/M276. Unknown engines are intentionally penalized until verified. The library is a decision-support reserve model, not a claim that every car with a given engine will need those repairs.
