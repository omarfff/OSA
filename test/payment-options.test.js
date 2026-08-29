import test from "node:test";
import assert from "node:assert/strict";
import { paymentOptions } from "../src/payment-options.js";
const ADDRESS = "11111111111111111111111111111111";
const solanaEntry = (o) => o.directCrypto.find((e) => e.network === "Solana");
test("Solana receive rail stays hidden until ownership proof exists", () => {
  const oldAddress=process.env.OSA_SOLANA_RECEIVE_ADDRESS, oldProof=process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
  try {
    delete process.env.OSA_SOLANA_RECEIVE_ADDRESS; delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF;
    let o=paymentOptions(); assert.equal(o.solana.status,"not_configured"); assert.equal(o.solana.address,null); assert.equal(solanaEntry(o),undefined);
    process.env.OSA_SOLANA_RECEIVE_ADDRESS=ADDRESS; o=paymentOptions(); assert.equal(o.solana.status,"ownership_unverified"); assert.equal(o.solana.address,null); assert.equal(solanaEntry(o),undefined);
    process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF="wallet-audit:verified"; o=paymentOptions(); assert.equal(o.solana.status,"verified_receive"); assert.equal(o.solana.address,ADDRESS); assert.equal(solanaEntry(o)?.address,ADDRESS);
  } finally {
    oldAddress===undefined?delete process.env.OSA_SOLANA_RECEIVE_ADDRESS:process.env.OSA_SOLANA_RECEIVE_ADDRESS=oldAddress;
    oldProof===undefined?delete process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF:process.env.OSA_SOLANA_OWNERSHIP_PROOF_REF=oldProof;
  }
});


test("x402 public metadata matches runtime configuration", () => {
  const keys = ["OSA_PAY_TO","OSA_NETWORK","OSA_FACILITATOR_URL","OSA_PRICE_USD"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.OSA_PAY_TO = "0x1111111111111111111111111111111111111111";
    delete process.env.OSA_NETWORK; delete process.env.OSA_FACILITATOR_URL; delete process.env.OSA_PRICE_USD;
    let o = paymentOptions();
    assert.equal(o.x402.status, "enabled");
    assert.equal(o.x402.network, "eip155:84532");
    assert.equal(o.x402.environment, "testnet");
    assert.equal(o.preferred.agent.network, "eip155:84532");
    process.env.OSA_PAY_TO = "   ";
    o = paymentOptions();
    assert.equal(o.x402.status, "wallet_ready_facilitator_pending");
    assert.equal(o.x402.environment, "not_configured");
  } finally {
    for (const k of keys) old[k] === undefined ? delete process.env[k] : process.env[k] = old[k];
  }
});
