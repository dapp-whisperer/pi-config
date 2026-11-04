import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {unpack} from './archive.mjs';
import {download} from './download.mjs';
import {install,hash,publishRelease,activateRelease,seedUiPreferences} from './install.mjs';
test('UI transparent default uses plugin settings and preserves preferences',()=>temp(home=>{
 const file=path.join(home,'.pi/settings.json');
 seedUiPreferences(home);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)),{toolBackground:'transparent'});
 fs.writeFileSync(file,JSON.stringify({theme:'dark',custom:{enabled:true}}));
 seedUiPreferences(home);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)),{theme:'dark',custom:{enabled:true},toolBackground:'transparent'});
 fs.writeFileSync(file,'{ "toolBackground": "outlines", "theme": "light" }');
 const before=fs.readFileSync(file,'utf8');seedUiPreferences(home);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal(fs.existsSync(path.join(home,'.pi/agent/settings.json')),false);
}));
export function tar(entries) {const blocks=[]; for(const [name,type='0',value=''] of entries) {const h=Buffer.alloc(512);h.write(name);h.write('0000755\0',100);h.write((type==='0'?Buffer.byteLength(value):0).toString(8).padStart(11,'0')+'\0',124);h.fill(32,148,156);h.write(type,156);if(type==='2'||type==='1') h.write(value,157);h.write('ustar\0',257);h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);blocks.push(h);if(type==='0') {const b=Buffer.alloc(Math.ceil(Buffer.byteLength(value)/512)*512);b.write(value);blocks.push(b);}}return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));}
function temp(fn) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-safety-'));return Promise.resolve().then(()=>fn(root)).finally(()=>fs.rmSync(root,{recursive:true,force:true}));}
test('archive rejects all prior traversal, hardlink, duplicate and unsupported regressions',()=>temp(root=>{
 const cases=[ [['root/a','2','.'],['root/c','1','root/a/../../victim'],['root/c','0','overwrite']], [['../victim','0','overwrite']], [['root/a','2','.'],['root/b','2','a/../../victim']], [['root/a','0','data'],['root/b','1','root/a']], [['root/a','0','data'],['root/./a','0','overwrite']], [['root/a','6','']], [['root/a','2','.'],['root/a/b','0','overwrite']], [['root','5'],['root/victim','0','inside'],['root/a','2','.'],['root/b','2','a/a/../../victim']], [['/absolute','0','x']], [['root/a','2','/outside']], [['root/a','2','../../outside']], [['root/a','2','missing']] ];
 for(const [i,entries] of cases.entries()) {const a=path.join(root,'a'),d=path.join(root,String(i));fs.writeFileSync(a,tar(entries));fs.mkdirSync(d);assert.throws(()=>unpack(a,d));assert.deepEqual(fs.readdirSync(d),[]);}
 const a=path.join(root,'a'),d=path.join(root,'valid');fs.mkdirSync(d);fs.writeFileSync(a,tar([['node/lib/npm/cli.js','0','ok'],['node/bin/npm','2','../lib/npm/cli.js']]));unpack(a,d);assert.equal(fs.readFileSync(path.join(d,'node/bin/npm'),'utf8'),'ok');
 const regular=path.join(root,'regular');fs.mkdirSync(regular);assert.throws(()=>unpack(a,regular,{regularOnly:true}));
}));
test('stalls and slow drip bound whole transaction, preserve existing HOME and remove lock',()=>temp(async home=>{
 const sockets=new Set();const server=http.createServer((req,res)=>{if(req.url==='/ok') {res.end('complete');return;} if(req.url==='/headers') return;res.writeHead(200,{'content-length':100000});res.flushHeaders();if(req.url==='/body') return;const t=setInterval(()=>res.write('x'),15);res.on('close',()=>clearInterval(t));});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const ok=path.join(home,'downloaded');await download(`http://127.0.0.1:${server.address().port}/ok`,hash('complete'),ok);assert.equal(fs.readFileSync(ok,'utf8'),'complete');await assert.rejects(download(`http://127.0.0.1:${server.address().port}/ok`,'0'.repeat(64),ok),/Checksum mismatch/);const root=path.join(home,'.local/share/personal-pi'),old=path.join(root,'old'),agent=path.join(home,'.pi/agent');fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'pi'),'preserved');fs.symlinkSync(old,path.join(root,'current'));fs.mkdirSync(agent,{recursive:true});fs.writeFileSync(path.join(agent,'settings.json'),'{}');fs.writeFileSync(path.join(agent,'auth.json'),'sentinel');
 for(const endpoint of ['headers','body','drip']) {const start=Date.now();await assert.rejects(install({home,fetch:(_u,digest,dest)=>download(`http://127.0.0.1:${server.address().port}/${endpoint}`,digest,dest,{socketTimeout:2000,overallTimeout:150})}),/overall timeout/);assert.ok(Date.now()-start<3000);assert.equal(fs.existsSync(path.join(root,'install.lock')),false);assert.equal(fs.readdirSync(root).some(n=>n.startsWith('build-')),false);assert.equal(fs.readFileSync(path.join(root,'current/pi'),'utf8'),'preserved');assert.equal(fs.readFileSync(path.join(agent,'auth.json'),'utf8'),'sentinel');assert.equal(fs.readFileSync(path.join(agent,'settings.json'),'utf8'),'{}');}
 for(const endpoint of ['headers','body']) await assert.rejects(download(`http://127.0.0.1:${server.address().port}/${endpoint}`,'unused',path.join(home,'partial'),{socketTimeout:50,overallTimeout:2000}),/socket timeout/);
 } finally {for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
}));
test('publication and activation failures preserve old selection and rollback new links',()=>temp(root=>{
 const stage=path.join(root,'stage'),old=path.join(root,'old'),release=path.join(root,'releases/new'),bin=path.join(root,'bin');for(const d of [stage,old,bin])fs.mkdirSync(d);fs.writeFileSync(path.join(stage,'pi'),'new');fs.writeFileSync(path.join(old,'pi'),'old');fs.symlinkSync(old,path.join(root,'current'));fs.symlinkSync(path.join(root,'current/pi'),path.join(bin,'pi'));
 const write=fs.writeFileSync;try {fs.writeFileSync=(p,...args)=>{if(String(p).endsWith('integrity.json'))throw Error('inventory failure');return write(p,...args);};assert.throws(()=>publishRelease(stage,release));assert.equal(fs.existsSync(release),false);}finally{fs.writeFileSync=write;}
 publishRelease(stage,release);
 for(const mode of ['link','rename']) {const symlink=fs.symlinkSync,rename=fs.renameSync;try {fs.symlinkSync=(target,p)=>{if(mode==='link'&&p.endsWith('/pih'))throw Error('link failure');return symlink(target,p);};fs.renameSync=(from,to)=>{if(mode==='rename')throw Error('rename failure');return rename(from,to);};assert.throws(()=>activateRelease(root,release,bin,['pi','pi-health','pih']));assert.equal(fs.readFileSync(path.join(bin,'pi'),'utf8'),'old');assert.equal(fs.existsSync(path.join(bin,'pi-health')),false);assert.equal(fs.readdirSync(root).some(n=>n.startsWith('activate-')),false);}finally{fs.symlinkSync=symlink;fs.renameSync=rename;}}
 activateRelease(root,release,bin,['pi','pi-health']);assert.equal(fs.readFileSync(path.join(bin,'pi'),'utf8'),'new');
}));
test('unrelated commands are refused before download and lock is released',()=>temp(async home=>{
 const bin=path.join(home,'.local/bin');fs.mkdirSync(bin,{recursive:true});fs.writeFileSync(path.join(bin,'pi'),'unrelated');
 await assert.rejects(install({home,fetch:()=>{throw Error('must not download');}}),/Refusing to replace/);
 assert.equal(fs.readFileSync(path.join(bin,'pi'),'utf8'),'unrelated');assert.equal(fs.existsSync(path.join(home,'.local/share/personal-pi/install.lock')),false);
}));
