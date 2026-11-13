import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const release=fs.realpathSync(process.argv[2]);
const source=path.join(release,'source');
const node=path.join(release,'node/bin/node');
const home=os.homedir();
const env={HOME:home,PATH:process.env.PATH,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',HUMANLAYER_PI_DISABLE:'1',NODE_OPTIONS:process.env.NODE_OPTIONS??''};
function run(root,mode,args=[],ok=true,command='pi'){
 const r=spawnSync(path.join(root,'node/bin/node'),[path.join(root,'source/launch.mjs'),command,...args],{cwd:home,env:{...env,PI_SUBAGENTS_MODE:mode},encoding:'utf8',timeout:60000,input:'{"id":"commands","type":"get_commands"}\n'});
 assert.equal(r.status===0,ok,`${mode} ${args}: ${r.stderr}\n${r.stdout}`);return r;
}
const schemas=[];const commands=[];
const {DefaultResourceLoader}=await import(pathToFileURL(path.join(source,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
for(const mode of ['source','bundled']){
 assert.match(run(release,mode,['list']).stdout,new RegExp('Subagents mode: '+mode));
 assert.match(run(release,mode,[],true,'pi-health').stdout,new RegExp('Subagents mode: '+mode));
 const r=run(release,mode,['--mode','rpc','--no-session','--no-context-files','--no-approve']);
 const response=r.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).find(x=>x.id==='commands');
 assert.ok(response?.success);commands.push(response.data.commands.map(c=>c.name).sort());
 const plugin=path.join(source,'node_modules/@tintinweb/pi-subagents');
 const loader=new DefaultResourceLoader({cwd:home,agentDir:path.join(home,'.pi/agent'),noContextFiles:true,additionalExtensionPaths:[mode==='source'?plugin:path.join(plugin,'src/bundle.mjs')]});
 await loader.reload();const loaded=loader.getExtensions();assert.deepEqual(loaded.errors,[]);
 schemas.push(JSON.parse(JSON.stringify(loaded.extensions.flatMap(e=>[...e.tools].map(([name,t])=>({name,definition:t.definition}))).sort((a,b)=>a.name.localeCompare(b.name)))));
}
assert.ok(schemas[0].length);assert.deepEqual(schemas[0],schemas[1]);assert.deepEqual(commands[0],commands[1]);
// Warm alternating real launcher samples: readiness means a complete get_commands
// response, not merely process spawn or EOF. Includes bundled integrity hashing.
async function readiness(mode){return await new Promise((resolve,reject)=>{
 const start=performance.now();let output='',stderr='',elapsed;
 const child=spawn(node,[path.join(source,'launch.mjs'),'pi','--mode','rpc','--no-session','--no-context-files','--no-approve'],{cwd:home,env:{...env,PI_SUBAGENTS_MODE:mode},stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('RPC readiness timeout: '+mode+' '+stderr));},60000);
 child.stderr.on('data',b=>{stderr+=b;});
 child.stdout.on('data',b=>{output+=b;const lines=output.split('\n');output=lines.pop();for(const line of lines){if(!line.startsWith('{'))continue;const msg=JSON.parse(line);if(msg.id==='timing'&&elapsed===undefined){if(!msg.success){child.kill('SIGKILL');reject(Error('RPC timing response failed'));return;}elapsed=performance.now()-start;child.stdin.end();}}});
 child.once('error',e=>{clearTimeout(timer);reject(e);});
 child.once('close',code=>{clearTimeout(timer);if(elapsed===undefined||code!==0)reject(Error('RPC timing process failed: '+code+' '+stderr));else resolve(elapsed);});
 child.stdin.write('{"id":"timing","type":"get_commands"}\n');
});}
const timings={source:[],bundled:[]};
for(const mode of ['source','bundled'])await readiness(mode);
for(let sample=0;sample<5;sample++)for(const mode of sample%2?['bundled','source']:['source','bundled'])timings[mode].push(await readiness(mode));
const stats=Object.fromEntries(Object.entries(timings).map(([mode,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [mode,{medianMs:sorted[2],minMs:sorted[0],maxMs:sorted[4],samplesMs:values}];}));
const ratio=stats.bundled.medianMs/stats.source.medianMs;
console.log('STARTUP '+JSON.stringify({measurement:'installed launcher RPC commands ready; includes integrity guard',...stats,bundledOverSource:ratio,medianGainPercent:100*(1-ratio)}));
// Relative guard intentionally permits noisy runners; measurements, not a strict
// wall-clock SLA, establish the gain. Catastrophic regressions still fail CI.
assert.ok(ratio<3,'Bundled median readiness exceeded three times source median');
const artifact=path.join(source,'node_modules/@tintinweb/pi-subagents/src/bundle.mjs');
const crypto=await import('node:crypto');const guardSamples=[];
for(let i=0;i<20;i++){const start=performance.now();const inventory=JSON.parse(fs.readFileSync(path.join(release,'integrity.json')));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),inventory[path.relative(release,artifact)]);guardSamples.push(performance.now()-start);}
guardSamples.sort((a,b)=>a-b);console.log('INTEGRITY_GUARD '+JSON.stringify({medianMs:guardSamples[10],minMs:guardSamples[0],maxMs:guardSamples[19],samples:20}));
assert.match(run(release,'invalid',['list'],false).stderr,/must be source or bundled/);
assert.ok(!fs.existsSync(path.join(source,'node_modules/esbuild')));
assert.equal(fs.readFileSync(path.join(source,'package-lock.json'),'utf8'),fs.readFileSync(new URL('./package-lock.json',import.meta.url),'utf8'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pi-packed-runtime-'));
try{
 const archive=path.join(temporary,'release.tar');
 execFileSync('tar',['-cf',archive,'-C',release,'.']);
 const relocated=path.join(temporary,'relocated');fs.mkdirSync(relocated);execFileSync('tar',['-xf',archive,'-C',relocated]);
 for(const mode of ['source','bundled']){run(relocated,mode,['--mode','rpc','--no-session','--no-context-files','--no-approve']);run(relocated,mode,[],true,'pi-health');}
 const bundle=path.join(relocated,'source/node_modules/@tintinweb/pi-subagents/src/bundle.mjs');
 fs.appendFileSync(bundle,'\nthrow Error("BUNDLE_SENTINEL");\n');
 assert.match(run(relocated,'bundled',[],false,'pi-health').stderr,/modified/);
 // Bundled integrity failure must stop startup, never fall back to source.
 const result=spawnSync(node,[path.join(relocated,'source/launch.mjs'),'pi','--mode','rpc','--no-session'],{cwd:home,env:{...env,PI_SUBAGENTS_MODE:'bundled'},input:'{"type":"get_commands"}\n',encoding:'utf8',timeout:60000});
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/Installed release modified/);
 fs.unlinkSync(bundle);
 assert.match(run(relocated,'bundled',['--mode','rpc','--no-session'],false).stderr,/ENOENT/);
 run(relocated,'source',['--mode','rpc','--no-session']);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('PASS installed launcher mode/schema/commands parity, health/list, invalid selector, omit-dev, locked runtime, packed relocation and tamper/no-fallback');
