import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const plugin=path.join(root,'node_modules/@tintinweb/pi-subagents');
const artifacts=path.join(root,'bundles');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function tree(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).filter(e=>e.name!=='node_modules'&&e.name!=='bundle.mjs').flatMap(e=>e.isDirectory()?tree(path.join(dir,e.name)):e.isFile()?[[path.relative(plugin,path.join(dir,e.name)),hash(fs.readFileSync(path.join(dir,e.name)))]]:[]);}
function inputs(){return {version:JSON.parse(fs.readFileSync(path.join(plugin,'package.json'))).version,source:hash(JSON.stringify(tree(plugin))),lock:hash(fs.readFileSync(path.join(root,'package-lock.json'))),recipe:hash(fs.readFileSync(fileURLToPath(import.meta.url)))};}
export function verifyBundle(){const p=JSON.parse(fs.readFileSync(path.join(artifacts,'subagents.json')));for(const [k,v] of Object.entries(inputs()))if(p[k]!==v)throw Error('Subagents provenance mismatch: '+k);const bytes=fs.readFileSync(path.join(artifacts,'subagents.mjs'));if(hash(bytes)!==p.bundle)throw Error('Subagents bundle hash mismatch');return bytes;}
export function installBundle(){fs.writeFileSync(path.join(plugin,'src/bundle.mjs'),verifyBundle());}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(mode==='install')installBundle();
 else if(mode==='build'||mode==='check'){
  const {build}=await import('esbuild');
  const result=await build({absWorkingDir:root,entryPoints:['node_modules/@tintinweb/pi-subagents/src/index.ts'],bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',write:false,legalComments:'inline'});
  const bytes=result.outputFiles[0].contents;
  const provenance=JSON.stringify({...inputs(),bundle:hash(bytes)},null,2)+'\n';
  if(mode==='check'){verifyBundle();if(!Buffer.from(bytes).equals(fs.readFileSync(path.join(artifacts,'subagents.mjs')))||provenance!==fs.readFileSync(path.join(artifacts,'subagents.json'),'utf8'))throw Error('Non-reproducible subagents artifact');}
  else{fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,'subagents.mjs'),bytes);fs.writeFileSync(path.join(artifacts,'subagents.json'),provenance);}
 }else throw Error('Expected build, check or install');
}
