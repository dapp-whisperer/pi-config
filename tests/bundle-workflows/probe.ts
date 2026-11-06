import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import fs from 'node:fs';
export default async function(pi){
 const root=process.env.WF_ROOT,variant=process.env.VARIANT,tools=new Map(),notifications=[],calls=[];
 const factory=(await import(process.env.WF_ENTRY)).default;
 await factory(new Proxy(pi,{get(t,k){if(k==='registerTool')return tool=>{tools.set(tool.name,tool);return t.registerTool(tool)};if(k==='sendMessage')return (m,o)=>{notifications.push(m);return t.sendMessage(m,o)};return Reflect.get(t,k)}}));
 pi.registerProvider('fixture',{apiKey:'fixture',api:'fixture',baseUrl:'http://invalid.local',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(model,context,options){const s=createAssistantMessageEventStream(); const users=context.messages.filter(x=>x.role==='user');calls.push(users);setTimeout(()=>{const m={role:'assistant',content:[{type:'text',text:'E2E-OK'}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};s.push({type:'start',partial:m});s.push({type:'done',reason:'stop',message:m});s.end();},15);return s;}});
 pi.on('session_start',async(_,ctx)=>{const rows=[];try{
 const invoke=a=>tools.get('SubagentWorkflow').execute('wf-e2e',a,undefined,undefined,ctx);
 const wait=async(id)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const n=notifications.find(m=>m.details?.id===id);if(n)return n;await new Promise(r=>setTimeout(r,25));}throw Error('notification timeout '+id)};
 const saved=await invoke({name:'project-literal',args:{saved:19}});rows.push({name:'saved',started:saved});rows.push({name:'saved-completion',notification:await wait(saved.details.taskId)});
 const pkg=await invoke({name:'pkg-literal'}); rows.push({name:'package',started:pkg});if(pkg.details?.taskId)rows.push({name:'package-completion',notification:await wait(pkg.details.taskId)});
 for(const [name,body] of [['parallel','return await parallel([()=>agent("WF-FIRST", {agentType:"lane-fixture"}),()=>agent("WF-SECOND", {agentType:"lane-fixture"})]);'],['pipeline','return await pipeline(["WF-PIPE"], x=>agent(x,{agentType:"lane-fixture"}),x=>agent("WF-NEXT "+x,{agentType:"lane-fixture"}));']]){
 const started=await invoke({script:`export const meta={name:"${name}",description:"e2e"};\n${body}`});rows.push({name,started});const id=started.details.taskId;rows.push({name:name+'-completion',notification:await wait(id)});
 if(name==='parallel'){await new Promise(r=>setTimeout(r,100));const before=calls.length;const resumed=await invoke({resumeFromRunId:id});rows.push({name:'resume',started:resumed});rows.push({name:'resume-completion',notification:await wait(resumed.details.taskId),callsBefore:before,callsAtNotification:calls.length});}
 }
 }catch(e){rows.push({error:String(e),stack:e.stack})}fs.writeFileSync(`${root}/${variant}-e2e.json`,JSON.stringify({rows,calls,notifications},null,2));});
}
