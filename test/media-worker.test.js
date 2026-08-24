import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, extractFeedItems, stableItemId, stripMarkup, wrapText } from '../tools/media-worker.mjs';

test('extracts RSS and Atom items without external XML dependency', () => {
  const rss = '<rss><channel><item><title><![CDATA[Agent market grows]]></title><link>https://example.com/a</link><description><![CDATA[<p>New &amp; useful.</p>]]></description><pubDate>Mon, 24 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const rows = extractFeedItems(rss, 'feed');
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Agent market grows'); assert.equal(rows[0].summary, 'New & useful.');
});

test('builds original short-form script and stable id', () => {
  const item = { id: '1', title: 'A useful AI update', url: 'https://example.com/a', summary: 'Something changed.', source: 'x' };
  assert.match(buildScript(item), /Why it matters/); assert.equal(stableItemId(item), stableItemId(item));
});

test('sanitizes and wraps markup', () => {
  assert.equal(stripMarkup('<b>Hello</b> &amp; world'), 'Hello & world');
  assert.ok(wrapText('one two three four five six seven eight nine ten', 10, 3).split('\n').length <= 3);
});
