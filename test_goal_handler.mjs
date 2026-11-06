#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Execute the installed bundled completion handler with isolated runtime/API mocks.
assert.ok(process.argv[2], 'Supply the installed node_modules directory');
const source = readFileSync(path.join(process.argv[2], '@narumitw/pi-goal/dist/index.ts'), 'utf8');
const start = source.indexOf('async execute(', source.indexOf('function registerGoalTools('));
const end = source.indexOf('\n    }', start);
assert.ok(start > 0 && end > start);
const method = source.slice(start, end + 6);
const messages = [];
const pi = { sendMessage: (...args) => messages.push(args) };
const noop = () => {};
const runtime = {
  activeGoal: { id: 'goal-1', text: 'Test goal', status: 'active' },
  hasActiveBudgetWrapUp: () => false, ownsWorkflow: () => true,
  canRecordGoalUsage: () => true, clearGoalWaitTimer: noop,
  setCompletionSummary: noop, recordGoalUsage: noop, persistGoal: noop,
  clearCompletedGoal: () => { runtime.activeGoal = undefined; },
  showCompletionStatus: noop, updateStatus: noop,
};
const handler = new Function('pi', 'runtime', 'notifyTerminal', 'goalIdRejectionReason',
  'isContradictoryCompletionSummary', 'MAX_COMPLETION_SUMMARY_LENGTH', 'transitionGoal',
  'STATUS_KEY', 'formatStatus', 'toolContent', 'completionDetails', `return ({${method}}).execute;`)(
    pi, runtime, noop, (g, id) => g.id === id ? undefined : 'stale id',
    s => s.includes('not complete'), 4000, (g, status) => ({...g, status}),
    'goal', () => '', text => [{type: 'text', text}], (...args) => args);
const ctx = { ui: { setStatus: noop } };
async function run(goal_id, summary) { return handler('test', {goal_id, summary}, undefined, undefined, ctx); }
for (const [id, summary] of [['stale', 'Verified'], ['goal-1', ''], ['goal-1', 'not complete']]) {
  const result = await run(id, summary);
  assert.equal(messages.length, 0);
  assert.notEqual(result.terminate, true);
}
const result = await run('goal-1', '  Implemented and verified.  ');
assert.equal(result.terminate, true);
assert.deepEqual(messages, [[{
  customType: 'goal-completion-summary', content: 'Goal complete: Implemented and verified.', display: true,
}, {triggerTurn: false}]]);
await run('goal-1', 'Implemented and verified.');
assert.equal(messages.length, 1);
console.log('PASS: installed completion handler publishes once; stale, empty, contradictory, and inactive calls publish nothing.');
