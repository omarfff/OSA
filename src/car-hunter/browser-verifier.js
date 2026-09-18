import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HARAJ_HOSTS = new Set(['haraj.com.sa', 'www.haraj.com.sa']);

function cleanText(value = '', max = 30000) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

export function assertPublicHarajListingUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || !HARAJ_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('haraj_visual_url_not_allowed');
  }
  if (/\/(?:api|graphql)(?:\/|$)/i.test(url.pathname)) {
    throw new Error('haraj_visual_internal_endpoint_forbidden');
  }
  return url.toString();
}

export function classifyHarajPage(text = '') {
  const value = String(text).toLowerCase();

  const blockedPatterns = [
    /access denied/i,
    /attention required/i,
    /security check/i,
    /captcha/i,
    /تحقق من أنك لست روبوت/i,
    /التحقق الأمني/i,
  ];
  if (blockedPatterns.some((re) => re.test(value))) {
    return { state: 'BLOCKED', worthy: false, reason: 'security_gate' };
  }

  const unavailablePatterns = [
    /الإعلان محذوف/i,
    /الاعلان محذوف/i,
    /تم حذف الإعلان/i,
    /تم حذف الاعلان/i,
    /الإعلان غير موجود/i,
    /الاعلان غير موجود/i,
    /هذا الإعلان غير متاح/i,
    /هذا الاعلان غير متاح/i,
    /لم يعد الإعلان متاح/i,
    /لم يعد الاعلان متاح/i,
  ];
  if (unavailablePatterns.some((re) => re.test(value))) {
    return { state: 'UNAVAILABLE', worthy: false, reason: 'listing_unavailable' };
  }

  const soldPatterns = [
    /تم البيع/i,
    /مباع(?:ة)?\b/i,
  ];
  if (soldPatterns.some((re) => re.test(value))) {
    return { state: 'SOLD', worthy: false, reason: 'listing_sold' };
  }

  if (cleanText(text, 1000).length < 120) {
    return { state: 'INCOMPLETE', worthy: false, reason: 'page_text_too_short' };
  }

  return { state: 'LIVE', worthy: true, reason: 'public_listing_loaded' };
}

function defaultBinary() {
  return process.env.OSA_CAR_HUNTER_BROWSER_BINARY || '/usr/local/bin/agent-browser';
}

function defaultProfileRoot() {
  return process.env.OSA_CAR_HUNTER_BROWSER_PROFILE
    || '/var/lib/osa-car-hunter/browser-profile';
}

async function runBrowser(command, args = [], options = {}) {
  const binary = options.binary || defaultBinary();
  const profile = options.profile || defaultProfileRoot();
  const session = options.session || 'osa-haraj-car-hunter';
  const argv = [
    '--session', session,
    '--profile', profile,
    '--pin-tab',
    '--content-boundaries',
    '--max-output', '30000',
    command,
    ...args.map(String),
  ];

  const { stdout = '', stderr = '' } = await execFileAsync(binary, argv, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 45000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });

  return {
    ok: true,
    stdout: cleanText(stdout, 100000),
    stderr: cleanText(stderr, 20000),
  };
}

async function safeScreenshot(file, options = {}) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await (options.browserRunner || runBrowser)('screenshot', [file], options);
    return file;
  } catch {
    return null;
  }
}

export async function verifyHarajCandidate(assessment, options = {}) {
  const listing = assessment?.listing || assessment;
  const url = assertPublicHarajListingUrl(listing?.url);
  const browserRunner = options.browserRunner || runBrowser;
  const evidenceDir = options.evidenceDir
    || process.env.OSA_CAR_HUNTER_EVIDENCE_DIR
    || '/var/lib/osa-car-hunter/evidence';
  const id = String(listing?.externalId || 'candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
  const screenshotFile = path.join(evidenceDir, \`\${id}.png\`);

  let finalUrl = url;
  let text = '';
  let stderr = '';

  try {
    await browserRunner('open', [url], options);
    await browserRunner('wait', [String(options.waitMs || 1600)], options);

    const current = await browserRunner('get', ['url'], options);
    finalUrl = cleanText(current.stdout, 2000) || url;
    const final = new URL(finalUrl);
    if (!HARAJ_HOSTS.has(final.hostname.toLowerCase())) {
      return {
        attempted: true,
        worthy: false,
        state: 'REDIRECTED',
        reason: 'redirected_off_haraj',
        url,
        finalUrl,
        screenshotFile: null,
        pageText: '',
      };
    }

    const page = await browserRunner('read', [], options);
    text = cleanText(page.stdout, options.maxText || 30000);
    stderr = cleanText([current.stderr, page.stderr].filter(Boolean).join('\n'), 4000);
    const pageState = classifyHarajPage(text);
    const screenshot = await safeScreenshot(screenshotFile, { ...options, browserRunner });

    return {
      attempted: true,
      worthy: pageState.worthy,
      state: pageState.state,
      reason: pageState.reason,
      url,
      finalUrl,
      screenshotFile: screenshot,
      pageText: text,
      pageTextLength: text.length,
      stderr,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      attempted: true,
      worthy: false,
      state: 'ERROR',
      reason: 'browser_verification_failed',
      url,
      finalUrl,
      screenshotFile: null,
      pageText: text,
      pageTextLength: text.length,
      stderr: cleanText(\`\${stderr}\n\${error?.message || error}\`, 4000),
      verifiedAt: new Date().toISOString(),
    };
  }
}

export async function verifyRankedHarajCandidates(assessments, options = {}) {
  const maxCandidates = Math.max(1, Math.min(Number(options.maxCandidates || 3), 8));
  const candidates = (assessments || [])
    .filter((item) => ['BUY_CANDIDATE', 'INSPECT'].includes(item?.status))
    .slice(0, maxCandidates);

  const attempts = [];
  const verified = [];

  for (const assessment of candidates) {
    const evidence = await verifyHarajCandidate(assessment, options);
    const combined = { ...assessment, browserVerification: evidence };
    attempts.push(combined);
    if (evidence.worthy) {
      verified.push(combined);
      if (verified.length >= Number(options.maxVerified || 1)) break;
    }
  }

  return {
    attempted: attempts.length,
    verified,
    attempts,
    unavailable: attempts.filter((x) => x.browserVerification?.state === 'UNAVAILABLE').length,
    sold: attempts.filter((x) => x.browserVerification?.state === 'SOLD').length,
    blocked: attempts.filter((x) => x.browserVerification?.state === 'BLOCKED').length,
    errors: attempts.filter((x) => x.browserVerification?.state === 'ERROR').length,
  };
}
