import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const WORK_TYPES = new Set(['revenue-action','direct-blocker','safety-incident','product','infrastructure','payment','platform','browser','autonomy','maintenance']);
const IMPACTS = new Set(['direct','blocker','fulfillment','retention','none']);
const RISKS = new Set(['none','security-incident','legal','data-loss','production-outage']);
const REQUIRED = ['work-type','revenue-impact','external-evidence','why-now','kill-criteria','risk-exception'];

export function parseDecision(text = '') {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*(Work-Type|Revenue-Impact|External-Evidence|Why-Now|Kill-Criteria|Risk-Exception)\s*:\s*(.*?)\s*$/i);
    if (!m) continue;
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function empty(v) {
  return !v || ['n/a','na','tbd','todo'].includes(String(v).trim().toLowerCase());
}

function none(v) {
  return empty(v) || ['none','no','null'].includes(String(v).trim().toLowerCase());
}

export function evaluateDecision(fields, { preFirstPayment = true } = {}) {
  const errors = [];
  for (const key of REQUIRED) if (empty(fields[key])) errors.push(`missing ${key}`);
  const work = String(fields['work-type'] || '').toLowerCase();
  const impact = String(fields['revenue-impact'] || '').toLowerCase();
  const risk = String(fields['risk-exception'] || '').toLowerCase();
  if (work && !WORK_TYPES.has(work)) errors.push(`invalid work-type: ${work}`);
  if (impact && !IMPACTS.has(impact)) errors.push(`invalid revenue-impact: ${impact}`);
  if (risk && !RISKS.has(risk)) errors.push(`invalid risk-exception: ${risk}`);
  if (preFirstPayment && impact === 'none' && risk === 'none') errors.push('pre-payment task is parked: no revenue impact and no risk exception');
  if (['direct','blocker','fulfillment','retention'].includes(impact) && none(fields['external-evidence'])) errors.push('external-evidence is required for claimed revenue impact');
  if (risk !== 'none' && RISKS.has(risk) && none(fields['external-evidence'])) errors.push('risk exception requires incident/legal/production evidence');
  if (work === 'direct-blocker' && !['direct','blocker'].includes(impact)) errors.push('direct-blocker must have direct or blocker revenue-impact');
  if (work === 'safety-incident' && risk === 'none') errors.push('safety-incident requires a risk-exception');
  return { ok: errors.length === 0, errors };
}

export function formatResult(result) {
  if (result.ok) return 'REVENUE_GATE=PASS';
  return ['REVENUE_GATE=FAIL', ...result.errors.map(e => `- ${e}`)].join('\n');
}

function main() {
  let text = process.env.PR_BODY || '';
  if (!text && process.argv[2]) text = fs.readFileSync(process.argv[2], 'utf8');
  if (!text) {
    console.error('REVENUE_GATE=FAIL\n- decision record missing (PR_BODY or file path required)');
    process.exit(2);
  }
  const result = evaluateDecision(parseDecision(text));
  console.log(formatResult(result));
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
