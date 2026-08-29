import { resolveX402Config } from "./x402.js";

const DEFAULTS = Object.freeze({
  evm: "0x04e8930d13A6f6A258aA1488eeFa500ca8Cd9ebB",
  tron: "TXzMju2v6QoevWaMkPaSwEuN6HbFibWW7o",
  bitcoin: "bc1qpg5zxqps9038vfgpjganvrf5pvq8ykk29ft9eq"
});

function addr(envName, fallback) {
  const value = String(process.env[envName] || "").trim();
  return value || fallback;
}

export function paymentOptions() {
  const evm = addr("OSA_EVM_RECEIVE_ADDRESS", DEFAULTS.evm);
  const solana = String(process.env.OSA_SOLANA_RECEIVE_ADDRESS || "").trim();
  const solanaOwnershipProofRef = String(process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF || "").trim();
  const solanaState = !solana ? "not_configured" : !solanaOwnershipProofRef ? "ownership_unverified" : "verified_receive";
  const tron = addr("OSA_TRON_RECEIVE_ADDRESS", DEFAULTS.tron);
  const bitcoin = addr("OSA_BITCOIN_RECEIVE_ADDRESS", DEFAULTS.bitcoin);
  const x402Config = resolveX402Config(process.env);
  const x402Enabled = Boolean(x402Config);
  const x402Network = x402Config?.network || "eip155:8453";
  const x402Environment = x402Config ? (x402Config.isTestnet ? "testnet" : "mainnet") : "not_configured";

  return {
    version: 2,
    preferred: {
      humanStablecoin: { network: "Base", asset: "USDC", address: evm },
      agent: { protocol: "x402", network: x402Network, asset: "USDC", status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending", environment: x402Environment },
      broadCryptoFallback: { network: "TRON", asset: "USDT", address: tron }
    },
    solana: { status: solanaState, address: solanaState === "verified_receive" ? solana : null },
    directCrypto: [
      { network: "Base", caip2: "eip155:8453", assets: ["USDC", "ETH"], address: evm },
      { network: "Ethereum", caip2: "eip155:1", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Arbitrum", caip2: "eip155:42161", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Optimism", caip2: "eip155:10", assets: ["USDC", "USDT", "ETH"], address: evm },
      { network: "Polygon", caip2: "eip155:137", assets: ["USDC", "USDT", "POL"], address: evm },
      ...(solanaState === "verified_receive" ? [{ network: "Solana", caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", assets: ["USDC", "USDT", "SOL"], address: solana }] : []),
      { network: "TRON", assets: ["USDT", "TRX"], address: tron },
      { network: "Bitcoin", assets: ["BTC"], address: bitcoin, addressType: "P2WPKH" }
    ],
    fiat: {
      card: { status: "pending_merchant_activation" },
      applePay: { status: "pending_merchant_activation" },
      bankTransfer: { status: "private_on_request", publicBankDetails: false }
    },
    x402: {
      status: x402Enabled ? "enabled" : "wallet_ready_facilitator_pending",
      payTo: x402Config?.payTo || evm,
      network: x402Network,
      asset: "USDC",
      environment: x402Environment
    },
    safety: {
      networkSpecific: true,
      instruction: "Send only an asset listed for the selected network. Transactions sent on an unsupported network may be unrecoverable.",
      secretsExposed: false
    }
  };
}
