import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const dest='dist/harborflow';mkdirSync(dest,{recursive:true});
for(const entry of ['server.js','src','public','fixtures','knowledge','config','scripts','tests','docs','deliverables','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','SECURITY.md','.env.example','.gitignore','.dockerignore','.github','Dockerfile','compose.yaml'])cpSync(entry,join(dest,entry),{recursive:true});
const integrity=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(e.name==='SHA256SUMS')continue;const path=join(dir,e.name);if(e.isDirectory())walk(path);else integrity.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(dest,path).replaceAll('\\','/')}`);}}
walk(dest);writeFileSync(join(dest,'SHA256SUMS'),integrity.join('\n')+'\n');console.log(`Build ready: ${dest} (${integrity.length} files). No credentials or runtime data copied.`);
