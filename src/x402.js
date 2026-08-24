const DEFAULT_TESTNET_FACILITATOR = "https://x402.org/facilitator";
const TESTNET_NETWORKS = new Set([
  "eip155:84532",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "stellar:testnet",
  "aptos:2"
]);

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function resolveX402Config(env = process.env) {
  const payTo = String(env.OSA_PAY_TO || "").trim();
  if (!payTo) return null;

  const network = String(env.OSA_NETWORK || "eip155:84532").trim();
  const facilitatorUrl = String(env.OSA_FACILITATOR_URL || DEFAULT_TESTNET_FACILITATOR).trim();
  const rawPrice = String(env.OSA_PRICE_USD || "0.01").trim();
  const numericPrice = Number(rawPrice);

  if (!network) throw new Error("x402 network is required when OSA_PAY_TO is configured");
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new Error("OSA_PRICE_USD must be a finite positive number");
  }

  if (network.startsWith("eip155:") && !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error("OSA_PAY_TO must be a 20-byte EVM address for eip155 networks");
  }

  let parsed;
  try {
    parsed = new URL(facilitatorUrl);
  } catch {
    throw new Error("OSA_FACILITATOR_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("OSA_FACILITATOR_URL must use HTTPS");

  const isTestnet = TESTNET_NETWORKS.has(network);
  if (!isTestnet && normalizeUrl(facilitatorUrl) === DEFAULT_TESTNET_FACILITATOR) {
    throw new Error("x402 mainnet requires an explicit production facilitator; x402.org/facilitator is testnet-only");
  }

  return {
    payTo,
    network,
    facilitatorUrl,
    price: `$${rawPrice}`,
    isTestnet
  };
}

export async function buildPaymentMiddleware() {
  const config = resolveX402Config();
  if (!config) return null;
  const { payTo, network, facilitatorUrl, price } = config;

  const [{ paymentMiddleware }, { HTTPFacilitatorClient, x402ResourceServer }, evm, bazaar] = await Promise.all([
    import("@x402/express"),
    import("@x402/core/server"),
    import("@x402/evm/exact/server"),
    import("@x402/extensions/bazaar")
  ]);

  const rawClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const client = bazaar.withBazaar ? bazaar.withBazaar(rawClient) : rawClient;
  const server = new x402ResourceServer(client);

  if (typeof evm.registerExactEvmScheme === "function") evm.registerExactEvmScheme(server);
  else if (evm.ExactEvmScheme) server.register(network, new evm.ExactEvmScheme());
  if (bazaar.bazaarResourceServerExtension && typeof server.registerExtension === "function") {
    server.registerExtension(bazaar.bazaarResourceServerExtension);
  }

  const discovery = (name, description) => bazaar.declareDiscoveryExtension ? bazaar.declareDiscoveryExtension({
    input: {},
    inputSchema: { properties: { intent: { type: "string" }, max_price: { type: "number" } } },
    output: { example: { endpoint: "https://example.com/api", score: 92, confidence: 88, alternatives: [], reasonCodes: ["STABLE"] } },
    toolName: name,
    description
  }) : {};

  const routes = {
    "GET /best": {
      accepts: [{ scheme: "exact", price, network, payTo }],
      description: "Return the highest-trust API/agent endpoint for an intent and optional max price.",
      mimeType: "application/json",
      extensions: { ...discovery("osa_best", "Select the best trusted endpoint") }
    },
    "GET /score": {
      accepts: [{ scheme: "exact", price, network, payTo }],
      description: "Live-verify an endpoint and return OSA TrustScore with reason codes.",
      mimeType: "application/json",
      extensions: { ...discovery("osa_score", "Score an endpoint before purchase") }
    }
  };

  return paymentMiddleware(routes, server);
}
