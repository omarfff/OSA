import { resolveX402Config } from "./x402.js";

// Public receive-address fallbacks correspond to active mainnet RECEIVE entries
// in the canonical OSA wallet registry. Treasury/provider wallets must never be
// advertised as generic customer receive addresses.
const DEFAULTS = Object.freeze({
  base: "0x559FbeCe1e1517d5cb0eD9FcB6D3383D58cf48d4",
  evm: "0x7A6F08C684f16B74BE7Ff499bB8A24a4EF3cf66b",
  x402: "0xCc34D733F5f387d0128021E636D023472CB5df0c",
  solana: "Fo6hiVofJdgHjnwPqwdBXs22QLd9oLLypiSUyrryinj5",
  solanaProof: "supabase:osa_wallet_registry:4e482f48-463c-4e9e-a5db-ce78818421e7",
  bitcoin: "bc1qzxqxvp9nauw673cdjfj083hasxwvn7uwzqgahm"
});

function requiredAddr(envName, fallback) {
  const value = String(process.env[envName] || "").trim();
  return value || fallback;
}

function optionalAddr(envName) {
  return String(process.env[envName] || "").trim() || null;
}

export function paymentOptions() {
  const base = requiredAddr("OSA_BASE_RECEIVE_ADDRESS", DEFAULTS.base);
  const evm = requiredAddr("OSA_EVM_RECEIVE_ADDRESS", DEFAULTS.evm);
  const x402Receive = requiredAddr("OSA_X402_RECEIVE_ADDRESS", DEFAULTS.x402);

  const solanaOverride = optionalAddr("OSA_SOLANA_RECEIVE_ADDRESS");
  const solanaProofOverride = optionalAddr("OSA_SOLANA_OWNERSHIP_PROOF_REF");
  const solana = solanaOverride || DEFAULTS.solana;
  // A proof tied to the canonical default wallet must never be reused for a
  // different address supplied at runtime.
  const solanaOwnershipProofRef = solanaOverride
    ? solanaProofOverride
    : (solanaProofOverride || DEFAULTS.solanaProof);
  const solanaState = solana && solanaOwnershipProofRef ? "verified_receive" : "ownership_unverified";

  const tron = optionalAddr("OSA_TRON_RECEIVE_ADDRESS");
  const tronState = tron ? "configured" : "not_configured";
  const bitcoin = requiredAddr("OSA_BITCOIN_RECEIVE_ADDRESS", DEFAULTS.bitcoin);
  const x402Config = resolveX402Config(process.env);
  const x402Enabled = Boolean(x402Config);
  const x402Network = x402Config?.network || "eip155:8453";
  const x402Environment = x402Config ? (x402Config.isTestnet ? "testnet" : "mainnet") : "not_configured";

  return {
    version: 4,
    preferred: {
      humanStablecoin: { network: "Base", asset: "USDC", address: base },
      agent: {
        protocol: "x402",
        network: x402Network,
        asset: "USDC",
        status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending",
        environment: x402Environment,
        payTo: x402Config?.payTo || x402Receive
      },
      broadCryptoFallback: { network: "TRON", asset: "USDT", status: tronState, address: tron }
    },
    solana: { status: solanaState, address: solanaState === "verified_receive" ? solana : null, ownershipProofRef: solanaOwnershipProofRef },
    tron: { status: tronState, address: tron },
    directCrypto: [
      { network: "Base", caip2: "eip155:8453", assets: ["USDC", "ETH"], address: base },
      { network: "Ethereum", caip2: "eip155:1", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Arbitrum", caip2: "eip155:42161", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Optimism", caip2: "eip155:10", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Polygon", caip2: "eip155:137", assets: ["USDC", "USDT", "POL"], address: evm },
      ...(solanaState === "verified_receive" ? [{ network: "Solana", caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", assets: ["USDC", "USDT", "SOL"], address: solana }] : []),
      ...(tron ? [{ network: "TRON", assets: ["USDT", "TRX"], address: tron }] : []),
      { network: "Bitcoin", assets: ["BTC"], address: bitcoin, addressType: "P2WPKH" }
    ],
    fiat: {
      card: { status: "pending_merchant_activation" },
      applePay: { status: "pending_merchant_activation" },
      googlePay: { status: "pending_merchant_activation" },
      bankTransfer: { status: "private_on_request", publicBankDetails: false }
    },
    x402: {
      status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending",
      payTo: x402Config?.payTo || x402Receive,
      network: x402Network,
      asset: "USDC",
      environment: x402Environment
    },
    safety: {
      networkSpecific: true,
      registryAlignedFallbacks: true,
      unverifiedNetworksAdvertised: false,
      separateBaseAndGenericEvmReceive: true,
      ownershipProofBoundToAddress: true,
      instruction: "Send only an asset listed for the selected network. Transactions sent on an unsupported network may be unrecoverable.",
      secretsExposed: false
    }
  };
}
