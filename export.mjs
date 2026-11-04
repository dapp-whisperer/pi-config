import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from './install.mjs';
export const FILES=[
  ".gitignore",
  "README.md",
  "archive.mjs",
  "bootstrap.sh",
  "defaults.json",
  "download.mjs",
  "export.mjs",
  "generate-bootstrap.mjs",
  "install.mjs",
  "launch.mjs",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "patch.mjs",
  "resources/humanlayer-auto-advance.ts",
  "resources/model-first-footer.ts",
  "resources/themes/ayu-dark-palette.json",
  "resources/themes/ayu-mirage-dotfiles.json",
  "resources/themes/catppuccin-frappe-mauve.json",
  "resources/themes/catppuccin-latte-mauve.json",
  "resources/themes/catppuccin-macchiato-mauve.json",
  "resources/themes/catppuccin-mocha-mauve.json",
  "resources/themes/duskfox-palette.json",
  "resources/themes/flexoki-dark-palette.json",
  "resources/themes/gruvbox-dark-palette.json",
  "resources/themes/kanagawa-wave-palette.json",
  "resources/themes/monokai-palette.json",
  "resources/themes/ocean-dark-palette.json",
  "resources/themes/one-dark-palette.json",
  "resources/themes/solarized-dark-dotfiles.json",
  "resources/themes/solarized-light-dotfiles.json",
  "resources/themes/tokyonight-night-palette.json",
  "resources/themes/tomorrow-night-bright-palette.json",
  "test_humanlayer_auto_advance.mjs",
  "test_runtime.mjs",
  "test_footer.mjs",
  "test_safety.mjs",
  "tests.mjs"
];
const source=path.dirname(fileURLToPath(import.meta.url));
function noLinks(p) {for(;;p=path.dirname(p)) {if(fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink()) throw Error('Refusing symlinked path'); if(path.dirname(p)===p) break;}}
export function exportFiles(destination) {
 destination=path.resolve(destination); noLinks(destination);
 if(destination===source||destination.startsWith(source+path.sep)) throw Error('Destination must be outside source');
 if(fs.existsSync(destination)&&(!fs.statSync(destination).isDirectory()||fs.readdirSync(destination).length)) throw Error('Destination must be empty');
 const payload=FILES.map(name=>{const p=path.join(source,name);noLinks(p); return [name,fs.readFileSync(p)];});
 fs.mkdirSync(destination,{recursive:true}); const inventory={};
 for(const [name,data] of payload) {const p=path.join(destination,name); fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);const mode=name==='bootstrap.sh'?0o755:0o644;fs.chmodSync(p,mode);inventory[name]={sha256:hash(data),mode:'0o'+mode.toString(8)};}
 fs.writeFileSync(path.join(destination,'export-manifest.json'),JSON.stringify(inventory,null,2)+'\n',{mode:0o644});
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) exportFiles(process.argv[2]);
