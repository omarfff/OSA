const base = process.env.PSYCHIATRY_BRAIN_LOCAL_URL || 'http://127.0.0.1:8791';
const count = Math.max(1, Math.min(6, Number(process.argv[2] || 3)));

async function generateOne() {
  const response = await fetch(`${base}/visuals/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ auto: true, language: 'bilingual' }),
    signal: AbortSignal.timeout(120_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `visual_http_${response.status}`);
  return body;
}

const results = [];
for (let i = 0; i < count; i += 1) {
  try {
    const result = await generateOne();
    results.push({ ok: true, accepted: result.accepted, id: result.metadata?.id || null, target: result.metadata?.topic || result.target?.topic || null, qaScore: result.metadata?.qaScore || result.score || null });
  } catch (err) {
    results.push({ ok: false, error: String(err?.message || err) });
  }
}

process.stdout.write(`${JSON.stringify({ ok: results.some((x) => x.ok), generated: results.filter((x) => x.accepted).length, attempts: results.length, results })}\n`);
if (!results.some((x) => x.ok)) process.exitCode = 1;
