import fs from 'node:fs';
import path from 'node:path';

// Native classic preferences are data, not an unmanaged extension. Inspect each
// component without following links, including dangling links. This is an
// ownership check at startup, not protection against concurrent filesystem edits.
export function assertManagedGlobalExtensions(root) {
 const refuse=()=>{throw Error('Unmanaged global extensions: only an ordinary subagent/config.json settings file is allowed');};
 const directory=(dir,allowed)=>{
  const stat=fs.lstatSync(dir,{throwIfNoEntry:false});
  if(!stat) return false;
  if(!stat.isDirectory()||stat.isSymbolicLink()) refuse();
  if(fs.readdirSync(dir).some(name=>name!==allowed)) refuse();
  return true;
 };
 if(!directory(root,'subagent')) return;
 const child=path.join(root,'subagent');
 if(!directory(child,'config.json')) return;
 const config=fs.lstatSync(path.join(child,'config.json'),{throwIfNoEntry:false});
 if(config&&(!config.isFile()||config.isSymbolicLink())) refuse();
}
