import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

type Keys = { openai: string; anthropic: string; google: string };

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const clean = (value: unknown, max = 12000) => String(value ?? "").trim().slice(0, max);
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function providerConfigured(provider: string, keys: Keys) {
  if (provider === "openai") return keys.openai.length > 20;
  if (provider === "anthropic") return keys.anthropic.length > 20;
  if (provider === "google") return keys.google.length > 20;
  return provider === "duckduckgo" || provider === "duck_ai";
}

function inferDomain(prompt: string, explicit: string) {
  if (explicit) return explicit.slice(0, 80).toLowerCase();
  const value = prompt.toLowerCase();
  if (/psychiatr|mental health|dsm|psychopharm/.test(value)) return "psychiatry";
  if (/medical|medicine|clinical|patient|diagnos/.test(value)) return "medicine";
  if (/code|bug|typescript|python|sql|api|github|program/.test(value)) return "coding";
  if (/research|paper|evidence|citation|study/.test(value)) return "research";
  if (/finance|market|stock|crypto|trading|investment/.test(value)) return "finance";
  if (/real estate|property|rent|tenant|building/.test(value)) return "real_estate";
  if (/marketing|sales|customer|campaign/.test(value)) return "marketing";
  return "general";
}

function inferComplexity(prompt: string, explicit: unknown) {
  const value = Number(explicit);
  if (Number.isFinite(value)) return clamp(value);
  let complexity = prompt.length > 3000 ? 0.85 : prompt.length > 1200 ? 0.68 : prompt.length > 400 ? 0.5 : 0.3;
  if (/deep|complex|architecture|reason|analy[sz]e|debug|plan|compare|comprehensive|عميق|حلل|قارن|خطط/.test(prompt.toLowerCase())) complexity += 0.15;
  return clamp(complexity);
}

function openAIText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || [])
    .flatMap((item: any) => item?.content || [])
    .map((item: any) => item?.text || "")
    .filter(Boolean)
    .join("\n");
}

function anthropicText(payload: any) {
  return (payload?.content || []).map((item: any) => item?.text || "").filter(Boolean).join("\n");
}

function geminiText(payload: any) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .map((item: any) => item?.text || "")
    .filter(Boolean)
    .join("\n");
}

async function callDuckDuckGo(prompt: string) {
  const url = new URL("https://api.duckduckgo.com/");
  for (const [key, value] of Object.entries({
    q: prompt,
    format: "json",
    no_html: "1",
    no_redirect: "1",
    skip_disambig: "0",
  })) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "OSA-Outcome-Agents/3.0",
    },
  });
  if (!response.ok) throw new Error("duckduckgo_http_" + response.status);

  const payload = await response.json();
  const related = Array.isArray(payload?.RelatedTopics)
    ? payload.RelatedTopics
      .flatMap((item: any) => Array.isArray(item?.Topics) ? item.Topics : [item])
      .filter((item: any) => item?.Text)
      .slice(0, 8)
      .map((item: any) => ({ text: item.Text, url: item.FirstURL ?? null }))
    : [];

  const text = clean(payload?.Answer, 3000)
    || clean(payload?.AbstractText, 5000)
    || clean(payload?.Definition, 5000);

  if (!text && !related.length) throw new Error("duckduckgo_no_answer");
  return { text: text || related.map((item: any) => item.text).join("\n") };
}

async function callModel(route: any, prompt: string, maxOutputTokens: number, keys: Keys) {
  if (route.provider === "duckduckgo") return await callDuckDuckGo(prompt);
  if (route.provider === "duck_ai") return { human_handoff: true, url: "https://duck.ai/", prompt, text: "" };

  if (route.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + keys.openai,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: route.model,
        input: prompt,
        max_output_tokens: maxOutputTokens,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("openai_http_" + response.status + ":" + clean(payload?.error?.message, 300));
    return { text: openAIText(payload), usage: payload?.usage || null, response_id: payload?.id || null };
  }

  if (route.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": keys.anthropic,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("anthropic_http_" + response.status + ":" + clean(payload?.error?.message, 300));
    return { text: anthropicText(payload), usage: payload?.usage || null, response_id: payload?.id || null };
  }

  if (route.provider === "google") {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/"
        + encodeURIComponent(route.model)
        + ":generateContent?key="
        + encodeURIComponent(keys.google),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("gemini_http_" + response.status + ":" + clean(payload?.error?.message, 300));
    return { text: geminiText(payload), usage: payload?.usageMetadata || null, response_id: null };
  }

  throw new Error("unsupported_provider");
}

Deno.serve(async (req: Request) => {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return json({ ok: false, error: "db_unavailable" }, 500);

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    const tokenRows = await sql`select public.osa_get_secret('OSA_AI_ROUTER_INTERNAL_TOKEN') as token`;
    const expected = String(tokenRows?.[0]?.token || "");
    const supplied = req.headers.get("x-osa-router-token") || "";
    if (expected.length < 32 || !safeEq(supplied, expected)) return json({ ok: false, error: "internal_auth_required" }, 403);

    const secretRows = await sql`
      select
        coalesce(public.osa_get_secret('OPENAI_API_KEY'),'') as openai,
        coalesce(public.osa_get_secret('ANTHROPIC_API_KEY'),'') as anthropic,
        coalesce(public.osa_get_secret('GEMINI_API_KEY'),'') as google
    `;
    const keys: Keys = {
      openai: String(Deno.env.get("OPENAI_API_KEY") || secretRows?.[0]?.openai || ""),
      anthropic: String(Deno.env.get("ANTHROPIC_API_KEY") || secretRows?.[0]?.anthropic || ""),
      google: String(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || secretRows?.[0]?.google || ""),
    };

    if (req.method === "GET") {
      const catalog = await sql`
        select route_key,provider,model,model_class,execution_mode,enabled
        from osa_brain.model_catalog
        where enabled
        order by route_key
      `;
      return json({
        ok: true,
        service: "osa-ai-router",
        version: 3,
        configured: {
          openai: providerConfigured("openai", keys),
          anthropic: providerConfigured("anthropic", keys),
          google: providerConfigured("google", keys),
          duckduckgo: true,
          duck_ai_manual: true,
        },
        catalog,
      });
    }

    if (req.method !== "POST") return json({ ok: false, error: "POST_ONLY" }, 405);
    const body: any = await req.json().catch(() => ({}));
    const action = clean(body?.action, 40).toLowerCase() || "route";

    if (action === "feedback") {
      const routeKey = clean(body?.route_key, 160);
      const domain = clean(body?.domain, 80).toLowerCase() || "general";
      const success = body?.success === true;
      const reward = Math.max(-10, Math.min(10, Number.isFinite(Number(body?.reward)) ? Number(body.reward) : success ? 1 : -1));
      if (!routeKey) return json({ ok: false, error: "route_key_required" }, 400);

      const rows = await sql`
        insert into osa_brain.model_route_stats(
          domain,route_key,verified_successes,verified_failures,avg_reward,last_used_at
        )
        values(
          ${domain},${routeKey},${success ? 1 : 0},${success ? 0 : 1},${reward},now()
        )
        on conflict(domain,route_key) do update set
          verified_successes=osa_brain.model_route_stats.verified_successes+${success ? 1 : 0},
          verified_failures=osa_brain.model_route_stats.verified_failures+${success ? 0 : 1},
          avg_reward=(
            (osa_brain.model_route_stats.avg_reward
              * (osa_brain.model_route_stats.verified_successes+osa_brain.model_route_stats.verified_failures))
            + ${reward}
          ) / (osa_brain.model_route_stats.verified_successes+osa_brain.model_route_stats.verified_failures+1),
          last_used_at=now(),
          updated_at=now()
        returning *
      `;
      return json({ ok: true, learned: true, stats: rows[0] });
    }

    const prompt = clean(body?.prompt ?? body?.q, 20000);
    if (prompt.length < 2) return json({ ok: false, error: "prompt_required" }, 400);

    const domain = inferDomain(prompt, clean(body?.domain, 80));
    const intent = clean(body?.intent, 80).toLowerCase();
    const complexity = inferComplexity(prompt, body?.complexity);
    const coding = body?.coding === true || domain === "coding";
    const multimodal = body?.multimodal === true;
    const costBias = clamp(Number.isFinite(Number(body?.cost_bias)) ? Number(body.cost_bias) : 0.45);
    const speedBias = clamp(Number.isFinite(Number(body?.speed_bias)) ? Number(body.speed_bias) : 0.45);
    const quickLookup = ["definition", "quick_fact", "entity_summary", "disambiguation", "lookup"].includes(intent);
    const forceRoute = clean(body?.force_route_key, 160);
    const preferredProvider = clean(body?.preferred_provider, 40).toLowerCase();
    const strictProvider = body?.strict_provider === true;
    const excluded = new Set(
      Array.isArray(body?.exclude_providers)
        ? body.exclude_providers.map((item: any) => clean(item, 40).toLowerCase()).filter(Boolean)
        : [],
    );

    const catalog = await sql`
      select
        c.*,
        coalesce(s.attempts,0) attempts,
        coalesce(s.successes,0) successes,
        coalesce(s.failures,0) failures,
        coalesce(s.verified_successes,0) verified_successes,
        coalesce(s.verified_failures,0) verified_failures,
        coalesce(s.avg_reward,0) avg_reward,
        coalesce(s.avg_latency_ms,0) avg_latency_ms
      from osa_brain.model_catalog c
      left join osa_brain.model_route_stats s
        on s.route_key=c.route_key and s.domain=${domain}
      where c.enabled=true
    `;

    let candidates = catalog.filter((route: any) => {
      if (excluded.has(String(route.provider).toLowerCase())) return false;
      if (forceRoute && route.route_key !== forceRoute) return false;
      if (strictProvider && preferredProvider && route.provider !== preferredProvider) return false;
      if (route.execution_mode === "automatic" && !providerConfigured(route.provider, keys)) return false;
      if (!forceRoute && quickLookup) return route.provider === "duckduckgo" || route.execution_mode === "human_only";
      if (!forceRoute && route.provider === "duckduckgo") return false;
      if (coding && !Boolean(route.capabilities?.coding) && route.execution_mode === "automatic") return false;
      if (multimodal && !Boolean(route.capabilities?.multimodal) && !Boolean(route.capabilities?.vision)) return false;
      return true;
    });

    if (!candidates.length && !strictProvider && !forceRoute) {
      candidates = catalog.filter((route: any) =>
        route.execution_mode === "human_only"
        && !excluded.has(String(route.provider).toLowerCase())
      );
    }

    const scored = candidates
      .map((route: any) => {
        const evidence = Number(route.verified_successes || 0) + Number(route.verified_failures || 0);
        const historical = clamp((Number(route.avg_reward || 0) + 1) / 2);
        const historicalWeight = Math.min(0.38, (evidence / 5) * 0.38);
        let quality = Number(route.quality_prior);
        if (complexity > 0.78 && route.model_class === "maximum") quality += 0.06;
        if (complexity < 0.45 && ["fast", "balanced"].includes(route.model_class)) quality += 0.04;

        let score =
          quality * (0.62 - historicalWeight)
          + historical * historicalWeight
          + Number(route.speed_prior) * speedBias * 0.18
          + Number(route.cost_prior) * costBias * 0.18;

        if (route.execution_mode === "human_only") score -= 0.18;
        if (quickLookup && route.provider === "duckduckgo") score += 0.35;
        if (preferredProvider && route.provider === preferredProvider) score += 0.12;
        if (forceRoute && route.route_key === forceRoute) score += 1;

        return { ...route, score: Number(score.toFixed(4)), evidence };
      })
      .sort((a: any, b: any) => b.score - a.score);

    if (!forceRoute && scored.length > 1 && Math.random() < 0.10) {
      const index = 1 + Math.floor(Math.random() * Math.min(2, scored.length - 1));
      [scored[0], scored[index]] = [scored[index], scored[0]];
      scored[0].exploration = true;
    }

    const selected = scored[0];
    const decision = {
      domain,
      intent: intent || null,
      complexity,
      coding,
      multimodal,
      routing_policy: {
        preferred_provider: preferredProvider || null,
        strict_provider: strictProvider,
        force_route_key: forceRoute || null,
        exclude_providers: [...excluded],
      },
      selected: selected
        ? {
          route_key: selected.route_key,
          provider: selected.provider,
          model: selected.model,
          score: selected.score,
          evidence: selected.evidence,
          execution_mode: selected.execution_mode,
          exploration: Boolean(selected.exploration),
        }
        : null,
      fallbacks: scored.slice(1, 3).map((route: any) => ({
        route_key: route.route_key,
        provider: route.provider,
        model: route.model,
        score: route.score,
        execution_mode: route.execution_mode,
      })),
    };

    await sql`
      insert into osa_brain.events(event_type,domain,subject,payload,outcome,reward,evidence_ref)
      values(
        'ai_route_decision',
        ${domain},
        ${selected?.route_key || "none"},
        ${sql.json({ decision })},
        'selected',
        0,
        ${selected?.route_key || null}
      )
    `;

    if (action === "route") return json({ ok: true, decision });
    if (action !== "execute") return json({ ok: false, error: "unsupported_action", supported: ["route", "execute", "feedback"] }, 400);
    if (!selected) return json({ ok: false, error: "no_configured_route", decision }, 503);

    const maxOutputTokens = Math.max(128, Math.min(8192, Number(body?.max_output_tokens || 2048)));
    const runId = crypto.randomUUID();
    const attempts: any[] = [];

    for (const route of scored.slice(0, 3)) {
      const started = Date.now();
      try {
        const result: any = await callModel(route, prompt, maxOutputTokens, keys);
        const latencyMs = Date.now() - started;

        if (route.execution_mode === "human_only") {
          return json({
            ok: true,
            run_id: runId,
            decision,
            selected_route: route.route_key,
            human_handoff: true,
            url: result.url,
            prompt,
            attempts,
          });
        }

        const text = clean(result.text, 20000);
        if (!text) throw new Error("empty_model_output");

        await sql`
          insert into osa_brain.model_route_stats(
            domain,route_key,attempts,successes,failures,avg_reward,avg_latency_ms,last_used_at
          )
          values(${domain},${route.route_key},1,1,0,0.2,${latencyMs},now())
          on conflict(domain,route_key) do update set
            attempts=osa_brain.model_route_stats.attempts+1,
            successes=osa_brain.model_route_stats.successes+1,
            avg_latency_ms=case
              when osa_brain.model_route_stats.avg_latency_ms is null then ${latencyMs}
              else (osa_brain.model_route_stats.avg_latency_ms*0.8)+(${latencyMs}*0.2)
            end,
            last_error=null,
            last_used_at=now(),
            updated_at=now()
        `;

        attempts.push({ route_key: route.route_key, ok: true, latency_ms: latencyMs });
        return json({
          ok: true,
          run_id: runId,
          decision: { ...decision, actual_route: route.route_key },
          provider: route.provider,
          model: route.model,
          text,
          usage: result.usage ?? null,
          response_id: result.response_id ?? null,
          attempts,
        });
      } catch (error) {
        const latencyMs = Date.now() - started;
        const message = clean(error instanceof Error ? error.message : String(error), 500);
        attempts.push({ route_key: route.route_key, ok: false, latency_ms: latencyMs, error: message });

        await sql`
          insert into osa_brain.model_route_stats(
            domain,route_key,attempts,successes,failures,avg_reward,avg_latency_ms,last_error,last_used_at
          )
          values(${domain},${route.route_key},1,0,1,-0.5,${latencyMs},${message},now())
          on conflict(domain,route_key) do update set
            attempts=osa_brain.model_route_stats.attempts+1,
            failures=osa_brain.model_route_stats.failures+1,
            avg_latency_ms=case
              when osa_brain.model_route_stats.avg_latency_ms is null then ${latencyMs}
              else (osa_brain.model_route_stats.avg_latency_ms*0.8)+(${latencyMs}*0.2)
            end,
            last_error=${message},
            last_used_at=now(),
            updated_at=now()
        `;
      }
    }

    return json({ ok: false, error: "all_routes_failed", run_id: runId, decision, attempts }, 502);
  } catch (error) {
    console.error("osa_ai_router", error);
    return json({
      ok: false,
      error: "router_failed",
      detail: clean(error instanceof Error ? error.message : String(error), 500),
    }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
