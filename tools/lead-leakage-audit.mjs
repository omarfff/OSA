import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10000;

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b,c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('2001:db8:');
  }
  return true;
}

function parseTarget(input) {
  const u = new URL(input);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('unsupported_protocol');
  if (u.username || u.password) throw new Error('credentials_in_url_not_allowed');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || (net.isIP(h) && isPrivateIp(h))) throw new Error('private_or_local_target');
  return u;
}

function safeLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? { ...options } : { family: options };
  const wantAll = opts.all === true;
  dns.lookup(hostname, { ...opts, all: wantAll }, (err, value, family) => {
    if (err) return callback(err);
    if (wantAll) {
      const rows = Array.isArray(value) ? value : (value ? [{ address: value, family }] : []);
      if (!rows.length || rows.some((x) => !x?.address || isPrivateIp(x.address))) return callback(Object.assign(new Error('private_or_local_target'), { code: 'EPRIVATE' }));
      return callback(null, rows);
    }
    if (!value || isPrivateIp(value)) return callback(Object.assign(new Error('private_or_local_target'), { code: 'EPRIVATE' }));
    callback(null, value, family);
  });
}

function requestOnce(u) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup: safeLookup, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'OSA-Lead-Leakage-Audit/0.2 (public-page-read-only)', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }
    }, (res) => {
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > MAX_BYTES) { res.destroy(); return reject(new Error('response_too_large')); }
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > MAX_BYTES) { res.destroy(new Error('response_too_large')); return; } chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('request_timeout')));
    req.on('error', reject); req.end();
  });
}

async function fetchPublicPage(input) {
  let u = parseTarget(input); const started = Date.now();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(u);
    if ([301,302,303,307,308].includes(res.status)) {
      if (!res.headers.location) throw new Error('redirect_without_location');
      u = parseTarget(new URL(res.headers.location, u).toString()); continue;
    }
    const type = String(res.headers['content-type'] || '').toLowerCase();
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('non_html_target');
    return { finalUrl: u.toString(), status: res.status, latencyMs: Date.now() - started, html: res.body };
  }
  throw new Error('too_many_redirects');
}

export function analyzeHtml(html, meta = {}) {
  const text = String(html || ''); const low = text.toLowerCase();
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g,' ').trim().slice(0,160);
  const signals = {
    whatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp/.test(low), phone: /href\s*=\s*["']tel:|\+966[\s-]?\d/.test(low),
    email: /href\s*=\s*["']mailto:/.test(low), form: /<form\b/.test(low), chat: /intercom|tawk\.to|crisp\.chat|livechat|zendesk|hubspot.*chat/.test(low),
    scheduler: /calendly|cal\.com|book.*appointment|schedule.*(call|visit|tour|demo)|حجز/.test(low),
    strongCta: /contact us|get started|book now|request|enquire|inquire|تواصل|احجز|اطلب/.test(low), arabic: /[\u0600-\u06ff]/.test(text), privacy: /privacy|سياسة الخصوصية/.test(low)
  };
  const findings = []; let score = 0;
  const add = (condition, points, code, message) => { if (condition) { score += points; findings.push({ code, points, message }); } };
  add(!signals.form,18,'NO_LEAD_FORM','No lead-capture form detected on the landing page.'); add(!signals.whatsapp,15,'NO_WHATSAPP','No obvious WhatsApp path detected.');
  add(!signals.phone,10,'NO_CLICK_TO_CALL','No click-to-call path detected.'); add(!signals.scheduler,12,'NO_SCHEDULER','No booking/scheduling path detected.');
  add(!signals.chat,8,'NO_LIVE_CHAT','No common live-chat widget detected.'); add(!signals.strongCta,12,'WEAK_CTA','No strong conversion CTA detected in visible markup.');
  add(Number(meta.latencyMs || 0) >= 2500,8,'SLOW_RESPONSE',`Initial page response took about ${meta.latencyMs} ms.`); add(Number(meta.status || 200) >= 400,17,'HTTP_ERROR',`Landing page returned HTTP ${meta.status}.`);
  score = Math.min(100, score); const topFindings = findings.slice().sort((a,b) => b.points-a.points).slice(0,3);
  const recommendedOffer = score >= 45 ? 'Lead recovery sprint: instant-response routing, qualification, booking and follow-up automation.' : score >= 20 ? 'Conversion follow-up layer: strengthen capture, routing and appointment conversion.' : 'Monitoring offer: track response paths and detect future lead-flow regressions.';
  return { title, opportunityScore: score, signals, findings, topFindings, recommendedOffer, auditLimitations: 'Public landing-page markup only; no forms submitted, no authentication, no bypassing controls.' };
}

function integrity(report) { return { payloadSha256: crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex') }; }
export async function auditUrl(input) {
  const fetched = await fetchPublicPage(input); const analysis = analyzeHtml(fetched.html, fetched);
  const report = { version:'0.2.1', reportId:crypto.randomUUID(), auditedAt:new Date().toISOString(), requestedUrl:String(input), finalUrl:fetched.finalUrl, httpStatus:fetched.status, latencyMs:fetched.latencyMs, bytes:Buffer.byteLength(fetched.html), ...analysis };
  return { ...report, integrity: integrity(report) };
}
async function main() {
  const target = process.argv[2]; if (!target) { console.error('usage: node tools/lead-leakage-audit.mjs https://example.com'); process.exit(2); }
  try { console.log(JSON.stringify(await auditUrl(target), null, 2)); } catch (err) { console.error(JSON.stringify({ ok:false, error:err instanceof Error ? err.message : String(err) })); process.exit(1); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
