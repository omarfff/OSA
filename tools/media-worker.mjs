import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_FEEDS = [
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
];
const DEFAULT_OUTBOX = '/var/lib/osa-media/outbox';
const DEFAULT_STATE = '/var/lib/osa-media/state.json';
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const DEFAULT_BRAIN_URL = 'http://127.0.0.1:8787';

export function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function stripMarkup(s) {
  const decoded = decodeEntities(String(s || ''));
  return decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (m) return stripMarkup(m[1]);
  }
  return '';
}

function linkFrom(block) {
  const atom = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  if (atom) return decodeEntities(atom).trim();
  return tag(block, ['link']);
}

export function extractFeedItems(xml, source = '') {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<item\b[\s\S]*?<\/item>/gi), ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  return blocks.map((block) => {
    const title = tag(block, ['title']);
    const url = linkFrom(block);
    const summary = tag(block, ['description', 'summary', 'content']);
    const published = tag(block, ['pubDate', 'published', 'updated']);
    const id = tag(block, ['guid', 'id']) || url || `${title}:${published}`;
    return { id, title, url, summary, published, source };
  }).filter((x) => x.title && /^https?:\/\//i.test(x.url));
}

export function wrapText(text, width = 34, maxLines = 8) {
  const words = stripMarkup(text).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) { lines.push(line); line = word; } else line = candidate;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.join('\n');
}

export function buildScript(item) {
  const title = stripMarkup(item.title).slice(0, 180);
  const summary = stripMarkup(item.summary).slice(0, 420);
  return [
    `Here is the AI update worth knowing today. ${title}.`,
    summary ? `The report says: ${summary}.` : '',
    'Why it matters: agent software is moving from demos toward real infrastructure, distribution, and payments.',
    'The practical takeaway is to watch what changes in reliability, pricing, and how software agents buy services.',
    'This is an OSA AI brief. Source link is included with the post.',
  ].filter(Boolean).join(' ');
}

export async function buildAiScript(item, { fetchImpl = fetch, brainUrl = process.env.OSA_BRAIN_URL || DEFAULT_BRAIN_URL } = {}) {
  const fallback = buildScript(item);
  try {
    const u = new URL(brainUrl);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) return fallback;
    const res = await fetchImpl(new URL('/v1/think', u), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ mode: 'media', task: 'Turn this source item into a factual spoken AI brief.', context: { title: item.title, summary: item.summary, sourceUrl: item.url, sourceFeed: item.source } }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const text = stripMarkup(data?.text || '').replace(/\s+/g, ' ').trim();
    return text.length >= 80 && text.length <= 1200 ? text : fallback;
  } catch { return fallback; }
}

export function stableItemId(item) {
  return crypto.createHash('sha256').update(`${item.id}|${item.url}|${item.title}`).digest('hex').slice(0, 20);
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'OSA-Media-Worker/0.1 (+public-rss)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`feed_http_${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_FEED_BYTES) throw new Error('feed_too_large');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FEED_BYTES) throw new Error('feed_too_large');
  return new TextDecoder().decode(buf);
}

async function readState(file) {
  try { const x = JSON.parse(await fs.readFile(file, 'utf8')); return x && typeof x === 'object' ? x : { seen: [] }; }
  catch (err) { if (err?.code === 'ENOENT') return { seen: [] }; throw err; }
}
async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { err += x; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`${cmd}_failed:${code}:${err.slice(-800)}`)));
  });
}

async function createVideo(item, outbox) {
  const id = stableItemId(item); const dir = path.join(outbox, id); await fs.mkdir(dir, { recursive: true });
  const fallbackScript = buildScript(item); const script = await buildAiScript(item); const scriptEngine = script === fallbackScript ? 'fallback' : 'osa-brain'; const title = wrapText(item.title, 30, 6); const source = wrapText(new URL(item.url).hostname, 42, 2);
  const scriptFile = path.join(dir, 'script.txt'), titleFile = path.join(dir, 'title.txt'), sourceFile = path.join(dir, 'source.txt');
  const audio = path.join(dir, 'voice.wav'), video = path.join(dir, 'short.mp4');
  await fs.writeFile(scriptFile, `${script}\n`); await fs.writeFile(titleFile, `${title}\n`); await fs.writeFile(sourceFile, `Source: ${source}\n`);
  await run('espeak-ng', ['-v', process.env.OSA_MEDIA_VOICE || 'en-us', '-s', process.env.OSA_MEDIA_SPEAK_RATE || '158', '-f', scriptFile, '-w', audio]);
  const bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; const regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const vf = [
    `drawtext=fontfile=${bold}:text='OSA AI BRIEF':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=250`,
    `drawtext=fontfile=${bold}:textfile=${titleFile}:fontcolor=white:fontsize=58:line_spacing=18:x=(w-text_w)/2:y=480`,
    `drawtext=fontfile=${regular}:textfile=${sourceFile}:fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1580`,
    `drawtext=fontfile=${regular}:text='Informational summary - source linked':fontcolor=white:fontsize=26:x=(w-text_w)/2:y=1680`,
  ].join(',');
  await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x111827:s=1080x1920:r=30','-i',audio,'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',video]);
  const metadata = { id, createdAt: new Date().toISOString(), title: stripMarkup(item.title), sourceUrl: item.url, sourceFeed: item.source, script, scriptEngine, video };
  await fs.writeFile(path.join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

async function main() {
  const outbox = process.env.OSA_MEDIA_OUTBOX || DEFAULT_OUTBOX; const stateFile = process.env.OSA_MEDIA_STATE || DEFAULT_STATE;
  const feeds = (process.env.OSA_MEDIA_FEEDS || DEFAULT_FEEDS.join(',')).split(',').map((x) => x.trim()).filter(Boolean);
  const state = await readState(stateFile); const seen = new Set(Array.isArray(state.seen) ? state.seen : []); const items = [];
  for (const feed of feeds) {
    try { items.push(...extractFeedItems(await fetchFeed(feed), feed)); }
    catch (err) { console.error(JSON.stringify({ event: 'feed_error', feed, error: String(err?.message || err) })); }
  }
  const ranked = items.map((item) => ({ ...item, _id: stableItemId(item), _time: Date.parse(item.published || '') || 0 }))
    .filter((item) => !seen.has(item._id)).sort((a, b) => b._time - a._time);
  if (!ranked.length) { console.log(JSON.stringify({ ok: true, generated: false, reason: 'no_unseen_items', feeds: feeds.length })); return; }
  const chosen = ranked[0]; const metadata = await createVideo(chosen, outbox);
  state.seen = [chosen._id, ...[...seen]].slice(0, 200); state.lastRunAt = new Date().toISOString(); state.lastOutput = metadata.video;
  await writeState(stateFile, state); console.log(JSON.stringify({ ok: true, generated: true, id: metadata.id, video: metadata.video, sourceUrl: metadata.sourceUrl }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
