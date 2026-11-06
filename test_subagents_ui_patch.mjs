import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchSubagentsUi} from './subagents-ui-patch.mjs';

export function verifyPatch(patch,modules,packages,anchorFile,versionPackage) {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pi-subagents-patch-'));
 try {
  const reset=()=>{fs.rmSync(temp,{recursive:true,force:true});fs.mkdirSync(temp);for(const name of packages) fs.cpSync(path.join(modules,name),path.join(temp,name),{recursive:true});};
  const snapshot=()=>{
   const out=new Map();const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.isFile())out.set(path.relative(temp,f),fs.readFileSync(f));}};walk(temp);return out;
  };
  reset();const original=snapshot();assert(patch(temp,{dryRun:true})>0);assert.deepEqual(snapshot(),original);
  assert(patch(temp)>0);const patched=snapshot();assert.equal(patch(temp),0);assert.deepEqual(snapshot(),patched);
  fs.writeFileSync(path.join(temp,anchorFile),original.get(anchorFile));const mixed=snapshot();assert.throws(()=>patch(temp),/partial/);assert.deepEqual(snapshot(),mixed);
  for(const fault of ['missing','duplicate','version','bundle-count']) {
   reset();
   if(fault==='bundle-count') {
    const dir=path.join(temp,packages[0],'bundle'),marker='// '+anchorFile.split('/').slice(1).join('/').replace(/\.js$/,'.ts')+'\n';
    const file=fs.readdirSync(dir).find(n=>n.endsWith('.js')&&fs.readFileSync(path.join(dir,n),'utf8').includes(marker));assert(file);
    fs.copyFileSync(path.join(dir,file),path.join(dir,'fixture-duplicate.js'));
   }
   else if(fault==='version')fs.writeFileSync(path.join(temp,versionPackage,'package.json'),'{"version":"unknown"}');
   else {const f=path.join(temp,anchorFile),text=fs.readFileSync(f,'utf8');fs.writeFileSync(f,fault==='missing'?'':text+'\n'+text);}
   const before=snapshot();assert.throws(()=>patch(temp));assert.deepEqual(snapshot(),before);
  }
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 verifyPatch(patchSubagentsUi,path.resolve(process.argv[2]),['pi-subagents','pi-claude-code-ui'],'pi-subagents/src/tui/subagent-messages.js','pi-subagents');
 console.log('PASS subagents UI atomic guards, dry run, idempotence, mixed/missing/duplicate/version refusal');
}
