#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.OSA_SELF_HEAL_MODEL || 'qwen2.5-coder:1.5b';
const MAX_CONTEXT = 22000;
const ALLOWED = /^(tools|ops|src|config|scripts|test|tests)\//;
const DENIED = /(^|\/)(\.env|\.git|node_modules)(\/|$)|secret|credential|private[_-]?key|seed[_-]?phrase/i;
const SENSITIVE_DIFF = /^\+.*\b(password|private[_-]?key|seed[_-]?phrase|api[_-]?key|secret[_-]?key)\s*[:=]/im;

function emit(result) {
  process.stdout.write('SELF_HEAL_RESULT='+JSON.stringify(result)+'\n');
}

function compactText(v, max=6000) {
  return String(v ?? '').replace(/\u0000/g,'').slice(0,max);
}

async function run(cmd,args=[],opts={}) {
  try {
    const {stdout='',stderr=''} = await execFile(cmd,args,{
      cwd: opts.cwd || ROOT,
      timeout: opts.timeout ?? 120000,
      maxBuffer: opts.maxBuffer ?? 4*1024*1024,
      env: {...process.env,...(opts.env||{})},
    });
    return {ok:true,code:0,stdout:String(stdout).trim(),stderr:String(stderr).trim()};
  } catch (err) {
    return {
      ok:false,
      code: Number.isInteger(err?.code) ? err.code : 1,
      stdout:String(err?.stdout||'').trim(),
      stderr:String(err?.stderr||err?.message||'').trim(),
    };
  }
}

function decodePayload(raw) {
  if (!raw) return {};
  try {
    const text = Buffer.from(String(raw),'base64').toString('utf8');
    return JSON.parse(text);
  } catch {
    try { return JSON.parse(String(raw)); } catch { return {}; }
  }
}

function keywords(payload) {
  const raw = [
    payload.failure_class,payload.last_error,payload.stderr,payload.summary,
    payload.task_key,payload.title,payload.purpose
  ].filter(Boolean).join(' ');
  const stop = new Set(['error','failed','failure','task','company','execution','dispatcher','unknown','timeout','command','state']);
  return [...new Set((raw.match(/[A-Za-z_][A-Za-z0-9_.-]{4,}/g)||[])
    .map(x=>x.replace(/^[-.]+|[-.]+$/g,''))
    .filter(x=>x.length>=5 && x.length<=80 && !stop.has(x.toLowerCase())))]
    .slice(0,8);
}


async function agentToolEvidence(cwd,payload) {
  const goal=[
    payload.summary,payload.failure_class,payload.last_error,payload.stderr,
    payload.task_key,payload.title,payload.purpose
  ].filter(Boolean).join(' ').slice(0,5000);
  if (!goal) return '';
  const planRun=await run('node',['tools/agent-fabric.mjs','plan',goal],{cwd,timeout:30000,maxBuffer:512*1024});
  if (!planRun.ok || !planRun.stdout) return '';
  let plan;
  try { plan=JSON.parse(planRun.stdout); } catch { return ''; }
  const urlMatch=goal.match(/https?:\/\/[^\s<>"']+/);
  const outputs=[];
  for (const item of (plan?.plan||[])) {
    if (outputs.length>=3) break;
    if (!item?.id || item.id==='self-healing-engineer') continue;
    if (!['read_only','draft'].includes(item.access)) continue;
    const args=[];
    if (item.requires_args) {
      if (!urlMatch) continue;
      args.push(urlMatch[0].replace(/[),.;\]]+$/,''));
    }
    const r=await run('node',['tools/agent-fabric.mjs','run',item.id,...args],{
      cwd,timeout:90000,maxBuffer:768*1024
    });
    outputs.push({
      agent:item.id,why:item.why,ok:r.ok,
      stdout:r.stdout.slice(0,5000),stderr:r.stderr.slice(0,1500)
    });
  }
  return outputs.length ? JSON.stringify(outputs) : '';
}

async function repoEvidence(cwd,payload) {
  const parts=[];
  const files = new Set();
  const stack = [payload.last_error,payload.stderr,payload.stdout,payload.summary].filter(Boolean).join('\n');
  for (const m of stack.matchAll(/(?:^|\s)((?:tools|ops|src|config|scripts|test|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|js|py|sh|json))/g)) {
    files.add(m[1]);
  }
  for (const f of [...files].slice(0,6)) {
    try {
      const text = await fs.readFile(path.join(cwd,f),'utf8');
      parts.push(`FILE ${f}\n${text.slice(0,6500)}`);
    } catch {}
  }
  for (const k of keywords(payload)) {
    const g=await run('git',['grep','-n','-I','--',k],{cwd,timeout:15000,maxBuffer:512*1024});
    if (g.ok && g.stdout) parts.push(`GREP ${k}\n${g.stdout.slice(0,3500)}`);
    if (parts.join('\n\n').length>=MAX_CONTEXT) break;
  }
  return parts.join('\n\n').slice(0,MAX_CONTEXT);
}

async function askLocalCoder(prompt) {
  try {
    const res=await fetch('http://127.0.0.1:11434/api/generate',{
      method:'POST',
      headers:{'content-type':'application/json'},
      signal:AbortSignal.timeout(150000),
      body:JSON.stringify({
        model:MODEL,
        prompt,
        stream:false,
        format:'json',
        options:{temperature:0.05,num_predict:1400}
      })
    });
    if (!res.ok) return null;
    const body=await res.json();
    return String(body?.response||'');
  } catch {
    return null;
  }
}

function extractJson(text) {
  const raw=String(text||'').trim().replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim();
  try { return JSON.parse(raw); } catch {}
  const start=raw.indexOf('{'), end=raw.lastIndexOf('}');
  if (start>=0 && end>start) {
    try { return JSON.parse(raw.slice(start,end+1)); } catch {}
  }
  return null;
}

function validateDiff(diff) {
  if (!diff || typeof diff!=='string') return {ok:false,reason:'empty_diff'};
  if (diff.length>90000) return {ok:false,reason:'diff_too_large'};
  if (SENSITIVE_DIFF.test(diff)) return {ok:false,reason:'secret_like_assignment_in_diff'};
  const files=[];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/') || line.startsWith('--- a/')) {
      const f=line.slice(6).trim();
      if (f==='/dev/null') continue;
      files.push(f);
    }
  }
  const unique=[...new Set(files)];
  if (!unique.length) return {ok:false,reason:'no_files_in_diff'};
  for (const f of unique) {
    if (!ALLOWED.test(f)) return {ok:false,reason:`path_not_allowed:${f}`};
    if (DENIED.test(f)) return {ok:false,reason:`sensitive_path:${f}`};
  }
  return {ok:true,files:unique};
}

async function deterministicTests(cwd,files) {
  const checks=[];
  const doRun=async(name,cmd,args,timeout=120000)=>{
    const r=await run(cmd,args,{cwd,timeout});
    checks.push({name,ok:r.ok,code:r.code,stdout:r.stdout.slice(0,2500),stderr:r.stderr.slice(0,2500)});
    return r.ok;
  };
  if (!await doRun('git-diff-check','git',['diff','--check'],30000)) return checks;
  for (const f of files.filter(x=>/\.(?:mjs|js)$/.test(x))) {
    if (!await doRun(`node-check:${f}`,'node',['--check',f],30000)) return checks;
  }
  if (files.some(x=>x==='tools/agent-fabric.mjs' || x==='config/agent-fabric.json')) {
    if (!await doRun('agent-fabric-list','node',['tools/agent-fabric.mjs','list'],45000)) return checks;
  }
  await doRun('npm-test','npm',['test'],180000);
  return checks;
}

function noCodeClass(payload) {
  const cls=String(payload.failure_class||'');
  const text=[payload.last_error,payload.stderr,payload.summary,payload.blocked_reason].filter(Boolean).join(' ').toLowerCase();
  if (cls==='RUNNER_STUCK_TIMEOUT') return 'runner_stuck_timeout_is_reaped_by_database_watchdog';
  if (/external buyer review pending|requester review|competition judging|external decision/.test(text)) return 'external_wait_not_a_code_bug';
  if (cls==='NO_EXTERNAL_EFFECT' && /waiting|pending|review/.test(text)) return 'external_effect_pending_not_a_code_bug';
  return null;
}

async function main() {
  const payload=decodePayload(process.argv[2] || process.env.OSA_SELF_HEAL_PAYLOAD_B64 || '');
  const incidentId=String(payload.incident_key || payload.vps_task_id || payload.task_key || Date.now()).replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80);
  const result={
    ok:false,mode:'self_heal',model:MODEL,incident:incidentId,
    diagnosis:null,changed_files:[],tests:[],commit:null,rollback:false
  };

  const known=noCodeClass(payload);
  if (known) {
    if (known.startsWith('runner_stuck')) {
      const w=await run('node',['tools/autopilot-watchdog.mjs'],{cwd:ROOT,timeout:90000});
      result.ok=w.ok; result.diagnosis=known; result.watchdog={ok:w.ok,stdout:w.stdout.slice(0,3000),stderr:w.stderr.slice(0,1500)};
    } else {
      result.ok=true; result.diagnosis=known;
    }
    emit(result);
    return;
  }

  const clean=await run('git',['status','--porcelain'],{cwd:ROOT,timeout:20000});
  if (!clean.ok || clean.stdout) throw new Error('root_worktree_not_clean');
  if (!(await run('git',['fetch','origin','main','--quiet'],{cwd:ROOT,timeout:60000})).ok) throw new Error('git_fetch_failed');
  const base=(await run('git',['rev-parse','origin/main'],{cwd:ROOT,timeout:15000})).stdout.trim();
  if (!base) throw new Error('origin_main_missing');

  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),`osa-heal-${incidentId}-`));
  let worktreeAdded=false;
  try {
    const add=await run('git',['worktree','add','--detach',tmp,base],{cwd:ROOT,timeout:60000});
    if (!add.ok) throw new Error('git_worktree_add_failed:'+add.stderr);
    worktreeAdded=true;

    const evidence=await repoEvidence(tmp,payload);
    const toolEvidence=await agentToolEvidence(tmp,payload);
    const prompt=[
      'You are OSA Self-Healing Coding Engineer.',
      'Return ONLY strict JSON: {"diagnosis":"...","confidence":0.0,"unified_diff":"...","why_tests":"..."}.',
      'Your unified_diff must be a standard git unified diff against the supplied repository evidence.',
      'Modify only existing code/config under tools/, ops/, src/, config/, scripts/, test/, tests/.',
      'Do not modify secrets, credentials, wallets, private keys, seed phrases, .env, dependencies, auth, KYC, financial policies, or Supabase SQL.',
      'Do not weaken safety or tests. Prefer the smallest root-cause fix. If evidence is insufficient, return unified_diff as an empty string.',
      'Do not output shell commands or markdown fences.',
      'FAILURE PAYLOAD:',
      JSON.stringify({
        failure_class:payload.failure_class,last_error:compactText(payload.last_error,5000),
        stderr:compactText(payload.stderr,5000),stdout:compactText(payload.stdout,3500),
        summary:compactText(payload.summary,2500),task_key:payload.task_key,title:payload.title,
        purpose:payload.purpose,blocked_reason:compactText(payload.blocked_reason,2000)
      }),
      'TOOL EVIDENCE:',
      toolEvidence || '(no additional agent-tool evidence)',
      'REPOSITORY EVIDENCE:',
      evidence || '(no direct code match found)'
    ].join('\n\n');

    let answer=await askLocalCoder(prompt);
    let proposal=extractJson(answer);
    let modelUsed=MODEL;
    if (!proposal) {
      const helper=await run('bash',['ops/ai-router-with-brain-env.sh','ask',prompt],{
        cwd:tmp,timeout:180000,maxBuffer:2*1024*1024
      });
      answer=helper.stdout;
      proposal=extractJson(answer);
      modelUsed='ai-router-fallback';
    }
    result.model=modelUsed;
    if (!proposal) throw new Error('coder_and_router_output_not_json');
    result.diagnosis=compactText(proposal.diagnosis,3000);
    result.confidence=Number(proposal.confidence||0);
    const diff=String(proposal.unified_diff||'');
    const valid=validateDiff(diff);
    if (!valid.ok) {
      result.ok=false;
      result.no_patch_reason=valid.reason;
      result.failure='no_verified_patch';
      emit(result);
      return;
    }

    const patchFile=path.join(tmp,'.osa-self-heal.patch');
    await fs.writeFile(patchFile,diff,{mode:0o600});
    const check=await run('git',['apply','--check',patchFile],{cwd:tmp,timeout:30000});
    if (!check.ok) throw new Error('git_apply_check_failed:'+check.stderr);
    const applied=await run('git',['apply',patchFile],{cwd:tmp,timeout:30000});
    if (!applied.ok) throw new Error('git_apply_failed:'+applied.stderr);

    const changed=(await run('git',['diff','--name-only'],{cwd:tmp,timeout:15000})).stdout.split(/\r?\n/).filter(Boolean);
    if (!changed.length) throw new Error('patch_changed_nothing');
    for (const f of changed) {
      if (!ALLOWED.test(f) || DENIED.test(f)) throw new Error('changed_path_not_allowed:'+f);
    }
    result.changed_files=changed;

    const tests=await deterministicTests(tmp,changed);
    result.tests=tests;
    if (tests.some(t=>!t.ok)) {
      result.rollback=true;
      result.ok=false;
      result.failure='verification_failed';
      emit(result);
      return;
    }

    const latestFetch=await run('git',['fetch','origin','main','--quiet'],{cwd:ROOT,timeout:60000});
    if (!latestFetch.ok) throw new Error('pre_push_fetch_failed');
    const latest=(await run('git',['rev-parse','origin/main'],{cwd:ROOT,timeout:15000})).stdout.trim();
    if (latest!==base) {
      result.rollback=true; result.failure='origin_main_changed_during_repair';
      emit(result);
      return;
    }

    await run('git',['add','-A'],{cwd:tmp,timeout:15000});
    const msg=`Self-heal: ${String(payload.failure_class||payload.task_key||'runtime failure').slice(0,70)}`;
    const commit=await run('git',['commit','-m',msg],{cwd:tmp,timeout:60000});
    if (!commit.ok) throw new Error('git_commit_failed:'+commit.stderr);
    const sha=(await run('git',['rev-parse','HEAD'],{cwd:tmp,timeout:15000})).stdout.trim();
    const push=await run('git',['push','origin','HEAD:main'],{cwd:tmp,timeout:120000});
    if (!push.ok) throw new Error('git_push_failed:'+push.stderr);
    result.commit=sha; result.ok=true;
    emit(result);
  } finally {
    if (worktreeAdded) await run('git',['worktree','remove','--force',tmp],{cwd:ROOT,timeout:60000});
    else { try { await fs.rm(tmp,{recursive:true,force:true}); } catch {} }
  }
}

main().catch((err)=>{
  emit({ok:false,mode:'self_heal',error:String(err?.message||err).slice(0,5000)});
  process.exitCode=1;
});
