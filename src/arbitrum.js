import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  toHex
} from 'viem';

export const OSA_ROUTE_SCHEMA = 'osa.route.v1';
export const ARBITRUM_NETWORKS = Object.freeze({
  421614: Object.freeze({
    chainId: 421614,
    caip2: 'eip155:421614',
    name: 'Arbitrum Sepolia',
    explorerUrl: 'https://sepolia.arbiscan.io'
  }),
  42161: Object.freeze({
    chainId: 42161,
    caip2: 'eip155:42161',
    name: 'Arbitrum One',
    explorerUrl: 'https://arbiscan.io'
  })
});

const decisionParameters = parseAbiParameters(
  'uint256 chainId, bytes32 providerId, uint8 score, uint8 confidence, bytes32 evidenceHash, uint64 observedAt'
);
const receiptParameters = parseAbiParameters('bytes32 decisionId, address reporter');

function normalizedJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('evidence numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizedJsonValue(item));
  if (typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) normalized[key] = normalizedJsonValue(value[key]);
    }
    return normalized;
  }
  throw new TypeError(`unsupported evidence value: ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizedJsonValue(value));
}

export function parseArbitrumChainId(value = process.env.OSA_ARBITRUM_CHAIN_ID || 421614) {
  const chainId = Number(value);
  if (!Number.isInteger(chainId) || !ARBITRUM_NETWORKS[chainId]) {
    throw new Error('OSA_ARBITRUM_CHAIN_ID must be 421614 (Sepolia) or 42161 (One)');
  }
  return chainId;
}

function boundedPercent(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new Error(`${label} must be an integer between 0 and 100`);
  }
  return number;
}

function unixTimestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error('live.checkedAt must be a valid timestamp');
  }
  return Math.floor(milliseconds / 1000);
}

function cleanOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalAddress(value, label) {
  if (!value) return null;
  if (!isAddress(value, { strict: false })) throw new Error(`${label} must be a valid EVM address`);
  return getAddress(value.toLowerCase());
}

function uint64(value, label) {
  let integer;
  try { integer = BigInt(value); }
  catch { throw new Error(`${label} must be a positive uint64`); }
  if (integer <= 0n || integer > 18_446_744_073_709_551_615n) {
    throw new Error(`${label} must be a positive uint64`);
  }
  return integer;
}

export function computeDecisionId({ chainId, providerId, score, confidence, evidenceHash, observedAt }) {
  return keccak256(encodeAbiParameters(decisionParameters, [
    BigInt(parseArbitrumChainId(chainId)),
    providerId,
    boundedPercent(score, 'score'),
    boundedPercent(confidence, 'confidence'),
    evidenceHash,
    uint64(observedAt, 'observedAt')
  ]));
}

export function computeReceiptId(decisionId, reporter) {
  if (!isAddress(reporter, { strict: false })) throw new Error('reporter must be a valid EVM address');
  return keccak256(encodeAbiParameters(receiptParameters, [decisionId, getAddress(reporter.toLowerCase())]));
}

export function buildArbitrumRouteReceipt(ranking, options = {}) {
  if (!ranking?.endpoint?.url) throw new Error('ranked endpoint URL is required');
  const score = boundedPercent(ranking.score, 'score');
  const confidence = boundedPercent(ranking.confidence, 'confidence');
  const chainId = parseArbitrumChainId(options.chainId);
  const network = ARBITRUM_NETWORKS[chainId];
  const observedAt = unixTimestamp(ranking.live?.checkedAt);
  const method = String(ranking.endpoint.method || 'GET').toUpperCase();
  const providerId = keccak256(toHex(`${method}:${ranking.endpoint.url}`));

  const evidence = {
    schemaVersion: OSA_ROUTE_SCHEMA,
    decision: {
      intent: String(options.intent || ''),
      maxPriceUsd: cleanOptionalNumber(options.maxPrice),
      evaluated: Number(ranking.evaluated || 0),
      candidates: Number(ranking.candidates || 0),
      totalCandidates: Number(ranking.totalCandidates || 0),
      truncated: Boolean(ranking.truncated)
    },
    selection: {
      endpointId: String(ranking.endpoint.id || ''),
      method,
      url: String(ranking.endpoint.url),
      priceUsd: cleanOptionalNumber(ranking.endpoint.priceUsd),
      score,
      confidence,
      reasonCodes: Array.isArray(ranking.reasonCodes) ? ranking.reasonCodes.map(String) : []
    },
    verification: {
      checkedAt: String(ranking.live.checkedAt),
      ok: Boolean(ranking.live.ok),
      status: cleanOptionalNumber(ranking.live.status),
      latencyMs: cleanOptionalNumber(ranking.live.latencyMs),
      schemaSignature: ranking.live.schemaSignature ?? null,
      paymentSignature: ranking.live.paymentSignature ?? null,
      transactionEvidence: cleanOptionalNumber(ranking.live.transactionEvidence)
    }
  };

  const evidenceJson = canonicalJson(evidence);
  const evidenceHash = keccak256(toHex(evidenceJson));
  const decisionId = computeDecisionId({ chainId, providerId, score, confidence, evidenceHash, observedAt });
  const configuredRegistry = options.registryAddress ?? process.env.OSA_ARBITRUM_REGISTRY;
  const registryAddress = optionalAddress(configuredRegistry, 'OSA_ARBITRUM_REGISTRY');
  const configuredReporter = options.reporter ?? process.env.OSA_ARBITRUM_REPORTER;
  const reporter = optionalAddress(configuredReporter, 'OSA_ARBITRUM_REPORTER');

  return {
    schemaVersion: OSA_ROUTE_SCHEMA,
    network,
    registryAddress,
    providerId,
    evidenceHash,
    decisionId,
    receiptId: reporter ? computeReceiptId(decisionId, reporter) : null,
    observedAt,
    evidence,
    evidenceJson,
    contractCall: {
      functionName: 'recordRouteReceipt',
      args: [providerId, score, confidence, evidenceHash, observedAt],
      value: '0'
    }
  };
}
