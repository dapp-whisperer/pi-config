import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGuardedReplacement} from './subagents-patch-replacement.mjs';

// Local pinned contract: only Pi's existing terminal writes the root record.
// Contributions contain a boolean, never child prompts, labels or messages.
const sourceMethod=`createBackgroundActivitySource() {
        const token = Symbol("background-activity");
        const generation = this.backgroundGeneration;
        let disposed = false;
        const setWorking = (working) => {
            if (disposed || generation !== this.backgroundGeneration) return;
            if (working) this.backgroundSources.add(token);
            else this.backgroundSources.delete(token);
            this.report();
        };
        return { setWorking, dispose: () => { setWorking(false); disposed = true; } };
    }
    `;
const noop='() => ({ setWorking() {}, dispose() {} })';
export function patchSubagentsStatus(modules,{dryRun=false}={}) {
 const pi=path.join(modules,'@earendil-works/pi-coding-agent'),classic=path.join(modules,'pi-subagents');
 for(const [root,version] of [[pi,'1.5.0'],[classic,'0.84.0']]) if(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version!==version) throw Error('Unsupported subagents status package version');
 const changes=new Map(),states=[];
 const edit=createGuardedReplacement(changes,states,file=>'Unexpected subagents status anchor: '+path.relative(modules,file));
 const find=(dir,marker)=>{
  const matches=fs.readdirSync(dir).filter(n=>n.endsWith('.js')).map(n=>path.join(dir,n)).filter(f=>fs.readFileSync(f,'utf8').includes(marker));
  if(matches.length!==1) throw Error('Unexpected status bundle module count: '+marker);
  return matches[0];
 };
 const native=path.join(pi,'dist/modes/interactive/program-status-reporter.js');
 const nativeBundle=find(path.join(pi,'dist/bundle/chunks'),'ProgramStatusReporter=class');
 edit(native,'    runActive = false;','    backgroundSources = new Set();\n    backgroundGeneration = 0;\n    runActive = false;');
 edit(native,'    handleEvent(event) {','    '+sourceMethod+'handleEvent(event) {');
 edit(native,'    reset() {','    reset() {\n        this.backgroundGeneration++;\n        this.backgroundSources.clear();');
 edit(native,'const status = this.runActive ?','const status = (this.runActive || this.backgroundSources.size > 0) ?');
 edit(nativeBundle,'ProgramStatusReporter=class{getTerminal;','ProgramStatusReporter=class{backgroundSources=new Set;backgroundGeneration=0;getTerminal;');
 edit(nativeBundle,'handleEvent(event){switch(event.type){case"agent_start":this.runActive',''+sourceMethod+'handleEvent(event){switch(event.type){case"agent_start":this.runActive');
 edit(nativeBundle,'reset(){this.runActive=!1,this.compacting=!1','reset(){this.backgroundGeneration++;this.backgroundSources.clear();this.runActive=!1,this.compacting=!1');
 edit(nativeBundle,'let status=this.runActive?{state:"working"}:this.restingStatus','let status=(this.runActive||this.backgroundSources.size>0)?{state:"working"}:this.restingStatus');
 const declaration='createBackgroundActivitySource(): { setWorking(working: boolean): void; dispose(): void };';
 edit(path.join(pi,'dist/modes/interactive/program-status-reporter.d.ts'),'    handleEvent(event: AgentSessionEvent): void;','    '+declaration+'\n    handleEvent(event: AgentSessionEvent): void;');
 edit(path.join(pi,'dist/core/extensions/types.d.ts'),'    setWorkingVisible(visible: boolean): void;','    /** Local pinned native root Working contribution; dispose when the owner stops. */\n    '+declaration+'\n    setWorkingVisible(visible: boolean): void;');
 edit(path.join(pi,'dist/modes/interactive/interactive-mode.js'),'            setWorkingVisible: (visible) => this.setWorkingVisible(visible),','            createBackgroundActivitySource: () => this.programStatus.createBackgroundActivitySource(),\n            setWorkingVisible: (visible) => this.setWorkingVisible(visible),');
 edit(nativeBundle,'setWorkingVisible:visible=>this.setWorkingVisible(visible),','createBackgroundActivitySource:()=>this.programStatus.createBackgroundActivitySource(),setWorkingVisible:visible=>this.setWorkingVisible(visible),');
 edit(path.join(pi,'dist/core/extensions/runner.js'),'    setWorkingVisible: () => { },','    createBackgroundActivitySource: '+noop+',\n    setWorkingVisible: () => { },');
 edit(nativeBundle,'setWorkingVisible:()=>{},','createBackgroundActivitySource:'+noop+',setWorkingVisible:()=>{},');
 edit(path.join(pi,'dist/modes/rpc/rpc-mode.js'),'        setWorkingVisible(_visible) {','        createBackgroundActivitySource: '+noop+',\n        setWorkingVisible(_visible) {');
 edit(nativeBundle,'setWorkingVisible(_visible){},','createBackgroundActivitySource:'+noop+',setWorkingVisible(_visible){},');
 const classicBundle=find(path.join(classic,'bundle'),'// src/integrations/program-status.ts\n');
 for(const file of [path.join(classic,'src/integrations/program-status.js'),classicBundle]) {
  const candidates='const candidates = [];\n'+(file===classicBundle?'    ':'        ')+'for (const job of options.getJobs()) {';
  edit(file,candidates,candidates.replace('const candidates = [];','const candidates = [];\n    let backgroundWorking = false;'));
  edit(file,'const state = programState(job, blockedRuns.has(job.asyncId));','const state = programState(job, blockedRuns.has(job.asyncId));\n      backgroundWorking ||= state === "working";');
  edit(file,'candidates.sort((left, right) => Number(right.active)','options.onWorkingChange?.(backgroundWorking);\n    candidates.sort((left, right) => Number(right.active)');
  edit(file,'dispose(shutdownReason) {','dispose(shutdownReason) {\n      options.onWorkingChange?.(false);');
 }
 edit(path.join(classic,'src/integrations/program-status.d.ts'),'    write?: (data: string) => void;','    /** Local native-root contribution derived from the same child projection. */\n    onWorkingChange?: (working: boolean) => void;\n    write?: (data: string) => void;');
 for(const file of [path.join(classic,'src/extension/index.js'),classicBundle]) {
  edit(file,'const programStatus = registerProgramStatusReporter({','let backgroundActivity;\n    const programStatus = registerProgramStatusReporter({\n        onWorkingChange: (working) => backgroundActivity?.setWorking(working),');
  edit(file,'programStatus.dispose(shutdownReason);','programStatus.dispose(shutdownReason);\n            backgroundActivity?.dispose();\n            backgroundActivity = undefined;');
  edit(file,'programStatus.sessionStarted({ hasUI: ctx.hasUI === true, mode: ctx.mode });','backgroundActivity?.dispose();\n        backgroundActivity = ctx.mode === "tui" ? ctx.ui.createBackgroundActivitySource?.() : undefined;\n        programStatus.sessionStarted({ hasUI: ctx.hasUI === true, mode: ctx.mode });');
 }
 if(new Set(states).size!==1) throw Error('Unexpected partial subagents status patch');
 for(const [file,text] of changes) if(file.endsWith('.js')) execFileSync(process.execPath,['--input-type=module','--check'],{input:text});
 if(!dryRun) for(const [file,text] of changes) fs.writeFileSync(file,text);
 return changes.size;
}
