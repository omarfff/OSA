# Python LLM integration gateway reference

This dependency-free reference demonstrates a narrow production boundary around
external LLM providers. It is a portfolio implementation, not a claim that a
customer's private mobile application has already been integrated.

The gateway provides:

- strict validation of messages, tools, structured responses, and usage data;
- bounded provider timeouts, retries, exponential backoff, and ordered fallback;
- an allowlist for tool/function calls;
- bounded conversational memory;
- telemetry events containing outcome codes and latency, never prompts, provider
  exception messages, credentials, or response content;
- provider-neutral interfaces suitable for OpenAI-compatible, other hosted, or
  self-hosted adapters.

Run the reference tests:

```bash
python3 -m unittest discover -s examples/python_llm_gateway -p 'test_*.py'
```

Real provider adapters should load credentials from the server environment or a
secret manager and translate the vendor response into the documented structured
mapping. They should never return keys or raw authentication errors to clients.
