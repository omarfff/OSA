import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const KNOWLEDGE_ROOT = path.join(ROOT, 'knowledge');

function assertInsideKnowledge(candidate, canonicalRoot) {
  const relative = path.relative(canonicalRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Psychiatry context boundary violation');
  }
}

export async function loadPsychiatryContext() {
  const canonicalRoot = await realpath(KNOWLEDGE_ROOT);
  const entries = (await readdir(canonicalRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const sections = [];
  for (const entry of entries) {
    const full = await realpath(path.join(canonicalRoot, entry.name));
    assertInsideKnowledge(full, canonicalRoot);
    sections.push(await readFile(full, 'utf8'));
  }

  if (!sections.length) throw new Error('Psychiatry knowledge base is empty');

  return [
    '# PSYCHIATRY STUDY BRAIN — ISOLATED SYSTEM CONTEXT',
    '',
    'This context is psychiatry-only. Do not retrieve or import knowledge from the repository root knowledge directory or any OSA commercial domain.',
    '',
    ...sections
  ].join('\n\n');
}

export function psychiatryKnowledgeRoot() {
  return KNOWLEDGE_ROOT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await loadPsychiatryContext()}\n`);
}
