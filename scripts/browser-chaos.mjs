import assert from 'node:assert/strict'; import {hostAllowed,normalizeTarget,classifyGate} from '../tools/osa-browser-runtime.mjs';
const site={domains:['example.com']};
for(let i=0;i<2000;i++){const good=`https://${i%2?'www.':''}example.com/path/${i}`;assert.equal(hostAllowed(new URL(good).hostname,site.domains),true);assert.doesNotThrow(()=>normalizeTarget(site,good));const bad=`https://example.com.bad${i}.invalid/`;assert.equal(hostAllowed(new URL(bad).hostname,site.domains),false);assert.throws(()=>normalizeTarget(site,bad));}
for(let i=0;i<1000;i++)assert.ok(['none','security_gate'].includes(classifyGate({status:i%17===0?403:200,text:`page-${i}`})));
console.log(JSON.stringify({ok:true,iterations:3000}));
