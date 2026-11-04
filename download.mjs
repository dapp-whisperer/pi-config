import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
async function transfer(url,digest,dest,{socketTimeout=30000,overallTimeout=900000}={}) {
 let request, response, output, settled=false;
 await new Promise((resolve,reject)=>{
  const finish=error=>{if(settled) return; settled=true; clearTimeout(timer); if(error) {request?.destroy(); response?.destroy(); if(output&&!output.closed) {output.once('close',()=>reject(error)); output.destroy();} else reject(error);} else resolve();};
  const timer=setTimeout(()=>finish(Error('Download overall timeout')),overallTimeout);
  const get=(address,hops=0)=>{
   if(hops>5) return finish(Error('Too many redirects'));
   const u=new URL(address); if(!['https:','http:'].includes(u.protocol)) return finish(Error('Unsupported download protocol'));
   request=(u.protocol==='https:'?https:http).get(u,r=>{
    response=r;
    if(r.statusCode>=300&&r.statusCode<400&&r.headers.location) {r.resume(); const next=new URL(r.headers.location,u); if(u.protocol==='https:'&&next.protocol!=='https:') return finish(Error('Insecure redirect')); get(next,hops+1); return;}
    if(r.statusCode!==200) return finish(Error('Download HTTP '+r.statusCode));
    output=fs.createWriteStream(dest); const hash=crypto.createHash('sha256');
    r.on('data',chunk=>hash.update(chunk)); r.on('error',finish); output.on('error',finish);
    output.on('finish',()=>finish(hash.digest('hex')===digest?undefined:Error('Checksum mismatch'))); r.pipe(output);
   });
   request.setTimeout(socketTimeout,()=>finish(Error('Download socket timeout'))); request.on('error',finish);
  }; get(url);
 });
}

// Isolate resolver and stream lifetime too: a timeout reaps the worker before the
// installer can remove staging or release its lock. No process-global signals.
export async function download(url,digest,dest,{socketTimeout=30000,overallTimeout=900000}={}) {
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',String(url),digest,String(dest),String(socketTimeout),String(overallTimeout)],{stdio:['ignore','ignore','pipe']});
  let error='',timedOut=false;
  child.stderr.on('data',chunk=>{error=(error+chunk).slice(-8192);});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},overallTimeout);
  child.on('error',failure=>{clearTimeout(timer);reject(failure);});
  child.on('close',code=>{clearTimeout(timer);if(timedOut)reject(Error('Download overall timeout'));else if(code!==0)reject(Error(error||'Download worker failed'));else resolve();});
 });
}
if(process.argv[2]==='--worker') {
 try {await transfer(process.argv[3],process.argv[4],process.argv[5],{socketTimeout:Number(process.argv[6]),overallTimeout:Number(process.argv[7])});}
 catch(error) {console.error(error.message);process.exit(1);}
}
