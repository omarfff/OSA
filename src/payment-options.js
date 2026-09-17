import { resolveX402Config } from "./x402.js";

const DEFAULTS = Object.freeze({
  pilotEvm: "0xCc34D733F5f387d0128021E636D023472CB5df0c",
  x402: "0xCc34D733F5f387d0128021E636D023472CB5df0c",
  solana: "Fo6hiVofJdgHjnwPqwdBXs22QLd9oLLypiSUyrryinj5",
  solanaProof: "supabase:osa_wallet_registry:4e482f48-463c-4e9e-a5db-ce78818421e7",
  tron: "TXzMju2v6QoevWaMkPaSwEuN6HbFibWW7o",
  tronProof: "supabase:osa_wallet_registry:3550acc9-d347-443c-a432-4f522a6796a5",
});

const PILOT_NETWORKS = Object.freeze([
  Object.freeze({ network: "Base", caip2: "eip155:8453", asset: "USDC" }),
  Object.freeze({ network: "Polygon", caip2: "eip155:137", asset: "USDC" }),
  Object.freeze({ network: "Arbitrum", caip2: "eip155:42161", asset: "USDC" }),
]);

function requiredAddr(envName, fallback) {
  return String(process.env[envName] || "").trim() || fallback;
}

function inventoryWallet({ addressEnv, proofEnv, addressFallback, proofFallback, network }) {
  const override = String(process.env[addressEnv] || "").trim();
  const proofOverride = String(process.env[proofEnv] || "").trim();
  const address = override || addressFallback;
  const ownershipProofRef = override ? proofOverride : (proofOverride || proofFallback);
  const status = address && ownershipProofRef ? "verified_receive" : "ownership_unverified";
  return {
    network,
    status,
    address: status === "verified_receive" ? address : null,
    ownershipProofRef,
    checkoutStatus: "not_enabled_for_pilot",
  };
}

export function paymentOptions() {
  const pilotAddress = requiredAddr("OSA_PILOT_USDC_RECEIVE_ADDRESS", DEFAULTS.pilotEvm);
  const x402Receive = requiredAddr("OSA_X402_RECEIVE_ADDRESS", DEFAULTS.x402);
  const solana = inventoryWallet({
    addressEnv: "OSA_SOLANA_RECEIVE_ADDRESS",
    proofEnv: "OSA_SOLANA_OWNERSHIP_PROOF_REF",
    addressFallback: DEFAULTS.solana,
    proofFallback: DEFAULTS.solanaProof,
    network: "Solana",
  });
  const tron = inventoryWallet({
    addressEnv: "OSA_TRON_RECEIVE_ADDRESS",
    proofEnv: "OSA_TRON_OWNERSHIP_PROOF_REF",
    addressFallback: DEFAULTS.tron,
    proofFallback: DEFAULTS.tronProof,
    network: "TRON",
  });
  const x402Config = resolveX402Config(process.env);
  const x402Enabled = Boolean(x402Config);
  const x402Network = x402Config?.network || "eip155:8453";
  const x402Environment = x402Config ? (x402Config.isTestnet ? "testnet" : "mainnet") : "not_configured";

  return {
    version: 6,
    product: {
      id: "mcp_reliability_pilot_30d",
      sku: "OSA-MCP-RELIABILITY-30D",
      name: "OSA 30-Day MCP Reliability Pilot",
      amount: 79,
      currency: "USD",
    },
    experience: {
      strategy: "adaptive_single_product",
      humanDefault: "invoice_request",
      instantOption: "pilot_usdc",
      agentDefault: "x402",
      customerCreatesWallet: false,
      customerUsesExistingWallet: true,
    },
    preferred: {
      human: { rail: "invoice_request", status: "request_ready" },
      humanStablecoin: { rail: "pilot_usdc", network: "Base", asset: "USDC", address: pilotAddress },
      agent: {
        rail: "x402",
        protocol: "x402",
        network: x402Network,
        asset: "USDC",
        status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending",
        environment: x402Environment,
        payTo: x402Config?.payTo || x402Receive,
      },
    },
    customerMethods: [
      {
        rail: "invoice_request",
        label: "Invoice / bank transfer",
        status: "request_ready",
        settlement: "reconciled_before_fulfillment",
        publicBankDetails: false,
      },
      {
        rail: "pilot_usdc",
        label: "Pay with a crypto wallet",
        status: "ready",
        asset: "USDC",
        networks: PILOT_NETWORKS.map(({ network }) => network),
        walletCompatibility: "Any wallet or exchange that can send native USDC on the selected network",
        examples: ["Coinbase Wallet", "MetaMask", "Trust Wallet", "Binance Wallet"],
      },
    ],
    directCrypto: PILOT_NETWORKS.map((entry) => ({ ...entry, assets: [entry.asset], address: pilotAddress })),
    walletInventory: { solana, tron },
    fiat: {
      invoiceRequest: { status: "request_ready", publicBankDetails: false },
      card: { status: "not_live", advertised: false },
      applePay: { status: "not_live", advertised: false },
      mada: { status: "not_live", advertised: false },
    },
    x402: {
      status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending",
      payTo: x402Config?.payTo || x402Receive,
      network: x402Network,
      asset: "USDC",
      environment: x402Environment,
    },
    safety: {
      oneHumanProduct: true,
      tapDisabledByOwner: true,
      staleFiveDollarSkuAdvertised: false,
      onlyVerifierBackedNetworksAdvertised: true,
      invoiceRequestIsNotPayment: true,
      fulfillmentRequiresIndependentPaymentEvidence: true,
      buyerWalletCustody: false,
      secretsExposed: false,
      instruction: "Use only native USDC on the selected network. A request, wallet connection, page view, or transaction hash alone is not payment proof.",
    },
  };
}
