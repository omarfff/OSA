function metadataObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nonEmpty(value) {
  return typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined;
}

export function evaluateX402Evidence(row) {
  const metadata = metadataObject(row?.metadata);
  const ok = Boolean(
    row
    && row.environment === 'mainnet'
    && nonEmpty(row.settlement_tx)
    && metadata.settlement_success === true,
  );
  return {
    ok,
    provider: 'x402',
    txHash: ok ? String(row.settlement_tx) : null,
    reason: ok ? 'verified_mainnet_settlement' : 'x402_evidence_incomplete',
  };
}

export function evaluateDirectUsdcEvidence(event, order, { successEventTypes = [] } = {}) {
  const success = new Set(successEventTypes.map((value) => String(value)));
  const eventPaymentId = String(event?.payment_id || '').trim();
  const orderTxHash = String(order?.tx_hash || '').trim();
  const ok = Boolean(
    event
    && event.provider === 'direct_usdc'
    && success.has(String(event.event_type || ''))
    && eventPaymentId
    && Number(event.credits_delta) > 0
    && ['fulfilled', 'pending_claim'].includes(String(event.status || ''))
    && order
    && order.status === 'verified'
    && orderTxHash
    && orderTxHash === eventPaymentId,
  );
  return {
    ok,
    provider: 'direct_usdc',
    txHash: ok ? eventPaymentId : null,
    credits: ok ? Number(event.credits_delta) : 0,
    reason: ok ? 'verified_event_and_matching_order' : 'direct_usdc_evidence_incomplete',
  };
}

export function evaluateNowPaymentsEvidence({ ipnVerified, payment, receipt } = {}) {
  const paymentId = String(payment?.payment_id || '').trim();
  const orderId = String(payment?.order_id || '').trim();
  const receiptPaymentId = String(receipt?.paymentId || '').trim();
  const receiptOrderId = String(receipt?.orderId || '').trim();
  const paid = Number(payment?.actually_paid);
  const receiptAmount = Number(receipt?.amount);
  const identifiersMatch = Boolean(
    (receiptPaymentId && receiptPaymentId === paymentId)
    || (receiptOrderId && receiptOrderId === orderId),
  );
  const ok = Boolean(
    ipnVerified === true
    && paymentId
    && orderId
    && String(payment?.payment_status || '').toLowerCase() === 'finished'
    && Number.isFinite(paid)
    && paid > 0
    && receipt?.verified === true
    && nonEmpty(receipt?.txHash)
    && nonEmpty(receipt?.network)
    && nonEmpty(receipt?.asset)
    && Number.isFinite(receiptAmount)
    && receiptAmount > 0
    && identifiersMatch,
  );
  return {
    ok,
    provider: 'nowpayments',
    txHash: ok ? String(receipt.txHash) : null,
    reason: ok ? 'verified_ipn_plus_independent_receipt' : 'nowpayments_evidence_incomplete',
  };
}

export function canFulfill(evidence) {
  return evidence?.ok === true;
}
