import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { assertPublicRealEstateUrl } from './sources.js';

const execFileAsync = promisify(execFile);

function cleanText(value = '', max = 50000) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

export function classifyRealEstatePage(text = '', source = {}) {
  const value = String(text);

  if (/(?:captcha|security check|attention required|تحقق من أنك لست روبوت|التحقق الأمني)/i.test(value)) {
    return { state: 'BLOCKED', usable: false, reason: 'security_gate' };
  }

  if (
    source.authExpected
    && /(?:تسجيل الدخول|دخــــول)/i.test(value)
    && /(?:نفاذ|النفاذ الوطني|National Single Sign-On)/i.test(value)
  ) {
    return { state: 'AUTH_REQUIRED', usable: true, reason: 'expected_nafath_login' };
  }

  if (cleanText(value, 1000).length < 120) {
    return { state: 'INCOMPLETE', usable: false, reason: 'page_text_too_short' };
  }

  return { state: 'LIVE', usable: true, reason: 'public_page_loaded' };
}

function defaultBinary() {
  return process.env.OSA_REAL_ESTATE_BROWSER_BINARY || '/usr/local/bin/agent-browser';
}

function defaultStateDir() {
  return process.env.OSA_REAL_ESTATE_STATE_DIR || '/var/lib/osa-real-estate-hunter';
}

async function runBrowser(command, args = [], options = {}) {
  const binary = options.binary || defaultBinary();
  const stateDir = options.stateDir || defaultStateDir();
  const profile = options.profile;
  const session = options.session;
  const argv = [
    '--session', session,
    '--profile', profile,
    '--pin-tab',
    '--content-boundaries',
    '--max-output', '50000',
    '--args', '--no-sandbox',
    command,
    ...args.map(String),
  ];

  const { stdout = '', stderr = '' } = await execFileAsync(binary, argv, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 50000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: stateDir,
      ...(options.env || {}),
    },
  });

  return {
    stdout: cleanText(stdout, 120000),
    stderr: cleanText(stderr, 12000),
  };
}

async function closeBrowser(options) {
  try {
    await runBrowser('close', [], options);
  } catch {
    // Best-effort cleanup. A failed close must not overwrite the collection result.
  }
}

async function screenshotBrowser(file, options) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await runBrowser('screenshot', [file], options);
    return file;
  } catch {
    return null;
  }
}

export async function captureRealEstateSource(source, options = {}) {
  const url = assertPublicRealEstateUrl(source.url);
  const stateDir = options.stateDir || defaultStateDir();
  const profile = path.join(stateDir, 'browser-profile', source.id);
  const evidenceDir = options.evidenceDir || path.join(stateDir, 'evidence');
  const session = 'osa-real-estate-' + source.id;
  const browserOptions = {
    ...options,
    stateDir,
    profile,
    session,
  };
  const screenshotFile = path.join(evidenceDir, source.id + '.png');

  await fs.mkdir(profile, { recursive: true });

  let pageText = '';
  let finalUrl = url;

  try {
    await runBrowser('open', [url], browserOptions);
    await runBrowser('wait', [String(options.waitMs || 1800)], browserOptions);

    const current = await runBrowser('get', ['url'], browserOptions);
    finalUrl = cleanText(current.stdout, 2000) || url;
    assertPublicRealEstateUrl(finalUrl);

    const page = await runBrowser('read', [], browserOptions);
    pageText = cleanText(page.stdout, options.maxText || 50000);
    const classification = classifyRealEstatePage(pageText, source);
    const screenshotFileResult = await screenshotBrowser(screenshotFile, browserOptions);

    return {
      sourceId: source.id,
      platform: source.platform,
      kind: source.kind,
      city: source.city,
      attempted: true,
      state: classification.state,
      usable: classification.usable,
      reason: classification.reason,
      url,
      finalUrl,
      pageText,
      pageTextLength: pageText.length,
      screenshotFile: screenshotFileResult,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      sourceId: source.id,
      platform: source.platform,
      kind: source.kind,
      city: source.city,
      attempted: true,
      state: 'ERROR',
      usable: false,
      reason: 'browser_capture_failed',
      url,
      finalUrl,
      pageText,
      pageTextLength: pageText.length,
      screenshotFile: null,
      error: cleanText(error?.message || error, 5000),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await closeBrowser(browserOptions);
  }
}
