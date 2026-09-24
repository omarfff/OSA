# OSA Multi-Model AI Swarm

OSA now has two AI routing layers:

1. **Local/runtime router** — `tools/ai-router.mjs` supports Ollama, Anthropic Claude, any HTTPS OpenAI-compatible endpoint, and Gemini with deterministic failover.
2. **Supabase adaptive router + swarm** — `osa-ai-router` selects from the model catalog using task domain, capability, complexity, cost/speed priors, and verified outcome statistics. `osa-ai-swarm` fans a task out to specialist agents, then runs critic and synthesis stages.

## Claude integration

Runtime configuration:

```bash
OSA_AI_PROVIDER_ORDER=ollama,anthropic,openai_compatible,gemini
OSA_ANTHROPIC_API_KEY=
OSA_ANTHROPIC_MODEL=claude-sonnet-5
```

Never commit a real API key. For Supabase, store `ANTHROPIC_API_KEY` in the project secret/Vault path already used by the OSA control plane.

The adaptive model catalog may contain multiple Claude routes. Model IDs are configuration, not secrets, and should be refreshed when the provider changes its active catalog.

## Swarm pattern

A synchronous swarm run is intentionally bounded to eight specialists:

- mapper
- evidence scout
- skeptic
- builder
- optimizer
- domain specialist
- novelty scout
- risk reviewer

The run then adds:

- critic — checks contradictions, unsupported claims, duplicated ideas, and missing tests.
- synthesizer — produces the final answer while preserving uncertainty and unresolved risks.

This is not intended to imitate a 950-agent research cluster inside one Edge Function. Larger swarms should move to durable queues/workers so retries, budgets, leases, cancellation, and per-agent observability are explicit.

## Persistence

`osa_brain.swarm_runs` stores the objective, strategy, state, and final result.

`osa_brain.swarm_members` stores each role, selected route/provider/model, output, latency, and failure state.

The tables are private: RLS is enabled and access is revoked from `anon` and `authenticated`.

## Verification

Before treating Claude as active:

1. Confirm the server secret is present without printing the value.
2. Call the router status endpoint and verify `configured.anthropic=true`.
3. Run one single-agent Claude request and record technical success.
4. Run a two- or four-agent `claude_first` swarm.
5. Only then increase concurrency or enable mixed-provider experiments.

A model call completing successfully is technical verification, not proof that its answer is correct. Outcome feedback should only reward independently verified results.
