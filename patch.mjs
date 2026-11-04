import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = path.join(process.argv[2], '@earendil-works/pi-coding-agent/dist');
const files = fs.readdirSync(path.join(root,'bundle/chunks')).map(n=>path.join(root,'bundle/chunks',n));
files.push(path.join(root,'modes/interactive/interactive-mode.js'));
let count = 0;
for (const file of files) {
  let text = fs.readFileSync(file,'utf8');
  if (!text.includes('checkForNewPiVersion(this.version)')) continue;
  for (const re of [/checkForNewPiVersion\(this\.version\)\.then\(/g, /this\.checkForPackageUpdates\(\)\s*\.then\(/g]) {
    const matches = text.match(re);
    if (matches?.length !== 1) throw new Error(`Patch compatibility failure: ${file}: ${re}`);
    text = text.replace(re, m=>'process.env.PI_UPDATE_NOTICES&&'+m);
    count++;
  }
  fs.writeFileSync(file,text); execFileSync(process.execPath,['--check',file]);
}
if(count !== 4) throw new Error(`Expected four update guards, got ${count}`);
