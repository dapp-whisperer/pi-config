import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {source,hash} from './install.mjs';

test('complete Python-free bootstrap and offline runtime preservation', {timeout:900000},async()=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pi-e2e-'))),tools=path.join(home,'tools');fs.mkdirSync(tools);
 // No Python, Git, system Node/npm, patch, or user credential environment.
 for(const name of ['sh','uname','mktemp','mkdir','rm','tar','gzip','curl','sha256sum','shasum']) {const found=spawnSync('/bin/sh',['-c',`command -v ${name}`],{encoding:'utf8'}).stdout.trim();if(found) fs.symlinkSync(found,path.join(tools,name));}
 const env={HOME:home,PATH:tools,PI_OFFLINE:'1',HUMANLAYER_PI_DISABLE:'1'};
 const run=(command,args=[],ok=true,extra={})=>{const r=spawnSync(command,args,{env,cwd:home,encoding:'utf8',timeout:240000,...extra});assert.equal(r.status===0,ok,`${command} ${args}\n${r.stdout}\n${r.stderr}\n${r.error??''}`);return r;};
 try {
  run(process.execPath,[path.join(source,'generate-bootstrap.mjs'),'--check']);
  // macOS /var aliases /private/var; CLI entrypoints must run through aliases.
  const sourceAlias=path.join(home,'source-alias');fs.symlinkSync(source,sourceAlias);
  assert.match(run(process.execPath,[path.join(sourceAlias,'install.mjs'),'--help']).stdout,/Usage:/);
  const a=path.join(home,'checkout');
  fs.cpSync(source,a,{recursive:true,filter:p=>!['.git','node_modules'].includes(path.basename(p))});
  // Real shell bootstrap downloads/checks pinned Node under restricted PATH.
  run(path.join(a,'bootstrap.sh')); // clone-and-run from unrelated cwd, no arguments
  const current=path.join(home,'.local/share/personal-pi/current'),bin=path.join(home,'.local/bin'),node=path.join(current,'node/bin/node');
  assert.equal(fs.existsSync(path.join(bin,'pih')),false);assert.equal(fs.existsSync(path.join(current,'source/resources/humanlayer-auto-advance.ts')),false);
  assert.equal(fs.existsSync(path.join(current,'upstream/humanlayer-humanlayer-pi')),false);
  const subagentsFile=path.join(home,'.pi/agent/subagents.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(subagentsFile)),{workflowsEnabled:true,fleetView:true,widgetMode:'background',showModel:true,showCost:true});
  const subagentOverride={workflowsEnabled:false,fleetView:false,widgetMode:'off',showModel:false,showCost:false,customPreserved:'sentinel'};
  fs.writeFileSync(subagentsFile,JSON.stringify(subagentOverride));
  const settings=path.join(home,'.pi/agent/settings.json'),auth=path.join(home,'.pi/agent/auth.json');const cfg=JSON.parse(fs.readFileSync(settings));cfg.customPreserved='sentinel';fs.writeFileSync(settings,JSON.stringify(cfg));fs.writeFileSync(auth,'{}');const before=fs.readFileSync(settings,'utf8');
  // Exercise verified immutable-source extraction (not only checkout mode).
  const commit='a'.repeat(40), fixtureRoot=path.join(home,'pi-config-'+commit), archive=path.join(home,'public.tgz');
  fs.cpSync(a,fixtureRoot,{recursive:true});
  execFileSync('tar',['-czf',archive,'-C',home,'pi-config-'+commit]);
  const curlPath=path.join(tools,'curl'),realCurl=fs.readlinkSync(curlPath);fs.unlinkSync(curlPath);
  fs.writeFileSync(curlPath,'#!/bin/sh\n[ "$1 $2 $3 $4" = "--connect-timeout 30 --max-time 900" ] || exit 9\ncase "$*" in *codeload.github.com/dapp-whisperer/pi-config*) while [ "$1" != -o ]; do shift; done; /bin/cat "'+archive+'" > "$2";; *) exec "'+realCurl+'" "$@";; esac\n',{mode:0o755});
  run('/bin/sh',[path.join(source,'bootstrap.sh'),'--with-humanlayer',commit,hash(fs.readFileSync(archive))]);
  assert.ok(fs.existsSync(path.join(bin,'pih')));
  assert.match(run('/bin/sh',[path.join(source,'bootstrap.sh'),commit,'0'.repeat(64)],false).stderr,/Checksum mismatch/);
  fs.symlinkSync('/tmp',path.join(fixtureRoot,'unsafe-link'));execFileSync('tar',['-czf',archive,'-C',home,'pi-config-'+commit]);
  assert.match(run('/bin/sh',[path.join(source,'bootstrap.sh'),commit,hash(fs.readFileSync(archive))],false).stderr,/Unsafe or duplicate archive entry/);
  fs.unlinkSync(curlPath);fs.symlinkSync(realCurl,curlPath);
  const selected=fs.readlinkSync(current);run(node,[path.join(a,'install.mjs')]);assert.equal(fs.readlinkSync(current),selected);
  function rpc(name) {const r=run(path.join(bin,name),['--mode','rpc','--no-session','--no-context-files','--no-approve'],true,{input:'{"id":"commands","type":"get_commands"}\n'});const response=r.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(x=>x.id==='commands');return new Set(response.data.commands.map(c=>c.name));}
  let names=rpc('pi');assert.ok(names.has('skill:firecrawl'));assert.ok(!names.has('hl-auto'));
  run(node,[path.join(a,'install.mjs'),'--with-humanlayer']);assert.ok(fs.existsSync(path.join(bin,'pih')));const optional=fs.readlinkSync(current);run(node,[path.join(a,'install.mjs')]);assert.equal(fs.readlinkSync(current),optional);
  assert.equal(fs.readFileSync(settings,'utf8'),before);assert.equal(fs.readFileSync(auth,'utf8'),'{}');
  const guard=path.join(home,'deny-network.cjs');fs.writeFileSync(guard,"const deny=()=>{throw Error('NETWORK_FORBIDDEN')};require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;globalThis.fetch=deny;");env.NODE_OPTIONS='--require='+guard;
  console.log(run(node,[path.join(source,'test_runtime.mjs'),current]).stdout);
   console.log(run(node,[path.join(source,'test_footer.mjs'),current]).stdout);
  console.log(run(node,[path.join(source,'test_humanlayer_auto_advance.mjs')]).stdout);
  const cli=path.join(current,'source/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
  for(const name of ['pi','pih']) {for(const command of ['auth','mcp']) {const direct=run(node,[cli,command,'--help']),wrapped=run(path.join(bin,name),[command,'--help']);assert.equal(wrapped.stdout,direct.stdout);assert.equal(wrapped.stderr,direct.stderr);}
   for(const command of ['install','update']) assert.match(run(path.join(bin,name),[command,'npm:fake'],false).stderr,/Managed release/);
   assert.match(run(path.join(bin,name),['list']).stdout,/@earendil-works\/pi-coding-agent@1.5.0/);assert.match(run(path.join(bin,name),['config']).stdout,/ordinary preferences/);
   names=rpc(name);for(const skill of ['skill:ce-work','skill:firecrawl','skill:simple-english','goal','vision'])assert.ok(names.has(skill),skill);assert.equal(names.has('hl-auto'),name==='pih');assert.equal(names.has('skill:create-research'),name==='pih');assert.ok(!names.has('skill:orchestration'));console.log(name,'offline commands',names.size);
  }
  assert.equal(fs.existsSync(path.join(current,'upstream/stablyai-orca')),false);
  cfg.packages=['npm:untrusted'];fs.writeFileSync(settings,JSON.stringify(cfg));assert.match(run(path.join(bin,'pi'),['--version'],false).stderr,/Unmanaged/);run(node,[path.join(a,'install.mjs')],false);fs.writeFileSync(settings,before);run(path.join(bin,'pi-health'));
  fs.writeFileSync(path.join(current,'source/defaults.json'),'{}');assert.match(run(path.join(bin,'pi-health'),[],false).stderr,/modified/);run(node,[path.join(a,'install.mjs')],false);assert.equal(fs.readlinkSync(current),optional);
  assert.deepEqual(JSON.parse(fs.readFileSync(subagentsFile)),subagentOverride);
  console.log('PASS real shell bootstrap with no Python/Git/system Node/npm/patch; checkout, install/rerun, optional retention, offline RPC, preservation, health and tamper refusal');
 } finally {fs.rmSync(home,{recursive:true,force:true});}
});
