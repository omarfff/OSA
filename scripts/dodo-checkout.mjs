import { createDodoCheckout, dodoReady } from '../src/payments/dodo.js';

if (!dodoReady()) {
  console.error('Dodo live checkout is not configured: DODO_PAYMENTS_API_KEY and DODO_PRODUCT_ID are required.');
  process.exit(2);
}

try {
  const result = await createDodoCheckout();
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
