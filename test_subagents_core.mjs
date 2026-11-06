// Optional real Core proof. All CLI operations use this fixture's private socket.
// No screen text is used to infer execution/status; hc get supplies native records.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixtureWorkerDocument,networkDenyPreload} from './test-fixtures/subagents-runtime-fixture.mjs';
const release=fs.realpathSync(process.argv[2]),hc=fs.realpathSync(process.argv[3]);
const modules=path.join(release,'source/node_modules');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-classic-core-'));
const disabled=process.argv[4]==='--disabled';
const evidence=[];
let started=false,id,server;
const home=path.join(root,'home'),agent=path.join(home,'.pi/agent');
for(const dir of ['home','run','config','state','tmp'])fs.mkdirSync(path.join(root,dir),{mode:0o700});
const env={HOME:home,PATH:path.join(release,'node/bin')+path.delimiter+process.env.PATH,TERM:'xterm-256color',HC_SESSION:path.basename(root),HC_SOCKET:path.join(root,'run/core.sock'),XDG_RUNTIME_DIR:path.join(root,'run'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_STATE_HOME:path.join(root,'state'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache'),TMPDIR:path.join(root,'tmp'),PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',HUMANLAYER_PI_DISABLE:'1'};
assert(env.HC_SOCKET.startsWith(root+path.sep));
if(disabled)env.PI_PROGRAM_STATUS='0';
const cli=(...args)=>{const r=spawnSync(hc,['--json',...args],{env,encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return JSON.parse(r.stdout);};
const get=()=>{const t=cli('get',id);return t.terminal??t;};
const wait=async(check,label)=>{const until=Date.now()+20000;while(!check()){assert(Date.now()<until,'timed out: '+label);await new Promise(r=>setTimeout(r,100));}};
const records=()=>fs.existsSync(env.PI_FIXTURE_EVENTS)?fs.readFileSync(env.PI_FIXTURE_EVENTS,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const children=t=>Object.values(t.records??{}).filter(r=>r.id?.startsWith('subagents/')||r.state);
const snapshot=label=>{const t=get();
 const view=spawnSync(hc,['read',id],{env,encoding:'utf8',timeout:15000});assert.equal(view.status,0,view.stderr);
 evidence.push({label,status:t.status,records:t.records,terminalView:view.stdout});console.log(label,JSON.stringify({status:t.status,records:t.records}));return t;};
try {
 fs.mkdirSync(path.join(agent,'agents'),{recursive:true});fs.mkdirSync(path.join(agent,'extensions/subagent'),{recursive:true});
 fs.writeFileSync(path.join(agent,'extensions/subagent/config.json'),'{"toolActivation":"eager"}');
 fs.writeFileSync(path.join(agent,'settings.json'),'{"defaultProjectTrust":"yes","enableInstallTelemetry":false}');
 const fixture=path.join(root,'fixture.ts');fs.copyFileSync(fileURLToPath(new URL('./test-fixtures/subagents-runtime.ts',import.meta.url)),fixture);
 fs.writeFileSync(path.join(agent,'agents/fixture-worker.md'),fixtureWorkerDocument(fixture));
 const deny=path.join(root,'deny-network.cjs');fs.writeFileSync(deny,networkDenyPreload);
 Object.assign(env,{PI_FIXTURE_CORE:root,PI_FIXTURE_EVENTS:path.join(root,'events.jsonl'),PI_FIXTURE_PIDS:path.join(root,'pids'),NODE_OPTIONS:'--require='+deny});
 cli('server','start');started=true;server=cli('server','status');assert.equal(server.live,0);assert.deepEqual(cli('ls').terminals,[]);
 cli('run','--bg','--no-parent','--no-notify','--name','classic-proof','--cwd',home,'--',path.join(release,'node/bin/node'),path.join(modules,'@earendil-works/pi-coding-agent/dist/bundle/cli.js'),'--no-extensions','--no-skills','--no-context-files','--no-approve','-e',path.join(modules,'pi-subagents'),'-e',path.join(modules,'pi-claude-code-ui'),'-e',fixture,'--model','fixture/parent','--tools','subagent,bg_wait');
 const list=cli('ls');assert.equal(list.terminals.length,1);id=list.terminals[0].id??list.terminals[0].address;assert(id);
 await wait(()=>records().some(r=>r.ready&&r.mode==='tui'),'TUI ready');assert.equal(records().find(r=>r.ready).forced,disabled?'0':null);
 if(disabled) {
  cli('send',id,'Run fixture');
  await wait(()=>records().filter(r=>r.ready).length>=3&&records().some(r=>r.settled),'disabled-mode children started');
  const t=snapshot('PI_PROGRAM_STATUS=0 / actual children / no native records');assert.equal(children(t).length,0);assert.notEqual(t.status?.app,'pi');
  for(const key of ['first','second'])fs.writeFileSync(path.join(root,'release-'+key),'');
  await wait(()=>new Set(records().filter(r=>r.settled).map(r=>r.pid)).size>=3,'disabled-mode children complete');
  assert.equal(children(get()).length,0);
 } else {
 await wait(()=>get().status?.state==='idle','native negotiated idle');snapshot('native negotiation / idle');
 cli('send',id,'Run fixture');
 await wait(()=>children(get()).filter(r=>r.state==='working').length===2&&records().some(r=>r.settled),'two real children after parent response');
 assert.equal(snapshot('parent settled / two working children').status.state,'working');
 cli('send',id,'/fixture-native-block');await wait(()=>get().status?.state==='blocked','native question precedence');snapshot('native blocked wins');
 cli('keys',id,'enter');await wait(()=>records().some(r=>r.answered)&&get().status?.state==='working','native question released');snapshot('native question released / working');
 fs.writeFileSync(path.join(root,'release-first'),'');await wait(()=>{const c=children(get());return c.some(r=>r.state==='done')&&c.some(r=>r.state==='working');},'first child complete');
 assert.equal(snapshot('one child complete / other still working').status.state,'working');
 fs.writeFileSync(path.join(root,'release-second'),'');await wait(()=>children(get()).filter(r=>r.state==='done').length===2&&get().status?.state==='done','all children complete / native resting outcome');snapshot('all children done / parent done');
 // Native session replacement must clear retained child records and contributions.
 cli('send',id,'/new');await wait(()=>get().status?.state==='idle'&&children(get()).length===0,'new session cleanup');snapshot('new session / idle / no children');
 }
 cli('send',id,'/fixture-quit');
 console.log(disabled?'PASS real unmodified Core: disabled native reporting with actual children':'PASS real unmodified Core: native negotiation, actual classic overlap, root Working, native blocked precedence, completion and new-session cleanup');
} finally {
 if(started){cli('server','stop');await wait(()=>{try{process.kill(server.pid,0);return false;}catch(e){return e.code==='ESRCH';}},'Core process cleanup');}
 const pids=fs.existsSync(path.join(root,'pids'))?[...new Set(fs.readFileSync(path.join(root,'pids'),'utf8').trim().split('\n').map(Number))]:[];
 await wait(()=>pids.every(pid=>{try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}}),'fixture child process cleanup');
 // Save only sanitized optional evidence to a caller-selected file, never a live session.
 if(process.env.PI_SUBAGENTS_CORE_EVIDENCE)fs.writeFileSync(process.env.PI_SUBAGENTS_CORE_EVIDENCE,JSON.stringify(evidence).replaceAll(root,'<fixture>'));
 fs.rmSync(root,{recursive:true,force:true});
}
