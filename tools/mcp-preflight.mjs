#!/usr/bin/env node
import { mcpPreflight } from '../src/mcp-preflight.js';

function usage() {
  console.error('Usage: npm run mcp:preflight -- https://public-mcp.example/mcp');
  console.error('Public baseline only: this command does not accept credentials, headers, or tool arguments.');
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
  usage();
  process.exitCode = 2;
} else {
  const rawUrl = args[0];
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(JSON.stringify({ ok: false, error: 'INVALID_URL' }));
    process.exitCode = 2;
  }

  if (parsed) {
    if (parsed.username || parsed.password || parsed.searchParams.size > 0 || parsed.hash) {
      console.error(JSON.stringify({ ok: false, error: 'CREDENTIALS_OR_QUERY_NOT_ALLOWED' }));
      process.exitCode = 2;
    } else {
      const result = await mcpPreflight(parsed.href);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok || !result.protocolOk) process.exitCode = result.authRequired ? 3 : 1;
    }
  }
}
