import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const endpointsPath = path.join(dataDir, "endpoints.json");
const snapshotsPath = path.join(dataDir, "snapshots.json");

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

export function listEndpoints() { return readJson(endpointsPath); }
export function listSnapshots() { return readJson(snapshotsPath); }

export function upsertEndpoint(endpoint) {
  const rows = listEndpoints();
  const i = rows.findIndex((x) => x.id === endpoint.id);
  if (i >= 0) rows[i] = { ...rows[i], ...endpoint, updatedAt: new Date().toISOString() };
  else rows.push({ ...endpoint, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  writeJson(endpointsPath, rows);
  return rows.find((x) => x.id === endpoint.id);
}

export function addSnapshot(snapshot) {
  const rows = listSnapshots();
  rows.push(snapshot);
  writeJson(snapshotsPath, rows.slice(-10000));
  return snapshot;
}

export function historyFor(endpointId, limit = 100) {
  return listSnapshots().filter((x) => x.endpointId === endpointId).slice(-limit).reverse();
}
