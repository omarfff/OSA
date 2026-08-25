import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const STATUS_DIR = process.env.OSA_AUTOPILOT_STATE || '/var/lib/osa-autopilot';
const MEDIA_ROOT = process.env.OSA_MEDIA_ROOT || '/var/lib/osa-media/outbox';
const TELEGRAM_ENV = process.env.OSA_TELEGRAM_ENV || '/etc/osa/telegram-wallet-tracker.env';
const MEDIA_MAX_AGE_MS = Number(process.env.OSA_MEDIA_MAX_AGE_MS || 8 * 60 * 60 * 1000);
const BRAIN_URL = process.env.OSA_BRAIN_URL || 'http://127.0.0.1:8787';
const EXPERIENCE_FILE = process.env.OSA_BRAIN_EXPERIENCE_FILE || '/var/lib/osa-brain/experiences.jsonl';

async function runSystemctl(args) {
  try {
    const { stdout = '', stderr = '' } = await execFile('/usr/bin/systemctl', args, { timeout: 15000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, stdout: String(err?.stdout || '').trim(), stderr: String(err?.stderr || err?.message || '').trim() };
  }
}

export function envHasBotToken(text = '') {
  const line = String(text).split(/\r?\n/).find((x) => /^\s*TELEGRAM_BOT_TOKEN\s*=/.test(x));
  if (!line) return false;
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  return Boolean(value && !/^<.*>$/.test(value) && value !== 'unset');
}

async function newestMp4(root) {
  let newest = null;
  try {
    const dirs = await fsp.readdir(root, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const p = path.join(root, d.name, 'short.mp4');
      try {
        const st = await fsp.stat(p);
        if (!newest || st.mtimeMs > newest.mtimeMs) newest = { path: p, mtimeMs: st.mtimeMs, size: st.size };
      } catch {}
    }
  } catch {}
  return newest;
}

async function diskUsage(target = '/') {
  const s = await fsp.statfs(target);
  const total = Number(s.blocks) * Number(s.bsize);
  const free = Number(s.bavail) * Number(s.bsize);
  return { total, free, usedPct: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : null };
}

export async function runWatchdog(now = Date.now()) {
  await fsp.mkdir(STATUS_DIR, { recursive: true, mode: 0o700 });
  const report = { at: new Date(now).toISOString(), actions: [], warnings: [], services: {} };

  const ollama = await runSystemctl(['is-active', 'ollama.service']);
  report.services.ollama = ollama.ok && ollama.stdout === 'active' ? 'active' : 'inactive';
  if (report.services.ollama !== 'active') {
    const r = await runSystemctl(['start', 'ollama.service']);
    report.actions.push({ action: 'start_ollama', ok: r.ok });
  }

  const brainSvc = await runSystemctl(['is-active', 'osa-brain.service']);
  report.services.brain = brainSvc.ok && brainSvc.stdout === 'active' ? 'active' : 'inactive';
  let brainHealthy = false;
  try {
    const r = await fetch(`${BRAIN_URL}/health`, { signal: AbortSignal.timeout(3000) });
    brainHealthy = r.ok;
  } catch {}
  report.brain = { healthy: brainHealthy };
  if (report.services.brain !== 'active' || !brainHealthy) {
    const r = await runSystemctl(['restart', 'osa-brain.service']);
    report.actions.push({ action: 'restart_brain', ok: r.ok });
  }

  const mediaTimer = await runSystemctl(['is-active', 'osa-media-worker.timer']);
  report.services.mediaTimer = mediaTimer.ok && mediaTimer.stdout === 'active' ? 'active' : 'inactive';
  if (report.services.mediaTimer !== 'active') {
    const r = await runSystemctl(['start', 'osa-media-worker.timer']);
    report.actions.push({ action: 'start_media_timer', ok: r.ok });
  }

  const media = await newestMp4(MEDIA_ROOT);
  report.media = media ? { ...media, ageMinutes: Math.round((now - media.mtimeMs) / 60000) } : null;
  if (!media || now - media.mtimeMs > MEDIA_MAX_AGE_MS) {
    const r = await runSystemctl(['start', 'osa-media-worker.service']);
    report.actions.push({ action: 'refresh_media', ok: r.ok });
  }

  let tokenReady = false;
  try { tokenReady = envHasBotToken(await fsp.readFile(TELEGRAM_ENV, 'utf8')); } catch {}
  report.telegramTokenReady = tokenReady;
  const tg = await runSystemctl(['is-active', 'osa-telegram-wallet-tracker.service']);
  report.services.telegram = tg.ok && tg.stdout === 'active' ? 'active' : 'inactive';
  if (tokenReady && report.services.telegram !== 'active') {
    const enable = await runSystemctl(['enable', 'osa-telegram-wallet-tracker.service']);
    const start = await runSystemctl(['start', 'osa-telegram-wallet-tracker.service']);
    report.actions.push({ action: 'activate_telegram', ok: enable.ok && start.ok });
  }

  report.disk = await diskUsage('/');
  if (report.disk.usedPct >= 90) report.warnings.push('DISK_USAGE_HIGH');

  const tmp = path.join(STATUS_DIR, 'status.json.tmp');
  const dst = path.join(STATUS_DIR, 'status.json');
  await fsp.writeFile(tmp, JSON.stringify(report, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, dst);
  if (report.actions.length || report.warnings.length) {
    const event = { at: report.at, kind: 'runtime_lesson', summary: `Autopilot observed ${report.actions.length} action(s) and ${report.warnings.length} warning(s)`, evidence: JSON.stringify({ services: report.services, actions: report.actions, warnings: report.warnings, disk: report.disk }), result: report.actions.every((x) => x.ok) ? 'actions_succeeded' : 'action_failed', lesson: 'Use verified service state and remediation outcomes in future diagnosis.', tags: ['autopilot','runtime','self-heal'] };
    try { await fsp.appendFile(EXPERIENCE_FILE, JSON.stringify(event) + '\n', { encoding: 'utf8' }); } catch {}
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const report = await runWatchdog();
  process.stdout.write(JSON.stringify(report) + '\n');
}
