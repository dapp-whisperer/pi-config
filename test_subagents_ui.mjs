// Actual pinned components and published renderers, without provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const modules=path.resolve(process.argv[2],'source/node_modules');
const load=p=>import(pathToFileURL(path.join(modules,p)));
const {visibleWidth}=await load('@earendil-works/pi-tui/dist/index.js');
const themes=await load('@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js');
const {ToolExecutionComponent}=await load('@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js');
const {renderSubagentResult,renderSubagentSummary,buildWidgetLines}=await load('pi-subagents/src/tui/render.js');
const {SubagentFleetStatus}=await load('pi-subagents/src/tui/fleet-status.js');
const {renderSubagentMessage}=await load('pi-subagents/src/tui/subagent-messages.js');
const bundleDir=path.join(modules,'pi-subagents/bundle');
const renderBundle=fs.readdirSync(bundleDir).find(n=>n.endsWith('.js')&&fs.readFileSync(path.join(bundleDir,n),'utf8').includes('// src/tui/render.ts\n'));
assert(renderBundle);
const bundled=await load('pi-subagents/bundle/'+renderBundle);
const samples={};
Date.now=()=>1700000000000; // Fixed elapsed labels; this process performs no runtime work.
const ui=fs.readFileSync(path.join(modules,'pi-claude-code-ui/extensions/index.ts'),'utf8');
const start=ui.indexOf('function patchToolExecutionRenderers(): void {'),end=ui.indexOf('\nfunction shortPath(',start);
assert(start>=0&&end>start);
// Execute the installed prototype interception against the real Pi component.
const patch=new Function('ToolExecutionComponent','TOOL_EXECUTION_PATCH_FLAG','shouldUseGenericToolRenderer','renderGenericToolCall','renderGenericToolResult','sanitizeToolResultForDisplay',stripTypeScriptTypes(ui.slice(start,end))+'\nreturn patchToolExecutionRenderers;');
patch(ToolExecutionComponent,Symbol('fixture'),()=>true,()=>{throw Error('call not used');},()=>{throw Error('classic result incorrectly intercepted');},x=>x)();
const plain=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
for(const name of ['dark','light','system']) {
 themes.initTheme(name); const theme=themes.theme;
 const fleet=new SubagentFleetStatus({},()=>{});
 assert.equal(plain(fleet.bullet(0,0,theme)),'●');
 assert.equal(plain(fleet.bullet(1,0,theme)),'○');
 for(const width of [0,1,2,24,40,80,120]) {
  const fit=lines=>{for(const line of lines) assert(visibleWidth(line)<=width,`width ${width}: ${plain(line)}`);};
  const fleetState={asyncJobs:new Map(),foregroundControls:new Map()};
  const roster=new SubagentFleetStatus(fleetState,()=>{}),bundleRoster=new bundled.SubagentFleetStatus(fleetState,()=>{});
  for(const view of [roster,bundleRoster]){view.entries=[{key:'fixture',agent:'worker 界 👩‍💻 é',state:'running',tokens:42,startedAt:Date.now()}];view.active=true;}
  fit(roster.render(width,theme));assert.deepEqual(roster.render(width,theme),bundleRoster.render(width,theme));
  if(name==='dark'&&width===80)samples.fleet=roster.render(width,theme).map(plain);
  for(const status of ['queued','running','complete','failed','partial','rejected','stopped','paused']) {
   const job={asyncId:'fixture',agents:['worker'],mode:'single',status,startedAt:Date.now(),updatedAt:Date.now(),task:'Inspect fixture'};
   const lines=buildWidgetLines([job],theme,width,false,0);fit(lines);
   if(width>=40) assert.match(plain(lines.join('\n')),/Agents/);
   if(width>=24&&status==='rejected')assert.match(plain(lines.join('\n')),/Rejected/);
   if(name==='dark'&&[24,80].includes(width))samples[`widget-${status}-${width}`]=lines.map(plain);
  }
  for(const status of ['completed','failed','stopped','paused']) {
   const message={customType:'subagent-notify',content:'Fixture diagnostic and output reference',details:{runs:[{agent:'worker',status}]}};
   for(const expanded of [false,true]) {
    const component=renderSubagentMessage(message,{expanded},theme);
    fit(component.render(width));
    if(width>=40) assert.match(plain(component.render(width).join('\n')),new RegExp(status));
   }
  }
  for(const expanded of [false,true]) {
   const result={content:[{type:'text',text:'fixture output'}],details:{mode:'single',results:[{agent:'worker',task:'Inspect fixture',exitCode:0,messages:[{role:'assistant',content:[{type:'text',text:'fixture output'}]}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,cost:0,turns:1},output:'fixture output'}]}};
   const component=new ToolExecutionComponent('subagent','fixture',{}, {}, {renderResult:renderSubagentResult},undefined,process.cwd());
   const renderer=component.getResultRenderer();
   const rendered=renderer(result,{expanded,isPartial:false},theme,{});
   fit(rendered.render(width));
   if(width>=80&&expanded)assert.match(plain(rendered.render(width).join('\n')),/fixture output/);
   fit(renderSubagentSummary(result,{expanded,isPartial:false},theme).render(width));
   assert.deepEqual(bundled.renderSubagentResult(result,{expanded,isPartial:false},theme).render(width),rendered.render(width));
   if(name==='dark'&&width===80)samples[`result-expanded-${expanded}`]=rendered.render(width).map(plain);
  }
  // Optional details and original multi/workflow result modes remain classic-owned.
  for(const mode of ['single','parallel','workflow']) {
   for(const details of [undefined,{mode,results:[]}]) {
    const result={content:[{type:'text',text:'界 👩‍💻 é '+ 'long '.repeat(40)+'\nDiagnostic line'}],details};
    for(const expanded of [false,true]) {
     const lines=renderSubagentResult(result,{expanded,isPartial:false},theme).render(width);fit(lines);
     assert.deepEqual(lines,bundled.renderSubagentResult(result,{expanded,isPartial:false},theme).render(width));
    }
   }
  }
 }
}
// Actual Fleet lifecycle and key handlers, with only the host UI boundary controlled.
for(const Fleet of [SubagentFleetStatus,bundled.SubagentFleetStatus]) {
 let listeners=0,editorText='typing',mounted,inspected=false;
 const editor={render(){return [];},invalidate(){},handleInput(){},getText(){return editorText;},setText(text){editorText=text;}};
 const tui={focusedComponent:editor,requestRender(){}};
 const ui={getEditorText:()=>editorText,onTerminalInput:()=>{listeners++;return ()=>listeners--;},setWidget:(_key,factory)=>{mounted=factory?.(tui,themes.theme);},notify(message){throw Error(message);}};
 const state={asyncJobs:new Map([['fixture',{asyncId:'fixture',agents:['worker'],mode:'single',status:'running',startedAt:Date.now()}]]),foregroundControls:new Map()};
 const fleet=new Fleet(state,async()=>{inspected=true;});
 try {
  fleet.setContext({hasUI:true,ui});fleet.setContext({hasUI:true,ui});assert.equal(listeners,1);assert(mounted);
  assert.equal(fleet.handleKey('\x1b[B'),undefined,'nonempty editor keeps input');
  editorText='';assert.deepEqual(fleet.handleKey('\x1b[B'),{consume:true});
  assert.deepEqual(fleet.handleKey('\x1b[B'),{consume:true});assert.notEqual(fleet.selectedKey,'main');
  assert.deepEqual(fleet.handleKey('\r'),{consume:true});await new Promise(resolve=>setImmediate(resolve));assert(inspected);assert(!fleet.inspectorOpen);
  tui.focusedComponent={};assert.equal(fleet.handleKey('j'),undefined,'other UI keeps input');assert(!fleet.active);
  fleet.setContext({hasUI:false,ui});assert.equal(listeners,0);assert.equal(mounted,undefined);
  fleet.setContext({hasUI:true,ui});assert.equal(listeners,1);
 } finally {fleet.dispose();fleet.dispose();assert.equal(listeners,0);assert.equal(mounted,undefined);}
}
const snapshots=new URL('./test-fixtures/subagents-render.json',import.meta.url);
if(process.env.UPDATE_SUBAGENTS_FIXTURES==='1')fs.writeFileSync(snapshots,JSON.stringify(samples,null,2)+'\n');
else assert.deepEqual(samples,JSON.parse(fs.readFileSync(snapshots,'utf8')));
console.log('PASS classic installed result routing, Fleet markers, widget/message/result fixtures, themes and widths');
