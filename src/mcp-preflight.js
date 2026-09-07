import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createPinnedLookup, validateTargetUrl } from './core.js';

const DEFAULT_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function parseMcpBody(contentType, body) {
  const text = String(body || '').trim();
  if (!text) return null;
  if (String(contentType || '').toLowerCase().includes('text/event-stream')) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    for (const candidate of data) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {}
    }
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeToolCatalog(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => ({
    name: String(tool?.name || ''),
    description: typeof tool?.description === 'string' ? tool.description : '',
    inputSchema: tool?.inputSchema ?? null,
    outputSchema: tool?.outputSchema ?? null,
    annotations: tool?.annotations ?? null,
    execution: tool?.execution ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function toolCatalogFingerprint(tools) {
  return sha256Json(normalizeToolCatalog(tools));
}

export function inspectToolCatalog(tools) {
  const normalized = normalizeToolCatalog(tools);
  const names = normalized.map((tool) => tool.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  const invalidNames = names.filter((name) => !TOOL_NAME_RE.test(name));
  const missingInputSchema = normalized.filter((tool) => !tool.inputSchema || typeof tool.inputSchema !== 'object').map((tool) => tool.name);
  return {
    toolCount: normalized.length,
    toolNames: names,
    schemaFingerprint: toolCatalogFingerprint(normalized),
    issues: [
      ...new Set(duplicates.map((name) => `DUPLICATE_TOOL_NAME:${name}`)),
      ...invalidNames.map((name) => `INVALID_TOOL_NAME:${name || '<empty>'}`),
      ...missingInputSchema.map((name) => `MISSING_INPUT_SCHEMA:${name || '<empty>'}`),
    ],
  };
}

export function diffToolCatalog(previousTools, currentTools) {
  const previous = new Map(normalizeToolCatalog(previousTools).map((tool) => [tool.name, tool]));
  const current = new Map(normalizeToolCatalog(currentTools).map((tool) => [tool.name, tool]));
  const removed = [...previous.keys()].filter((name) => !current.has(name)).sort();
  const added = [...current.keys()].filter((name) => !previous.has(name)).sort();
  const schemaChanged = [...previous.keys()].filter((name) => current.has(name)
    && sha256Json({ inputSchema: previous.get(name).inputSchema, outputSchema: previous.get(name).outputSchema })
      !== sha256Json({ inputSchema: current.get(name).inputSchema, outputSchema: current.get(name).outputSchema })).sort();
  return {
    changed: removed.length > 0 || added.length > 0 || schemaChanged.length > 0,
    breaking: removed.length > 0 || schemaChanged.length > 0,
    removed,
    added,
    schemaChanged,
  };
}

async function requestMcp(rawUrl, payload, { timeoutMs, maxBytes, protocolVersion, sessionId } = {}) {
  const validated = await validateTargetUrl(rawUrl);
  if (validated.url.protocol !== 'https:') {
    throw Object.assign(new Error('MCP preflight requires HTTPS'), { code: 'HTTPS_REQUIRED' });
  }
  const pinned = validated.addresses[0];
  const transport = validated.url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  const safeTimeoutMs = clampInt(timeoutMs, DEFAULT_TIMEOUT_MS, 500, 30_000);
  const safeMaxBytes = clampInt(maxBytes, DEFAULT_MAX_BYTES, 4096, 2 * 1024 * 1024);
  const hostname = validated.url.hostname.replace(/^\[|\]$/g, '');
  const headers = {
    'user-agent': 'OSA-MCP-Preflight/0.1',
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  };
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = transport.request({
      protocol: validated.url.protocol,
      hostname,
      port: validated.url.port || undefined,
      path: `${validated.url.pathname}${validated.url.search}`,
      method: 'POST',
      headers,
      servername: hostname,
      lookup: createPinnedLookup(pinned),
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > safeMaxBytes) {
          res.destroy(Object.assign(new Error('MCP response too large'), { code: 'RESPONSE_TOO_LARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, {
        status: Number(res.statusCode || 0),
        contentType: String(res.headers['content-type'] || ''),
        sessionId: String(res.headers['mcp-session-id'] || ''),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', (error) => finish(reject, error));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('MCP request timed out'), { code: 'TIMEOUT' })), safeTimeoutMs);
    req.on('error', (error) => finish(reject, error));
    req.end(body);
  });
}

export async function mcpPreflight(rawUrl, options = {}) {
  const started = performance.now();
  const protocolVersion = String(options.protocolVersion || DEFAULT_PROTOCOL_VERSION);
  const initializeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'OSA MCP Preflight', version: '0.1.0' },
    },
  };

  let initialize;
  try {
    initialize = await requestMcp(rawUrl, initializeRequest, options);
  } catch (error) {
    return {
      ok: false,
      protocolOk: false,
      authRequired: false,
      stage: 'initialize_transport',
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      error: String(error?.code || error?.message || error),
    };
  }

  if ([401, 403].includes(initialize.status)) {
    return {
      ok: true,
      protocolOk: false,
      authRequired: true,
      stage: 'initialize_auth',
      status: initialize.status,
      latencyMs: Math.round(performance.now() - started),
      issues: ['AUTH_REQUIRED_FOR_PROTOCOL_PROBE'],
    };
  }

  const initMessage = parseMcpBody(initialize.contentType, initialize.body);
  if (initialize.status < 200 || initialize.status >= 300 || !initMessage?.result) {
    return {
      ok: false,
      protocolOk: false,
      authRequired: false,
      stage: 'initialize_protocol',
      status: initialize.status,
      latencyMs: Math.round(performance.now() - started),
      issues: ['INITIALIZE_FAILED'],
    };
  }

  const negotiatedVersion = String(initMessage.result.protocolVersion || protocolVersion);
  const sessionId = initialize.sessionId || '';

  try {
    await requestMcp(rawUrl, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, {
      ...options,
      protocolVersion: negotiatedVersion,
      sessionId,
    });
  } catch {}

  let listed;
  try {
    listed = await requestMcp(rawUrl, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, {
      ...options,
      protocolVersion: negotiatedVersion,
      sessionId,
    });
  } catch (error) {
    return {
      ok: false,
      protocolOk: false,
      authRequired: false,
      stage: 'tools_list_transport',
      status: 0,
      protocolVersion: negotiatedVersion,
      latencyMs: Math.round(performance.now() - started),
      error: String(error?.code || error?.message || error),
    };
  }

  const toolsMessage = parseMcpBody(listed.contentType, listed.body);
  if (listed.status < 200 || listed.status >= 300 || !Array.isArray(toolsMessage?.result?.tools)) {
    return {
      ok: false,
      protocolOk: false,
      authRequired: [401, 403].includes(listed.status),
      stage: 'tools_list_protocol',
      status: listed.status,
      protocolVersion: negotiatedVersion,
      latencyMs: Math.round(performance.now() - started),
      issues: ['TOOLS_LIST_FAILED'],
    };
  }

  const catalog = inspectToolCatalog(toolsMessage.result.tools);
  return {
    ok: true,
    protocolOk: true,
    authRequired: false,
    stage: 'complete',
    status: listed.status,
    protocolVersion: negotiatedVersion,
    serverInfo: initMessage.result.serverInfo || null,
    capabilities: initMessage.result.capabilities || {},
    sessionMode: sessionId ? 'session' : 'stateless_or_unspecified',
    latencyMs: Math.round(performance.now() - started),
    ...catalog,
  };
}
