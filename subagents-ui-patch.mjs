import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGuardedReplacement} from './subagents-patch-replacement.mjs';

// Patch only the pinned rendering seams. Validate the entire source/bundle set
// before writing; a mixed installation is not an invitation to repair it blindly.
export function patchSubagentsUi(modules,{dryRun=false}={}) {
 const classic=path.join(modules,'pi-subagents'), ui=path.join(modules,'pi-claude-code-ui');
 for(const [root,version] of [[classic,'0.84.0'],[ui,'1.0.109']])
  if(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version!==version) throw Error('Unsupported subagents UI package version');
 const bundle=fs.readdirSync(path.join(classic,'bundle')).filter(n=>n.endsWith('.js')).map(n=>path.join(classic,'bundle',n));
 const moduleFile=name=>{
  const matches=bundle.filter(file=>fs.readFileSync(file,'utf8').includes(`// src/tui/${name}.ts\n`));
  if(matches.length!==1) throw Error('Unexpected bundle module count: '+name);
  return matches[0];
 };
 const changes=new Map(),states=[];
 const replace=createGuardedReplacement(changes,states,file=>'Unexpected subagents UI anchor: '+path.basename(file));
 const uiFile=path.join(ui,'extensions/index.ts');
 replace(uiFile,'const AGENT_FAMILY_TOOL_NAMES = new Set(["Agent", "Agents",','const AGENT_FAMILY_TOOL_NAMES = new Set(["subagent", "Agent", "Agents",');
 replace(uiFile,'proto.getResultRenderer = function patchedGetResultRenderer() {','proto.getResultRenderer = function patchedGetResultRenderer() {\n\t\t// Classic owns rich workflow details and its configured summary mode.\n\t\tif (this?.toolName === "subagent") return originalGetResultRenderer.call(this);');
 for(const name of ['render','fleet-status','subagent-messages']) {
  for(const file of [path.join(classic,'src/tui',name+'.js'),moduleFile(name)]) {
   if(name==='render') {
    // Native error glyphs already include rejected; retain the textual distinction too.
    replace(file,'if (job.status === "failed")','if (job.status === "rejected") return "Rejected";\n    if (job.status === "failed")');
    const failedLabel='if (state === "failed")'+(file.includes(path.sep+'src'+path.sep)?'\n        ':' ')+'return "Failed";';
    replace(file,failedLabel,'if (state === "rejected") return "Rejected";\n    '+failedLabel);
    replace(file,'? "async subagent"','? "Agents"');
    replace(file,'`async subagent ${mode}','`Agents ${mode}');
    replace(file,'${tone("subagents")}','${tone("Agents")}');
    replace(file,'function renderSubagentSummary(result, options, theme) {',`function renderSubagentSummary(result, options, theme) {
  return boundSubagentComponent(classicSubagentSummary(result, options, theme));
}
function boundSubagentComponent(component) {
  const render = component.render.bind(component);
  component.render = (width) => width <= 0 ? [] : render(width).map((line) => truncLine(line, width));
  return component;
}
function classicSubagentSummary(result, options, theme) {`);
    replace(file,'function renderSubagentResult(result, options, theme, frame, rendererConfig, foregroundDetachShortcut) {',`function renderSubagentResult(result, options, theme, frame, rendererConfig, foregroundDetachShortcut) {
  return boundSubagentComponent(classicSubagentResult(result, options, theme, frame, rendererConfig, foregroundDetachShortcut));
}
function classicSubagentResult(result, options, theme, frame, rendererConfig, foregroundDetachShortcut) {`);
   } else if(name==='fleet-status') {
    replace(file,'return rosterIndex === selectedIndex ? theme.fg("accent", ">") : " ";','return rosterIndex === selectedIndex ? theme.fg("accent", "●") : theme.fg("dim", "○");');
   } else {
    replace(file,'super(1, 1, (text) => theme.bg("customMessageBg", text));','super(0, 0);');
    replace(file,'theme.bold("[subagent]")','theme.bold("● Subagent")');
    replace(file,'isExpanded() {','render(width) {\n    if (width <= 0) return [];\n    return super.render(width).map((line) => truncateToWidth(line, width, ""));\n  }\n  isExpanded() {');
   }
  }
 }
 if(new Set(states).size!==1) throw Error('Unexpected partial subagents UI patch');
 for(const [file,text] of changes) if(file.endsWith('.js')) execFileSync(process.execPath,['--input-type=module','--check'],{input:text});
 if(!dryRun) for(const [file,text] of changes) fs.writeFileSync(file,text);
 return changes.size;
}
