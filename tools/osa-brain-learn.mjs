import { appendExperience } from './osa-brain.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) {
  process.stderr.write('experience_json_required\n');
  process.exit(2);
}
try {
  const event = JSON.parse(input);
  const saved = await appendExperience(event);
  process.stdout.write(JSON.stringify({ ok: true, saved }) + '\n');
} catch (err) {
  process.stderr.write(String(err?.message || err) + '\n');
  process.exit(1);
}
