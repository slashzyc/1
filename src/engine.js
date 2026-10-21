import { randomUUID } from 'node:crypto';
import { agents, assert, str, validateInput, retrieve, quote, demoGenerate, validateOutput, checkRisks } from './domain.js';
import { generateLive } from './model.js';
export async function execute(store, body, config, parent=null) {
  const started=Date.now();
  assert(body&&typeof body==='object'&&!Array.isArray(body),'请求须为 JSON 对象');
  str(body.productId,'商品 ID',40);
  if(body.sourceRunId)str(body.sourceRunId,'源任务 ID',80);
  const source = body.sourceRunId ? store.run(body.sourceRunId) : null;
  if(body.sourceRunId) assert(source,'原任务不存在','NOT_FOUND',404);
  const product=parent?.product ?? source?.product ?? store.product(body.productId);
  assert(product,'商品不存在，请先导入商品台账','NOT_FOUND',404);
  assert(!source || source.product.id===body.productId,'关联任务与商品不一致');
  const input=validateInput(body,product);
  const rules=retrieve(input);
  const history=parent?store.history(parent.id):[];
  assert(history.length<20,'单任务最多保留 20 轮生成，请新建任务');
  let output, provider;
  if(input.mode==='live') {const r=await generateLive(input,product,rules,history,config);output=r.output;provider={mode:'live',...r.meta};}
  else {output=validateOutput(demoGenerate(input,product,history));provider={mode:'demo',provider:'local-template',model:'deterministic-v1',attempts:0,usage:null};}
  const now=new Date();
  const result={id:parent?.id ?? randomUUID(),version:(parent?.version??0)+1,createdAt:parent?.createdAt??now.toISOString(),updatedAt:now.toISOString(),
    input,product,output,quote:input.workflow==='rfq'?quote(input,now):null,knowledge:rules,
    validation:checkRisks(input,product,output,rules,now),trace:{...provider,durationMs:Date.now()-started,knowledgeVersion:agents.knowledgeVersion,stages:['理解与输入校验','商品事实与知识检索','双语生成','独立规则检查','版本持久化'],humanReviewRequired:true}};
  return store.save(result,parent?.version??0);
}
export function markdownExport(run) {
  const lines=[`# HarborFlow 业务草稿 · ${run.product.name}`,``, `**状态：需人工复核；非平台发布文件。**`, ``, `任务 ${run.id} · V${run.version} · ${run.trace.mode==='live'?'真实模型':'离线模板'} · ${run.updatedAt}`,``];
  for(const lang of ['en','de']) {const c=run.output.content[lang];lines.push(`## ${lang.toUpperCase()}`,c.title,'',c.highlights,'',c.body,'',...c.bullets.map(v=>`- ${v}`),'');}
  if(run.quote) {const q=run.quote;lines.push('## 报价草稿',`数量：${q.quantity}；单价：${(q.unitPriceCents/100).toFixed(2)} ${q.currency}；商品小计：${(q.totalCents/100).toFixed(2)} ${q.currency}`,`${q.incoterm} ${q.place}；有效至 ${q.expiresAt}；生产交期 ${q.leadDays} 天`,q.payment,q.excludes,'');}
  lines.push('## 风险批注',...run.validation.risks.map(r=>`- [${r.severity}] ${r.message} → ${r.action}（${r.ruleId}）`),'','## 规则来源',...run.knowledge.map(k=>`- ${k.id} · ${k.title} · 复核 ${k.reviewedAt} · ${k.source??'商家内部政策'}`));
  return lines.join('\n');
}
