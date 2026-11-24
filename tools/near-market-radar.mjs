#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const BASE = process.env.OSA_NEAR_MARKET_BASE || 'https://market.near.ai';
const FETCH_TIMEOUT_MS = Math.max(2000, Math.min(Number(process.env.OSA_NEAR_MARKET_TIMEOUT_MS || 12000), 30000));
const MAX_VISIBLE_AGENTS = Math.max(50, Math.min(Number(process.env.OSA_NEAR_MARKET_MAX_AGENTS || 1000), 1500));

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function classifyReviewer(name = '', body = '') {
  const n = String(name || '').trim();
  const text = String(body || '');
  if (/^DA\d+(?:\s|$)/i.test(n) || /\bfixture\b|EYERMARK-|public-view review|baseline review|sibling account review/i.test(text)) return 'qa_test';
  if (/^Agent Market$/i.test(n)) return 'platform_internal';
  return 'external_or_unknown';
}

export function summarizeAgents(agents = []) {
  const categories = new Map();
  const delivered = [];
  for (const agent of agents) {
    const count = asNumber(agent?.delivered_jobs);
    const category = String(agent?.category || 'unknown');
    const row = categories.get(category) || { category, visible_agents: 0, agents_with_delivery: 0, delivered_jobs: 0 };
    row.visible_agents += 1;
    if (count > 0) {
      row.agents_with_delivery += 1;
      row.delivered_jobs += count;
      delivered.push({
        agent_id: agent.agent_id,
        handle: agent.handle,
        name: agent.name,
        category,
        delivered_jobs: count,
        success_rate: agent.success_rate ?? null,
        response_time_seconds_median: agent.response_time_seconds_median ?? null,
        payable_with: Array.isArray(agent.payable_with) ? agent.payable_with : [],
        created_at: agent.created_at ?? null,
      });
    }
    categories.set(category, row);
  }
  return {
    visible_agents: agents.length,
    agents_with_delivery: delivered.length,
    visible_delivered_jobs: delivered.reduce((sum, x) => sum + x.delivered_jobs, 0),
    categories: [...categories.values()].sort((a, b) => b.delivered_jobs - a.delivered_jobs || b.agents_with_delivery - a.agents_with_delivery),
    top_agents: delivered.sort((a, b) => b.delivered_jobs - a.delivered_jobs || asNumber(b.success_rate) - asNumber(a.success_rate)).slice(0, 25),
  };
}

async function getJson(path, fetchImpl = fetch) {
  const base = new URL(BASE);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('near_market_https_base_required');
  const url = new URL(path, base);
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'OSA-NEAR-Market-Radar/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`near_market_http_${res.status}`);
  return await res.json();
}

export async function fetchVisibleAgents({ fetchImpl = fetch } = {}) {
  const out = [];
  const seen = new Set();
  for (let offset = 0; offset < MAX_VISIBLE_AGENTS; offset += 50) {
    const payload = await getJson(`/v1/agents?limit=50&offset=${offset}`, fetchImpl);
    const batch = Array.isArray(payload?.agents) ? payload.agents : [];
    if (!batch.length) break;
    for (const agent of batch) {
      if (!agent?.agent_id || seen.has(agent.agent_id)) continue;
      seen.add(agent.agent_id);
      out.push(agent);
    }
    if (batch.length < 50) break;
  }
  return out;
}

async function enrichAgent(agent, fetchImpl) {
  const id = encodeURIComponent(agent.agent_id);
  const result = { ...agent };
  try {
    const reputation = await getJson(`/v1/agents/${id}/reputation`, fetchImpl);
    result.reputation = {
      overall: reputation?.overall ?? null,
      repeat_hires: reputation?.axes?.repeat_hires ?? null,
      jobs_counted: reputation?.jobs_counted ?? null,
    };
  } catch {}
  try {
    const plans = await getJson(`/v1/agents/${id}/pricing-plans`, fetchImpl);
    const live = Array.isArray(plans) ? plans.filter((x) => x?.listing_status === 'live') : [];
    const plan = live.find((x) => x?.is_default) || live[0] || null;
    result.pricing = plan ? {
      model: plan.model ?? null,
      price_amount: plan.price_amount ?? null,
      display_name: plan.display_name ?? null,
    } : null;
  } catch {}
  try {
    const reviews = await getJson(`/v1/agents/${id}/reviews?limit=100&offset=0`, fetchImpl);
    const rows = Array.isArray(reviews?.reviews) ? reviews.reviews : [];
    result.review_summary = rows.reduce((acc, review) => {
      const kind = classifyReviewer(review?.reviewerDisplayName, review?.body);
      acc.total += 1;
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, { total: 0, external_or_unknown: 0, qa_test: 0, platform_internal: 0 });
  } catch {}
  return result;
}

export async function runNearMarketRadar({ fetchImpl = fetch } = {}) {
  const [stats, agents] = await Promise.all([
    getJson('/v1/platform/stats', fetchImpl),
    fetchVisibleAgents({ fetchImpl }),
  ]);
  const summary = summarizeAgents(agents);
  const candidates = summary.top_agents.slice(0, 20);
  const enriched = [];
  for (const agent of candidates) enriched.push(await enrichAgent(agent, fetchImpl));
  return {
    ok: true,
    observed_at: new Date().toISOString(),
    source: 'https://market.near.ai public unauthenticated API',
    platform_stats: {
      live_agents: asNumber(stats?.live_agents),
      jobs_total: asNumber(stats?.jobs_total),
      jobs_this_week: asNumber(stats?.jobs_this_week),
      active_hires: asNumber(stats?.active_hires),
      delivered_jobs: asNumber(stats?.delivered_jobs),
    },
    public_catalog: {
      visible_agents: summary.visible_agents,
      agents_with_delivery: summary.agents_with_delivery,
      visible_delivered_jobs: summary.visible_delivered_jobs,
      incomplete_vs_platform_total: asNumber(stats?.delivered_jobs) > summary.visible_delivered_jobs,
    },
    categories: summary.categories,
    top_agents: enriched.map((x) => ({
      handle: x.handle,
      name: x.name,
      category: x.category,
      delivered_jobs: x.delivered_jobs,
      success_rate: x.success_rate,
      current_pricing: x.pricing || null,
      repeat_hires_axis: x.reputation?.repeat_hires ?? null,
      reputation_overall: x.reputation?.overall ?? null,
      review_summary: x.review_summary || null,
    })),
    doctrine: {
      primary_experiment: 'Public MCP Preflight & Evidence Agent',
      first_success_kpi: 'verified cross-owner paid settlement',
      exclude_as_external_demand: ['self-hires', 'platform-internal activity', 'QA fixtures', 'test transactions'],
      caution: 'Current listing prices are not historical spend; public reviews are an incomplete customer ledger.',
    },
  };
}

async function main() {
  try {
    const result = await runNearMarketRadar();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: String(err?.message || err) }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
