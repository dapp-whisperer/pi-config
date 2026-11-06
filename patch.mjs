import {patchGoal} from './goal-patch.mjs';
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

const askFile=path.join(process.argv[2],'pi-ask-user/index.ts');
let ask=fs.readFileSync(askFile,'utf8');
const edits=[["\ntype AskMode = \"select\" | \"freeform\" | \"comment\";\n\nconst ASK_OVERLAY_MAX_HEIGHT_RATIO = 0.85;\nconst ASK_OVERLAY_MIN_RENDER_LINES = 8;\nconst ASK_OVERLAY_WIDTH = \"92%\";\nconst ASK_OVERLAY_MIN_WIDTH = 40;\nconst SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH = 84;\nconst SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH = 32;\nconst SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH = 28;","\ntype AskMode = \"select\" | \"freeform\" | \"comment\";\n\nconst ASK_OVERLAY_MAX_HEIGHT_RATIO = 0.95;\nconst ASK_OVERLAY_MAX_HEIGHT = \"95%\";\nconst ASK_OVERLAY_MIN_RENDER_LINES = 8;\nconst ASK_OVERLAY_WIDTH = \"100%\";\nconst ASK_OVERLAY_MIN_WIDTH = 40;\n// Dock the prompt to the bottom edge (Claude Code style): short prompts sit on\n// the input line, tall ones grow upward instead of floating mid-window.\nconst ASK_OVERLAY_ANCHOR = \"bottom-center\" as const;\nconst SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH = 84;\nconst SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH = 32;\nconst SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH = 28;"],["         return {\n            overlay: true,\n            overlayOptions: {\n               anchor: \"center\" as const,\n               width: ASK_OVERLAY_WIDTH,\n               minWidth: ASK_OVERLAY_MIN_WIDTH,\n               maxHeight: \"85%\",\n               margin: 1,\n            },\n            ...(onHandle ? { onHandle } : {}),","         return {\n            overlay: true,\n            overlayOptions: {\n               anchor: ASK_OVERLAY_ANCHOR,\n               width: ASK_OVERLAY_WIDTH,\n               minWidth: ASK_OVERLAY_MIN_WIDTH,\n               maxHeight: ASK_OVERLAY_MAX_HEIGHT,\n               margin: 1,\n            },\n            ...(onHandle ? { onHandle } : {}),"]];
for(const [before,after] of edits) {const expected=before.includes('overlayOptions')?2:1; if(ask.split(before).length-1!==expected) throw Error('Ask-user patch compatibility failure'); ask=ask.replaceAll(before,after);}
fs.writeFileSync(askFile,ask);
patchGoal(process.argv[2]);
execFileSync(process.execPath, [new URL('./test_goal_patch.mjs', import.meta.url).pathname], {stdio:'inherit'});
execFileSync(process.execPath, [new URL('./test_goal_handler.mjs', import.meta.url).pathname, process.argv[2]], {stdio:'inherit'});

// The Claude-style UI strips all ANSI styling from links for copy safety.
// Reapply semantic link styles after stripping nested body colors; OSC 8 targets
// are added by Pi afterwards, so click/copy behavior remains unchanged.
const uiFile=path.join(process.argv[2],'pi-claude-code-ui/extensions/index.ts');
let ui=fs.readFileSync(uiFile,'utf8');
const plainLinks='\t\tlink: (text: string) => stripAnsi(text),\n\t\tlinkUrl: (text: string) => stripAnsi(text),';
const visibleLinks='\t\tlink: (text: string) => theme.link(theme.underline(stripAnsi(text))),\n\t\tlinkUrl: (text: string) => theme.linkUrl(stripAnsi(text)),';
if(ui.split(plainLinks).length!==2) throw Error('Markdown link patch compatibility failure');
fs.writeFileSync(uiFile,ui.replace(plainLinks,visibleLinks));
