import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiScript, buildScript, extractFeedItems, stableItemId, stripMarkup, wrapText } from '../tools/media-worker.mjs';

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


test('uses local OSA Brain media copy when available and falls back safely', async () => {
  const item = { id: 'x', title: 'Agent payments update', url: 'https://example.com/x', summary: 'A concrete reliability change was announced.', source: 'feed' };
  const ai = 'This AI infrastructure update changes how agent services handle reliability and payment flows. The source reports a concrete reliability change and nothing beyond that. For teams building machine commerce, the practical implication is to verify service behavior, pricing, and payment settlement before automating purchases. OSA tracks those operational changes as evidence rather than treating announcements as production readiness.';
  const got = await buildAiScript(item, { fetchImpl: async () => ({ ok: true, json: async () => ({ text: ai }) }) });
  assert.equal(got, ai);
  const fallback = await buildAiScript(item, { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(fallback, buildScript(item));
});
