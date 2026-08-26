import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import {
  ARBITRUM_NETWORKS,
  buildArbitrumRouteReceipt,
  canonicalJson,
  computeDecisionId,
  computeReceiptId,
  parseArbitrumChainId
} from '../src/arbitrum.js';
import { compileRouteRegistry, routeRegistrySource } from '../scripts/lib/compile-route-registry.mjs';

const ranking = {
  endpoint: {
    id: 'weather-primary',
    name: 'Weather Primary',
    url: 'https://api.example.com/weather',
    method: 'GET',
    priceUsd: 0.02
  },
  score: 91,
  confidence: 84,
  reasonCodes: ['STABLE'],
  live: {
    checkedAt: '2026-08-26T12:42:00.000Z',
    ok: true,
    status: 200,
    latencyMs: 183,
    schemaSignature: 'forecast:object|location:string',
    paymentSignature: 'usdc:0.02',
    transactionEvidence: 47
  },
  evaluated: 3,
  candidates: 3,
  totalCandidates: 5,
  truncated: false,
  alternatives: []
};

test('canonical JSON is stable across object insertion order', () => {
  assert.equal(
    canonicalJson({ z: 3, nested: { b: 2, a: 1 }, a: ['x', true] }),
    canonicalJson({ a: ['x', true], nested: { a: 1, b: 2 }, z: 3 })
  );
  assert.throws(() => canonicalJson({ bad: Infinity }), /finite/);
});

test('builds a deterministic Arbitrum Sepolia decision commitment', () => {
  const options = { intent: 'weather', maxPrice: 0.05, chainId: 421614 };
  const first = buildArbitrumRouteReceipt(ranking, options);
  const second = buildArbitrumRouteReceipt(structuredClone(ranking), options);
  assert.deepEqual(first, second);
  assert.equal(first.network.caip2, 'eip155:421614');
  assert.match(first.providerId, /^0x[0-9a-f]{64}$/);
  assert.match(first.evidenceHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.decisionId, /^0x[0-9a-f]{64}$/);
  assert.equal(first.receiptId, null);
  assert.equal(first.contractCall.args[4], 1787748120);
  assert.equal(buildArbitrumRouteReceipt({
    ...ranking,
    endpoint: { ...ranking.endpoint, priceUsd: null },
    live: { ...ranking.live, status: null, transactionEvidence: undefined }
  }, options).evidence.selection.priceUsd, null);
  assert.deepEqual(JSON.parse(first.evidenceJson), first.evidence);
  assert.equal(computeDecisionId({
    chainId: first.network.chainId,
    providerId: first.providerId,
    score: ranking.score,
    confidence: ranking.confidence,
    evidenceHash: first.evidenceHash,
    observedAt: first.observedAt
  }), first.decisionId);
});

test('binds each onchain receipt to its reporter', () => {
  const reporterA = '0x00000000000000000000000000000000000000A1';
  const reporterB = '0x00000000000000000000000000000000000000B2';
  const receipt = buildArbitrumRouteReceipt(ranking, { chainId: 421614, reporter: reporterA });
  assert.equal(receipt.receiptId, computeReceiptId(receipt.decisionId, reporterA));
  assert.notEqual(receipt.receiptId, computeReceiptId(receipt.decisionId, reporterB));
});

test('rejects unsupported networks, invalid percentages and addresses', () => {
  assert.equal(parseArbitrumChainId('42161'), 42161);
  assert.equal(ARBITRUM_NETWORKS[42161].name, 'Arbitrum One');
  assert.throws(() => parseArbitrumChainId(1), /421614/);
  assert.throws(() => buildArbitrumRouteReceipt({ ...ranking, score: 101 }, { chainId: 421614 }), /score/);
  assert.throws(() => buildArbitrumRouteReceipt(ranking, { chainId: 421614, registryAddress: 'not-an-address' }), /registry/i);
  assert.throws(() => computeReceiptId('0x' + '11'.repeat(32), 'not-an-address'), /reporter/);
  assert.throws(() => computeDecisionId({
    chainId: 421614,
    providerId: '0x' + '11'.repeat(32),
    score: 50,
    confidence: 50,
    evidenceHash: '0x' + '22'.repeat(32),
    observedAt: -1
  }), /uint64/);
});

test('Solidity registry compiles and exposes the receipt interface', () => {
  const artifact = compileRouteRegistry();
  assert.match(artifact.compilerVersion, /^0\.8\.36/);
  assert.ok(artifact.bytecode.length > 1000);
  const names = new Set(artifact.abi.map((entry) => entry.name).filter(Boolean));
  for (const name of ['computeDecisionId', 'computeReceiptId', 'recordRouteReceipt', 'routeReceipts', 'RouteReceiptRecorded']) {
    assert.equal(names.has(name), true, name);
  }
  const receipt = buildArbitrumRouteReceipt(ranking, { chainId: 421614 });
  assert.match(encodeFunctionData({
    abi: artifact.abi,
    functionName: receipt.contractCall.functionName,
    args: [
      receipt.contractCall.args[0],
      receipt.contractCall.args[1],
      receipt.contractCall.args[2],
      receipt.contractCall.args[3],
      BigInt(receipt.contractCall.args[4])
    ]
  }), /^0x[0-9a-f]+$/);
  assert.match(routeRegistrySource(), /block\.chainid[\s\S]*providerId[\s\S]*evidenceHash[\s\S]*observedAt/);
});
