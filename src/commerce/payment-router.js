import { paymentOptions } from '../payment-options.js';
import { nowPaymentsReady } from '../payments/nowpayments.js';

export function paymentRouterStatus(env = process.env) {
  const options = paymentOptions();
  return {
    version: 1,
    preferredHuman: 'direct_usdc',
    preferredAgent: options.x402.status === 'enabled' && options.x402.environment === 'mainnet' ? 'x402' : 'direct_usdc',
    rails: {
      direct_usdc: {
        status: 'ready',
        network: 'eip155:8453',
        asset: 'USDC',
        address: options.preferred.humanStablecoin.address,
      },
      x402: {
        status: options.x402.status,
        environment: options.x402.environment,
        network: options.x402.network,
        asset: options.x402.asset,
      },
      nowpayments: {
        status: nowPaymentsReady(env) ? 'configured' : 'not_configured',
        activation: 'named_payer_or_checkout_blocker',
        revenueProof: 'verified_ipn_plus_independent_receipt',
      },
    },
  };
}

export function selectPaymentRail({ requestedRail, customerType = 'human', env = process.env } = {}) {
  const status = paymentRouterStatus(env);
  const requested = String(requestedRail || '').trim().toLowerCase();
  if (requested) {
    if (!Object.hasOwn(status.rails, requested)) throw new Error('PAYMENT_RAIL_UNSUPPORTED');
    if (['not_configured', 'wallet_ready_facilitator_pending'].includes(status.rails[requested].status)) throw new Error('PAYMENT_RAIL_NOT_READY');
    if (requested === 'x402' && status.rails.x402.environment !== 'mainnet') throw new Error('PAYMENT_RAIL_NOT_MAINNET');
    return { rail: requested, ...status.rails[requested] };
  }
  const rail = customerType === 'agent' ? status.preferredAgent : status.preferredHuman;
  return { rail, ...status.rails[rail] };
}
