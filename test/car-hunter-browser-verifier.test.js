import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertPublicHarajListingUrl,
  classifyHarajPage,
  verifyRankedHarajCandidates,
} from '../src/car-hunter/browser-verifier.js';

test('visual verifier only permits public Haraj URLs', () => {
  assert.equal(new URL(assertPublicHarajListingUrl('https://haraj.com.sa/11188250984/BMW_530i/')).hostname, 'haraj.com.sa');
  assert.throws(() => assertPublicHarajListingUrl('https://example.com/11188250984/'), /not_allowed/);
  assert.throws(() => assertPublicHarajListingUrl('https://haraj.com.sa/api/post/1'), /internal_endpoint/);
});

test('Haraj browser page classifier rejects sold, unavailable and security-gated pages', () => {
  assert.equal(classifyHarajPage('تم حذف الإعلان من موقع حراج'.repeat(20)).state, 'UNAVAILABLE');
  assert.equal(classifyHarajPage('هذه السيارة تم البيع شكرا'.repeat(20)).state, 'SOLD');
  assert.equal(classifyHarajPage('Security Check CAPTCHA'.repeat(20)).state, 'BLOCKED');
  assert.equal(
    classifyHarajPage('BMW 530i 2019 سيارة نظيفة فحص وصيانة ومعلومات الإعلان '.repeat(10)).state,
    'LIVE',
  );
});

test('ranked visual verification skips stale top ad and returns first live candidate only', async () => {
  const evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'haraj-browser-evidence-'));
  let currentUrl = '';
  const pages = new Map([
    ['https://haraj.com.sa/11111111111/BMW_530i/', 'تم حذف الإعلان من موقع حراج'.repeat(20)],
    ['https://haraj.com.sa/22222222222/BMW_540i/', 'BMW 540i 2020 فل كامل ممشى 80 الف وصيانة موثقة والسيارة متاحة للبيع '.repeat(10)],
  ]);

  const browserRunner = async (command, args = []) => {
    if (command === 'open') {
      currentUrl = args[0];
      return { ok: true, stdout: '', stderr: '' };
    }
    if (command === 'wait') return { ok: true, stdout: '', stderr: '' };
    if (command === 'get') return { ok: true, stdout: currentUrl, stderr: '' };
    if (command === 'read') return { ok: true, stdout: pages.get(currentUrl) || '', stderr: '' };
    if (command === 'screenshot') return { ok: true, stdout: 'saved', stderr: '' };
    throw new Error('unexpected_command:' + command);
  };

  const result = await verifyRankedHarajCandidates([
    {
      status: 'BUY_CANDIDATE',
      listing: { externalId: '11111111111', url: 'https://haraj.com.sa/11111111111/BMW_530i/' },
      scores: { deal: 95 },
    },
    {
      status: 'INSPECT',
      listing: { externalId: '22222222222', url: 'https://haraj.com.sa/22222222222/BMW_540i/' },
      scores: { deal: 80 },
    },
  ], {
    browserRunner,
    evidenceDir,
    maxCandidates: 3,
    maxVerified: 1,
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.verified.length, 1);
  assert.equal(result.verified[0].listing.externalId, '22222222222');
  assert.equal(result.verified[0].browserVerification.state, 'LIVE');
  assert.equal(result.unavailable, 1);

  await fs.rm(evidenceDir, { recursive: true, force: true });
});
