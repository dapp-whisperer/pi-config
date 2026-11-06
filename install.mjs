import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {download} from './download.mjs';
import {unpack} from './archive.mjs';
export const source=path.dirname(fileURLToPath(import.meta.url));
export const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
export function files(root) {return fs.readdirSync(root,{withFileTypes:true}).filter(e=>!['.git','node_modules','__pycache__'].includes(e.name)).flatMap(e=>e.isDirectory()?files(path.join(root,e.name)).map(n=>e.name+'/'+n):e.isFile()?[e.name]:[]).sort();}
function inventory(root) {const result={}; function walk(dir) {for(const e of fs.readdirSync(dir,{withFileTypes:true})) {const p=path.join(dir,e.name); if(e.isDirectory()) walk(p); else if(e.isFile()) result[path.relative(root,p)]=hash(fs.readFileSync(p));}} walk(root); return result;}
export function publishRelease(stage,release) {fs.writeFileSync(path.join(stage,'integrity.json'),JSON.stringify(inventory(stage))); fs.mkdirSync(path.dirname(release),{recursive:true}); fs.renameSync(stage,release);}
export function activateRelease(root,release,bindir,commands) {
 const created=[],temporary=path.join(root,'activate-'+crypto.randomUUID());
 try {for(const name of commands) {const p=path.join(bindir,name); if(!fs.existsSync(p)&&!fs.lstatSync(p,{throwIfNoEntry:false})) {fs.symlinkSync(path.join(root,'current',name),p); created.push(p);}} fs.symlinkSync(release,temporary); fs.renameSync(temporary,path.join(root,'current'));}
 catch(error) {for(const p of created) fs.unlinkSync(p); throw error;} finally {fs.rmSync(temporary,{force:true});}
}
export function seedUiPreferences(home) {
 const file=path.join(home,'.pi/settings.json');
 const existing=fs.existsSync(file);
 const prefs=existing?JSON.parse(fs.readFileSync(file,'utf8')):{};
 if(Object.hasOwn(prefs,'toolBackground')) return;
 prefs.toolBackground='transparent';
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(prefs,null,2)+'\n',{mode:0o600});
}
export function status(message, stream=process.stderr, env=process.env) {
 const label=stream.isTTY&&env.TERM!=='dumb'&&!Object.hasOwn(env,'NO_COLOR')?'\x1b[36m[install]\x1b[0m':'[install]';
 stream.write(label+' '+message+'\n');
}
export const skillMenu='Skill packs (comma-separated names, all, or none):\n  compound     Compound Engineering (default)\n  firecrawl    Firecrawl (default)\n  matt-pocock  Matt Pocock\n[compound,firecrawl]: ';
export const packs=['compound','firecrawl','matt-pocock'];
export function parsePacks(value) {
 const selected=value==='all'?packs:value==='none'?[]:value.split(',');
 if(selected.some(x=>!packs.includes(x))) throw Error('Unknown skill pack: '+value);
 return [...new Set(selected)].sort();
}
export async function install({home=os.homedir(),humanlayer=false,skillPacks,fetch=download}={}) {
 status('Checking installation and selected skills');
 const root=path.join(home,'.local/share/personal-pi'), current=path.join(root,'current'), bindir=path.join(home,'.local/bin');
 const previous=path.join(current,'options.json'); humanlayer ||= fs.existsSync(previous)&&JSON.parse(fs.readFileSync(previous)).humanlayer;
 const prior=fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous)):{};
 skillPacks=[...new Set([...(prior.skillPacks??(fs.existsSync(previous)?['compound','firecrawl']:[])),...(skillPacks??prior.skillPacks??['compound','firecrawl'])])].sort();
 const commands=humanlayer?['pi','pi-health','pih']:['pi','pi-health'];
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
 const digest=crypto.createHash('sha256').update(JSON.stringify({humanlayer,skillPacks})); for(const name of files(source)) digest.update(name).update(fs.readFileSync(path.join(source,name)));
 const release=path.join(root,'releases',digest.digest('hex').slice(0,20));
 fs.mkdirSync(root,{recursive:true}); const lock=path.join(root,'install.lock'); fs.mkdirSync(lock);
 let stage;
 try {
  for(const name of commands) {const p=path.join(bindir,name), st=fs.lstatSync(p,{throwIfNoEntry:false}); if(st&&(!st.isSymbolicLink()||fs.readlinkSync(p)!==path.join(current,name))) throw Error('Refusing to replace '+p);}
  if(process.env.PI_CODING_AGENT_DIR) throw Error('Unset PI_CODING_AGENT_DIR');
  const agent=path.join(home,'.pi/agent'),settings=path.join(agent,'settings.json'),extensions=path.join(agent,'extensions');
  if(fs.existsSync(extensions)&&fs.readdirSync(extensions).length) throw Error('Unmanaged global extensions');
  if(fs.existsSync(settings)) {const cfg=JSON.parse(fs.readFileSync(settings)); if(cfg.packages?.length||(cfg.extensions??[]).some(x=>!x.startsWith('-')&&!x.startsWith('builtin:'))) throw Error('Unmanaged configured packages/extensions');}
  if(fs.existsSync(release)&&!fs.existsSync(path.join(release,'integrity.json'))) fs.renameSync(release,release+'.incomplete-'+crypto.randomUUID());
  if(!fs.existsSync(release)) {
   stage=fs.mkdtempSync(path.join(root,'build-')); const src=path.join(stage,'source');
   fs.cpSync(source,src,{recursive:true,filter:p=>!['.git','node_modules','__pycache__'].includes(path.basename(p))});
   fs.writeFileSync(path.join(stage,'options.json'),JSON.stringify({humanlayer:!!humanlayer,skillPacks}));
   if(!humanlayer) fs.unlinkSync(path.join(src,'resources/humanlayer-auto-advance.ts'));
   const archive=path.join(stage,'archive.tgz'), extract=path.join(stage,'extract');
   const key=process.platform+'-'+process.arch;
   status('Downloading pinned Node runtime');
   await fetch(`https://nodejs.org/dist/v${manifest.nodeVersion}/node-v${manifest.nodeVersion}-${key}.tar.gz`,manifest.node[key],archive);
   fs.mkdirSync(extract); fs.renameSync(unpack(archive,extract),path.join(stage,'node')); fs.rmdirSync(extract); fs.unlinkSync(archive);
   const env={...process.env,HOME:home,PATH:path.join(stage,'node/bin')+path.delimiter+(process.env.PATH??''),npm_config_progress:'false',npm_config_color:'false',npm_config_update_notifier:'false',npm_config_cache:path.join(stage,'npm-cache'),npm_config_userconfig:'/dev/null',npm_config_globalconfig:path.join(stage,'empty-npmrc')};
   const node=path.join(stage,'node/bin/node');
   status('Installing locked npm dependencies');
   await new Promise((resolve,reject)=>{
    const child=spawn(node,[path.join(stage,'node/lib/node_modules/npm/bin/npm-cli.js'),'ci','--omit=dev','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund'],{cwd:src,env,stdio:'inherit'});
    const timer=setInterval(()=>status('npm dependency installation still running'),15000);
    child.on('error',error=>{clearInterval(timer);reject(error);});
    child.on('close',code=>{clearInterval(timer);code===0?resolve():reject(Error('npm ci failed: '+code));});
   });
   execFileSync(node,[path.join(src,'subagents-bundle.mjs'),'install'],{env,stdio:'inherit'});
   execFileSync(node,[path.join(src,'patch.mjs'),path.join(src,'node_modules')],{env,stdio:'inherit'});
   const upstream=path.join(stage,'upstream'); fs.mkdirSync(upstream);
   for(const item of manifest.sources) {if(item.pack&&!skillPacks.includes(item.pack)) continue; if(item.repo==='humanlayer/humanlayer-pi'&&!humanlayer) continue; status('Downloading '+item.repo); const dest=path.join(upstream,item.repo.replaceAll('/','-')); fs.mkdirSync(dest); await fetch(`https://codeload.github.com/${item.repo}/tar.gz/${item.sha}`,item.sha256,archive); unpack(archive,dest); fs.unlinkSync(archive);}
   fs.rmSync(path.join(stage,'npm-cache'),{recursive:true,force:true});
   for(const name of commands) fs.writeFileSync(path.join(stage,name),'#!/bin/sh\nexec "$HOME/.local/share/personal-pi/current/node/bin/node" "$HOME/.local/share/personal-pi/current/source/launch.mjs" '+name+' "$@"\n',{mode:0o755});
   publishRelease(stage,release); stage=undefined;
  }
  status('Verifying release integrity');
  for(const [name,expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(release,'integrity.json'))))) if(hash(fs.readFileSync(path.join(release,name)))!==expected) throw Error('Installed release modified: '+name);
  if(!fs.existsSync(settings)) {fs.mkdirSync(agent,{recursive:true}); fs.copyFileSync(path.join(source,'defaults.json'),settings);}
  seedUiPreferences(home);
  const subagentsFile=path.join(agent,'subagents.json');
  const subagents=fs.existsSync(subagentsFile)?JSON.parse(fs.readFileSync(subagentsFile,'utf8')):{};
  const subagentDefaults={workflowsEnabled:true,fleetView:true,widgetMode:'background',showModel:true,showCost:true};
  let changed=false;
  for(const [key,value] of Object.entries(subagentDefaults)) if(!Object.hasOwn(subagents,key)) {subagents[key]=value;changed=true;}
  if(changed) fs.writeFileSync(subagentsFile,JSON.stringify(subagents,null,2)+'\n',{mode:0o600});
  execFileSync(path.join(release,'node/bin/node'),[path.join(release,'source/launch.mjs'),'pi-health'],{cwd:home,env:{...process.env,HOME:home},stdio:'inherit'});
  fs.mkdirSync(bindir,{recursive:true}); activateRelease(root,release,bindir,commands); console.log('Installed '+release+'; add '+bindir+' to PATH.');
  return release;
 } finally {if(stage) fs.rmSync(stage,{recursive:true,force:true}); fs.rmdirSync(lock);}
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--help')) console.log('Usage: node install.mjs [--with-humanlayer] [--skills=compound,firecrawl,matt-pocock|all|none] [--yes]');
 else {
  const argv=process.argv.slice(2); let skillPacks;
  for(const arg of argv) {
   if(arg.startsWith('--skills=')) skillPacks=parsePacks(arg.slice(9));
   else if(!['--with-humanlayer','--yes'].includes(arg)) throw Error('Unknown option: '+arg);
  }
  if(skillPacks===undefined&&!argv.includes('--yes')&&process.stdin.isTTY&&process.stderr.isTTY) {
   const {createInterface}=await import('node:readline/promises');
   const rl=createInterface({input:process.stdin,output:process.stderr});
   try {skillPacks=parsePacks((await rl.question(skillMenu)).trim()||'compound,firecrawl');} finally {rl.close();}
  }
  await install({humanlayer:argv.includes('--with-humanlayer'),skillPacks});
 }
}
