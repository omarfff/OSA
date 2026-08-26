import test from "node:test";
import assert from "node:assert/strict";
import { resolveX402Config, X402_PROTECTED_ROUTES } from "../src/x402.js";

const evmAddress = "0x1111111111111111111111111111111111111111";

test("x402 remains disabled without a receiving address", () => {
  assert.equal(resolveX402Config({}), null);
  assert.deepEqual(X402_PROTECTED_ROUTES, ['GET /best', 'GET /route', 'GET /score']);
});

test("x402 testnet defaults are explicit and valid", () => {
  const cfg = resolveX402Config({ OSA_PAY_TO: evmAddress });
  assert.equal(cfg.network, "eip155:84532");
  assert.equal(cfg.facilitatorUrl, "https://x402.org/facilitator");
  assert.equal(cfg.price, "$0.01");
  assert.equal(cfg.isTestnet, true);
});

test("x402 refuses mainnet with the testnet-only default facilitator", () => {
  assert.throws(
    () => resolveX402Config({ OSA_PAY_TO: evmAddress, OSA_NETWORK: "eip155:8453" }),
    /explicit production facilitator/
  );
});

test("x402 accepts Base mainnet with an explicit production facilitator", () => {
  const cfg = resolveX402Config({
    OSA_PAY_TO: evmAddress,
    OSA_NETWORK: "eip155:8453",
    OSA_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
    OSA_PRICE_USD: "0.01"
  });
  assert.equal(cfg.network, "eip155:8453");
  assert.equal(cfg.isTestnet, false);
});

test("x402 rejects malformed EVM destinations and non-positive prices", () => {
  assert.throws(
    () => resolveX402Config({ OSA_PAY_TO: "not-an-address", OSA_NETWORK: "eip155:84532" }),
    /20-byte EVM address/
  );
  assert.throws(
    () => resolveX402Config({ OSA_PAY_TO: evmAddress, OSA_PRICE_USD: "0" }),
    /finite positive number/
  );
});
