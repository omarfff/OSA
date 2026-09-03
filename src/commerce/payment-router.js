import { paymentOptions } from '../payment-options.js';
import { nowPaymentsMissingConfig, nowPaymentsReady } from '../payments/nowpayments.js';

function stripeRuntimeStatus(env = process.env) {
  const secret = String(env.STRIPE_SECRET_KEY || '').trim();
  const webhook = String(env.STRIPE_WEBHOOK_SECRET || env.STRIPE_ENDPOINT_SECRET || '').trim();
  const missing = [];
  if (!/^sk_live_/.test(secret)) missing.push('live_secret_key');
  if (!/^whsec_/.test(webhook)) missing.push('webhook_secret');
  if (missing.length) {
    return {
      status: secret && /^sk_test_/.test(secret) ? 'test_only' : 'not_configured',
      mode: secret && /^sk_test_/.test(secret) ? 'test' : 'unconfigured',
      missing,
    };
  }
  return { status: 'configured', mode: 'live', missing: [] };
}

export function paymentRouterStatus(env = process.env) {
  const options = paymentOptions();
  const nowMissing = nowPaymentsMissingConfig(env);
  const stripe = stripeRuntimeStatus(env);
  return {
    version: 2,
    preferredHuman: 'direct_usdc',
    preferredAgent: options.x402.status === 'enabled' && options.x402.environment === 'mainnet' ? 'x402' : 'direct_usdc',
    settlementPreference: ['USDC', 'USDT', 'BTC'],
    rails: {
      direct_usdc: {
        status: 'ready',
        network: 'eip155:8453',
        asset: 'USDC',
        address: options.preferred.humanStablecoin.address,
        revenueProof: 'verified_chain_receipt_plus_matching_crypto_order',
      },
      x402: {
        status: options.x402.status,
        environment: options.x402.environment,
        network: options.x402.network,
        asset: options.x402.asset,
        payTo: options.x402.payTo,
        revenueProof: 'mainnet_settlement_tx_plus_settlement_success',
      },
      nowpayments: {
        status: nowPaymentsReady(env) ? 'configured' : 'not_configured',
        missing: nowMissing,
        activation: 'merchant_api_key_ipn_secret_https_callback',
        currencyDiscovery: nowPaymentsReady(env) ? 'dynamic_api' : 'blocked_until_configured',
        revenueProof: 'verified_ipn_finished_plus_independent_receipt',
      },
      stripe: {
        ...stripe,
        activation: 'live_merchant_account_plus_webhook',
        supports: ['card', 'apple_pay', 'google_pay'],
        revenueProof: 'live_payment_success_plus_independent_stripe_retrieval',
      },
    },
    acceptance: {
      directCrypto: options.directCrypto,
      fiat: {
        ...options.fiat,
        stripe: { status: stripe.status, mode: stripe.mode },
      },
      agent: options.preferred.agent,
      broadCryptoAggregator: {
        provider: 'nowpayments',
        status: nowPaymentsReady(env) ? 'configured' : 'not_configured',
      },
    },
    safety: {
      neverCountTestModeAsRevenue: true,
      neverAdvertiseUnverifiedReceiveNetwork: true,
      ownerMoneyMovementRequiresApproval: true,
    },
  };
}

export function selectPaymentRail({ requestedRail, customerType = 'human', env = process.env } = {}) {
  const status = paymentRouterStatus(env);
  const requested = String(requestedRail || '').trim().toLowerCase();
  if (requested) {
    if (!Object.hasOwn(status.rails, requested)) throw new Error('PAYMENT_RAIL_UNSUPPORTED');
    if (['not_configured', 'wallet_ready_facilitator_pending', 'test_only'].includes(status.rails[requested].status)) throw new Error('PAYMENT_RAIL_NOT_READY');
    if (requested === 'x402' && status.rails.x402.environment !== 'mainnet') throw new Error('PAYMENT_RAIL_NOT_MAINNET');
    return { rail: requested, ...status.rails[requested] };
  }
  const rail = customerType === 'agent' ? status.preferredAgent : status.preferredHuman;
  return { rail, ...status.rails[rail] };
}
