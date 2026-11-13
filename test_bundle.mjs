import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const run=(cwd,...args)=>execFileSync(process.execPath,['subagents-bundle.mjs',...args],{cwd,stdio:'pipe'});
run(root,'check');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pi-bundle-test-'));
try{
 for(const name of ['subagents-bundle.mjs','package-lock.json','bundles'])fs.cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
 const plugin='node_modules/@tintinweb/pi-subagents';
 fs.cpSync(path.join(root,plugin),path.join(temp,plugin),{recursive:true});
 run(temp,'install');
 assert.deepEqual(fs.readFileSync(path.join(temp,plugin,'src/bundle.mjs')),fs.readFileSync(path.join(temp,'bundles/subagents.mjs')));
 fs.appendFileSync(path.join(temp,'bundles/subagents.mjs'),'// tamper');
 assert.throws(()=>run(temp,'install'),/bundle hash mismatch/);
 fs.copyFileSync(path.join(root,'bundles/subagents.mjs'),path.join(temp,'bundles/subagents.mjs'));
 fs.appendFileSync(path.join(temp,plugin,'src/index.ts'),'// source tamper');
 assert.throws(()=>run(temp,'install'),/provenance mismatch: source/);
 console.log('PASS reproducibility, relocation, artifact tamper and upstream source mismatch refusal');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
