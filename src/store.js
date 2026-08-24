import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const endpointsPath = path.join(dataDir, "endpoints.json");
const snapshotsPath = path.join(dataDir, "snapshots.json");
const remoteUrl = process.env.OSA_STORE_URL || "";
const remoteKey = process.env.OSA_STORE_KEY || "";
const parsedRemoteTimeoutMs = Number(process.env.OSA_STORE_TIMEOUT_MS);
const remoteTimeoutMs = Number.isFinite(parsedRemoteTimeoutMs) ? Math.max(1000, Math.min(60_000, parsedRemoteTimeoutMs)) : 6000;

function ensureFile(file, fallback = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
}

function readJson(file) {
  ensureFile(file);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return []; }
}

function writeJson(file, value) {
  ensureFile(file);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function remoteEnabled() { return Boolean(remoteUrl && remoteKey); }
export function storeMode() { return remoteEnabled() ? "supabase" : "local-json"; }

async function remoteCall(action, payload = {}) {
  if (!remoteEnabled()) throw new Error("remote store is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remoteTimeoutMs);
  try {
    const response = await fetch(remoteUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-osa-store-key": remoteKey },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error(`remote store ${action} returned invalid JSON`); }
    if (!response.ok) throw new Error(`remote store ${action} failed with HTTP ${response.status}`);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`remote store ${action} returned invalid payload`);
    if (body.error) throw new Error(`remote store ${action} failed`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function listEndpoints() {
  if (remoteEnabled()) return (await remoteCall("list_endpoints")).endpoints || [];
  return readJson(endpointsPath);
}

export async function upsertEndpoint(endpoint) {
  if (remoteEnabled()) return (await remoteCall("upsert_endpoint", { endpoint })).endpoint;
  const rows = readJson(endpointsPath);
  const i = rows.findIndex((x) => x.id === endpoint.id);
  if (i >= 0) rows[i] = { ...rows[i], ...endpoint, updatedAt: new Date().toISOString() };
  else rows.push({ ...endpoint, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  writeJson(endpointsPath, rows);
  return rows.find((x) => x.id === endpoint.id);
}

export async function addSnapshot(snapshot) {
  if (remoteEnabled()) return (await remoteCall("add_snapshot", { snapshot })).snapshot;
  const rows = readJson(snapshotsPath);
  rows.push(snapshot);
  writeJson(snapshotsPath, rows.slice(-10000));
  return snapshot;
}

export async function latestSnapshot(endpointId) {
  if (remoteEnabled()) return (await remoteCall("latest_snapshot", { endpointId })).snapshot || null;
  return readJson(snapshotsPath).filter((x) => x.endpointId === endpointId).at(-1) || null;
}

export async function historyFor(endpointId, limit = 100) {
  const parsed = Number(limit);
  const safeLimit = Number.isInteger(parsed) && parsed >= 1 ? Math.min(500, parsed) : 100;
  if (remoteEnabled()) return (await remoteCall("history", { endpointId, limit: safeLimit })).snapshots || [];
  return readJson(snapshotsPath).filter((x) => x.endpointId === endpointId).slice(-safeLimit).reverse();
}
