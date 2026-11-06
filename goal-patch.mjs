import fs from 'node:fs';
import path from 'node:path';

// Validate every target before writing any target. Unknown releases fail closed.
export function patchGoal(modules, {dryRun = false} = {}) {
  const root = path.join(modules, '@narumitw/pi-goal');
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '0.54.13') {
    throw new Error('Unsupported pi-goal version; review upstream before updating this patch');
  }
  const anchor = '      runtime.showCompletionStatus(ctx);';
  const addition = '\n      pi.sendMessage({\n        customType: "goal-completion-summary",\n        content: `Goal complete: ${summary}`,\n        display: true,\n      }, { triggerTurn: false });';
  const changes = [];
  for (const name of ['src/tools.ts', 'dist/index.ts']) {
    const file = path.join(root, name);
    const text = fs.readFileSync(file, 'utf8');
    if (text.split(anchor).length !== 2) throw new Error(`Unexpected completion site: ${name}`);
    if (text.includes(anchor + addition) && text.split('goal-completion-summary').length === 2) continue;
    if (text.includes('goal-completion-summary')) throw new Error(`Unexpected partial patch: ${name}`);
    changes.push([file, text.replace(anchor, anchor + addition)]);
  }
  if (!dryRun) for (const [file, text] of changes) fs.writeFileSync(file, text);
  return changes.length;
}
