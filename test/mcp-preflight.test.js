import assert from 'node:assert/strict';
import test from 'node:test';
import { diffToolCatalog, inspectToolCatalog, parseMcpBody, toolCatalogFingerprint } from '../src/mcp-preflight.js';

test('parses JSON and SSE MCP responses', () => {
  assert.deepEqual(parseMcpBody('application/json', '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), {
    jsonrpc: '2.0', id: 1, result: { ok: true },
  });
  assert.deepEqual(parseMcpBody('text/event-stream', 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n'), {
    jsonrpc: '2.0', id: 2, result: { tools: [] },
  });
  assert.equal(parseMcpBody('application/json', 'not-json'), null);
});

test('tool catalog fingerprint is stable across tool and object ordering', () => {
  const a = [
    { name: 'b', inputSchema: { type: 'object', properties: { z: { type: 'number' }, a: { type: 'string' } } } },
    { name: 'a', inputSchema: { type: 'object', properties: {} } },
  ];
  const b = [
    { name: 'a', inputSchema: { properties: {}, type: 'object' } },
    { name: 'b', inputSchema: { properties: { a: { type: 'string' }, z: { type: 'number' } }, type: 'object' } },
  ];
  assert.equal(toolCatalogFingerprint(a), toolCatalogFingerprint(b));
});

test('catalog inspection catches malformed market-facing tool definitions', () => {
  const result = inspectToolCatalog([
    { name: 'search', inputSchema: { type: 'object' } },
    { name: 'search', inputSchema: { type: 'object' } },
    { name: 'bad tool name', inputSchema: null },
  ]);
  assert.equal(result.toolCount, 3);
  assert.ok(result.issues.includes('DUPLICATE_TOOL_NAME:search'));
  assert.ok(result.issues.includes('INVALID_TOOL_NAME:bad tool name'));
  assert.ok(result.issues.includes('MISSING_INPUT_SCHEMA:bad tool name'));
  assert.match(result.schemaFingerprint, /^[0-9a-f]{64}$/);
});

test('catalog diff separates additions from breaking removals and schema changes', () => {
  const previous = [
    { name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
    { name: 'status', inputSchema: { type: 'object', properties: {} } },
  ];
  const additive = [...previous, { name: 'new_tool', inputSchema: { type: 'object', properties: {} } }];
  const breaking = [
    { name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' }, locale: { type: 'string' } }, required: ['q', 'locale'] } },
  ];

  assert.deepEqual(diffToolCatalog(previous, additive), {
    changed: true,
    breaking: false,
    removed: [],
    added: ['new_tool'],
    schemaChanged: [],
  });

  assert.deepEqual(diffToolCatalog(previous, breaking), {
    changed: true,
    breaking: true,
    removed: ['status'],
    added: [],
    schemaChanged: ['search'],
  });
});
