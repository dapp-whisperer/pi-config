import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {patchGoal} from './goal-patch.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-patch-'));
const root = path.join(dir, '@narumitw/pi-goal');
const anchor = '      runtime.showCompletionStatus(ctx);';
function fixture(version = '0.54.13', bundle = anchor) {
  for (const name of ['src', 'dist']) fs.mkdirSync(path.join(root, name), {recursive:true});
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version}));
  fs.writeFileSync(path.join(root, 'src/tools.ts'), anchor);
  fs.writeFileSync(path.join(root, 'dist/index.ts'), bundle);
}
try {
  fixture();
  assert.equal(patchGoal(dir, {dryRun:true}), 2);
  assert.equal(fs.readFileSync(path.join(root, 'src/tools.ts'), 'utf8'), anchor);
  assert.equal(patchGoal(dir), 2);
  assert.equal(patchGoal(dir), 0);
  fixture('0.54.14'); assert.throws(() => patchGoal(dir), /Unsupported/);
  for (const bad of ['', anchor + anchor, anchor + 'goal-completion-summary']) {
    fixture('0.54.13', bad); assert.throws(() => patchGoal(dir));
    assert.equal(fs.readFileSync(path.join(root, 'src/tools.ts'), 'utf8'), anchor);
  }
  console.log('Goal patch guards: PASS');
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
