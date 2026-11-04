// No model requests: verify the actual installed native PTY and SDK resource loader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const release=process.argv[2], source=path.join(release,'source');
const {spawn}=await import(pathToFileURL(path.join(source,'node_modules/zigpty/dist/index.mjs')));
let output='', observe;
const observed=new Promise(resolve=>{observe=resolve;});
const pty=spawn('/bin/sh',['-c','test -t 0 && test -t 1 && printf "native-pty-ok\\n"; read ack'],{
 terminal:{data(_term,data){output+=Buffer.from(data).toString(); if(output.includes('native-pty-ok')) observe();}},
});
const timer=setTimeout(()=>{pty.kill(); throw Error('Native PTY timed out');},10000);
try {
 await observed;
 pty.write('done\n');
 assert.equal(await pty.exited,0);
 assert.match(output,/native-pty-ok/);
 console.log('PASS installed zigpty native PTY (no pipe fallback)');
} finally {clearTimeout(timer); pty.close();}
const {DefaultResourceLoader}=await import(pathToFileURL(path.join(source,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
const deps=JSON.parse(fs.readFileSync(path.join(source,'package.json'))).dependencies;
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
for(const humanlayer of [false,true]) {
 const extensions=Object.keys(deps).filter(n=>n!=='@earendil-works/pi-coding-agent').map(n=>path.join(source,'node_modules',n));
 const skills=[];
 for(const item of manifest.sources) {
  const parent=path.join(release,'upstream',item.repo.replace('/','-'));
  if(!fs.existsSync(parent)) continue;
  const root=path.join(parent,fs.readdirSync(parent)[0]);
  if(item.repo==='humanlayer/humanlayer-pi') {
   if(humanlayer) extensions.push(path.join(source,'resources/humanlayer-auto-advance.ts'),root);
  } else if(item.repo==='davebcn87/pi-autoresearch') extensions.push(root);
  for(const skill of item.skills) skills.push(path.join(root,skill));
 }
 const loader=new DefaultResourceLoader({cwd:process.cwd(),agentDir:path.join(os.homedir(),'.pi/agent'),noContextFiles:true,additionalExtensionPaths:extensions,additionalSkillPaths:skills,additionalThemePaths:[path.join(source,'resources/themes')]});
 await loader.reload();
 const loaded=loader.getExtensions();
 assert.deepEqual(loaded.errors,[]);
 const diagnostics=[...loader.getSkills().diagnostics,...loader.getPrompts().diagnostics,...loader.getThemes().diagnostics];
 console.log(JSON.stringify({mode:humanlayer?'pih':'pi',extensions:loaded.extensions.length,skills:loader.getSkills().skills.length,themes:loader.getThemes().themes.length,diagnostics}));
 assert.equal(diagnostics.filter(d=>d.type==='error').length,0);
}
