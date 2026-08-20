export async function buildPaymentMiddleware() {
  const payTo = process.env.OSA_PAY_TO;
  if (!payTo) return null;

  const [{ paymentMiddleware }, { HTTPFacilitatorClient, x402ResourceServer }, evm, bazaar] = await Promise.all([
    import("@x402/express"),
    import("@x402/core/server"),
    import("@x402/evm/exact/server"),
    import("@x402/extensions/bazaar")
  ]);

  const network = process.env.OSA_NETWORK || "eip155:84532";
  const facilitatorUrl = process.env.OSA_FACILITATOR_URL || "https://x402.org/facilitator";
  const price = `$${process.env.OSA_PRICE_USD || "0.01"}`;
  const rawClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const client = bazaar.withBazaar ? bazaar.withBazaar(rawClient) : rawClient;
  const server = new x402ResourceServer(client);

  if (typeof evm.registerExactEvmScheme === "function") evm.registerExactEvmScheme(server);
  else if (evm.ExactEvmScheme) server.register(network, new evm.ExactEvmScheme());
  if (bazaar.bazaarResourceServerExtension && typeof server.registerExtension === "function") {
    server.registerExtension(bazaar.bazaarResourceServerExtension);
  }

  const discovery = (name, description) => bazaar.declareDiscoveryExtension ? bazaar.declareDiscoveryExtension({
    input: {},
    inputSchema: { properties: { intent: { type: "string" }, max_price: { type: "number" } } },
    output: { example: { endpoint: "https://example.com/api", score: 92, confidence: 88, alternatives: [], reasonCodes: ["STABLE"] } },
    toolName: name,
    description
  }) : {};

  const routes = {
    "GET /best": {
      accepts: [{ scheme: "exact", price, network, payTo }],
      description: "Return the highest-trust API/agent endpoint for an intent and optional max price.",
      mimeType: "application/json",
      extensions: { ...discovery("osa_best", "Select the best trusted endpoint") }
    },
    "GET /score": {
      accepts: [{ scheme: "exact", price, network, payTo }],
      description: "Live-verify an endpoint and return OSA TrustScore with reason codes.",
      mimeType: "application/json",
      extensions: { ...discovery("osa_score", "Score an endpoint before purchase") }
    }
  };

  return paymentMiddleware(routes, server);
}
