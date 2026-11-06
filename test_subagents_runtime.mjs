import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixtureWorkerDocument,networkDenyPreload} from './test-fixtures/subagents-runtime-fixture.mjs';
const release=path.resolve(process.argv[2]),modules=path.join(release,'source/node_modules');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-classic-runtime-'));
try {
 const home=path.join(root,'home'),agent=path.join(home,'.pi/agent'),tmp=path.join(root,'tmp');
 for(const d of [path.join(agent,'agents'),tmp])fs.mkdirSync(d,{recursive:true});
 const fixture=path.join(root,'fixture.ts');fs.copyFileSync(fileURLToPath(new URL('./test-fixtures/subagents-runtime.ts',import.meta.url)),fixture);
 const workflow=path.join(root,'workflow.js');fs.writeFileSync(workflow,'return (await runs.run("one", { agent: "fixture-worker", task: "Inspect workflow fixture", async: false })).output;');
 fs.writeFileSync(path.join(agent,'agents/fixture-worker.md'),fixtureWorkerDocument(fixture));
 fs.mkdirSync(path.join(agent,'extensions/subagent'),{recursive:true});
 fs.writeFileSync(path.join(agent,'extensions/subagent/config.json'),'{"toolActivation":"eager"}');
 fs.writeFileSync(path.join(agent,'settings.json'),'{"defaultProjectTrust":"yes","enableInstallTelemetry":false}');
 const deny=path.join(root,'deny-network.cjs');fs.writeFileSync(deny,networkDenyPreload);
 const env={PATH:path.join(release,'node/bin')+path.delimiter+process.env.PATH,HOME:home,TMPDIR:tmp,XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_RUNTIME_DIR:path.join(root,'runtime'),PI_OFFLINE:'1',PI_TELEMETRY:'0',PI_SKIP_VERSION_CHECK:'1',HUMANLAYER_PI_DISABLE:'1',PI_FIXTURE_WORKFLOW:workflow,PI_FIXTURE_PIDS:path.join(root,'pids'),NODE_OPTIONS:'--require='+deny};
 const result=spawnSync(path.join(release,'node/bin/node'),[path.join(modules,'@earendil-works/pi-coding-agent/dist/bundle/cli.js'),'--mode','json','-p','--no-extensions','--no-skills','--no-context-files','--no-approve','-e',path.join(modules,'pi-subagents'),'-e',fixture,'--model','fixture/parent','--tools','subagent,bg_wait','Run deterministic fixture'],{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 const events=result.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));
 const results=events.filter(e=>e.type==='tool_execution_end'&&e.toolName==='subagent');
 assert(results.length>=4,JSON.stringify(results));
 assert(!results[0].isError,JSON.stringify(results[0]));assert.equal(results[0].result.details.mode,'single');assert.match(JSON.stringify(results[0]),/fixture child complete/);
 assert(results[1].result.details.asyncId,JSON.stringify(results[1]));
 assert(results.some(r=>r.result.details?.lifecycleStatus?.processTerminal?.state==='observed'),'background process settled');
 const workflowResult=results.find(r=>r.result.details?.mode==='workflow');assert(workflowResult,JSON.stringify(results));assert(!workflowResult.isError,JSON.stringify(workflowResult));assert.match(JSON.stringify(workflowResult),/fixture child complete/);
 const stopCall=events.find(e=>e.type==='tool_execution_start'&&e.args?.action==='stop');assert(stopCall,'stop requested');
 const stopped=results.find(e=>e.toolCallId===stopCall.toolCallId);assert(stopped&&!stopped.isError,JSON.stringify(stopped));
 assert(results.at(-1).isError,'invalid agent refused');
 console.log('PASS actual bundled classic foreground/background/workflow execution, stop and invalid-agent refusal, deterministic provider, network denied');
} finally {
 // Every PID was recorded by our fixture preload/provider; never kill live Pi sessions.
 const pids=fs.existsSync(path.join(root,'pids'))?[...new Set(fs.readFileSync(path.join(root,'pids'),'utf8').trim().split('\n').map(Number))]:[];
 for(const pid of pids) {try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
 const live=()=>pids.filter(pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code!=='ESRCH')throw e;return false;}});
 const until=Date.now()+10000;
 while(live().length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
 assert.deepEqual(live(),[],'fixture processes exited');
 fs.rmSync(root,{recursive:true,force:true});
}
