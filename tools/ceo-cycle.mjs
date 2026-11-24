#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadFabric, planForGoal, runAgent } from './agent-fabric.mjs';
import { askBrain } from './osa-brain.mjs';

const DEFAULT_GOAL = 'Reach the first verified cross-owner paid settlement through NEAR Agent Market using the existing Public MCP Preflight & Evidence capability. Do not create new platforms, move funds, accept binding terms, perform KYC, or claim revenue without settlement evidence.';

export function executableSafePlan(goal, agents) {
  return planForGoal(goal, agents).filter((item) => {
    const agent = agents.find((x) => x.id === item.id);
    if (!agent || agent.enabled !== true) return false;
    if (agent.args !== 'none') return false;
    return ['read_only', 'draft'].includes(agent.access);
  });
}

function compactAgentResult(agentId, result) {
  const base = {
    agent: agentId,
    ok: Boolean(result?.ok),
    blocked: Boolean(result?.blocked),
    reason: result?.reason || null,
    stderr: String(result?.stderr || '').slice(0, 600),
  };
  const raw = String(result?.stdout || '');
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw);
    if (agentId === 'near-market-scout') {
      return {
        ...base,
        evidence: {
          observed_at: parsed?.observed_at ?? null,
          platform_stats: parsed?.platform_stats ?? null,
          public_catalog: parsed?.public_catalog ?? null,
          categories: Array.isArray(parsed?.categories) ? parsed.categories.slice(0, 8) : [],
          top_agents: Array.isArray(parsed?.top_agents) ? parsed.top_agents.slice(0, 8).map((x) => ({
            handle: x.handle,
            category: x.category,
            delivered_jobs: x.delivered_jobs,
            success_rate: x.success_rate,
            current_pricing: x.current_pricing,
            repeat_hires_axis: x.repeat_hires_axis,
            review_summary: x.review_summary,
          })) : [],
          doctrine: parsed?.doctrine ?? null,
        },
      };
    }
    if (agentId === 'near-listing-spec') {
      return {
        ...base,
        evidence: {
          product: parsed?.product ?? null,
          buyer_input: parsed?.buyer_input ?? null,
          buyer_safety: parsed?.buyer_safety ?? null,
          commercial_truth: parsed?.commercial_truth ?? null,
        },
      };
    }
    return { ...base, evidence: parsed };
  } catch {
    return { ...base, stdout: raw.slice(0, 1600) };
  }
}

export async function runCeoCycle({
  goal = DEFAULT_GOAL,
  env = process.env,
  runAgentImpl = runAgent,
  askBrainImpl = askBrain,
} = {}) {
  const fabric = await loadFabric();
  const safePlan = executableSafePlan(goal, fabric.agents).slice(0, 4);
  const executions = [];
  for (const item of safePlan) {
    const agent = fabric.agents.find((x) => x.id === item.id);
    const result = await runAgentImpl(agent, [], {
      env,
      timeoutMs: fabric.policy?.default_timeout_ms,
      maxOutputBytes: fabric.policy?.max_output_bytes,
    });
    executions.push({ plan: item, result });
  }

  const runtime = {
    goal,
    revenue_truth: 'Only authoritative external settlement counts as PAID.',
    safe_executions: executions.map((x) => ({
      why: x.plan.why,
      ...compactAgentResult(x.plan.id, x.result),
    })),
    owner_only_gates: [
      'identity/KYC attestation',
      'binding terms or electronic signature',
      'bank/custody/funding approval',
      'wallet seed/private-key ownership',
      'money movement or irreversible financial action',
    ],
  };

  let decision;
  try {
    decision = await askBrainImpl({
      task: [
        'Act as OSA CEO for one revenue cycle.',
        'Use the supplied verified runtime evidence and persistent OSA memory.',
        'Keep one primary revenue path and at most one backup.',
        'Prefer the existing Public MCP Preflight & Evidence asset over new product building.',
        'Separate BUILT, VERIFIED, SELLING and PAID.',
        'Exclude self-hires, internal/QA activity and test transactions from external demand.',
        'Choose the smallest next action that advances a verified cross-owner paid settlement.',
        'Do not authorize owner-only gates.',
      ].join(' '),
      context: runtime,
      mode: 'ceo',
    });
  } catch (err) {
    decision = {
      text: 'CEO inference unavailable. Preserve the primary path: verify NEAR market activity, generate the MCP listing spec, keep payment watch active, and stop at any owner-only legal/identity/financial gate.',
      model: null,
      mode: 'ceo',
      error: String(err?.message || err),
    };
  }

  return {
    ok: executions.some((x) => x.result.ok) || safePlan.length === 0,
    goal,
    primary_path: 'NEAR Agent Market -> Public MCP Preflight & Evidence -> first verified cross-owner paid settlement',
    safe_plan: safePlan,
    executions,
    ceo_decision: decision,
  };
}

async function main() {
  const goal = process.argv.slice(2).join(' ').trim() || DEFAULT_GOAL;
  try {
    const result = await runCeoCycle({ goal });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: String(err?.message || err) }) + '\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
