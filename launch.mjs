import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const source=path.dirname(fileURLToPath(import.meta.url)), release=path.dirname(source);
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
const home=path.join(os.homedir(),'.pi/agent');
const cfg=JSON.parse(fs.readFileSync(path.join(home,'settings.json')));
if(process.env.PI_CODING_AGENT_DIR) throw Error('Unset PI_CODING_AGENT_DIR: bootstrap uses the shared default agent directory.');
if(cfg.packages?.length) throw Error('Unmanaged settings.packages detected; back up settings and remove package declarations before using this pinned launcher.');
if((cfg.extensions??[]).some(x=>!x.startsWith('-')&&!x.startsWith('builtin:')) || (fs.existsSync(path.join(home,'extensions')) && fs.readdirSync(path.join(home,'extensions')).length)) throw Error('Unmanaged global extensions detected. Move them aside explicitly; they can activate HumanLayer or floating dependencies.');
for (let dir=process.cwd();;dir=path.dirname(dir)) {
 const file=path.join(dir,'.pi/settings.json');
 if(fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).packages?.length) throw Error('Project package declarations are outside the bootstrap lock: '+file);
 if(path.dirname(dir)===dir) break;
}
const mode=process.argv[2], input=process.argv.slice(3);
if(mode==='pih' && !JSON.parse(fs.readFileSync(path.join(release,'options.json'))).humanlayer) throw Error('Reinstall with --with-humanlayer first.');
if(['install','update','remove','uninstall'].includes(input[0])) throw Error('Managed release: update by installing an explicitly reviewed bootstrap release, not pi package commands.');
const deps=JSON.parse(fs.readFileSync(path.join(source,'package.json'))).dependencies;
// Pi dispatches subcommands before parsing resource flags: keep argv[0] intact.
const passthrough = ['auth', 'mcp'].includes(input[0]);
if(input[0]==='list') {
 if(input.length>1 && !['--help','-h'].includes(input[1])) throw Error('Managed list takes no options; it lists the pinned release, not Pi package-manager state.');
 console.log('Managed release packages (local resources, not Pi package-manager installations):');
 for(const [name, version] of Object.entries(deps)) console.log(`${name}@${version}`);
 for(const item of manifest.sources) {
  const installed=fs.existsSync(path.join(release,'upstream',item.repo.replace('/','-')));
  if(installed) console.log(`${item.repo}@${item.sha}${item.repo==='humanlayer/humanlayer-pi'?' (pih only)':''}`);
 }
 process.exit(0);
}
if(input[0]==='config') {
 console.log(`Managed resources are selected by this immutable release, not Pi's package configuration screen. Edit ordinary preferences in ${path.join(home,'settings.json')}. To change packages/resources, review and install a new bootstrap release. Use pi list to inspect the managed inventory.`);
 process.exit(0);
}
const args=['-e',path.join(source,'resources/model-first-footer.ts')];
if(mode==='pih' && !passthrough) console.error('HumanLayer workflow preflight: private-derived RPI agent definitions are not distributed. RPI phases requiring codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher, implementer-agent, outline-implementer-agent or implementation-reviewer are unavailable in this public-only release. Mirroring and public skills load; workflows referencing those agents cannot run unchanged.');
for(const name of Object.keys(deps)) if(name!=='@earendil-works/pi-coding-agent') args.push('-e',path.join(source,'node_modules',name));
for(const item of manifest.sources){
 const dir=path.join(release,'upstream',item.repo.replace('/','-'));
 if(!fs.existsSync(dir) && item.repo==='humanlayer/humanlayer-pi') continue;
 const root=path.join(dir,fs.readdirSync(dir)[0]);
 if(item.repo==='humanlayer/humanlayer-pi'){
  if(mode==='pih') args.push('-e',path.join(source,'resources/humanlayer-auto-advance.ts'),'-e',root);
 }else if(item.repo==='davebcn87/pi-autoresearch') args.push('-e',root);
 for(const skill of item.skills) args.push('--skill',path.join(root,skill));
}
args.push('--theme',path.join(source,'resources/themes'));
const cli=path.join(source,'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const env={...process.env,PATH:path.join(release,'node/bin')+path.delimiter+process.env.PATH, PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0'};
if(mode!=='pih') env.HUMANLAYER_PI_DISABLE='1';
if(mode==='pi-health'){
 for(const [name, expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(release,'integrity.json'))))) {
  const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(release,name))).digest('hex');
  if(actual!==expected) throw Error('Installed release modified: '+name);
 }
 const out=spawnSync(process.execPath,[cli,'--version'],{env,encoding:'utf8'});
 if(out.status!==0 || out.stdout.trim()!=='1.5.0') throw Error('Runtime health check failed: '+out.stderr+out.stdout);
 console.log('OK: Pi 1.5.0; isolated Node '+process.version+'; '+Object.keys(deps).length+' locked npm packages; '+fs.readdirSync(path.join(release,'upstream')).length+' integrity-checked Git sources.');
 console.log(fs.existsSync(path.join(home,'auth.json'))?'Credentials file present (not read or validated).':'No saved credentials: run pi, then /login; or configure provider API-key environment variables.');
 console.log('Optional: git, rg, firecrawl CLI/auth, browser tools and HumanLayer daemon/auth are NOT provisioned. Offline startup: PI_OFFLINE=1 pi. No model call was made.');
}else{
 const child=spawnSync(process.execPath,[cli,...(passthrough ? input : [...args,...input])],{env,stdio:'inherit'});
 if(child.error) throw child.error;
 process.exit(child.status??1);
}
