import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const script=new URL('./bootstrap.sh',import.meta.url);
for(const args of [[],['--checkout'],['--export'],['bad','bad'],['--with-humanlayer']]) test('actionable invalid/piped invocation '+JSON.stringify(args),()=>{
 const r=spawnSync('sh',['-s','--',...args],{input:fs.readFileSync(script),encoding:'utf8',cwd:'/tmp'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Usage:/);
});
test('checkout entrypoints resolve their own directory before download; explicit pins remain accepted',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-entry-'));
 try {
 const bin=path.join(root,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'curl'),'#!/bin/sh\necho DOWNLOAD_REACHED >&2\nexit 79\n',{mode:0o755});
 const env={...process.env,PATH:bin+':'+process.env.PATH};
 for(const args of [[],['--with-humanlayer'],['6a74e5eda42fed727dcee593826537ed105d3c0a','55b0173f27375d801475de485194c8e9f462febdf8e48dfe80f16e2024539b04']]) {
 const r=spawnSync(script.pathname,args,{cwd:root,env,encoding:'utf8'});
 assert.equal(r.status,79);assert.match(r.stderr,/DOWNLOAD_REACHED/);
 }
 fs.writeFileSync(path.join(bin,'uname'),'#!/bin/sh\necho Unsupported\n',{mode:0o755});
 const r=spawnSync(script.pathname,[],{cwd:root,env,encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/Unsupported platform/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

await test('clean status colors and named skill menu', async()=>{
 const {status,skillMenu}=await import('./install.mjs');
 for(const [isTTY,env,color] of [[true,{TERM:'xterm'},true],[false,{TERM:'xterm'},false],[true,{TERM:'dumb'},false],[true,{TERM:'xterm',NO_COLOR:''},false]]) {
  let output=''; status('Ready',{isTTY,write:s=>output+=s},env);
  assert.equal(output.includes('\x1b['),color);
  assert.ok(output.endsWith(' Ready\n'));
 }
 for(const name of ['Compound Engineering','Firecrawl','Matt Pocock']) assert.ok(skillMenu.includes(name));
 assert.ok(skillMenu.endsWith('[compound,firecrawl]: '));
});
