import { runCarHunterCycle } from '../src/car-hunter/autopilot.js';

runCarHunterCycle()
  .then((result) => {
    process.stdout.write(`${JSON.stringify({ ok: true, summary: result.summary, alerts: result.alerts.slice(0, 5) }, null, 2)}\n`);
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    process.exit(1);
  });
