import test from 'node:test';
import assert from 'node:assert/strict';
import { providerStatus, routeChat } from '../tools/ai-router.mjs';

test('provider status never exposes API key values', () => {
  const status = providerStatus({
    OSA_AI_REMOTE_URL: 'https://api.example.com',
    OSA_AI_REMOTE_MODEL: 'model-x',
    OSA_AI_REMOTE_API_KEY: 'secret-value',
    OSA_ANTHROPIC_API_KEY: 'anthropic-secret-value',
    OSA_ANTHROPIC_MODEL: 'claude-test',
    OSA_AI_PROVIDER_ORDER: 'anthropic,openai_compatible,ollama',
  });
  assert.equal(status.providers.openai_compatible.configured, true);
  assert.equal(status.providers.openai_compatible.api_key_present, true);
  assert.equal(status.providers.anthropic.configured, true);
  assert.equal(status.providers.anthropic.api_key_present, true);
  assert.equal(JSON.stringify(status).includes('secret-value'), false);
  assert.equal(JSON.stringify(status).includes('anthropic-secret-value'), false);
});

test('router can call Anthropic and preserves system prompt separately', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { content: [{ type: 'text', text: 'claude answer' }] };
      },
    };
  };
  const env = {
    OSA_AI_PROVIDER_ORDER: 'anthropic',
    OSA_ANTHROPIC_API_KEY: 'not-logged',
    OSA_ANTHROPIC_MODEL: 'claude-test',
  };
  const result = await routeChat({
    messages: [
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'hello' },
    ],
    fetchImpl,
    env,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.text, 'claude answer');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.system, 'system instructions');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(seen[0].init.headers['x-api-key'], 'not-logged');
});

test('router falls back from failed local model to Anthropic', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('127.0.0.1')) return { ok: false, status: 503, async json() { return {}; } };
    return {
      ok: true,
      status: 200,
      async json() { return { content: [{ type: 'text', text: 'claude fallback' }] }; },
    };
  };
  const env = {
    OSA_AI_PROVIDER_ORDER: 'ollama,anthropic',
    OSA_OLLAMA_URL: 'http://127.0.0.1:11434',
    OSA_BRAIN_MODEL: 'local-test',
    OSA_ANTHROPIC_API_KEY: 'not-logged',
    OSA_ANTHROPIC_MODEL: 'claude-test',
  };
  const result = await routeChat({ messages: [{ role: 'user', content: 'hello' }], fetchImpl, env, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.text, 'claude fallback');
  assert.equal(result.failures[0].provider, 'ollama');
  assert.equal(calls.length, 2);
});

test('router falls back from failed local model to remote compatible provider', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
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
    env: { OSA_AI_PROVIDER_ORDER: 'ollama,anthropic,gemini', OSA_OLLAMA_URL: 'http://127.0.0.1:11434' },
    fetchImpl: async () => ({ ok: false, status: 500, async json() { return {}; } }),
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'all_ai_providers_failed');
  assert.equal(result.failures.some((x) => x.provider === 'anthropic' && x.error === 'not_configured'), true);
  assert.equal(result.failures.some((x) => x.provider === 'gemini' && x.error === 'not_configured'), true);
});
