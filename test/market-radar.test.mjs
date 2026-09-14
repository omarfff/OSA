import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, scoreItem, aggregateSectors } from '../tools/market-radar.mjs';

test('parseRss extracts source, date and sector', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Data center capacity shortage lifts demand]]></title><link>https://example.com/a</link><pubDate>Mon, 14 Sep 2026 06:00:00 GMT</pubDate><source>Example News</source><description>Backlog and constrained power capacity.</description></item></channel></rss>`;
  const items = parseRss(xml, { sector: 'ai-data-centers-power', query: 'test' });
  assert.equal(items.length, 1);
  assert.equal(items[0].sector, 'ai-data-centers-power');
  assert.equal(items[0].source, 'Example News');
  assert.equal(items[0].published_at, '2026-09-14T06:00:00.000Z');
});

test('scoreItem rewards demand plus shortage and penalizes oversupply', () => {
  const now = Date.parse('2026-09-14T09:00:00Z');
  const tight = scoreItem({
    title: 'Severe shortage creates backlog as demand expands',
    description: 'Limited capacity and higher prices continue',
    published_at: '2026-09-14T06:00:00.000Z',
  }, now);
  const loose = scoreItem({
    title: 'Oversupply grows as demand weakens',
    description: 'Surplus capacity pushes prices down',
    published_at: '2026-09-14T06:00:00.000Z',
  }, now);
  assert.ok(tight > loose);
  assert.ok(tight >= 8);
});

test('aggregateSectors ranks stronger multi-source signal first', () => {
  const result = aggregateSectors([
    { sector: 'healthcare', source: 'A', title: 'x', signal_score: 8 },
    { sector: 'healthcare', source: 'B', title: 'y', signal_score: 7 },
    { sector: 'tourism', source: 'C', title: 'z', signal_score: 5 },
  ]);
  assert.equal(result[0].sector, 'healthcare');
  assert.equal(result[0].independent_sources, 2);
  assert.equal(result[0].signal_score, 15);
});
