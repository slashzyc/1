import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { agents, knowledge, AppError, assert, str, integer } from './src/domain.js';
import { openStore } from './src/store.js';
import { execute, markdownExport } from './src/engine.js';
const root=dirname(fileURLToPath(import.meta.url));
export function environment(env=process.env) {
  const host=env.HOST||'127.0.0.1', appToken=env.APP_TOKEN||'';
  if(!['127.0.0.1','localhost','::1'].includes(host) && appToken.length<24) throw new Error('非本机监听必须设置至少 24 字符的 APP_TOKEN，并通过 HTTPS 反向代理访问。');
  return {host,port:Number(env.PORT||3000),dataDir:resolve(env.DATA_DIR||join(root,'data')),appToken,origin:env.APP_ORIGIN||'',apiKey:env.MODEL_API_KEY||'',baseUrl:env.MODEL_BASE_URL||'https://api.deepseek.com',model:env.MODEL_NAME||'deepseek-flash',timeoutMs:Math.min(120000,Math.max(1000,Number(env.MODEL_TIMEOUT_MS)||60000))};
}
export function createApp(config,store=openStore(config.dataDir)) {
  let inflight=0;const pending=new Set(),limits=new Map();
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
  const rateLimit=(key,max)=>{const now=Date.now();for(const [k,v]of limits)if(now-v.at>60000)limits.delete(k);const v=limits.get(key)||{at:now,n:0};v.n++;limits.set(key,v);assert(v.n<=max,'请求过于频繁，请稍后重试','RATE_LIMIT',429);};
  async function readBody(req) {
    assert((req.headers['content-type']||'').split(';')[0]==='application/json','请使用 application/json','CONTENT_TYPE',415);
    return new Promise((resolve,reject)=>{
      const parts=[];let size=0,failed=false;
      req.on('data',part=>{if(failed)return;size+=part.length;if(size>262144){failed=true;parts.length=0;reject(new AppError('BODY_LIMIT','请求体超过 256 KB',413));return;}parts.push(part);});
      req.on('error',()=>reject(new AppError('REQUEST_INTERRUPTED','请求传输中断，请重试',400)));
      req.on('end',()=>{if(failed)return;try{const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value)){reject(new AppError('VALIDATION','请求须为 JSON 对象'));return;}resolve(value);}catch{reject(new AppError('JSON_INVALID','JSON 格式不正确'));}});
    });
  }
  async function generation(req,body,fn) {
    rateLimit(`${req.socket.remoteAddress}:generate`,30);
    const key=req.headers['idempotency-key'];
    if(key) assert(typeof key==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(key),'请求标识格式不正确');
    const hash=createHash('sha256').update(req.url+'\n'+JSON.stringify(body)).digest('hex');
    if(key) {const cached=store.cached(key,hash);if(cached)return cached;assert(!pending.has(key),'该请求仍在处理中，请稍后重试同一请求','REQUEST_PENDING',409);}
    assert(inflight<3,'当前生成任务较多，请稍后重试','BUSY',429);
    inflight++;if(key)pending.add(key);
    try{const result=await fn();if(key)store.cache(key,hash,result);return result;}
    finally{inflight--;if(key)pending.delete(key);}
  }
  const staticFiles={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/pitch.html':'pitch.html'};
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const server=createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const currentPort=server.address()?.port??config.port;
      const allowedHosts=new Set([`127.0.0.1:${currentPort}`,`localhost:${currentPort}`,`[::1]:${currentPort}`]);
      if(config.origin)allowedHosts.add(new URL(config.origin).host);
      assert(allowedHosts.has(req.headers.host),'Host 不受信任','HOST_INVALID',403);
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz')return json(res,200,{ok:true});
      if(url.pathname==='/readyz')return json(res,store.health()?200:503,{ok:store.health()});
      if(url.pathname.startsWith('/api/')) {
        rateLimit(req.socket.remoteAddress||'local',180);
        if(config.appToken)assert(equal(req.headers.authorization||'',`Bearer ${config.appToken}`),'请输入工作区访问口令','UNAUTHORIZED',401);
        const origin=req.headers.origin;
        if(origin){const allowedOrigins=new Set([...allowedHosts].map(h=>`http://${h}`));if(config.origin)allowedOrigins.add(config.origin);assert(allowedOrigins.has(origin),'跨站请求被拒绝','ORIGIN_INVALID',403);}
        if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(res,200,{agents,knowledge,products:store.products(),runs:store.runs().map(r=>({id:r.id,version:r.version,product:r.product.name,workflow:r.input.workflow,mode:r.input.mode,market:r.input.market,updatedAt:r.updatedAt,highRisks:r.validation.counts.high})),tickets:store.tickets(),metrics:store.metrics(),provider:{configured:!!config.apiKey,model:config.model,host:new URL(config.baseUrl).hostname},audit:store.auditList()});
        if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,agents);
        if(req.method==='POST'&&url.pathname==='/api/products/import') {const body=await readBody(req);assert(Array.isArray(body.products)&&body.products.length>0&&body.products.length<=100,'每次导入 1–100 个商品');return json(res,200,{products:store.importProducts(body.products)});}
        if(req.method==='POST'&&url.pathname==='/api/runs') {const body=await readBody(req);return json(res,201,await generation(req,body,()=>execute(store,body,config)));}
        if(req.method==='POST'&&url.pathname==='/api/runs/batch') {
          const body=await readBody(req);assert(Array.isArray(body.productIds)&&body.productIds.length>=1&&body.productIds.length<=5,'批量请选择 1–5 个商品');
          assert(new Set(body.productIds).size===body.productIds.length,'批量商品不能重复');
          assert(body.input?.workflow==='listing','批量生成当前支持商品上架');
          return json(res,200,await generation(req,body,async()=>{
            const results=[];
            for(const productId of body.productIds)try{const run=await execute(store,{...body.input,productId,sourceRunId:null},config);results.push({productId,ok:true,run});}catch(e){results.push({productId,ok:false,error:{code:e.code||'INTERNAL',message:e instanceof AppError?e.message:'生成失败，请重试'}});}
            return {results};
          }));
        }
        const match=url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)(?:\/(revisions|export))?$/);
        if(match) {
          const run=store.run(match[1]);assert(run,'任务不存在','NOT_FOUND',404);
          if(req.method==='GET'&&!match[2])return json(res,200,{run,history:store.history(run.id)});
          if(req.method==='GET'&&match[2]==='export') {
            if(url.searchParams.get('format')==='md'){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="harborflow-${run.id}-draft.md"`});return res.end(markdownExport(run));}
            return json(res,200,{exportType:'review-required-draft',run,history:store.history(run.id)});
          }
          if(req.method==='POST'&&match[2]==='revisions') {
            const body=await readBody(req);integer(body.expectedVersion,'预期版本',1,20);
            const overrides=body.overrides??{};assert(overrides&&typeof overrides==='object'&&!Array.isArray(overrides),'修订条件必须为对象');
            assert(Object.keys(overrides).every(k=>['quantity','unitPriceCents','validDays','leadDays','currency','incoterm','place','payment'].includes(k)),'修订含不支持的字段');
            return json(res,201,await generation(req,body,()=>{const current=store.run(run.id);assert(current.version===body.expectedVersion,'任务已产生新版本，请刷新','VERSION_CONFLICT',409);return execute(store,{...current.input,...overrides,prompt:str(body.prompt,'修改要求')},config,current);}));
          }
        }
        if(req.method==='POST'&&url.pathname==='/api/tickets') {const body=await readBody(req);const run=store.run(str(body.runId,'任务 ID',80));assert(run,'任务不存在','NOT_FOUND',404);const ticket=store.createTicket(run,str(body.reason,'转人工原因',1000));return json(res,201,ticket);}
        const tm=url.pathname.match(/^\/api\/tickets\/([a-f0-9-]+)$/);
        if(req.method==='PATCH'&&tm){const body=await readBody(req);return json(res,200,store.updateTicket(tm[1],{expectedVersion:integer(body.expectedVersion,'预期版本',1,10000),status:str(body.status,'状态',20),assignedTo:str(body.assignedTo,'处理人',80),note:str(body.note,'处理说明',1000)}));}
        throw new AppError('NOT_FOUND','接口不存在',404);
      }
      if(req.method==='GET'&&staticFiles[url.pathname]) {
        const file=staticFiles[url.pathname],ext=file.slice(file.lastIndexOf('.'));
        const bytes=await readFile(join(root,'public',file));
        if(file==='pitch.html'){
          const html=bytes.toString('utf8');
          const hashes=tag=>[...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`,'g'))].map(m=>`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
          res.setHeader('Content-Security-Policy',`default-src 'self'; script-src ${hashes('script')}; style-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`);
        }
        res.writeHead(200,{'Content-Type':mime[ext]});return res.end(bytes);
      }
      throw new AppError('NOT_FOUND','页面不存在',404);
    } catch(error) {
      const safe=error instanceof AppError;
      if(!safe)console.error(JSON.stringify({requestId,event:'server.error',name:error.name}));
      if(req.url?.startsWith('/api/'))store.audit('request.failed',requestId,{code:safe?error.code:'INTERNAL'});
      if(!res.headersSent)json(res,safe?error.status:500,{error:{code:safe?error.code:'INTERNAL',message:safe?error.message:'服务异常，请稍后重试',requestId}});else res.end();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  return {server,store};
}
async function readSecret() {
  if(!process.stdin.isTTY)throw new Error('--key-stdin requires a terminal');
  process.stdout.write('Model key via hidden stdin (not persisted): ');process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise(resolve=>{let secret='';const listen=chunk=>{const s=chunk.toString();if(s==='\u0003')process.exit(130);if(/[\r\n]/.test(s)){secret+=s.replace(/[\r\n]/g,'');process.stdin.off('data',listen);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(secret.trim());}else if(s==='\u007f'||s==='\b')secret=secret.slice(0,-1);else secret+=s;};process.stdin.on('data',listen);});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=environment();if(process.argv.includes('--key-stdin'))config.apiKey=await readSecret();
  const {server,store}=createApp(config);
  server.listen(config.port,config.host,()=>console.log(`HarborFlow ready at http://${config.host}:${server.address().port} · ${config.apiKey?'live model configured':'offline demo available'}`));
  const close=()=>{server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
