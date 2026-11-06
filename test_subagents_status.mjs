// Reporter-level controlled facts; this is not evidence of child execution.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {registerProgramStatusReporter}=await import(pathToFileURL(path.resolve(process.argv[2],'source/node_modules/pi-subagents/src/integrations/program-status.js')));
const initialListeners=process.listenerCount('SIGCONT');
const parse=s=>Object.fromEntries(s.slice(7,-2).split(':').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
for(const [status,expected] of Object.entries({queued:'working',running:'working',complete:'done',failed:'error',partial:'error',rejected:'error',stopped:'idle',paused:'idle'})) {
 const writes=[],changes=[];let jobs=[{asyncId:'fixture',status,agents:['worker'],task:'PRIVATE_PROMPT'}];
 const reporter=registerProgramStatusReporter({enabled:true,isTTY:true,env:{TERM:'xterm'},getJobs:()=>jobs,getPendingRequests:()=>[],write:s=>writes.push(s),onWorkingChange:v=>changes.push(v)});
 try {
  reporter.sessionStarted({hasUI:true,mode:'tui'});assert.equal(parse(writes[0]).state,expected);
  for(const field of ['title','msg'])assert(!Buffer.from(parse(writes[0])[field],'base64').toString().includes('PRIVATE_PROMPT'));
  assert.equal(changes.at(-1),expected==='working');reporter.sync();assert.equal(writes.length,1);
  if(process.platform!=='win32'){process.emit('SIGCONT');assert.equal(writes.length,2);assert.equal(writes[0],writes[1]);}
  jobs=[];reporter.sync();assert.equal(parse(writes.at(-1)).state,'clear');assert.equal(changes.at(-1),false);
 } finally {reporter.dispose('reload');}
}
for(const gate of [{enabled:false},{isTTY:false},{env:{TERM:'dumb'}},{env:{PI_PROGRAM_STATUS:'0'}},{mode:'rpc'},{mode:'print'},{mode:'json'},{hasUI:false}]) {
 const writes=[];const reporter=registerProgramStatusReporter({enabled:true,isTTY:true,env:{TERM:'xterm'},getJobs:()=>[{asyncId:'fixture',status:'running'}],getPendingRequests:()=>[],write:s=>writes.push(s),...gate});
 try {reporter.sessionStarted({hasUI:true,mode:'tui',...gate});reporter.sync();assert.deepEqual(writes,[]);}finally{reporter.dispose('quit');}
}
for(const reason of ['quit','new','reload','resume','fork']) {
 const writes=[];const jobs=Array.from({length:70},(_,i)=>({asyncId:'id'+i,status:i===69?'running':'complete',updatedAt:i,agents:['界'.repeat(300)],task:'PRIVATE_PROMPT'}));
 const reporter=registerProgramStatusReporter({enabled:true,isTTY:true,env:{TERM:'xterm'},getJobs:()=>jobs,getPendingRequests:()=>[],write:s=>writes.push(s)});
 try {
  reporter.sessionStarted({hasUI:true,mode:'tui'});assert.equal(writes.length,64);assert.equal(parse(writes[0]).state,'working');
  for(const w of writes){const r=parse(w);assert(Buffer.from(r.title,'base64').length<=192);assert(!Buffer.from(r.title,'base64').toString().includes('�'));}
  reporter.dispose(reason);assert.equal(writes.length,reason==='quit'?64:128);reporter.dispose(reason);
 } finally {reporter.dispose('quit');}
}
{
 const writes=[];
 const jobs=['a/b','a:b','界'.repeat(200)].map((key,i)=>({asyncId:'child'+i,parentWorkflowRunId:'12345678-abcd-ef00',workflowKey:key,status:'running',currentTool:'界'.repeat(1000),task:'PRIVATE_PROMPT'}));
 const reporter=registerProgramStatusReporter({enabled:true,isTTY:true,env:{TERM:'xterm'},getJobs:()=>jobs,getPendingRequests:()=>[],write:s=>writes.push(s)});
 try {
  reporter.sessionStarted({hasUI:true,mode:'tui'});
  const ids=writes.map(w=>parse(w).id);assert.equal(new Set(ids).size,3);
  for(const w of writes){const r=parse(w);assert.match(r.id,/^subagents\/[A-Za-z0-9_.+-]{1,32}$/);const msg=Buffer.from(r.msg,'base64');assert(msg.length<=2048);assert(!msg.toString().includes('�'));}
 } finally {reporter.dispose('quit');}
}
assert.equal(process.listenerCount('SIGCONT'),initialListeners);
console.log('PASS native child mappings, gates, privacy, UTF-8 title bound, active-first cap, dedup, resend, removal and disposal');
