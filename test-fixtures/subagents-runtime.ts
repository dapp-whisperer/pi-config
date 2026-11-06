// Credential-free deterministic provider used only by disposable runtime tests.
import fs from 'node:fs';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';

export default function fixture(pi: any) {
 const record=(value:any)=>{if(process.env.PI_FIXTURE_EVENTS)fs.appendFileSync(process.env.PI_FIXTURE_EVENTS,JSON.stringify(value)+'\n');};
 if(process.env.PI_FIXTURE_PIDS)fs.appendFileSync(process.env.PI_FIXTURE_PIDS,process.pid+'\n');
 pi.on('session_start',(_event:any,ctx:any)=>record({ready:true,mode:ctx.mode,forced:process.env.PI_PROGRAM_STATUS??null}));
 pi.on('agent_end',()=>record({settled:true,pid:process.pid}));
 pi.registerCommand('fixture-native-block',{handler:async(_args:any,ctx:any)=>{await ctx.ui.select('Fixture native question',['Continue']);record({answered:true});}});
 pi.registerCommand('fixture-quit',{handler:async(_args:any,ctx:any)=>ctx.shutdown()});
 pi.registerProvider('fixture', {
  api:'openai-completions',baseUrl:'https://invalid.example',apiKey:'fixture-not-a-credential',
  models:['parent','child'].map(id=>({id,name:id,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1024})),
  streamSimple(model: any, context: any, options: any) {
   const stream=createAssistantMessageEventStream();
   void (async()=>{
    const results=context.messages.filter((m: any)=>m.role==='toolResult');
    let args:any;
    if(model.id==='parent'&&!results.some((r: any)=>r.isError)) {
     if(results.length===0)args={agent:'fixture-worker',task:'Inspect fixture',async:false};
     else if(results.length===1)args={agent:'fixture-worker',task:'Inspect background fixture',async:true};
     else if(!results.slice(2).some((r: any)=>r.details?.lifecycleStatus?.processTerminal?.state==='observed'))args={action:'status',id:results[1].details?.asyncId};
     else if(!results.some((r: any)=>r.details?.mode==='workflow'))args={workflow:process.env.PI_FIXTURE_WORKFLOW,async:false,options:{mission:false}};
     else {
      const calls=context.messages.filter((m:any)=>m.role==='assistant').flatMap((m:any)=>m.content).filter((c:any)=>c.type==='toolCall');
      const launch=calls.find((c:any)=>c.arguments.task==='Inspect stop fixture');
      if(!launch)args={agent:'fixture-worker',task:'Inspect stop fixture',async:true};
      else if(!calls.some((c:any)=>c.arguments.action==='stop'))args={action:'stop',id:results.find((r:any)=>r.toolCallId===launch.id)?.details?.asyncId};
      else args={agent:'fixture-missing',task:'Do not launch'};
     }
    }
    if(process.env.PI_FIXTURE_CORE&&model.id==='parent')args=results.length<2?{agent:'fixture-worker',task:results.length===0?'core-first':'core-second',async:true}:undefined;
    if(process.env.PI_FIXTURE_CORE&&model.id==='child') {
     const key=JSON.stringify(context.messages).includes('core-second')?'second':'first';
     const until=Date.now()+30000;
     while(!fs.existsSync(path.join(process.env.PI_FIXTURE_CORE,'release-'+key))&&!options?.signal?.aborted&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
    }
    const content:any[]=args?[{type:'toolCall',id:'fixture-'+results.length,name:'subagent',arguments:args}]:[{type:'text',text:model.id==='child'?'fixture child complete':'FIXTURE_RUNTIME_FINISHED'}];
    const message:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'stop',content:[],usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    await new Promise(resolve=>setTimeout(resolve,model.id==='child'&&JSON.stringify(context.messages).includes('Inspect stop fixture')?3000:100));
    if(options?.signal?.aborted){message.stopReason='aborted';message.errorMessage='fixture cancelled';stream.push({type:'error',reason:'aborted',error:message});stream.end();return;}
    stream.push({type:'start',partial:message});message.content=content;
    if(args){stream.push({type:'toolcall_start',contentIndex:0,partial:message});stream.push({type:'toolcall_delta',contentIndex:0,delta:JSON.stringify(args),partial:message});stream.push({type:'toolcall_end',contentIndex:0,toolCall:content[0],partial:message});message.stopReason='toolUse';}
    else {stream.push({type:'text_start',contentIndex:0,partial:message});stream.push({type:'text_delta',contentIndex:0,delta:content[0].text,partial:message});stream.push({type:'text_end',contentIndex:0,content:content[0].text,partial:message});}
    stream.push({type:'done',reason:message.stopReason,message});stream.end();
   })();
   return stream;
  },
 });
}
