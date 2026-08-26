import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const STATE_DIR = process.env.OSA_CONTINUITY_STATE || '/var/lib/osa-continuity';
const WATCHDOG_STATUS = process.env.OSA_AUTOPILOT_STATUS || '/var/lib/osa-autopilot/status.json';
const BRAIN_URL = process.env.OSA_BRAIN_URL || 'http://127.0.0.1:8787';
const SUPERTEAM_CLI = process.env.OSA_SUPERTEAM_CLI || '/opt/osa-superteam/superteam-agent.py';

export function validateLocalBrainUrl(value = BRAIN_URL) {
  const u = new URL(String(value));
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'http:') throw new Error('brain_loopback_http_required');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('brain_loopback_only');
  if (u.username || u.password) throw new Error('brain_credentials_not_allowed');
  return u;
}

export function sanitizeListing(x = {}) {
  const allowed = ['id', 'slug', 'title', 'type', 'deadline', 'agentAccess', 'rewardAmount', 'rewardToken'];
  return Object.fromEntries(allowed.filter((k) => x?.[k] !== undefined).map((k) => [k, x[k]]));
}

export function parseSuperteamOutput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, current_count: 0, listings: [], error: 'empty_output' };
  try {
    const obj = JSON.parse(raw);
    const listings = Array.isArray(obj?.listings) ? obj.listings.map(sanitizeListing) : [];
    const count = Number.isFinite(Number(obj?.current_count)) ? Number(obj.current_count) : listings.length;
    return { ok: obj?.ok !== false, current_count: Math.max(0, count), listings };
  } catch {
    return { ok: false, current_count: 0, listings: [], error: 'invalid_json' };
  }
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { return null; }
}

async function runSuperteam() {
  try {
    const { stdout = '', stderr = '' } = await execFile('/usr/bin/python3', [SUPERTEAM_CLI, 'list-live'], { timeout: 45000, maxBuffer: 512 * 1024 });
    return { ...parseSuperteamOutput(stdout), stderr: String(stderr || '').trim().slice(0, 400) };
  } catch (err) {
    return {
      ok: false,
      current_count: 0,
      listings: [],
      error: String(err?.message || 'superteam_failed').slice(0, 300),
    };
  }
}

async function think(context, fetchImpl = fetch) {
  const base = validateLocalBrainUrl(BRAIN_URL);
  const endpoint = new URL('/v1/think', base);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(135000),
    body: JSON.stringify({
      mode: 'operator',
      task: 'Operate as the local OSA continuity adviser. Using only the supplied verified local context, identify the single highest-value safe reversible next action that can continue without ChatGPT/Codex. Do not invent payments, customers, replies, listings, commands, or completed actions. Human gates remain mandatory for OTP/KYC, binding terms or signatures, and movement of money.',
      context,
    }),
  });
  if (!response.ok) throw new Error(`brain_http_${response.status}`);
  const body = await response.json();
  if (!body?.ok || !body?.text) throw new Error(String(body?.error || 'brain_invalid_response'));
  return {
    text: String(body.text).slice(0, 6000),
    model: String(body.model || ''),
    grounding_repaired: Boolean(body.grounding_repaired),
    grounding_unsupported: Array.isArray(body.grounding_unsupported) ? body.grounding_unsupported.slice(0, 20) : [],
    latency_ms: Number(body.latency_ms || 0),
  };
}

export async function runContinuity(now = Date.now(), deps = {}) {
  const stateDir = deps.stateDir || STATE_DIR;
  const watchdogPath = deps.watchdogPath || WATCHDOG_STATUS;
  const superteamFn = deps.runSuperteam || runSuperteam;
  const thinkFn = deps.think || think;

  await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const watchdog = await readJson(watchdogPath);
  const superteam = await superteamFn();

  const context = {
    at: new Date(now).toISOString(),
    source: 'verified_local_runtime',
    codex_dependency_policy: 'Prefer local OSA services and local Brain for routine analysis. Codex/ChatGPT is escalation-only when a capability is unavailable locally.',
    watchdog: watchdog ? {
      at: watchdog.at || null,
      services: watchdog.services || {},
      brain: watchdog.brain || {},
      warnings: Array.isArray(watchdog.warnings) ? watchdog.warnings.slice(0, 20) : [],
      actions: Array.isArray(watchdog.actions) ? watchdog.actions.slice(0, 20) : [],
      disk: watchdog.disk || null,
    } : { unavailable: true },
    superteam: {
      ok: Boolean(superteam.ok),
      current_count: Number(superteam.current_count || 0),
      listings: Array.isArray(superteam.listings) ? superteam.listings.slice(0, 25) : [],
      error: superteam.error || null,
    },
  };

  const report = {
    at: context.at,
    mode: 'local_continuity',
    codex_required: false,
    brain_advice_is_execution_proof: false,
    verified_sources: ['watchdog_status', 'superteam_list_live'],
    context,
    brain: null,
    errors: [],
  };

  try { report.brain = await thinkFn(context); }
  catch (err) { report.errors.push(String(err?.message || err).slice(0, 300)); }

  const tmp = path.join(stateDir, 'continuity.json.tmp');
  const dst = path.join(stateDir, 'continuity.json');
  await fsp.writeFile(tmp, JSON.stringify(report, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, dst);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const report = await runContinuity();
  process.stdout.write(JSON.stringify(report) + '\n');
}
