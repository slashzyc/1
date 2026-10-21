import { readFileSync } from 'node:fs';
export const agents = JSON.parse(readFileSync(new URL('../config/agents.json', import.meta.url)));
export const knowledge = JSON.parse(readFileSync(new URL('../knowledge/rules.json', import.meta.url)));
export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function assert(ok, message, code = 'VALIDATION', status = 400) { if (!ok) throw new AppError(code, message, status); }
export function str(v, name, max = 4000, optional = false) {
  assert(typeof v === 'string' && v.length <= max && (optional || v.trim().length > 0), `${name} 格式错误或超过 ${max} 字符`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), `${name} 含不支持的控制字符`);
  return v.trim();
}
export function integer(v, name, min, max) { assert(Number.isSafeInteger(v) && v >= min && v <= max, `${name} 必须为 ${min}–${max} 的整数`); return v; }
export function validateProduct(p) {
  assert(p && typeof p === 'object' && !Array.isArray(p), '商品须为对象');
  const result = {};
  for (const k of ['id','name','brand','category','nameEn','nameDe','materialEn','materialDe']) result[k] = str(p[k], k, k === 'id' ? 40 : 100);
  assert(/^[A-Za-z0-9_-]+$/.test(result.id), '商品 ID 仅支持字母、数字、下划线、连字符');
  assert(Array.isArray(p.sizeCm) && p.sizeCm.length === 3 && p.sizeCm.every(n => Number.isFinite(n) && n > 0 && n <= 1000), 'sizeCm 需要 3 个正数（厘米）');
  result.sizeCm = [...p.sizeCm];
  for (const k of ['featuresEn','featuresDe']) {
    assert(Array.isArray(p[k]) && p[k].length >= 1 && p[k].length <= 5, `${k} 需要 1–5 个卖点`);
    result[k] = p[k].map(v => str(v, k, 250));
  }
  result.moq = integer(p.moq, 'MOQ', 1, 1000000);
  result.unitPriceCents = integer(p.unitPriceCents, '单价（分）', 1, 100000000);
  result.leadDays = integer(p.leadDays, '交期', 1, 365);
  assert(['USD','EUR'].includes(p.currency), '币种只支持 USD 或 EUR'); result.currency = p.currency;
  for (const k of ['manufacturer','manufacturerContact','euResponsiblePerson','safetyInfoDe']) result[k] = str(p[k] ?? '', k, 500, true);
  assert(Array.isArray(p.evidence ?? []) && (p.evidence ?? []).length <= 10, 'evidence 最多 10 项');
  result.evidence = (p.evidence ?? []).map(v => str(v, '证据描述', 500));
  result.synthetic = p.synthetic === true;
  return result;
}
export function validateInput(body, product) {
  assert(body && typeof body === 'object' && !Array.isArray(body), '请求须为 JSON 对象');
  assert(agents.agents.some(a => a.id === body.workflow), '请选择有效的客服方向');
  assert(['US','DE'].includes(body.market), '目标市场须为美国或德国');
  assert(['demo','live'].includes(body.mode), '请选择离线演示或真实模型');
  const v = { workflow: body.workflow, market: body.market, mode: body.mode, productId: product.id,
    prompt: str(body.prompt, '业务需求'),
    quantity: integer(body.quantity ?? product.moq, '数量', 1, 1000000),
    unitPriceCents: integer(body.unitPriceCents ?? product.unitPriceCents, '单价（分）', 1, 100000000),
    validDays: integer(body.validDays ?? 14, '报价有效天数', 1, 90),
    leadDays: integer(body.leadDays ?? product.leadDays, '生产天数', 1, 365),
    currency: body.currency ?? product.currency,
    incoterm: body.incoterm ?? 'FOB',
    place: str(body.place ?? 'Ningbo', '指定地点', 120),
    payment: str(body.payment ?? '30% deposit, 70% before shipment; subject to confirmation', '付款约定', 300),
    sourceRunId: body.sourceRunId ? str(body.sourceRunId, '源任务', 80) : null
  };
  assert(['USD','EUR'].includes(v.currency), '币种不支持');
  assert(['FOB','EXW'].includes(v.incoterm), '当前只支持 FOB／EXW；其他条款请转人工核对');
  return v;
}
export function retrieve(input) {
  return knowledge.filter(k => k.markets.includes(input.market) && k.workflows.includes(input.workflow)).map(k => ({...k, matchReason: `${input.market} / ${input.workflow}`}));
}
export function quote(input, now = new Date()) {
  const expiresAt = new Date(now.getTime() + input.validDays * 86400000).toISOString().slice(0,10);
  return {quantity: input.quantity, unitPriceCents: input.unitPriceCents, totalCents: input.quantity * input.unitPriceCents,
    currency: input.currency, incoterm: input.incoterm, place: input.place, validDays: input.validDays, expiresAt,
    leadDays: input.leadDays, payment: input.payment, excludes: 'Freight, insurance, duties and taxes excluded. Production lead time starts after deposit and sample approval. Subject to written confirmation.'};
}
const money = (n, c, lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {style:'currency',currency:c}).format(n / 100);
export { money };
export function dimension(p, market, lang) {
  return p.sizeCm.map(n => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US',{maximumFractionDigits:1}).format(market === 'US' ? n / 2.54 : n)).join(' × ') + (market === 'US' ? ' in' : ' cm');
}
export function demoGenerate(input, p, history = []) {
  const instruction = [history.map(h => h.input.prompt).join(' '), input.prompt].join(' ');
  const concise = /简短|精简|short|concise|kürzer/i.test(instruction);
  const sample = /样品|sample|Muster/i.test(instruction);
  const followup = /跟进|follow.up|nachfass/i.test(instruction);
  const content = {};
  for (const lang of ['en','de']) {
    const de = lang === 'de', name = de ? p.nameDe : p.nameEn, material = de ? p.materialDe : p.materialEn;
    const title = `${p.brand} ${name}`;
    const size = dimension(p,input.market,lang);
    if (input.workflow === 'listing') {
      content[lang] = {title, highlights: `${material} · ${size}`, body: de ? `${name} für einen übersichtlichen Alltag. Bitte prüfen Sie vor dem Kauf die Abmessungen: ${size}.` : `${name} for everyday organization. Check the dimensions before ordering: ${size}.`, bullets: [...(de ? p.featuresDe : p.featuresEn), `${de ? 'Material' : 'Material'}: ${material}`, `${de ? 'Abmessungen' : 'Dimensions'}: ${size}`]};
    } else if (input.workflow === 'support') {
      content[lang] = {title: de ? `Wir helfen Ihnen mit ${name}` : `Let's resolve the issue with your ${name}`, highlights: de ? 'Nächster Schritt: Bestelldaten und Fotos prüfen' : 'Next step: review order details and photos',body: de ? `Guten Tag,\n\nvielen Dank für Ihre Nachricht. Es tut uns leid, dass es ein Problem mit Ihrer Bestellung gibt. Bitte senden Sie uns die Bestellnummer, die betroffene Stückzahl und Fotos des Produkts und der Verpackung. Unser Team prüft den Fall und bestätigt anschließend die verfügbaren Optionen. Bitte senden Sie keine Zahlungsdaten.\n\nMit freundlichen Grüßen\nIhr Serviceteam` : `Hello,\n\nThank you for getting in touch. I'm sorry there is an issue with your order. Please share the order number, affected quantity, and photos of the product and packaging. Our team will review the case and confirm the available options. Please do not send payment details.\n\nKind regards,\nCustomer Care`,bullets: de ? ['Bestellnummer bestätigen','Betroffene Stückzahl und Fotos prüfen','Lösung durch zuständige Person bestätigen lassen'] : ['Confirm the order number','Review affected quantity and photos','Have the responsible team confirm a resolution']};
    } else if (input.workflow === 'compliance') {
      content[lang] = {title: de ? 'Unterlagen zur Produktprüfung' : 'Product review evidence checklist',highlights: de ? 'Vorprüfung anhand der bereitgestellten Daten' : 'Initial review of the supplied product data',body: de ? `Für ${name} fehlen möglicherweise überprüfbare Hersteller- und Sicherheitsangaben. Bitte klären Sie die vorgesehenen Verwendungszwecke und stellen Sie die erforderlichen Nachweise bereit. Die Freigabe erfolgt durch die zuständige Person nach Prüfung der anwendbaren Vorschriften.` : `For ${name}, verifiable manufacturer and safety details may be missing. Confirm intended uses and provide the relevant supporting documents. The responsible reviewer must assess applicable requirements before release.`,bullets: de ? ['Hersteller und Kontaktdaten prüfen','Produktidentifikation und Sicherheitsinformationen ergänzen','Aussagen anhand von Nachweisen prüfen'] : ['Check manufacturer and contact information','Complete product identification and safety information','Verify claims against supporting evidence']};
    } else {
      let body = de ? `Guten Tag,\n\nvielen Dank für Ihre Anfrage zu ${name}. Die Abmessungen betragen ${size}; das Material ist ${material}. Unser unverbindliches Angebot für ${input.quantity} Stück finden Sie in der beigefügten Preisübersicht. Bitte bestätigen Sie den Bestimmungsort und die gewünschten Verpackungsdetails.` : `Hello,\n\nThank you for your inquiry about our ${name}. The dimensions are ${size}, and the material is ${material}. Please see the attached draft quotation for ${input.quantity} units. Could you confirm the destination and your packaging requirements?`;
      if (!concise) body += de ? '\n\nDie Produktionszeit beginnt nach Eingang der Anzahlung und Musterfreigabe. Versanddauer und Kosten bestätigen wir separat.' : '\n\nProduction lead time starts after the deposit and sample approval. Transit time and shipping costs will be confirmed separately.';
      if (sample) body += de ? '\n\nGern klären wir die Musterverfügbarkeit und Versandkosten vorab.' : '\n\nWe can check sample availability and shipping costs before proceeding.';
      if (followup) body += de ? '\n\nGibt es noch offene Fragen zu den Spezifikationen? Wir freuen uns auf Ihre Rückmeldung.' : '\n\nIs there anything else you would like us to clarify about the specifications?';
      body += de ? '\n\nMit freundlichen Grüßen\nIhr Vertriebsteam' : '\n\nBest regards,\nYour Sales Team';
      content[lang] = {title: de ? `Ihr Angebot: ${name}` : `Your quotation: ${name}`, highlights: `${input.incoterm} ${input.place} · ${input.quantity} ${de ? 'Stück' : 'units'}`,body,bullets: de ? ['Bestimmungsort bestätigen','Verpackungswunsch klären','Liefertermin nach Musterfreigabe bestätigen'] : ['Confirm the destination','Clarify packaging requirements','Confirm timing after sample approval']};
    }
  }
  return {content, summary: `已按${agents.agents.find(a=>a.id===input.workflow).name}模板生成双语草稿。离线模式仅识别简短、样品、跟进等预设修订；自由指令请用真实模型。`, missingInfo: input.workflow === 'support' ? ['订单号与受损数量','商品及包装照片','适用售后政策与责任确认'] : ['买家或订单身份尚未独立核验','适用市场的产品材料需人工核对'], nextActions: input.workflow === 'support' ? ['收集必要凭证','将补偿决定转给人工客服'] : ['核对商品事实与商务条件','复核风险后再对外使用']};
}
export function validateOutput(raw) {
  assert(raw && typeof raw === 'object', '模型输出不是 JSON 对象', 'MODEL_SCHEMA', 502);
  try {
    const content = {};
    for (const lang of ['en','de']) {
      const c = raw.content?.[lang]; assert(c && typeof c === 'object', `缺少 ${lang} 输出`);
      assert(Array.isArray(c.bullets) && c.bullets.length >= 1 && c.bullets.length <= 8, '卖点或行动清单数量不正确');
      content[lang] = {title: str(c.title,'标题',300), highlights:str(c.highlights,'亮点',500), body:str(c.body,'正文',6000), bullets:c.bullets.map(v=>str(v,'条目',800))};
    }
    const result = {content, summary:str(raw.summary,'需求理解',1500)};
    for (const k of ['missingInfo','nextActions']) {
      assert(Array.isArray(raw[k]) && raw[k].length <= 10, `${k} 结构无效`);
      result[k] = raw[k].map(v=>str(v,k,500));
    }
    return result;
  } catch { throw new AppError('MODEL_SCHEMA','模型返回格式不完整，未保存结果。请重试或切换离线演示。',502); }
}
export function checkRisks(input, product, output, rules, now = new Date()) {
  const risks = [];
  const add = (id, severity, category, field, excerpt, message, action, ruleId) => risks.push({id,severity,category,field,excerpt,message,action,ruleId});
  const fields = [['input.prompt',input.prompt], ...Object.entries(output.content).flatMap(([lang,c]) => [['title',c.title],['highlights',c.highlights],['body',c.body],...c.bullets.map((v,i)=>[`bullets.${i}`,v])].map(([k,v])=>[`content.${lang}.${k}`,v]))];
  for (const [field,text] of fields) {
    for (const [id,pattern,category,message,action,ruleId] of [
      ['evidence',/\b(?:FDA[- ]?(?:approved|certified)|CE[- ]?certified|food[- ]grade|non[- ]toxic)\b|食品级|无毒|CE认证|FDA认证/ig,'compliance','检测到需证据支持的认证或安全声明','人工核实适用性与证明文件；未证实前删除该声明','claim-evidence'],
      ['green',/eco[- ]friendly|100%\s*(?:recyclable|sustainable)|umweltfreundlich|环保|百分百可回收/ig,'compliance','宽泛环保宣传缺少可核验证据','改成具体材料事实，或提供可验证且限定范围的证据',input.market==='US'?'ftc-green':'claim-evidence'],
      ['absolute',/\b(?:best in the world|guaranteed safe|100% safe|number one)\b|世界第一|绝对安全|保证安全|weltbeste/ig,'culture','绝对化表达可能误导客户','使用可证实的具体特点，避免绝对承诺','localization'],
      ['scope',/儿童|婴儿|食品接触|electrical|baby|children|food contact/ig,'compliance','用途可能超出首版普通家居品规则覆盖','交给合规人员补充该品类规则，不可凭当前检查结果上线','claim-evidence']
    ]) {
      const match = text.match(pattern);
      if (match) add(`${id}-${field}`,'high',category,field,match[0],message,action,ruleId);
    }
  }
  if (input.workflow === 'listing') for (const [lang,c] of Object.entries(output.content)) {
    if ([...c.title].length > 75) add(`title-${lang}`,'high','platform',`content.${lang}.title`,c.title,'标题超过 75 字符保守基线','精简标题，将材质和用途移入 Item Highlights','amazon-title-2026');
    if ([...c.highlights].length > 125) add(`highlight-${lang}`,'high','platform',`content.${lang}.highlights`,c.highlights,'Item Highlights 超过 125 字符','缩短亮点文案并核对目标站点要求','amazon-title-2026');
    if (/https?:\/\/|@[\w.-]+|free shipping|limited offer|限时/i.test(JSON.stringify(c))) add(`promotion-${lang}`,'medium','platform',`content.${lang}`,'','发现链接、联系方式或促销表达','按站点与类目要求人工核实商品详情内容','amazon-title-2026');
    if (/\b(?:hello|dear|sales team|minimum order|contact our|contact us)\b|Guten Tag|Vertriebsteam|Mindestbestellmenge|wenden Sie sich/i.test(c.body)) add(`listing-style-${lang}`,'high','platform',`content.${lang}.body`,'','商品详情混入商务邮件语气或联系销售的引导','删除问候、署名、起订量与联系引导，改成直接的商品描述','localization');
  }
  if (input.market === 'DE' && input.workflow !== 'support') {
    const missing = ['manufacturer','manufacturerContact','euResponsiblePerson','safetyInfoDe'].filter(k=>!product[k]);
    if (missing.length) add('gpsr-missing','high','compliance','product',missing.join(', '),'德国市场资料未完整：制造商／联系信息／欧盟责任人／德文安全信息','由合规负责人补充并核实适用性；B2B 报价阶段作为后续零售准备项','gpsr-19');
  }
  if (input.workflow === 'rfq') {
    for (const [lang,c] of Object.entries(output.content)) {
      if (/after order confirmation|nach (?:Auftrags|Bestell)bestätigung/i.test(c.body)) add(`lead-condition-${lang}`,'high','contract',`content.${lang}.body`,'','交期起算条件与报价表可能不一致','生产交期须从收到定金并确认样品后起算；修订正文以匹配报价表','commercial-terms');
      if (/(?:USD|EUR|\$|€)\s*\d|\d+(?:[.,]\d+)?\s*(?:USD|EUR|dollars|euros)/i.test(c.body)) add(`money-in-text-${lang}`,'high','contract',`content.${lang}.body`,'','模型正文含金额，请与程序报价逐项核对','金额以报价表为准，建议删除正文金额以免版本不一致','commercial-terms');
      if (/\[(?:Buyer Name|Your Name|Company|Ihr Name|Unternehmen)\]/i.test(c.body)) add(`placeholder-${lang}`,'medium','contract',`content.${lang}.body`,'','回复仍有待填写的称呼或署名','填入已核实的客户称呼与商家署名后再发送','commercial-terms');
    }
    if (input.quantity < product.moq) add('below-moq','high','contract','input.quantity',String(input.quantity),'采购数量低于商品起订量','采购或业务负责人确认小单政策','commercial-terms');
    if (input.unitPriceCents < product.unitPriceCents) add('discount-review','medium','contract','input.unitPriceCents',money(input.unitPriceCents,input.currency,'en'),'报价低于商品参考价','销售负责人确认折扣与毛利','commercial-terms');
    if (input.leadDays < product.leadDays) add('lead-review','high','contract','input.leadDays',String(input.leadDays),'要求交期短于商品参考交期','采购确认产能后再承诺','commercial-terms');
    if (input.currency !== product.currency) add('currency-review','high','contract','input.currency',input.currency,'报价币种与台账不同；系统不自动换汇','明确价格币种及汇率依据，重新核实金额','commercial-terms');
    add('quote-terms','info','contract','quote','','报价仅含商品金额，运费、保险、税费另计','确认指定地点、付款、样品与交期前提后再发送','commercial-terms');
  }
  if (input.workflow === 'support') {
    add('human-resolution','medium','contract','input.prompt','','退款／补发尚需人工授权；系统没有订单或物流实时连接','核对订单、凭证与售后政策后由人工决定','support-policy');
    if (/受伤|伤害|起火|injur|fire|lawsuit|起诉/i.test(input.prompt)) add('urgent-support','high','compliance','input.prompt','','涉及安全或争议，建议优先人工处理','立即联系内部负责人；保留必要证据','support-policy');
  }
  if (product.evidence.length === 0) add('evidence-missing','medium','compliance','product.evidence','','商品台账未附核验材料','添加来源资料；当前文本仅能作为草稿','claim-evidence');
  for (const rule of rules) if (now > new Date(`${rule.reviewDue}T23:59:59Z`)) add(`stale-${rule.id}`,'medium',rule.category,'knowledge','','规则已超过复核日期','查看官方来源并更新版本',rule.id);
  return {status:risks.some(r=>r.severity==='high')?'review-required':'draft',risks,counts:{high:risks.filter(r=>r.severity==='high').length,medium:risks.filter(r=>r.severity==='medium').length,info:risks.filter(r=>r.severity==='info').length}, disclaimer:'自动初筛覆盖已配置规则，不能证明全面合规。所有对外内容都需要人工复核。'};
}
