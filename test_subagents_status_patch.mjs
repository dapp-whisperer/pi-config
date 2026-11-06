import path from 'node:path';
import {verifyPatch} from './test_subagents_ui_patch.mjs';
import {patchSubagentsStatus} from './subagents-status-patch.mjs';
verifyPatch(patchSubagentsStatus,path.resolve(process.argv[2]),['pi-subagents','@earendil-works/pi-coding-agent'],'pi-subagents/src/integrations/program-status.js','@earendil-works/pi-coding-agent');
console.log('PASS subagents native status atomic guards, dry run, idempotence, mixed/missing/duplicate/version refusal');
