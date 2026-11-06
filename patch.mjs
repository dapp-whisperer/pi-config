import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = path.join(process.argv[2], '@earendil-works/pi-coding-agent/dist');
const files = fs.readdirSync(path.join(root,'bundle/chunks')).map(n=>path.join(root,'bundle/chunks',n));
files.push(path.join(root,'modes/interactive/interactive-mode.js'));
// Keep the SDK and bundle anchors separate: these are pinned emitted builds, not regenerated code.
const sdkOverlayEdits = [
  ['let closed = false;', 'let closed = false;\n            const blockedSource = isOverlay && options?.blocked ? Symbol("extension-overlay") : undefined;\n            const clearOverlay = () => {\n                if (blockedSource) this.programStatus.setBlocked(blockedSource, undefined);\n                overlayHandle?.hide();\n            };'],
  ['overlayHandle?.hide();\n                else', 'clearOverlay();\n                else'],
  ['Promise.resolve(factory(this.ui, theme, this.keybindings, close))', 'Promise.resolve().then(() => factory(this.ui, theme, this.keybindings, close))'],
  ['overlayHandle = this.ui.showOverlay(c, resolveOptions());', 'overlayHandle = this.ui.showOverlay(c, resolveOptions());\n                    if (closed) { clearOverlay(); return; }\n                    if (blockedSource) this.programStatus.setBlocked(blockedSource, options.blocked);'],
  ['if (!isOverlay)\n                    restoreEditor();\n                reject(err);', 'closed = true;\n                if (isOverlay) clearOverlay();\n                else restoreEditor();\n                reject(err);'],
];
const bundleOverlayEdits = [
  ['closed=!1,restoreEditor3=', 'closed=!1,blockedSource=isOverlay&&options?.blocked?Symbol("extension-overlay"):void 0,clearOverlay=()=>{blockedSource&&this.programStatus.setBlocked(blockedSource,void 0),overlayHandle?.hide()},restoreEditor3='],
  ['isOverlay?overlayHandle?.hide():restoreEditor3()', 'isOverlay?clearOverlay():restoreEditor3()'],
  ['Promise.resolve(factory(this.ui,theme,this.keybindings,close))', 'Promise.resolve().then(()=>factory(this.ui,theme,this.keybindings,close))'],
  ['overlayHandle=this.ui.showOverlay(c,resolveOptions()),options?.onHandle?.(overlayHandle)', 'overlayHandle=this.ui.showOverlay(c,resolveOptions());if(closed){clearOverlay();return}blockedSource&&this.programStatus.setBlocked(blockedSource,options.blocked),options?.onHandle?.(overlayHandle)'],
  ['closed||(isOverlay||restoreEditor3(),reject(err))', 'closed||(closed=!0,isOverlay?clearOverlay():restoreEditor3(),reject(err))'],
];
function replaceExactly(text, before, after, file, expected = 1) {
  if (text.split(before).length - 1 !== expected) throw Error(`Patch compatibility failure: ${file}: ${before}`);
  return text.replaceAll(before, after);
}
const overlayBuilds = new Set();
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes('async showExtensionCustom(')) continue;
  const bundled = file.includes('/bundle/');
  const build = bundled ? 'bundle' : 'sdk';
  if (overlayBuilds.has(build)) throw Error(`Duplicate overlay lifecycle build: ${build}`);
  const start = 'async showExtensionCustom(';
  const methodEnd = bundled ? 'showExtensionError(extensionPath,error,stack)' : 'showExtensionError(extensionPath, error, stack)';
  if (text.split(start).length !== 2 || text.split(methodEnd).length !== 2) throw Error(`Overlay patch compatibility failure: ${file}`);
  const from = text.indexOf(start), to = text.indexOf(methodEnd, from);
  let method = text.slice(from, to);
  for (const [before, after] of bundled ? bundleOverlayEdits : sdkOverlayEdits) {
    method = replaceExactly(method, before, after, file);
  }
  text = text.slice(0, from) + method + text.slice(to);
  fs.writeFileSync(file, text); execFileSync(process.execPath, ['--check', file]);
  overlayBuilds.add(build);
}
if (overlayBuilds.size !== 2) throw Error(`Expected two overlay lifecycles, got ${overlayBuilds.size}`);
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

const askFile=path.join(process.argv[2],'pi-ask-user/index.ts');
let ask=fs.readFileSync(askFile,'utf8');
const edits=[["\ntype AskMode = \"select\" | \"freeform\" | \"comment\";\n\nconst ASK_OVERLAY_MAX_HEIGHT_RATIO = 0.85;\nconst ASK_OVERLAY_MIN_RENDER_LINES = 8;\nconst ASK_OVERLAY_WIDTH = \"92%\";\nconst ASK_OVERLAY_MIN_WIDTH = 40;\nconst SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH = 84;\nconst SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH = 32;\nconst SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH = 28;","\ntype AskMode = \"select\" | \"freeform\" | \"comment\";\n\nconst ASK_OVERLAY_MAX_HEIGHT_RATIO = 0.95;\nconst ASK_OVERLAY_MAX_HEIGHT = \"95%\";\nconst ASK_OVERLAY_MIN_RENDER_LINES = 8;\nconst ASK_OVERLAY_WIDTH = \"100%\";\nconst ASK_OVERLAY_MIN_WIDTH = 40;\n// Dock the prompt to the bottom edge (Claude Code style): short prompts sit on\n// the input line, tall ones grow upward instead of floating mid-window.\nconst ASK_OVERLAY_ANCHOR = \"bottom-center\" as const;\nconst SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH = 84;\nconst SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH = 32;\nconst SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH = 28;"],["         return {\n            overlay: true,\n            overlayOptions: {\n               anchor: \"center\" as const,\n               width: ASK_OVERLAY_WIDTH,\n               minWidth: ASK_OVERLAY_MIN_WIDTH,\n               maxHeight: \"85%\",\n               margin: 1,\n            },\n            ...(onHandle ? { onHandle } : {}),","         return {\n            overlay: true,\n            overlayOptions: {\n               anchor: ASK_OVERLAY_ANCHOR,\n               width: ASK_OVERLAY_WIDTH,\n               minWidth: ASK_OVERLAY_MIN_WIDTH,\n               maxHeight: ASK_OVERLAY_MAX_HEIGHT,\n               margin: 1,\n            },\n            ...(onHandle ? { onHandle } : {}),"]];
for(const [before,after] of edits) {const expected=before.includes('overlayOptions')?2:1; if(ask.split(before).length-1!==expected) throw Error('Ask-user patch compatibility failure'); ask=ask.replaceAll(before,after);}
ask = replaceExactly(ask,
  '): { overlay?: boolean; overlayOptions?: OverlayOptions; onHandle?: (handle: OverlayHandle) => void } | undefined {\n   switch (displayMode) {\n      case "inline":\n         return undefined;',
  '): { overlay?: boolean; overlayOptions?: OverlayOptions; onHandle?: (handle: OverlayHandle) => void; blocked: { kind: "question"; message: string } } {\n   const blocked = { kind: "question" as const, message: "Waiting for user response" };\n   switch (displayMode) {\n      case "inline":\n         return { blocked };', askFile);
ask = replaceExactly(ask, '            overlay: true,\n            overlayOptions:', '            overlay: true,\n            blocked,\n            overlayOptions:', askFile, 2);
fs.writeFileSync(askFile,ask);
