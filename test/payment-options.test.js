import test from "node:test";
import assert from "node:assert/strict";
import { paymentOptions } from "../src/payment-options.js";

test("customer checkout advertises one product and only verifier-backed pilot networks", () => {
  const options = paymentOptions();
  assert.equal(options.version, 6);
  assert.equal(options.product.sku, "OSA-MCP-RELIABILITY-30D");
  assert.equal(options.product.amount, 79);
  assert.equal(options.experience.humanDefault, "invoice_request");
  assert.equal(options.experience.instantOption, "pilot_usdc");
  assert.deepEqual(options.directCrypto.map((entry) => entry.network), ["Base", "Polygon", "Arbitrum"]);
  assert.equal(options.directCrypto.every((entry) => entry.assets.length === 1 && entry.assets[0] === "USDC"), true);
  assert.equal(options.directCrypto.every((entry) => entry.address === "0xCc34D733F5f387d0128021E636D023472CB5df0c"), true);
  assert.equal(options.directCrypto.some((entry) => entry.network === "Solana"), false);
  assert.equal(options.directCrypto.some((entry) => entry.network === "TRON"), false);
  assert.equal(options.directCrypto.some((entry) => entry.network === "Bitcoin"), false);
});

test("verified wallet inventory is kept separate from checkout readiness", () => {
  const oldSolana = process.env.OSA_SOLANA_RECEIVE_ADDRESS;
  const oldProof = process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
  try {
    delete process.env.OSA_SOLANA_RECEIVE_ADDRESS;
    delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
    let options = paymentOptions();
    assert.equal(options.walletInventory.solana.status, "verified_receive");
    assert.equal(options.walletInventory.solana.checkoutStatus, "not_enabled_for_pilot");

    process.env.OSA_SOLANA_RECEIVE_ADDRESS = "11111111111111111111111111111111";
    delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
    options = paymentOptions();
    assert.equal(options.walletInventory.solana.status, "ownership_unverified");
    assert.equal(options.walletInventory.solana.address, null);
  } finally {
    oldSolana === undefined ? delete process.env.OSA_SOLANA_RECEIVE_ADDRESS : process.env.OSA_SOLANA_RECEIVE_ADDRESS = oldSolana;
    oldProof === undefined ? delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF : process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF = oldProof;
  }
});

test("invoice requests are not represented as payment and inactive fiat is hidden", () => {
  const options = paymentOptions();
  assert.equal(options.fiat.invoiceRequest.status, "request_ready");
  assert.equal(options.fiat.invoiceRequest.publicBankDetails, false);
  assert.equal(options.fiat.card.advertised, false);
  assert.equal(options.fiat.applePay.advertised, false);
  assert.equal(options.fiat.mada.advertised, false);
  assert.equal(options.safety.tapDisabledByOwner, true);
  assert.equal(options.safety.invoiceRequestIsNotPayment, true);
  assert.equal(options.safety.fulfillmentRequiresIndependentPaymentEvidence, true);
  assert.equal(options.safety.buyerWalletCustody, false);
  assert.equal(options.safety.secretsExposed, false);
});

test("x402 public metadata matches runtime configuration", () => {
  const keys = ["OSA_PAY_TO", "OSA_NETWORK", "OSA_FACILITATOR_URL", "OSA_PRICE_USD"];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.OSA_PAY_TO = "0x1111111111111111111111111111111111111111";
    delete process.env.OSA_NETWORK;
    delete process.env.OSA_FACILITATOR_URL;
    delete process.env.OSA_PRICE_USD;
    let options = paymentOptions();
    assert.equal(options.x402.status, "enabled");
    assert.equal(options.x402.environment, "testnet");
    process.env.OSA_PAY_TO = "   ";
    options = paymentOptions();
    assert.equal(options.x402.status, "wallet_ready_facilitator_pending");
    assert.equal(options.x402.payTo, "0xCc34D733F5f387d0128021E636D023472CB5df0c");
  } finally {
    for (const key of keys) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key];
  }
});
