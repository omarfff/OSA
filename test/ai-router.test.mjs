import test from 'node:test';
import assert from 'node:assert/strict';
import { providerStatus, routeChat } from '../tools/ai-router.mjs';

test('provider status never exposes API key values', () => {
  const status = providerStatus({
    OSA_AI_REMOTE_URL: 'https://api.example.com',
    OSA_AI_REMOTE_MODEL: 'model-x',
    OSA_AI_REMOTE_API_KEY: 'secret-value',
    OSA_AI_PROVIDER_ORDER: 'openai_compatible,ollama',
  });
  assert.equal(status.providers.openai_compatible.configured, true);
  assert.equal(status.providers.openai_compatible.api_key_present, true);
  assert.equal(JSON.stringify(status).includes('secret-value'), false);
});

test('router falls back from failed local model to remote compatible provider', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('127.0.0.1')) return { ok: false, status: 503, async json() { return {}; } };
    return {
      ok: true,
      status: 200,
      async json() { return { choices: [{ message: { content: 'remote answer' } }] }; },
    };
  };
  const env = {
    OSA_AI_PROVIDER_ORDER: 'ollama,openai_compatible',
    OSA_OLLAMA_URL: 'http://127.0.0.1:11434',
    OSA_BRAIN_MODEL: 'local-test',
    OSA_AI_REMOTE_URL: 'https://api.example.com',
    OSA_AI_REMOTE_MODEL: 'remote-test',
    OSA_AI_REMOTE_API_KEY: 'not-logged',
  };
  const result = await routeChat({ messages: [{ role: 'user', content: 'hello' }], fetchImpl, env, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openai_compatible');
  assert.equal(result.text, 'remote answer');
  assert.equal(result.failures[0].provider, 'ollama');
  assert.equal(calls.length, 2);
});

test('router reports clean failure when no remote provider is configured and local fails', async () => {
  const result = await routeChat({
    messages: [{ role: 'user', content: 'hello' }],
    env: { OSA_AI_PROVIDER_ORDER: 'ollama,gemini', OSA_OLLAMA_URL: 'http://127.0.0.1:11434' },
    fetchImpl: async () => ({ ok: false, status: 500, async json() { return {}; } }),
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'all_ai_providers_failed');
  assert.equal(result.failures.some((x) => x.provider === 'gemini' && x.error === 'not_configured'), true);
});
