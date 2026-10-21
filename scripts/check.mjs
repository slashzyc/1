import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(['.git','data','dist','node_modules','work'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(/\.(?:m?js|json)$/.test(path))files.push(path);}}
walk('.');
for(const file of files){if(file.endsWith('.json'))JSON.parse(readFileSync(file,'utf8'));else{const p=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(p.status!==0){console.error(p.stderr);process.exit(1);}}}
console.log(`Checked ${files.length} JavaScript / JSON files.`);
