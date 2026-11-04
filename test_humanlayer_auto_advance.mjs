// Execute the shipped extension with mocked timers, filesystem and Pi API only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('./resources/humanlayer-auto-advance.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source).replace(/^import .*;$/gm, '')
  .replace('export default function', 'function').replace('export function', 'function');

function fixture() {
  const events = {}, commands = {}, timers = new Map(), sent = [];
  let nextTimer = 0, saved;
  const env = {};
  const sandbox = {
    process: {env}, join: (...parts) => parts.join('/'), homedir: () => '/unused',
    getAgentDir: () => '/mock-agent', existsSync: () => saved !== undefined,
    readFileSync: () => saved, writeFileSync: (_path, data) => { saved = data; },
    mkdirSync() {}, readdirSync: () => [],
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const extension = vm.runInNewContext(code + '\nhumanlayerAutoAdvance;', sandbox);
  extension({
    on: (name, handler) => { events[name] = handler; },
    registerCommand: (name, command) => { commands[name] = command.handler; },
    getCommands: () => ['implement-plan', 'create-research'].map(skill => ({source: 'skill', name: `skill:${skill}`})),
    sendUserMessage: command => sent.push(command),
  });
  const ctx = {hasUI: true, ui: {setStatus() {}, notify() {}}, sessionManager: {getSessionId: () => undefined}};
  return {
    timers, sent,
    command: text => commands['hl-auto'](text, ctx),
    schedule(skill) {
      events.agent_end({messages: [{role: 'assistant', content: [{type: 'text', text: `\`\`\`text\n/rpi:${skill}\n\`\`\``}]}]});
      events.agent_settled({aborted: false}, ctx);
      assert.equal(timers.size, 1);
      return [...timers.values()][0];
    },
    reload(config) { saved = JSON.stringify(config); events.session_start({}, ctx); },
  };
}

for (const command of ['deny implement-plan', 'reset', 'off']) {
  const f = fixture();
  await f.command('allow implement-plan');
  const callback = f.schedule('implement-plan');
  await f.command(command);
  assert.equal(f.timers.size, 0, command + ' must cancel countdown');
  // Even a callback already queued at cancellation must honor current gates.
  callback();
  assert.deepEqual(f.sent, [], command);
}
// Reset cancels even a default-allowed skill, not just implementation gates.
{
  const f = fixture(); f.schedule('create-research'); await f.command('reset');
  assert.equal(f.timers.size, 0); assert.deepEqual(f.sent, []);
}
// Current configuration is rechecked independently of command cancellation.
for (const config of [{enabled: false, allow: ['implement-plan']}, {enabled: true, allow: []}]) {
  const f = fixture(); await f.command('allow implement-plan');
  const callback = f.schedule('implement-plan'); f.reload(config); callback();
  assert.deepEqual(f.sent, []);
}
for (const denyUnrelated of [false, true]) {
  const f = fixture(); await f.command('allow implement-plan');
  const callback = f.schedule('implement-plan');
  if (denyUnrelated) await f.command('deny create-research');
  assert.equal(f.timers.size, 1); callback();
  assert.equal(f.sent.length, 1); assert.match(f.sent[0], /^\/skill:implement-plan /);
}
console.log('PASS HumanLayer countdown deny/reset/off cancellation, execution-time gates, allowed launch (mocked; no provider/cloud calls)');
