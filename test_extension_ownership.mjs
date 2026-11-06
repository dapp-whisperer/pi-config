import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,source} from './install.mjs';

const cases=[
 ['absent',null,true], ['empty','',true], ['empty child','subagent/',true], ['config','subagent/config.json',true],
 ['root file','ROOT',false], ['child file','subagent',false], ['config directory','subagent/config.json/',false],
 ...['index.ts','index.js','package.json','.hidden','other/','subagent/index.ts','subagent/index.js','subagent/package.json','subagent/.hidden','subagent/nested/'].map(p=>[p,p,false]),
 ...['ROOT','subagent','subagent/config.json'].flatMap(p=>[[`${p} link`,p+'@',false],[`${p} dangling`,p+'!',false]]),
];
for(const [name,entry,accepted] of cases) test('extension ownership: '+name,async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'pi-ownership-'));
 try {
  const root=path.join(home,'.pi/agent/extensions'), sentinel=path.join(home,'sentinel');
  fs.writeFileSync(sentinel,'untouched');
  if(entry!==null){
   const target=entry.startsWith('ROOT')?root:path.join(root,entry.replace(/[@!/]$/,''));
   fs.mkdirSync(path.dirname(target),{recursive:true});
   if(entry.endsWith('@')||entry.endsWith('!')) fs.symlinkSync(entry.endsWith('@')?sentinel:path.join(home,'missing'),target);
   else if(entry===''||entry.endsWith('/')) fs.mkdirSync(target,{recursive:true});
   else fs.writeFileSync(target,'{ "programStatus": false }\n');
  }
  fs.mkdirSync(path.join(home,'.pi/agent'),{recursive:true});
  fs.writeFileSync(path.join(home,'.pi/agent/settings.json'),'{}');
  const launch=spawnSync(process.execPath,[path.join(source,'launch.mjs'),'pi','list'],{cwd:home,env:{HOME:home,PATH:process.env.PATH},encoding:'utf8'});
  assert.equal(launch.status===0,accepted,launch.stderr);
  if(!accepted) assert.match(launch.stderr,/Unmanaged global extensions/);
  let downloads=0;
  await assert.rejects(install({home,fetch:async()=>{downloads++;throw Error('FIXTURE_DOWNLOAD');}}),accepted?/FIXTURE_DOWNLOAD/:/Unmanaged global extensions/);
  assert.equal(downloads,accepted?1:0);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'untouched');
  assert.equal(fs.existsSync(path.join(home,'.local/share/personal-pi/install.lock')),false);
 } finally {fs.rmSync(home,{recursive:true,force:true});}
});
