import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TELEGRAM_API = 'https://api.telegram.org';
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const DEFAULT_STATE = '/var/lib/osa-telegram/state.json';
const MAX_WALLETS_PER_CHAT = 10;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(input) {
  if (typeof input !== 'string' || !input) return null;
  const bytes = [0];
  for (const ch of input) {
    const val = BASE58.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i] * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < input.length - 1 && input[i] === '1'; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function isValidSolanaAddress(address) {
  const value = String(address || '').trim();
  if (value.length < 32 || value.length > 44) return false;
  const decoded = decodeBase58(value);
  return decoded?.length === 32;
}

export function createEmptyState() { return { version: 1, telegramOffset: 0, chats: {} }; }

function chatBucket(state, chatId) {
  const id = String(chatId);
  state.chats[id] ||= { wallets: [] };
  state.chats[id].wallets ||= [];
  return state.chats[id];
}

export function addWallet(state, chatId, address, label = '') {
  const addr = String(address || '').trim();
  if (!isValidSolanaAddress(addr)) return { ok: false, error: 'invalid_solana_address' };
  const bucket = chatBucket(state, chatId);
  if (bucket.wallets.some((w) => w.address === addr)) return { ok: true, duplicate: true };
  if (bucket.wallets.length >= MAX_WALLETS_PER_CHAT) return { ok: false, error: 'wallet_limit_reached' };
  bucket.wallets.push({ address: addr, label: String(label || '').trim().slice(0, 60), lastSignature: null, addedAt: new Date().toISOString() });
  return { ok: true };
}

export function removeWallet(state, chatId, address) {
  const bucket = chatBucket(state, chatId);
  const before = bucket.wallets.length;
  bucket.wallets = bucket.wallets.filter((w) => w.address !== String(address || '').trim());
  return { ok: bucket.wallets.length < before };
}

export function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return { command: '', args: [] };
  const parts = raw.split(/\s+/);
  return { command: parts[0].split('@')[0].toLowerCase(), args: parts.slice(1) };
}

async function readState(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid_state');
    parsed.telegramOffset ||= 0; parsed.chats ||= {};
    return parsed;
  } catch (err) {
    if (err?.code === 'ENOENT') return createEmptyState();
    throw err;
  }
}

async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function telegram(token, method, body = {}) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`telegram_${method}_failed:${res.status}:${json.description || 'unknown'}`);
  return json.result;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`solana_rpc_failed:${res.status}:${json.error?.message || 'unknown'}`);
  return json.result;
}

function helpText() {
  return [
    'OSA Solana Wallet Tracker',
    '',
    '/track <address> [label] — track a public wallet',
    '/untrack <address> — stop tracking',
    '/list — tracked wallets',
    '/status — bot status',
    '',
    `Limit: ${MAX_WALLETS_PER_CHAT} wallets per chat. Alerts are informational only; this bot does not trade or move funds.`,
  ].join('\n');
}

async function send(token, chatId, text) {
  return telegram(token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

async function handleMessage(token, state, message) {
  const chatId = message?.chat?.id;
  if (!chatId || typeof message?.text !== 'string') return false;
  const { command, args } = parseCommand(message.text);
  if (!command) return false;
  if (command === '/start' || command === '/help') { await send(token, chatId, helpText()); return true; }
  if (command === '/track') {
    const [address, ...label] = args;
    const result = addWallet(state, chatId, address, label.join(' '));
    if (!result.ok) await send(token, chatId, result.error === 'wallet_limit_reached' ? 'Wallet limit reached.' : 'Invalid Solana address.');
    else if (result.duplicate) await send(token, chatId, 'Already tracking that wallet.');
    else await send(token, chatId, `Tracking ${address}${label.length ? ` (${label.join(' ')})` : ''}. Baseline will be captured without historical spam.`);
    return true;
  }
  if (command === '/untrack') {
    const result = removeWallet(state, chatId, args[0]);
    await send(token, chatId, result.ok ? 'Wallet removed.' : 'That wallet was not tracked.');
    return true;
  }
  if (command === '/list') {
    const wallets = chatBucket(state, chatId).wallets;
    await send(token, chatId, wallets.length ? wallets.map((w, i) => `${i + 1}. ${w.label ? `${w.label} — ` : ''}${w.address}`).join('\n') : 'No wallets tracked yet.');
    return true;
  }
  if (command === '/status') {
    await send(token, chatId, `Tracker online. ${chatBucket(state, chatId).wallets.length}/${MAX_WALLETS_PER_CHAT} wallets configured.`);
    return true;
  }
  await send(token, chatId, helpText()); return true;
}

async function checkWallet(rpcUrl, wallet) {
  const rows = await rpc(rpcUrl, 'getSignaturesForAddress', [wallet.address, { limit: 10, commitment: 'confirmed' }]);
  if (!Array.isArray(rows) || !rows.length) return { notifications: [], changed: false };
  if (!wallet.lastSignature) { wallet.lastSignature = rows[0].signature; return { notifications: [], changed: true }; }
  const fresh = [];
  for (const row of rows) {
    if (row.signature === wallet.lastSignature) break;
    fresh.push(row);
  }
  if (!fresh.length) return { notifications: [], changed: false };
  wallet.lastSignature = rows[0].signature;
  return { notifications: fresh.reverse(), changed: true };
}

async function pollWallets(token, rpcUrl, state) {
  let changed = false;
  for (const [chatId, bucket] of Object.entries(state.chats || {})) {
    for (const wallet of bucket.wallets || []) {
      try {
        const result = await checkWallet(rpcUrl, wallet); changed ||= result.changed;
        for (const row of result.notifications) {
          const status = row.err ? 'FAILED' : 'CONFIRMED';
          const label = wallet.label ? `${wallet.label}\n` : '';
          await send(token, chatId, `${label}${status} Solana activity\n${wallet.address}\nslot ${row.slot}\nhttps://solscan.io/tx/${row.signature}`);
        }
      } catch (err) { console.error(JSON.stringify({ event: 'wallet_poll_error', address: wallet.address, error: String(err?.message || err) })); }
    }
  }
  return changed;
}

async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
  const stateFile = process.env.OSA_TELEGRAM_STATE?.trim() || DEFAULT_STATE;
  if (!token) { console.error('TELEGRAM_BOT_TOKEN is required'); process.exit(2); }
  const state = await readState(stateFile);
  let nextWalletPoll = 0;
  while (true) {
    let dirty = false;
    try {
      const updates = await telegram(token, 'getUpdates', { offset: Number(state.telegramOffset || 0), timeout: 20, allowed_updates: ['message'] });
      for (const update of updates || []) {
        state.telegramOffset = Math.max(Number(state.telegramOffset || 0), Number(update.update_id || 0) + 1); dirty = true;
        if (update.message) dirty = (await handleMessage(token, state, update.message)) || dirty;
      }
    } catch (err) { console.error(JSON.stringify({ event: 'telegram_poll_error', error: String(err?.message || err) })); await new Promise((r) => setTimeout(r, 3000)); }
    if (Date.now() >= nextWalletPoll) {
      dirty = (await pollWallets(token, rpcUrl, state)) || dirty;
      nextWalletPoll = Date.now() + 30000;
    }
    if (dirty) await writeState(stateFile, state);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
