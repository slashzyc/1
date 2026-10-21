import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base=process.env.DEMO_BASE_URL||'http://127.0.0.1:3000',mode=process.argv.includes('--live')?'live':'demo';
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(process.env.APP_TOKEN?{Authorization:`Bearer ${process.env.APP_TOKEN}`}:{})},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||r.status);return j;}
const input={workflow:'rfq',market:'DE',mode,productId:'HF-BOX-01',prompt:'德国买家采购500件收纳盒，请提供正式但友好的回复，并确认样品需求。',quantity:500};
const evidence=[];
const file=process.env.EVIDENCE_PATH||`data/${mode}-verification.json`;mkdirSync('data',{recursive:true});
const checkpoint=(status,extra={})=>writeFileSync(file,JSON.stringify({verifiedAt:new Date().toISOString(),mode,status,steps:evidence,...extra,note:'Synthetic business inputs; live means external model response received. No credentials included.'},null,2));
try {
let run=await post('/api/runs',input);const record=r=>{assert(r.output.content.en.body);assert(r.output.content.de.body);if(mode==='live')assert(r.trace.responseId);evidence.push({id:r.id,version:r.version,workflow:r.input.workflow,mode:r.trace.mode,model:r.trace.model,responseId:r.trace.responseId??null,durationMs:r.trace.durationMs,attempts:r.trace.attempts,usage:r.trace.usage,highRisks:r.validation.counts.high,enTitle:r.output.content.en.title,deTitle:r.output.content.de.title});checkpoint('in-progress');console.log(`${r.input.workflow} V${r.version}: ${r.trace.mode} · ${r.trace.durationMs}ms · ${r.validation.counts.high} high risk(s)`);};record(run);
assert.equal(run.quote.totalCents,160000);
for(const prompt of ['请更简短，保留所有事实与报价条件。','请在上一版补充样品和后续跟进，不承诺具体寄出日期。']){run=await post(`/api/runs/${run.id}/revisions`,{prompt,expectedVersion:run.version});record(run);}
assert.equal(run.version,3);
const listing=await post('/api/runs',{...input,workflow:'listing',sourceRunId:run.id,prompt:'请为同一商品生成本地化英德双语 Amazon Listing，只使用商品事实。'});record(listing);
for(const lang of ['en','de']){assert([...listing.output.content[lang].title].length<=75);assert([...listing.output.content[lang].highlights].length<=125);}
assert(!listing.validation.risks.some(r=>r.id.startsWith('listing-style-')),'Listing must not contain email-style content');
const support=await post('/api/runs',{...input,workflow:'support',prompt:'买家收到12件破损商品，请安抚、索取必要凭证并交接人工。不承诺退款已执行。'});record(support);
const compliance=await post('/api/runs',{...input,workflow:'compliance',prompt:'检查德国市场资料缺口，拟用的环保、食品级与绝对安全宣传都没有证据，请给出风险和修改方向。'});record(compliance);
const ticket=await post('/api/tickets',{runId:support.id,reason:'需要人工核对受损凭证与售后选项'});assert(ticket.id);
checkpoint('passed',{handoffCreated:true});console.log(`End-to-end evidence written to ${file}`);
} catch(error) {checkpoint('failed',{error:error.message});console.error(error.message);process.exitCode=1;}
