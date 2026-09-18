import { runRealEstateHunterCycle } from '../src/real-estate-hunter/autopilot.js';

runRealEstateHunterCycle()
  .then((result) => {
    process.stdout.write(JSON.stringify({
      ok: true,
      generatedAt: result.generatedAt,
      summary: result.summary,
      market: result.market,
      alerts: result.alerts,
      training: result.training,
      recentOpportunityEvents: result.recentOpportunityEvents,
      sources: result.sources.map((source) => ({
        sourceId: source.sourceId,
        state: source.state,
        parsed: source.parsed,
      })),
    }, null, 2) + '\n');
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    process.exit(1);
  });
