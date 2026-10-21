import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, validateProduct } from './domain.js';
export function openStore(directory) {
  if (directory !== ':memory:') mkdirSync(directory,{recursive:true,mode:0o700});
  const db = new DatabaseSync(directory === ':memory:' ? ':memory:' : join(directory,'harborflow.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions(run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,version));
    CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, event TEXT NOT NULL, subject TEXT, at TEXT NOT NULL, details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);
    PRAGMA user_version=1;`);
  const parse = row=>row ? JSON.parse(row.body) : null;
  const transaction = fn=>{db.exec('BEGIN IMMEDIATE');try {const result=fn();db.exec('COMMIT');return result;} catch(error){db.exec('ROLLBACK');throw error;}};
  const audit = (event,subject,details={}) => db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),event,subject,new Date().toISOString(),JSON.stringify(details));
  const products = () => db.prepare('SELECT body FROM products ORDER BY id').all().map(parse);
  if (!db.prepare('SELECT id FROM products LIMIT 1').get()) transaction(()=>{
    for (const p of JSON.parse(readFileSync(new URL('../fixtures/products.json',import.meta.url)))) db.prepare('INSERT INTO products VALUES(?,?)').run(p.id,JSON.stringify(validateProduct(p)));
    audit('seed','catalog',{synthetic:true});
  });
  return {
    db, audit, close:()=>db.close(), health:()=>db.prepare('SELECT 1 ok').get().ok === 1,
    products, product:id=>parse(db.prepare('SELECT body FROM products WHERE id=?').get(id)),
    importProducts(items) {
      const validated=items.map(validateProduct);
      assert(new Set(validated.map(p=>p.id)).size === validated.length,'导入数据存在重复商品 ID');
      transaction(()=>{for(const p of validated) db.prepare('INSERT INTO products VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p)); audit('catalog.import','catalog',{count:validated.length});});
      return validated;
    },
    run:id=>parse(db.prepare('SELECT body FROM runs WHERE id=?').get(id)),
    history:id=>db.prepare('SELECT body FROM revisions WHERE run_id=? ORDER BY version').all(id).map(parse),
    runs:()=>db.prepare('SELECT body FROM runs ORDER BY created_at DESC LIMIT 200').all().map(parse),
    save(run,expectedVersion=0) {
      transaction(()=>{
        const old=db.prepare('SELECT version FROM runs WHERE id=?').get(run.id);
        assert((old?.version ?? 0)===expectedVersion,'此任务已有新版本，请刷新后再修改。','VERSION_CONFLICT',409);
        const body=JSON.stringify(run);
        db.prepare('INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body').run(run.id,run.version,body,run.createdAt);
        db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(run.id,run.version,body);
        audit('run.saved',run.id,{version:run.version,workflow:run.input.workflow,mode:run.input.mode,highRisks:run.validation.counts.high});
      });return run;
    },
    cached(key,hash) {
      const row=db.prepare('SELECT * FROM idempotency WHERE key=?').get(key);
      if (!row) return null;
      assert(row.hash===hash,'同一请求标识不能用于不同内容','IDEMPOTENCY_CONFLICT',409);return JSON.parse(row.body);
    },
    cache(key,hash,body) {db.prepare('INSERT INTO idempotency VALUES(?,?,?,?)').run(key,hash,JSON.stringify(body),new Date().toISOString());},
    tickets:()=>db.prepare('SELECT body FROM tickets ORDER BY rowid DESC LIMIT 200').all().map(parse),
    createTicket(run,reason) {
      const ticket={id:randomUUID(),runId:run.id,runVersion:run.version,productName:run.product.name,workflow:run.input.workflow,reason,status:'pending',assignedTo:'待认领',version:1,createdAt:new Date().toISOString(),notes:[]};
      transaction(()=>{db.prepare('INSERT INTO tickets VALUES(?,?,?,?)').run(ticket.id,run.id,1,JSON.stringify(ticket));audit('ticket.created',ticket.id,{runId:run.id});});return ticket;
    },
    updateTicket(id,input) {
      return transaction(()=>{
        const ticket=parse(db.prepare('SELECT body FROM tickets WHERE id=?').get(id));assert(ticket,'工单不存在','NOT_FOUND',404);
        assert(input.expectedVersion===ticket.version,'工单已更新，请刷新','VERSION_CONFLICT',409);
        const transitions={pending:['active'],active:['pending','resolved'],resolved:['active']};
        assert(transitions[ticket.status].includes(input.status),'不支持该工单状态变更');
        ticket.status=input.status;ticket.version++;ticket.assignedTo=input.assignedTo;ticket.notes.push({text:input.note,at:new Date().toISOString()});
        db.prepare('UPDATE tickets SET version=?,body=? WHERE id=?').run(ticket.version,JSON.stringify(ticket),id);audit('ticket.updated',id,{status:input.status});return ticket;
      });
    },
    auditList:()=>db.prepare('SELECT event,subject,at,details FROM audit ORDER BY rowid DESC LIMIT 100').all().map(r=>({...r,details:JSON.parse(r.details)})),
    metrics:()=>({runs:db.prepare('SELECT COUNT(*) n FROM runs').get().n,versions:db.prepare('SELECT COUNT(*) n FROM revisions').get().n,tickets:db.prepare('SELECT COUNT(*) n FROM tickets').get().n})
  };
}
