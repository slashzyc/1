import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.DEMO_BASE_URL||'http://127.0.0.1:3000';
const report=JSON.parse(readFileSync('data/live-verification.json','utf8'));
assert.equal(report.status,'passed');
mkdirSync('docs/evidence',{recursive:true});copyFileSync('data/live-verification.json','docs/evidence/live-verification.json');
const runs=[];
for(const id of new Set(report.steps.map(s=>s.id))){
  const res=await fetch(`${base}/api/runs/${id}/export`,{headers:process.env.APP_TOKEN?{Authorization:`Bearer ${process.env.APP_TOKEN}`}:{}});assert(res.ok);const data=await res.json();assert(data.run.product.synthetic,'Only synthetic examples may be published as verification evidence');runs.push(data);
}
const evidence={purpose:'Synthetic acceptance examples; review-required drafts, not actual transactions.',runs};
const serialized=JSON.stringify(evidence,null,2);
assert(!/sk-[a-zA-Z0-9]{16,}/.test(serialized),'Do not publish credentials in evidence');
writeFileSync('docs/evidence/business-samples.json',serialized);
console.log(`Captured ${runs.length} synthetic workflow examples, including all RFQ revisions.`);
console.log(JSON.stringify(runs.map(x=>({workflow:x.run.input.workflow,title:x.run.output.content.en.title,body:x.run.output.content.en.body,highRisks:x.run.validation.risks.filter(r=>r.severity==='high').map(r=>r.id)})),null,2));
