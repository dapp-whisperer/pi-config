import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const modules=path.join(repo,'node_modules');
const plugin=path.join(modules,'@tintinweb/pi-subagents');
const host=path.join(modules,'@earendil-works/pi-coding-agent');
const pkg=JSON.parse(fs.readFileSync(path.join(host,'package.json')));
const cli=path.join(host,typeof pkg.bin==='string'?pkg.bin:pkg.bin.pi);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-workflows-'));
fs.chmodSync(root,0o700);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
try {
 for(const variant of ['original','bundled']){
  const base=path.join(root,variant), agent=path.join(base,'agent'), fixture=path.join(base,'fixture');
  for(const d of ['home','tmp','cwd','agent/agents','fixture/flows'])fs.mkdirSync(path.join(base,d),{recursive:true});
  fs.writeFileSync(path.join(agent,'agents/lane-fixture.md'),'---\nname: lane-fixture\ndescription: deterministic test\nmodel: fixture/fixture\n---\nReturn fixture completion.\n');
  fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify({name:'workflow-fixture',version:'1.0.0',pi:{subagents:{workflows:['./flows']}}}));
  fs.writeFileSync(path.join(fixture,'flows/pkg-literal.js'),'export const meta={name:"package-fixture",description:"package resource"};return {packageResult:73};');
  fs.mkdirSync(path.join(base,'cwd/.pi/workflows'),{recursive:true});
  fs.writeFileSync(path.join(base,'cwd/.pi/workflows/project-literal.js'),'export const meta={name:"project-fixture",description:"saved project"};return args;');
  fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify({subagents:{rememberAgents:false},packages:[fixture]}));
  const entry=path.join(plugin,'src',variant==='original'?'index.ts':'bundle.mjs');assert.ok(fs.existsSync(entry),'Install the verified bundle before this suite: '+entry);
  // Deliberately allowlist environment: no provider keys, cloud credentials, NODE_OPTIONS or inherited Pi config.
  const env={PATH:process.env.PATH??'/usr/bin:/bin',HOME:path.join(base,'home'),TMPDIR:path.join(base,'tmp'),PI_CODING_AGENT_DIR:agent,XDG_CONFIG_HOME:path.join(base,'home/.config'),XDG_CACHE_HOME:path.join(base,'home/.cache'),PI_OFFLINE:'1',VARIANT:variant,WF_ROOT:root,WF_ENTRY:entry};
  const p=spawnSync(process.execPath,[cli,'--mode','rpc','--no-session','-ne','-e',path.join(here,'probe.ts'),'--model','fixture/fixture'],{cwd:path.join(base,'cwd'),env,input:'{"type":"get_state"}\n',encoding:'utf8',timeout:40000,maxBuffer:8*1024*1024});
  assert.ifError(p.error);assert.equal(p.status,0,p.stderr);
  const d=JSON.parse(fs.readFileSync(path.join(root,variant+'-e2e.json')));assert.ok(!d.rows.some(r=>r.error),JSON.stringify(d.rows));const rows=Object.fromEntries(d.rows.map(r=>[r.name,r]));
  for(const [name,value] of [['saved',{saved:19}],['package',{packageResult:73}],['parallel',['E2E-OK','E2E-OK']],['resume',['E2E-OK','E2E-OK']],['pipeline',['E2E-OK']]]){
   const n=rows[name+'-completion'].notification;assert.equal(n.details.status,'completed');assert.deepEqual(JSON.parse(n.details.resultPreview),value);
  }
  assert.match(rows['resume-completion'].notification.content,/2 replayed/);assert.equal(rows['resume-completion'].notification.details.totalTokens,0);
  const prompts=d.calls.flatMap(c=>c.flatMap(u=>u.content.filter(x=>x.type==='text').map(x=>x.text))).filter(t=>t.startsWith('WF-'));
  assert.deepEqual(prompts.sort(),['WF-FIRST','WF-SECOND','WF-PIPE','WF-NEXT E2E-OK'].sort());
  assert.ok(d.calls.some(c=>JSON.stringify(c).includes('2 replayed')),'Parent must consume actual completion notification');
  for(const name of ['parallel','resume']){const id=rows[name].started.details.taskId;const matches=files(path.join(base,'tmp')).filter(f=>path.basename(f)===id+'.workflow.jsonl');assert.equal(matches.length,1);const journal=fs.readFileSync(matches[0],'utf8').trim().split('\n').map(JSON.parse);assert.equal(journal.length,2);assert.ok(journal.every(e=>e.ok&&e.text==='E2E-OK'));}
  console.log(`${variant}: actual sessions, saved/package resources, parallel/pipeline, parent notification and public replay PASS`);
 }
 const workerHome=path.join(root,'worker-home'),workerTmp=path.join(root,'worker-tmp');fs.mkdirSync(workerHome);fs.mkdirSync(workerTmp);
 const worker=spawnSync(process.execPath,[path.join(here,'worker.mjs')],{env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:workerHome,TMPDIR:workerTmp,PI_CODING_AGENT_DIR:path.join(workerHome,'agent'),PI_OFFLINE:'1',WF_ROOT:root},encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 assert.ifError(worker.error);assert.equal(worker.status,0,worker.stderr);process.stdout.write(worker.stdout);
} finally {fs.rmSync(root,{recursive:true,force:true});}
