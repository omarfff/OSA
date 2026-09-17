import { paymentOptions } from '../payment-options.js';

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
  const stripe = stripeRuntimeStatus(env);
  return {
    version: 4,
    product: options.product,
    preferredHuman: 'invoice_request',
    preferredInstantHuman: 'pilot_usdc',
    preferredAgent: options.x402.status === 'enabled' && options.x402.environment === 'mainnet' ? 'x402' : 'pilot_usdc',
    rails: {
      invoice_request: {
        status: 'request_ready',
        mode: 'assisted',
        amount: options.product.amount,
        currency: options.product.currency,
        publicBankDetails: false,
        revenueProof: 'reconciled_bank_settlement_plus_matching_invoice',
      },
      pilot_usdc: {
        status: 'ready',
        mode: 'live',
        amount: options.product.amount,
        currency: options.product.currency,
        asset: 'USDC',
        networks: options.directCrypto.map((entry) => entry.network),
        address: options.preferred.humanStablecoin.address,
        revenueProof: 'verified_chain_receipt_plus_matching_pilot_order',
      },
      x402: {
        status: options.x402.status,
        environment: options.x402.environment,
        network: options.x402.network,
        asset: options.x402.asset,
        payTo: options.x402.payTo,
        audience: 'agent',
        revenueProof: 'mainnet_settlement_tx_plus_settlement_success',
      },
      card_wallet: {
        status: 'not_live',
        providerStatus: stripe.status,
        providerMode: stripe.mode,
        missing: stripe.missing,
        advertised: false,
        supports: ['card', 'apple_pay', 'google_pay', 'mada'],
        reason: 'no_live_merchant_rail',
      },
      tap: {
        status: 'disabled_by_owner',
        advertised: false,
        selectable: false,
      },
      legacy_five_dollar_checkout: {
        status: 'retired',
        advertised: false,
        selectable: false,
      },
    },
    customerMethods: options.customerMethods,
    safety: {
      oneHumanProduct: true,
      neverCountRequestAsRevenue: true,
      neverCountTestModeAsRevenue: true,
      neverAdvertiseUnverifiedReceiveNetwork: true,
      neverRouteToUnconfiguredFiat: true,
      ownerMoneyMovementRequiresApproval: true,
    },
  };
}

export function selectPaymentRail({ requestedRail, customerType = 'human', env = process.env } = {}) {
  const status = paymentRouterStatus(env);
  const requested = String(requestedRail || '').trim().toLowerCase();
  if (requested) {
    if (!Object.hasOwn(status.rails, requested)) throw new Error('PAYMENT_RAIL_UNSUPPORTED');
    if (!['ready', 'request_ready', 'enabled'].includes(status.rails[requested].status)) throw new Error('PAYMENT_RAIL_NOT_READY');
    if (requested === 'x402' && status.rails.x402.environment !== 'mainnet') throw new Error('PAYMENT_RAIL_NOT_MAINNET');
    return { rail: requested, ...status.rails[requested] };
  }
  const rail = customerType === 'agent' ? status.preferredAgent : status.preferredHuman;
  return { rail, ...status.rails[rail] };
}
