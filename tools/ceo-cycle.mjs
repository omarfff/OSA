#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadFabric, planForGoal, runAgent } from './agent-fabric.mjs';
import { retrieveExperiences, retrieveKnowledge, systemPrompt } from './osa-brain.mjs';
import { routeChat } from './ai-router.mjs';

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

export function deterministicCeoDecision(runtime = {}) {
  const rows = Array.isArray(runtime?.safe_executions) ? runtime.safe_executions : [];
  const market = rows.find((x) => x?.agent === 'near-market-scout');
  const listing = rows.find((x) => x?.agent === 'near-listing-spec');
  const stats = market?.evidence?.platform_stats || {};
  const truth = listing?.evidence?.commercial_truth || {};
  const marketActive = Boolean(
    market?.ok
    && Number(stats.jobs_this_week || 0) > 0
    && Number(stats.delivered_jobs || 0) > 0
    && Number(stats.active_hires || 0) > 0
  );
  const productBuilt = Boolean(listing?.ok && truth.current_state === 'BUILT');

  let stage = 'BLOCKED';
  let nextAction = 'Repair the smallest failed prerequisite and rerun the bounded CEO cycle.';
  let stopReason = null;
  if (marketActive && productBuilt) {
    stage = 'VERIFIED';
    nextAction = 'Advance the existing Public MCP Preflight & Evidence product to an external NEAR listing/application using an already-authorized session if one exists; otherwise stop exactly at the account/binding-terms owner gate.';
  } else if (!marketActive) {
    stopReason = 'Current runtime evidence does not establish an active NEAR market.';
  } else if (!productBuilt) {
    stopReason = 'The listing specification did not verify as BUILT.';
  }

  return {
    decision_source: 'deterministic_kernel',
    stage,
    primary_path: 'NEAR Agent Market -> Public MCP Preflight & Evidence -> verified cross-owner paid settlement',
    market_active: marketActive,
    product_built: productBuilt,
    next_action: nextAction,
    park: [
      'new generalist agents',
      'new payment rails',
      'self-hires and internal test jobs',
      'infrastructure unrelated to a named listing/delivery/settlement blocker',
    ],
    owner_only_gate: 'identity/KYC, binding terms/e-signature, custody/funding, private-key ownership, money movement or another irreversible financial/legal action',
    stop_reason: stopReason,
    paid: false,
    paid_truth: 'PAID remains false until authoritative external settlement evidence exists.',
  };
}

export async function routedCeoDecision({ goal, runtime, env = process.env, routeChatImpl = routeChat } = {}) {
  const kernel = deterministicCeoDecision(runtime);
  const query = `${goal}\n${JSON.stringify({ kernel, runtime })}`;
  const [memory, experience] = await Promise.all([
    retrieveKnowledge(query, { topK: 5, maxChars: 4200 }),
    retrieveExperiences(query, { topK: 4, maxChars: 1800 }),
  ]);
  const routedEnv = {
    ...env,
    OSA_AI_PROVIDER_ORDER: env.OSA_CEO_AI_PROVIDER_ORDER || 'gemini,anthropic,openai_compatible',
    OSA_AI_MAX_OUTPUT_TOKENS: env.OSA_CEO_MAX_OUTPUT_TOKENS || '220',
  };
  let advisory = null;
  try {
    const result = await routeChatImpl({
      env: routedEnv,
      timeoutMs: 15000,
      messages: [
        { role: 'system', content: systemPrompt('ceo') },
        { role: 'user', content: `The deterministic CEO kernel is authoritative for stage/gates. Explain or challenge it only with supplied evidence; do not invent actions.\n\nGOAL:\n${goal}\n\nKERNEL:\n${JSON.stringify(kernel)}\n\nPERSISTENT OSA MEMORY:\n${memory.text || '(none)'}\n\nVERIFIED EXPERIENCE MEMORY:\n${experience.text || '(none)'}\n\nVERIFIED RUNTIME EVIDENCE:\n${JSON.stringify(runtime)}` },
      ],
    });
    if (result?.ok && result?.text) {
      advisory = {
        text: result.text,
        provider: result.provider,
        model: result.model,
        failures: result.failures || [],
      };
    } else {
      advisory = { text: null, provider: null, model: null, failures: result?.failures || [], error: result?.error || 'ceo_router_failed' };
    }
  } catch (err) {
    advisory = { text: null, provider: null, model: null, failures: [], error: String(err?.message || err) };
  }
  return {
    ...kernel,
    text: advisory?.text || `Decision: ${kernel.next_action}\nStage: ${kernel.stage}\nPaid: false. ${kernel.paid_truth}`,
    provider: advisory?.provider || null,
    model: advisory?.model || null,
    advisory_failures: advisory?.failures || [],
    advisory_error: advisory?.error || null,
    memory_sources: memory.sources || [],
    experience_sources: experience.sources || [],
  };
}

export async function runCeoCycle({
  goal = DEFAULT_GOAL,
  env = process.env,
  runAgentImpl = runAgent,
  decisionImpl = routedCeoDecision,
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
    decision = await decisionImpl({ goal, runtime, env });
  } catch (err) {
    decision = {
      text: 'CEO inference unavailable. Preserve the primary path: verify NEAR market activity, generate the MCP listing spec, and stop at any owner-only legal/identity/financial gate.',
      provider: null,
      model: null,
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
