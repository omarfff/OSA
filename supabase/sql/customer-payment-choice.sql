-- Canonical data-plane state for the single $79 human checkout.
-- Safe to re-run: rows are addressed by stable rail keys and product SKUs.

begin;

update public.payment_products
set active = false,
    updated_at = now()
where sku in ('agent-100', 'osa-credits-100');

update public.payment_products
set active = true,
    updated_at = now()
where sku = 'pilot-30d';

update osa_payments.rails
set enabled = false,
    production_ready = false,
    status_reason = 'Retired from public checkout to enforce the single $79 pilot offer.',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'retired', true,
      'retired_reason', 'single_product_checkout'
    ),
    updated_at = now()
where rail_key in ('direct_usdc', 'gumroad_hosted', 'btc_invoice');

update osa_payments.rails
set enabled = true,
    production_ready = true,
    audience = 'human',
    method = 'invoice_bank_transfer_request',
    provider = 'manual',
    networks = array['private_reconciliation'],
    endpoint_url = 'https://pkctqxeydfuiupadaoov.supabase.co/functions/v1/osa-pay',
    proof_type = 'reconciled_bank_settlement',
    status_reason = '$79 invoice-request capture is live. The request is not payment; bank details stay private and fulfillment requires reconciled settlement.',
    capabilities = jsonb_build_object(
      'one_time', true,
      'price_usd', 79,
      'bank_transfer', true,
      'invoice_request', true,
      'automatic_settlement', false
    ),
    metadata = jsonb_build_object(
      'sku', 'pilot-30d',
      'request_is_payment', false,
      'public_bank_details', false,
      'verified_external_payment', false
    ),
    last_verified_at = now(),
    updated_at = now()
where rail_key = 'bank_invoice';

update osa_payments.rails
set enabled = true,
    production_ready = true,
    audience = 'human',
    method = 'direct_crypto',
    provider = 'osa',
    asset = 'USDC',
    networks = array['Base', 'Polygon', 'Arbitrum'],
    endpoint_url = 'https://pkctqxeydfuiupadaoov.supabase.co/functions/v1/osa-pilot-usdc',
    proof_type = 'onchain_receipt',
    status_reason = '$79 pilot checkout supports Base, Polygon, and Arbitrum with independent on-chain verification. Solana is inventory-only until its pilot verifier is implemented.',
    capabilities = jsonb_build_object(
      'one_time', true,
      'price_usd', 79,
      'onchain_verify', true,
      'single_product', true,
      'wallet_agnostic', true
    ),
    metadata = jsonb_build_object(
      'sku', 'pilot-30d',
      'public_offer', 'OSA-MCP-RELIABILITY-30D',
      'verified_external_payment', false
    ),
    last_verified_at = now(),
    updated_at = now()
where rail_key = 'pilot_usdc';

commit;
