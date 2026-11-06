// Exercise the installed UI theme adapter with Pi's real Markdown renderer; no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2], 'source/node_modules');
const ui=fs.readFileSync(path.join(root,'pi-claude-code-ui/extensions/index.ts'),'utf8');
// The adapter is private; extract its actual implementation rather than duplicate it.
const start=ui.indexOf('function assistantListBulletMarker(');
const end=ui.indexOf('\nfunction makeMarkdownLinksCopySafe(',start);
assert(start>=0 && end>start);
const stripAnsi=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
const adapter=new Function('stripAnsi',stripTypeScriptTypes(ui.slice(start,end))+'\nreturn copySafeMarkdownTheme;')(stripAnsi);
const load=p=>import(pathToFileURL(path.join(root,p)));
const {Markdown}=await load('@earendil-works/pi-tui/dist/components/markdown.js');
const {getCapabilities}=await load('@earendil-works/pi-tui/dist/terminal-image.js');
const {initTheme,getMarkdownTheme}=await load('@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js');
initTheme('dark');
const stock=getMarkdownTheme(), theme=adapter(stock);
const label='pi-gui', url='https://www.pi-gui.com/';
assert.equal(theme.link('\x1b[37m'+label+'\x1b[39m'),stock.link(stock.underline(label)), 'link adapter must restore theme color and underline after stripping nested body styles');
assert.equal(theme.linkUrl(url),stock.linkUrl(url),'fallback URLs retain their theme style');
assert.equal(stripAnsi(theme.listBullet('- ')),'◉ ');
const caps=getCapabilities(), previous=caps.hyperlinks;
try {
 for(const hyperlinks of [true,false]) {
  caps.hyperlinks=hyperlinks;
  for(const text of [`[${label}](${url})`,`**[${label}](${url})**`,`| App |\n| --- |\n| [${label}](${url}) |`]) {
   const rendered=new Markdown(text,0,0,theme).render(100).join('\n');
   assert(rendered.includes(theme.link(label)), 'paragraph, bold, and table links keep color and underline');
   assert(rendered.includes(url),'OSC 8 target or fallback URL is preserved');
   assert.equal(rendered.includes('\x1b]8;'),hyperlinks);
  }
 }
} finally {caps.hyperlinks=previous;}
console.log('PASS: link color/underline, nested body-style removal, table and bold links, OSC 8 targets, fallback URLs, list markers');
