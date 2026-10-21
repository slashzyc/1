import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp,environment } from '../server.js';
import { openStore } from '../src/store.js';
import { request } from 'node:http';
async function withApp(fn,extra={}) {const app=createApp({port:0,host:'127.0.0.1',apiKey:'',baseUrl:'https://api.deepseek.com',model:'test',...extra},openStore(':memory:'));await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;try{await fn(base,app);}finally{await new Promise(r=>app.server.close(r));app.store.close();}}
const input={workflow:'rfq',market:'DE',mode:'demo',productId:'HF-BOX-01',prompt:'请报价',quantity:500};
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('API completes RFQ, 2 revisions, linked listing, export and handoff',()=>withApp(async base=>{
 let res=await post(base,'/api/runs',input),run=await res.json();assert.equal(res.status,201);assert.equal(run.quote.totalCents,160000);
 for(const prompt of ['请更简短','补充样品和跟进']){res=await post(base,`/api/runs/${run.id}/revisions`,{prompt,expectedVersion:run.version});run=await res.json();assert.equal(res.status,201);}
 assert.equal(run.version,3);res=await post(base,`/api/runs/${run.id}/revisions`,{prompt:'stale',expectedVersion:1});assert.equal(res.status,409);
 res=await post(base,'/api/runs',{...input,workflow:'listing',sourceRunId:run.id});const listing=await res.json();assert.equal(listing.input.sourceRunId,run.id);assert(listing.output.content.de.title.length<=75);
 const exported=await(await fetch(`${base}/api/runs/${run.id}/export`)).json();assert.equal(exported.history.length,3);assert(exported.run.validation.risks.length);
 const t=await(await post(base,'/api/tickets',{runId:run.id,reason:'需要复核'})).json();const updated=await fetch(`${base}/api/tickets/${t.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:1,status:'active',assignedTo:'测试员',note:'核对凭证'})});assert.equal(updated.status,200);
}));
test('idempotency returns same run and rejects changed payload',()=>withApp(async(base,app)=>{const headers={'Idempotency-Key':'repeat-request-123'};const a=await(await post(base,'/api/runs',input,headers)).json(),b=await(await post(base,'/api/runs',input,headers)).json();assert.equal(a.id,b.id);assert.equal(app.store.metrics().runs,1);const res=await post(base,'/api/runs',{...input,prompt:'different'},headers);assert.equal(res.status,409);}));
test('batch reports each item failure without hiding successes',()=>withApp(async base=>{const r=await(await post(base,'/api/runs/batch',{productIds:['HF-BOX-01','missing'],input:{...input,workflow:'listing'}})).json();assert.equal(r.results[0].ok,true);assert.equal(r.results[1].ok,false);}));
test('errors, CSRF, host guard, traversal and input size',()=>withApp(async base=>{
 assert.equal((await post(base,'/api/runs',{...input,quantity:0})).status,400);
 assert.equal((await post(base,'/api/runs',null)).status,400);
 assert.equal((await post(base,'/api/runs',{...input,productId:{bad:true}})).status,400);
 assert.equal((await post(base,'/api/runs',input,{Origin:'https://evil.example'})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>{const req=request(base+'/api/bootstrap',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostStatus,403);
 assert.equal((await fetch(`${base}/.env`)).status,404);
 assert.equal((await fetch(`${base}/src/model.js`)).status,404);
 assert.equal((await post(base,'/api/runs',{...input,prompt:'x'.repeat(270000)})).status,413);
 const res=await fetch(base+'/');assert(res.headers.get('content-security-policy').includes("script-src 'self'"));assert.equal(res.status,200);
}));
test('live failure is explicit and creates no output record',()=>withApp(async(base,app)=>{const r=await post(base,'/api/runs',{...input,mode:'live'});assert.equal(r.status,503);assert.equal(app.store.metrics().runs,0);}));
test('token protects all business APIs; public health contains no details',()=>withApp(async base=>{assert.equal((await fetch(base+'/api/bootstrap')).status,401);const good=await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer test-long-workspace-secret'}});const body=await good.json();assert.equal(good.status,200);assert(!JSON.stringify(body).includes('test-long-workspace-secret'));assert.deepEqual(await(await fetch(base+'/healthz')).json(),{ok:true});},{appToken:'test-long-workspace-secret'}));
test('non-loopback deployment requires authentication',()=>{assert.throws(()=>environment({HOST:'0.0.0.0'}));assert.equal(environment({HOST:'0.0.0.0',APP_TOKEN:'a'.repeat(32)}).host,'0.0.0.0');});
