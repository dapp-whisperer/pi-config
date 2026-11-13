// Runtime-only tests: actual worker threads, but NOT child AgentSession tests.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(repo,'package.json'));
const {createJiti}=require('jiti');
const {build}=require('esbuild');
const temp=process.env.TMPDIR;
assert.ok(process.env.WF_ROOT && temp.startsWith(process.env.WF_ROOT),'Run through run.mjs for isolated environment');
const source=path.join(repo,'node_modules/@tintinweb/pi-subagents/src/workflow/runtime.ts');
fs.symlinkSync(path.join(repo,'node_modules'),path.join(temp,'node_modules'),'dir');
const bundle=path.join(temp,'runtime.mjs');
await build({entryPoints:[source],bundle:true,packages:'external',platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
const original=await createJiti(import.meta.url).import(source);
const bundled=await import(pathToFileURL(bundle).href);
for(const [name,m] of [['original',original],['bundled-runtime',bundled]]){
 const host={spawnAgent:async()=>{throw Error('No child spawn permitted in worker-only tests')}};
 const meta='export const meta={name:"worker",description:"runtime test"};\n';
 const run=(body,extra={})=>m.runWorkflow({script:meta+body,host,...extra});
 const value=await run('phase("Ready");log("hello");return args;',{args:{n:17}});
 assert.equal(value.status,'completed');assert.deepEqual(value.value,{n:17});assert.equal(value.progress[0].title,'Ready');assert.equal(value.progress[1].message,'hello');
 const invalid=await run('return ()=>{};');assert.equal(invalid.status,'failed');assert.match(invalid.error,/function.*boundary/);
 const syntax=await run('return @;');assert.equal(syntax.status,'failed');assert.match(syntax.error,/token/);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);
 try{const cancelled=await run('while(true){}',{signal:controller.signal});assert.equal(cancelled.status,'killed');assert.match(cancelled.error,/aborted/);}finally{clearTimeout(timer)}
 console.log(name+': worker args/phase/log, validation, syntax, infinite-loop cancellation PASS');
}
