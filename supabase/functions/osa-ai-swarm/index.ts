import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const clean = (value: unknown, max = 12000) => String(value ?? "").trim().slice(0, max);

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ROLES = [
  ["mapper", "Map the problem space, assumptions, unknowns, and promising directions. Be concrete."],
  ["evidence_scout", "Find the strongest evidence, counterexamples, and missing verification steps. Do not invent sources."],
  ["skeptic", "Attack the leading ideas. Identify failure modes, hidden assumptions, and reasons the plan may be wrong."],
  ["builder", "Turn the objective into an executable architecture or action plan with dependencies and tests."],
  ["optimizer", "Look for a simpler, faster, cheaper route while preserving the objective."],
  ["domain_specialist", "Reason as a domain specialist and surface technical details other agents may miss."],
  ["novelty_scout", "Generate non-obvious hypotheses or combinations, then state how each could be falsified."],
  ["risk_reviewer", "Focus on security, safety, privacy, legal/operational risk, rollback, and observability."],
] as const;

async function routerCall(base: string, token: string, body: any) {
  const response = await fetch(base + "/functions/v1/osa-ai-router", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-osa-router-token": token,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("router_http_" + response.status + ":" + clean(payload?.error || payload?.detail, 300));
  return payload;
}

function providerFor(strategy: string, index: number) {
  if (strategy === "claude_first") return "anthropic";
  if (strategy === "mixed") return ["anthropic", "openai", "google"][index % 3];
  if (strategy === "openai_first") return "openai";
  if (strategy === "gemini_first") return "google";
  return "";
}

Deno.serve(async (req: Request) => {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  const base = Deno.env.get("SUPABASE_URL");
  if (!dbUrl || !base) return json({ ok: false, error: "platform_env_unavailable" }, 500);

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    const tokenRows = await sql`select public.osa_get_secret('OSA_AI_ROUTER_INTERNAL_TOKEN') as token`;
    const token = String(tokenRows?.[0]?.token || "");
    const supplied = req.headers.get("x-osa-router-token") || "";
    if (token.length < 32 || !safeEq(supplied, token)) return json({ ok: false, error: "internal_auth_required" }, 403);

    if (req.method === "GET") {
      const providers = await sql`
        select
          length(coalesce(public.osa_get_secret('ANTHROPIC_API_KEY'),''))>20 as anthropic,
          length(coalesce(public.osa_get_secret('OPENAI_API_KEY'),''))>20 as openai,
          length(coalesce(public.osa_get_secret('GEMINI_API_KEY'),''))>20 as google
      `;
      const runs = await sql`
        select id,domain,mode,requested_agents,state,preferred_provider,created_at,completed_at
        from osa_brain.swarm_runs
        order by created_at desc
        limit 5
      `;
      return json({
        ok: true,
        service: "osa-ai-swarm",
        version: 1,
        provider_credentials: providers[0],
        sync_agent_limit: 8,
        pattern: "parallel specialists -> critic -> synthesizer",
        recent_runs: runs,
      });
    }

    if (req.method !== "POST") return json({ ok: false, error: "POST_ONLY" }, 405);

    const body: any = await req.json().catch(() => ({}));
    const objective = clean(body?.objective ?? body?.prompt, 12000);
    if (objective.length < 5) return json({ ok: false, error: "objective_required" }, 400);

    const domain = clean(body?.domain, 80).toLowerCase() || "general";
    const rawMode = clean(body?.mode, 30).toLowerCase();
    const mode = ["research", "solve", "review", "compare"].includes(rawMode) ? rawMode : "research";
    const rawStrategy = clean(body?.strategy, 30).toLowerCase();
    const strategy = ["auto", "claude_first", "mixed", "openai_first", "gemini_first"].includes(rawStrategy)
      ? rawStrategy
      : "claude_first";
    const requested = Math.max(2, Math.min(8, Number(body?.agents || 4)));
    const maxOutputTokens = Math.max(512, Math.min(2400, Number(body?.max_output_tokens || 1600)));
    const dryRun = body?.dry_run === true;

    const plan = Array.from({ length: requested }, (_, index) => {
      const role = ROLES[index % ROLES.length];
      return {
        agent_index: index,
        role: role[0],
        instruction: role[1],
        preferred_provider: providerFor(strategy, index),
      };
    });

    if (dryRun) return json({ ok: true, dry_run: true, objective, domain, mode, strategy, plan });

    const runRows = await sql`
      insert into osa_brain.swarm_runs(
        objective,domain,mode,requested_agents,state,preferred_provider,plan,started_at,metadata
      )
      values(
        ${objective},
        ${domain},
        ${mode},
        ${requested},
        'running',
        ${strategy},
        ${sql.json({ agents: plan })},
        now(),
        ${sql.json({ pattern: "parallel-specialists-critic-synthesizer", version: 1 })}
      )
      returning id
    `;
    const runId = String(runRows[0].id);

    for (const item of plan) {
      const prompt = `ROLE: ${item.role}
MISSION: ${item.instruction}
DOMAIN: ${domain}
MODE: ${mode}
OBJECTIVE:
${objective}

Return a concise, evidence-aware contribution for a later reviewer. Separate facts, assumptions, and proposals. Do not claim to have used tools you did not use.`;

      await sql`
        insert into osa_brain.swarm_members(
          run_id,agent_index,role,state,prompt,metadata
        )
        values(
          ${runId},
          ${item.agent_index},
          ${item.role},
          'queued',
          ${prompt},
          ${sql.json({ preferred_provider: item.preferred_provider || null })}
        )
      `;
    }

    const tasks = plan.map(async (item) => {
      const prompt = `ROLE: ${item.role}
MISSION: ${item.instruction}
DOMAIN: ${domain}
MODE: ${mode}
OBJECTIVE:
${objective}

Return a concise, evidence-aware contribution for a later reviewer. Separate facts, assumptions, and proposals. Do not claim to have used tools you did not use.`;

      const started = Date.now();
      try {
        await sql`
          update osa_brain.swarm_members
          set state='running'
          where run_id=${runId} and agent_index=${item.agent_index}
        `;

        const result = await routerCall(base, token, {
          action: "execute",
          prompt,
          domain,
          complexity: 0.82,
          max_output_tokens: maxOutputTokens,
          preferred_provider: item.preferred_provider || undefined,
          strict_provider: false,
          cost_bias: 0.35,
          speed_bias: 0.45,
        });

        const latencyMs = Date.now() - started;
        if (result?.human_handoff) {
          await sql`
            update osa_brain.swarm_members
            set
              state='handoff',
              latency_ms=${latencyMs},
              metadata=metadata || ${sql.json({ handoff: true, selected_route: result?.selected_route || null })},
              completed_at=now()
            where run_id=${runId} and agent_index=${item.agent_index}
          `;
          return { agent_index: item.agent_index, role: item.role, ok: false, handoff: true };
        }

        const output = clean(result?.text, 14000);
        await sql`
          update osa_brain.swarm_members
          set
            state='succeeded',
            route_key=${result?.decision?.actual_route || result?.decision?.selected?.route_key || null},
            provider=${result?.provider || null},
            model=${result?.model || null},
            output=${output},
            latency_ms=${latencyMs},
            completed_at=now()
          where run_id=${runId} and agent_index=${item.agent_index}
        `;

        return {
          agent_index: item.agent_index,
          role: item.role,
          ok: true,
          provider: result?.provider || null,
          model: result?.model || null,
          output,
        };
      } catch (error) {
        const latencyMs = Date.now() - started;
        const message = clean(error instanceof Error ? error.message : String(error), 500);

        await sql`
          update osa_brain.swarm_members
          set
            state='failed',
            error=${message},
            latency_ms=${latencyMs},
            completed_at=now()
          where run_id=${runId} and agent_index=${item.agent_index}
        `;

        return { agent_index: item.agent_index, role: item.role, ok: false, error: message };
      }
    });

    const settled = await Promise.all(tasks);
    const successes = settled.filter((item: any) => item.ok && item.output);

    if (successes.length === 0) {
      await sql`
        update osa_brain.swarm_runs
        set
          state='failed',
          error='no_model_agent_succeeded',
          result=${sql.json({ agents: settled })},
          completed_at=now(),
          updated_at=now()
        where id=${runId}
      `;

      return json({
        ok: false,
        error: "no_model_agent_succeeded",
        run_id: runId,
        agents: settled,
        hint: "Configure at least one server LLM credential. ANTHROPIC_API_KEY enables Claude-first mode.",
      }, 503);
    }

    const packet = successes
      .map((item: any) =>
        `### ${item.role} [${item.provider || "unknown"}/${item.model || "unknown"}]
${clean(item.output, 6000)}`
      )
      .join("\n\n")
      .slice(0, 30000);

    let critic: any = { text: "" };
    try {
      const criticPrompt = `You are the swarm critic. Objective:
${objective}

Agent contributions:
${packet}

Identify contradictions, unsupported claims, duplicated ideas, missing tests, and the 3 strongest conclusions. Do not merely summarize.`;

      critic = await routerCall(base, token, {
        action: "execute",
        prompt: criticPrompt,
        domain,
        complexity: 0.9,
        max_output_tokens: 1800,
        preferred_provider: strategy === "mixed" ? "openai" : strategy === "claude_first" ? "anthropic" : undefined,
        strict_provider: false,
        cost_bias: 0.25,
        speed_bias: 0.3,
      });

      await sql`
        insert into osa_brain.swarm_members(
          run_id,agent_index,role,state,prompt,output,route_key,provider,model,completed_at,metadata
        )
        values(
          ${runId},
          998,
          'critic',
          'succeeded',
          ${criticPrompt},
          ${clean(critic?.text, 14000)},
          ${critic?.decision?.actual_route || null},
          ${critic?.provider || null},
          ${critic?.model || null},
          now(),
          ${sql.json({ stage: "critic" })}
        )
      `;
    } catch (error) {
      critic = { text: "Critic stage unavailable: " + clean(error instanceof Error ? error.message : String(error), 300) };
    }

    const synthPrompt = `You are the lead synthesizer for a multi-agent research swarm.
OBJECTIVE:
${objective}

SPECIALIST OUTPUTS:
${packet}

CRITIC:
${clean(critic?.text, 8000)}

Produce the best final result. Preserve uncertainty. Give: (1) conclusion, (2) evidence/assumptions, (3) execution plan, (4) tests/verification, (5) unresolved risks. Do not invent citations or tool results.`;

    let synthesis: any;
    try {
      synthesis = await routerCall(base, token, {
        action: "execute",
        prompt: synthPrompt,
        domain,
        complexity: 0.96,
        max_output_tokens: Math.max(1800, maxOutputTokens),
        preferred_provider: strategy === "claude_first" ? "anthropic" : undefined,
        strict_provider: false,
        cost_bias: 0.2,
        speed_bias: 0.25,
      });

      await sql`
        insert into osa_brain.swarm_members(
          run_id,agent_index,role,state,prompt,output,route_key,provider,model,completed_at,metadata
        )
        values(
          ${runId},
          999,
          'synthesizer',
          'succeeded',
          ${synthPrompt},
          ${clean(synthesis?.text, 18000)},
          ${synthesis?.decision?.actual_route || null},
          ${synthesis?.provider || null},
          ${synthesis?.model || null},
          now(),
          ${sql.json({ stage: "synthesis" })}
        )
      `;
    } catch (error) {
      synthesis = {
        text: successes.map((item: any) => item.output).join("\n\n").slice(0, 18000),
        provider: null,
        model: null,
        error: clean(error instanceof Error ? error.message : String(error), 300),
      };
    }

    const state = successes.length === requested ? "succeeded" : "partial";
    const result = {
      final: clean(synthesis?.text, 18000),
      provider: synthesis?.provider || null,
      model: synthesis?.model || null,
      critic: clean(critic?.text, 8000),
      agents: settled,
    };

    await sql`
      update osa_brain.swarm_runs
      set
        state=${state},
        result=${sql.json(result)},
        completed_at=now(),
        updated_at=now()
      where id=${runId}
    `;

    await sql`
      insert into osa_brain.events(event_type,domain,subject,payload,outcome,reward,evidence_ref)
      values(
        'ai_swarm_run',
        ${domain},
        ${runId},
        ${sql.json({
          mode,
          strategy,
          requested_agents: requested,
          successful_agents: successes.length,
          synth_provider: synthesis?.provider || null,
          synth_model: synthesis?.model || null,
        })},
        ${state},
        ${state === "succeeded" ? 0.5 : 0.1},
        ${runId}
      )
    `;

    return json({
      ok: true,
      run_id: runId,
      state,
      successful_agents: successes.length,
      requested_agents: requested,
      strategy,
      final: result.final,
      critic: result.critic,
      agents: settled,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "swarm_failed",
      detail: clean(error instanceof Error ? error.message : String(error), 500),
    }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
