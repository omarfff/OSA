#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'config', 'agent-fabric.json');

export async function loadFabric(file = DEFAULT_MANIFEST) {
  const raw = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
  if (!raw || raw.version !== 1 || !Array.isArray(raw.agents)) throw new Error('invalid_agent_fabric_manifest');
  const ids = new Set();
  for (const agent of raw.agents) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(String(agent.id || ''))) throw new Error('invalid_agent_id');
    if (ids.has(agent.id)) throw new Error(`duplicate_agent_id:${agent.id}`);
    ids.add(agent.id);
    if (!Array.isArray(agent.command) || agent.command.length < 2) throw new Error(`invalid_agent_command:${agent.id}`);
    if (!['read_only', 'draft', 'write', 'financial'].includes(agent.access)) throw new Error(`invalid_agent_access:${agent.id}`);
    if (!['none', 'one_public_url', 'passthrough'].includes(agent.args)) throw new Error(`invalid_agent_args:${agent.id}`);
  }
  return raw;
}

export function publicUrlArg(value) {
  let u;
  try { u = new URL(String(value || '')); } catch { throw new Error('public_url_required'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('public_http_url_required');
  if (u.username || u.password || u.hash) throw new Error('credentials_or_fragment_not_allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('local_target_not_allowed');
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error('private_target_not_allowed');
  return u.href;
}

export function normalizeAgentArgs(agent, args = []) {
  const values = args.map((x) => String(x));
  if (agent.args === 'none') {
    if (values.length) throw new Error('agent_accepts_no_arguments');
    return [];
  }
  if (agent.args === 'one_public_url') {
    if (values.length !== 1) throw new Error('agent_requires_one_public_url');
    return [publicUrlArg(values[0])];
  }
  if (values.some((x) => x.includes('\u0000'))) throw new Error('nul_argument_rejected');
  return values.slice(0, 20).map((x) => x.slice(0, 2048));
}

export function executionDecision(agent, env = process.env) {
  if (agent.access === 'financial') return { allowed: false, reason: 'financial_execution_blocked' };
  if (agent.access === 'write' && String(env.OSA_AGENT_ALLOW_WRITE || '') !== '1') return { allowed: false, reason: 'write_gate_closed' };
  return { allowed: true, reason: agent.access === 'write' ? 'write_gate_open' : 'safe_class' };
}

function boundedNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function runAgent(agent, args = [], { env = process.env, cwd = ROOT, timeoutMs, maxOutputBytes } = {}) {
  const decision = executionDecision(agent, env);
  if (!decision.allowed) return { ok: false, blocked: true, agent: agent.id, reason: decision.reason };
  if (agent.enabled !== true && String(env.OSA_AGENT_ALLOW_DISABLED || '') !== '1') {
    return { ok: false, blocked: true, agent: agent.id, reason: 'agent_disabled' };
  }
  const safeArgs = normalizeAgentArgs(agent, args);
  const command = agent.command.map(String);
  const executable = command[0];
  const commandArgs = [...command.slice(1), ...safeArgs];
  const timeout = boundedNumber(timeoutMs, 120000, 1000, 300000);
  const maxBytes = boundedNumber(maxOutputBytes, 1024 * 1024, 4096, 4 * 1024 * 1024);
  const started = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(executable, commandArgs, {
      cwd,
      env: { ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let killedForOutput = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > maxBytes) {
        killedForOutput = true;
        child.kill('SIGTERM');
        return next.subarray(0, maxBytes);
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, agent: agent.id, error: String(err?.message || err), duration_ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut && !killedForOutput,
        agent: agent.id,
        exit_code: code,
        signal,
        timed_out: timedOut,
        output_truncated: killedForOutput,
        duration_ms: Date.now() - started,
        stdout: stdout.toString('utf8').trim(),
        stderr: stderr.toString('utf8').trim(),
      });
    });
  });
}

export function planForGoal(goal, agents) {
  const text = String(goal || '').toLowerCase();
  const wanted = [];
  const add = (id, why) => { const agent = agents.find((x) => x.id === id); if (agent) wanted.push({ id, why, requires_args: agent.args !== 'none', enabled: agent.enabled === true, access: agent.access }); };
  if (/revenue|sales|lead|money|cash|عميل|دخل|فلوس|ايراد|إيراد/.test(text)) {
    add('revenue-scout', 'find current demand before building');
    add('lead-auditor', 'prove a prospect problem before outreach');
    add('mcp-verifier', 'verify a technical offer or endpoint before selling');
    add('payment-watch', 'watch for verified settlement evidence');
  }
  if (/health|runtime|browser|server|خادم|سيرفر|متصفح|عطل/.test(text)) {
    add('browser-health', 'check browser/runtime health');
    add('watchdog', 'surface the smallest operational blocker');
  }
  if (/bounty|superteam|مهمة|باونتي|مكاف/.test(text)) {
    add('superteam-builder', 'prepare a focused bounty artifact');
    add('superteam-submitter', 'submit only after write gate and platform prerequisites are satisfied');
  }
  if (/media|marketing|content|محتوى|تسويق/.test(text)) add('media-worker', 'prepare factual marketing support without auto-publishing');
  return wanted.length ? wanted : agents.filter((x) => x.enabled).map((x) => ({ id: x.id, why: 'available default agent', requires_args: x.args !== 'none', enabled: true, access: x.access }));
}

async function main() {
  const fabric = await loadFabric();
  const [cmd = 'list', ...rest] = process.argv.slice(2);
  if (cmd === 'list' || cmd === 'status') {
    const rows = fabric.agents.map((a) => ({ id: a.id, name: a.name, domain: a.domain, access: a.access, enabled: a.enabled, revenue_impact: a.revenue_impact, args: a.args, decision: executionDecision(a).reason }));
    console.log(JSON.stringify({ ok: true, policy: fabric.policy, agents: rows }, null, 2));
    return;
  }
  if (cmd === 'plan') {
    console.log(JSON.stringify({ ok: true, goal: rest.join(' '), plan: planForGoal(rest.join(' '), fabric.agents) }, null, 2));
    return;
  }
  if (cmd === 'run') {
    const [id, ...args] = rest;
    const agent = fabric.agents.find((x) => x.id === id);
    if (!agent) throw new Error(`unknown_agent:${id || ''}`);
    const result = await runAgent(agent, args, {
      timeoutMs: fabric.policy?.default_timeout_ms,
      maxOutputBytes: fabric.policy?.max_output_bytes,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = result.blocked ? 3 : 1;
    return;
  }
  throw new Error('usage: agent-fabric.mjs [list|status|plan <goal>|run <agent-id> [args...]]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    process.exitCode = 1;
  });
}
