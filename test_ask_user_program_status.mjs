// Execute the pinned lifecycle and reporter, not copies of their implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const release = path.resolve(process.argv[2]);
const modules = path.join(release, 'source/node_modules');
const agent = path.join(modules, '@earendil-works/pi-coding-agent');
const load = relative => import(pathToFileURL(path.join(agent, relative)));
assert.equal(JSON.parse(fs.readFileSync(path.join(agent, 'package.json'))).version, '1.5.0');
const {InteractiveMode} = await load('dist/modes/interactive/interactive-mode.js');
const {ProgramStatusReporter} = await load('dist/modes/interactive/program-status-reporter.js');
const {initTheme} = await load('dist/modes/interactive/theme/theme.js');
initTheme('dark');
const tick = () => new Promise(resolve => setImmediate(resolve));
const blocked = {kind: 'question', message: 'Waiting for user response'};
function harness() {
  const reports = [], overlays = new Set();
  const mode = Object.create(InteractiveMode.prototype);
  mode.programStatus = new ProgramStatusReporter(() => ({setProgramStatus: status => reports.push(status)}), () => 'session');
  mode.editor = {getText: () => 'draft', setText() {}};
  mode.editorContainer = {clear() {}, addChild() {}};
  mode.extensionDialogs = [];
  mode.ui = {requestRender() {}, setFocus() {}, terminal: {columns: 100, rows: 40}, showOverlay(component) {
    let hidden = false;
    const handle = {hide: () => overlays.delete(handle), setHidden: value => { hidden = value; }, isHidden: () => hidden};
    overlays.add(handle);
    return handle;
  }};
  return {mode, reports, overlays, status: () => reports.at(-1)};
}
function open(h, options = {overlay: true, blocked}) {
  let done;
  const promise = h.mode.showExtensionCustom((_ui, _theme, _keys, close) => {
    done = close;
    return {render: () => [], invalidate() {}};
  }, options);
  return {promise, done: value => done(value)};
}
{
  const h = harness(), prompt = open(h);
  await tick();
  assert.equal(h.status()?.state, 'blocked', 'showExtensionCustom overlay must report native blocked');
  const handle = [...h.overlays][0];
  handle.setHidden(true);
  assert.equal(h.status().state, 'blocked');
  handle.setHidden(false);
  prompt.done('answer');
  assert.equal(await prompt.promise, 'answer');
  assert.equal(h.status().state, 'idle');
  assert.equal(h.overlays.size, 0);
}
console.log('PASS native overlay blocked, hidden/unhidden, answer and idle restoration');
for (const reverse of [false, true]) {
  const h = harness();
  h.mode.programStatus.setBlocked('login', {kind: 'permission', message: 'login'});
  const inline = open(h, {blocked: {kind: 'question', message: 'inline'}});
  await tick();
  const a = open(h, {overlay: true, blocked: {kind: 'question', message: 'A'}});
  await tick();
  const b = open(h, {overlay: true, blocked: {kind: 'question', message: 'B'}});
  await tick();
  assert.equal(h.status().message, 'B');
  const [first, last] = reverse ? [b, a] : [a, b];
  first.done(); await first.promise;
  assert.equal(h.status().message, reverse ? 'A' : 'B');
  last.done(); await last.promise;
  assert.equal(h.status().message, 'inline');
  inline.done(); await inline.promise;
  assert.equal(h.status().message, 'login');
  assert.equal(h.mode.programStatus.blocked.size, 1);
}
for (const events of [
  [], [{type: 'agent_start'}], [{type: 'compaction_start'}],
  [{type: 'agent_start'}, {type: 'agent_settled'}],
  [{type: 'agent_start'}, {type: 'message_end', message: {role: 'assistant', stopReason: 'error', errorMessage: 'failure\nprivate detail'}}, {type: 'agent_settled'}],
]) {
  const h = harness();
  for (const event of events) h.mode.programStatus.handleEvent(event);
  h.mode.programStatus.report();
  const underlying = h.status();
  const prompt = open(h); await tick(); prompt.done(); await prompt.promise;
  assert.deepEqual(h.status(), underlying);
  const plain = open(h, {overlay: true}); await tick();
  assert.deepEqual(h.status(), underlying, 'no metadata means non-blocking');
  plain.done(); await plain.promise;
}
for (const failure of ['sync factory', 'async factory', 'options', 'attachment', 'handle']) {
  const h = harness(), survivor = open(h);
  await tick();
  const expected = h.status();
  let lateDone;
  const factory = (_ui, _theme, _keys, done) => {
    lateDone = done;
    if (failure === 'sync factory') throw Error(failure);
    if (failure === 'async factory') return Promise.reject(Error(failure));
    return {render: () => [], invalidate() {}};
  };
  const options = {overlay: true, blocked: {kind: 'question', message: 'failed prompt'},
    overlayOptions: () => { if (failure === 'options') throw Error(failure); return {}; },
    onHandle: () => { if (failure === 'handle') throw Error(failure); },
  };
  if (failure === 'attachment') h.mode.ui.showOverlay = () => { throw Error(failure); };
  await assert.rejects(h.mode.showExtensionCustom(factory, options), new RegExp(failure));
  lateDone('too late');
  assert.deepEqual(h.status(), expected);
  assert.equal(h.mode.programStatus.blocked.size, 1, failure);
  assert.equal(h.overlays.size, 1, failure);
  survivor.done(); await survivor.promise;
}
for (const when of ['factory', 'late factory', 'handle', 'handle throws', 'options']) {
  const h = harness();
  let done, releaseFactory;
  const promise = h.mode.showExtensionCustom((_ui, _theme, _keys, close) => {
    done = close;
    if (when.includes('factory')) close('early');
    const component = {render: () => [], invalidate() {}};
    return when === 'late factory' ? new Promise(resolve => { releaseFactory = () => resolve(component); }) : component;
  }, {overlay: true, blocked,
    overlayOptions: () => { if (when === 'options') done('early'); return {}; },
    onHandle: () => { done('early'); if (when === 'handle throws') throw Error('after done'); },
  });
  assert.equal(await promise, 'early');
  releaseFactory?.(); await tick(); done('duplicate');
  assert.equal(h.overlays.size, 0, when);
  assert.equal(h.mode.programStatus.blocked.size, 0, when);
  if (when.includes('factory') || when === 'options') assert(!h.reports.some(r => r.state === 'blocked'), when);
  else assert.equal(h.status().state, 'idle');
}
console.log('PASS native independent overlay/inline/login sources, both closure orders, reporter restoration and failure/early-completion paths');

// The plugin is loaded as shipped and its registered tool drives the real lifecycle.
const {createRequire} = await import('node:module');
const {getEventListeners} = await import('node:events');
const require = createRequire(path.join(agent, 'package.json'));
const {createJiti} = require('jiti');
const jiti = createJiti(import.meta.url, {alias: {
  '@earendil-works/pi-coding-agent': path.join(agent, 'dist/index.js'),
  '@earendil-works/pi-tui': path.join(modules, '@earendil-works/pi-tui/dist/index.js'),
  '@sinclair/typebox': path.join(modules, 'typebox/build/index.mjs'),
}});
const {default: askExtension} = await jiti.import(path.join(modules, 'pi-ask-user/index.ts'));
const {KeybindingsManager} = await load('dist/core/keybindings.js');
const question = {question: 'PRIVATE_QUESTION', context: 'PRIVATE_CONTEXT', options: ['PRIVATE_ANSWER', 'Other'], allowFreeform: false};
const questions = [question, {...question, question: 'SECOND_PRIVATE_QUESTION'}];
function pluginHarness() {
  const h = harness(), listeners = new Set(), events = [], options = [];
  let tool, component;
  askExtension({registerTool: value => { tool = value; }, on() {}, events: {emit: (name, data) => events.push({name, data})}});
  assert.equal(tool.name, 'ask_user');
  assert.equal(tool.exposure, 'model-only');
  h.mode.keybindings = new KeybindingsManager();
  const ctx = {hasUI: true, ui: {
    custom: (factory, opts) => {
      options.push(opts);
      return h.mode.showExtensionCustom((...args) => { component = factory(...args); return component; }, opts);
    },
    onTerminalInput: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    notify() {},
  }};
  return {...h, listeners, events, options, ctx,
    execute: (params, signal) => tool.execute('test', params, signal, undefined, ctx),
    input: data => component.handleInput(data),
    toggle: () => { for (const listener of listeners) assert.deepEqual(listener('\x1bo'), {consume: true}); },
  };
}
function assertLegacyPair(h) {
  assert.deepEqual(h.events.filter(e => e.name === 'herdr:blocked').map(e => e.data), [
    {active: true, label: blocked.message}, {active: false},
  ]);
}
for (const displayMode of [undefined, 'inline']) {
  for (const kind of ['single', 'multi', 'batch']) {
    const h = pluginHarness();
    const params = kind === 'batch' ? {questions} : {...question, allowMultiple: kind === 'multi'};
    if (displayMode) params.displayMode = displayMode;
    const controller = new AbortController();
    const pending = h.execute(params, controller.signal);
    await tick();
    assert.deepEqual(h.options[0].blocked, blocked);
    assert.equal(Boolean(h.options[0].overlay), !displayMode);
    assert.equal(h.status().state, 'blocked');
    assert.equal(h.status().message, blocked.message);
    if (!displayMode) {
      assert.deepEqual(h.options[0].overlayOptions, {anchor: 'bottom-center', width: '100%', minWidth: 40, maxHeight: '95%', margin: 1});
      h.toggle(); assert([...h.overlays][0].isHidden());
      assert.equal(h.status().state, 'blocked');
      h.toggle(); assert(![...h.overlays][0].isHidden());
    }
    if (kind === 'multi') h.input(' ');
    h.input('\r');
    if (kind === 'batch') { h.input('\r'); h.input('\r'); }
    const result = await pending;
    assert.equal(result.details.cancelled, false);
    if (kind === 'batch') assert(result.details.answers.every(a => a.response.selections[0] === 'PRIVATE_ANSWER'));
    else assert.deepEqual(result.details.response.selections, ['PRIVATE_ANSWER']);
    assert.equal(h.status().state, 'idle');
    assert.equal(h.listeners.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assertLegacyPair(h);
    assert(!JSON.stringify(h.reports).includes('PRIVATE_'));
  }
}
for (const kind of ['single', 'batch']) {
  for (const ending of ['escape', 'timeout', 'aborted', 'hidden abort', 'custom error']) {
    const h = pluginHarness(), controller = new AbortController();
    const params = kind === 'batch' ? {questions} : {...question};
    // Track the real plugin's timer ownership without replacing timer semantics.
    const timers = new Set(), originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    globalThis.setTimeout = (...args) => { const timer = originalSet(...args); timers.add(timer); return timer; };
    globalThis.clearTimeout = timer => { timers.delete(timer); return originalClear(timer); };
    try {
      if (ending === 'aborted') controller.abort();
      if (ending === 'custom error') h.ctx.ui.custom = () => { throw Error('custom failure'); };
      params.timeout = ending === 'timeout' ? 20 : 10000;
      const pending = h.execute(params, controller.signal);
      if (ending === 'custom error') await assert.rejects(pending, /custom failure/);
      else {
        await tick();
        if (ending === 'escape') h.input('\x1b');
        if (ending === 'hidden abort') {
          h.toggle(); assert([...h.overlays][0].isHidden());
          assert.equal(h.status().state, 'blocked'); controller.abort();
        }
        const result = await pending;
        assert.equal(result.details.cancelled, true);
      }
      assert.equal(h.mode.programStatus.blocked.size, 0);
      assert.equal(h.overlays.size, 0);
      assert.equal(h.listeners.size, 0);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      assert.equal(timers.size, 0, `${kind} ${ending}: leaked timer`);
      if (ending === 'aborted') assert.equal(h.events.length, 0);
      else assertLegacyPair(h);
    } finally {
      for (const timer of timers) originalClear(timer);
      globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
    }
  }
}
{
  const h = pluginHarness();
  // Exercise the defensive switch branch, bypassing tool-schema validation deliberately.
  const pending = h.execute({...question, displayMode: 'unexpected'});
  await tick();
  assert.deepEqual(h.options[0].blocked, blocked);
  assert.equal(h.options[0].overlay, true);
  h.input('\x1b'); await pending;
  assert.equal(h.mode.programStatus.blocked.size, 0);
}
for (const params of [{}, {question: 'x', options: [{}]}, {questions: [question]}]) {
  const h = pluginHarness();
  await assert.rejects(h.execute(params));
  assert.equal(h.options.length, 0); assert.equal(h.events.length, 0);
}
{
  const h = pluginHarness(); h.ctx.hasUI = false;
  await assert.rejects(h.execute(question), /requires interactive mode/);
  assert.equal(h.options.length, 0); assert.equal(h.events.length, 0);
}
for (const batch of [false, true]) {
  const h = pluginHarness(); let selected = 0;
  h.ctx.ui.custom = async () => undefined; // RPC's documented custom() behavior
  h.ctx.ui.select = async (_title, choices) => { selected++; return choices[0]; };
  const result = await h.execute(batch ? {questions} : question);
  assert.equal(result.details.cancelled, false);
  assert.equal(selected, batch ? 2 : 1); assertLegacyPair(h);
}
{
  const h = pluginHarness(); let title;
  h.ctx.ui.input = async prompt => { title = prompt; return 'free text'; };
  const result = await h.execute({question: 'native title'});
  assert.equal(title, 'native title'); assert.equal(h.options.length, 0);
  assert.equal(result.details.response.kind, 'freeform'); assertLegacyPair(h);
}
console.log('PASS actual Ask registration: single/multi/batch overlay + inline metadata and answers, hide, escape, timeout, abort, errors, resource cleanup, RPC and native input compatibility');

// Native capability negotiation stays authoritative; no new OSC writer is introduced.
const {ProcessTerminal} = await import(pathToFileURL(path.join(modules, '@earendil-works/pi-tui/dist/terminal.js')));
{
  const terminal = new ProcessTerminal(), write = process.stdout.write, override = process.env.PI_PROGRAM_STATUS;
  let output = '';
  try {
    delete process.env.PI_PROGRAM_STATUS;
    process.stdout.write = data => { output += data; return true; };
    terminal.setProgramStatus({state: 'blocked', ...blocked});
    assert.equal(output, '');
    terminal.queryAndEnableKittyProtocol();
    assert(output.includes('\x1b]7501;?\x1b\\'));
    assert(!output.includes('state=blocked'));
    terminal.stdinDataHandler('\x1b]7501;?\x1b\\');
    assert(output.includes('state=blocked'));
  } finally {
    terminal.stop(); process.stdout.write = write;
    if (override === undefined) delete process.env.PI_PROGRAM_STATUS;
    else process.env.PI_PROGRAM_STATUS = override;
  }
}
console.log('PASS native default capability gate waits for terminal support reply');
{
  const {TuiBase} = await import(pathToFileURL(path.join(modules, '@earendil-works/pi-tui/dist/tui.js')));
  const h = harness();
  const tui = new TuiBase({columns: 100, rows: 40, hideCursor() {}});
  tui.requestRender = () => {};
  h.mode.ui = tui;
  await assert.rejects(h.mode.showExtensionCustom(() => ({render: () => [], invalidate() {}}), {
    overlay: true, blocked, overlayOptions: {visible() { throw Error('internal visibility failure'); }},
  }), /internal visibility failure/);
  assert.equal(h.mode.programStatus.blocked.size, 0);
  assert(!h.reports.some(r => r.state === 'blocked'));
  // Characterize a pre-existing upstream limitation, not desired behavior: TUI attaches
  // before invoking visible(), so no removal handle reaches the caller on this path.
  assert.equal(tui.overlayStack.length, 1);
  tui.hideOverlay();
  assert.equal(tui.overlayStack.length, 0);
}
console.log('CHARACTERIZED upstream partial attachment failure: no new blocked source; internal orphan rollback is outside this fix');

const os = await import('node:os');
const {spawnSync} = await import('node:child_process');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ask-proof-'));
try {
  // Mutate disposable copies of each installed execution surface, never the supplied release.
  const sdkFile = path.join(agent, 'dist/modes/interactive/interactive-mode.js');
  const chunks = path.join(agent, 'dist/bundle/chunks');
  const bundleFile = fs.readdirSync(chunks).map(n => path.join(chunks, n))
    .find(f => fs.readFileSync(f, 'utf8').includes('async showExtensionCustom('));
  assert(bundleFile);
  for (const [build, original] of [['sdk', sdkFile], ['bundle', bundleFile]]) {
    for (const mutation of ['absent', 'duplicate']) {
      const deps = path.join(scratch, `${build}-${mutation}`), dist = path.join(deps, '@earendil-works/pi-coding-agent/dist');
      fs.mkdirSync(path.join(dist, 'bundle/chunks'), {recursive: true});
      fs.mkdirSync(path.join(dist, 'modes/interactive'), {recursive: true});
      const anchor = 'async showExtensionCustom(';
      const text = fs.readFileSync(original, 'utf8');
      const mutated = mutation === 'absent' ? text.replace(anchor, 'async renamedCustom(') : text + '\n// ' + anchor;
      fs.writeFileSync(path.join(dist, 'modes/interactive/interactive-mode.js'), build === 'sdk' ? mutated : '');
      fs.writeFileSync(path.join(dist, 'bundle/chunks/fixture.js'), build === 'bundle' ? mutated : '');
      const result = spawnSync(process.execPath, [new URL('./patch.mjs', import.meta.url).pathname, deps], {encoding: 'utf8'});
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mutation === 'absent' ? /Expected two overlay lifecycles, got 0/ : /Overlay patch compatibility failure/);
    }
    assert.equal(spawnSync(process.execPath, ['--check', original]).status, 0);
  }
  console.log('PASS SDK/bundle missing and duplicate owning anchors fail closed; patched builds parse');

  const {spawn} = await import(pathToFileURL(path.join(modules, 'zigpty/dist/index.mjs')));
  const fixture = path.join(scratch, 'ask-fixture.ts');
  fs.writeFileSync(fixture, `
import ask from ${JSON.stringify(path.join(modules, 'pi-ask-user/index.ts'))};
import fs from 'node:fs';
const record = value => fs.appendFileSync(process.env.ASK_PROOF_EVENTS, JSON.stringify(value) + '\\n');
export default function(pi) {
  let tool;
  ask({...pi, registerTool: value => { tool = value; }});
  pi.on('session_start', () => record({ready: true, tty: process.stdin.isTTY && process.stdout.isTTY}));
  pi.registerCommand('ask-proof', {handler: async (args, ctx) => {
    let handle;
    const ui = {...ctx.ui,
      custom: (factory, options) => ctx.ui.custom(factory, {...options, onHandle: value => {
        handle = value; options.onHandle?.(value);
      }}),
      onTerminalInput: listener => ctx.ui.onTerminalInput(data => {
        const result = listener(data);
        if (result?.consume && handle) record({hidden: handle.isHidden()});
        return result;
      }),
    };
    const params = {...${JSON.stringify(question)}, ...(args === 'inline' ? {displayMode: 'inline'} : {})};
    record({started: args});
    const result = await tool.execute('pty-proof', params, undefined, undefined, {...ctx, ui});
    record({result});
  }});
  pi.registerCommand('ask-proof-stop', {handler: async (_args, ctx) => ctx.shutdown()});
}
`);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const enabled of [true, false]) {
    const home = path.join(scratch, enabled ? 'enabled' : 'disabled'); fs.mkdirSync(home);
    const eventFile = path.join(home, 'events.jsonl');
    const records = () => fs.existsSync(eventFile) ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const reports = []; let buffer = '', output = '';
    const pty = spawn(process.execPath, [path.join(agent, 'dist/bundle/cli.js'), '--no-session', '--no-context-files', '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '-e', fixture], {
      cwd: home, cols: 100, rows: 40,
      env: {HOME: home, PATH: process.env.PATH, TERM: 'xterm-256color', PI_OFFLINE: '1', PI_PROGRAM_STATUS: enabled ? '1' : '0', ASK_PROOF_EVENTS: eventFile,
        ...(process.env.NODE_OPTIONS ? {NODE_OPTIONS: process.env.NODE_OPTIONS} : {})},
      terminal: {data(_term, data) {
        const text = Buffer.from(data).toString(); output += text; buffer += text;
        const frames = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
        let match, consumed = 0;
        while ((match = frames.exec(buffer))) {
          consumed = frames.lastIndex;
          if (match[1] === '?') continue;
          const report = Object.fromEntries(match[1].split(':').map(pair => { const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; }));
          if (report.msg) report.msg = Buffer.from(report.msg, 'base64').toString('utf8');
          reports.push(report);
        }
        if (consumed) buffer = buffer.slice(consumed);
      }},
    });
    let exited = false;
    pty.exited.then(() => { exited = true; });
    const wait = async (predicate, label) => {
      const deadline = Date.now() + 20000;
      while (!predicate()) {
        assert(!exited, `CLI exited while waiting for ${label}: ${output.slice(-3000)}`);
        assert(Date.now() < deadline, `PTY timeout: ${label}: ${output.slice(-3000)}`);
        assert(output.length < 2_000_000, 'unexpected unbounded terminal output');
        await sleep(20);
      }
    };
    try {
      await wait(() => records().some(r => r.ready), 'session startup');
      assert.equal(records()[0].tty, true, 'must be native PTY, not zigpty pipe fallback');
      // Startup completion precedes editor input activation by a microtask/render.
      await sleep(150);
      for (const scenario of enabled ? ['overlay', 'inline', 'cancel'] : ['overlay']) {
        const beforeReports = reports.length, beforeResults = records().filter(r => r.result).length;
        pty.write(`/ask-proof ${scenario}\r`);
        await wait(() => output.includes('PRIVATE_QUESTION') && records().some(r => r.started === scenario), 'Ask prompt');
        if (enabled) await wait(() => reports.slice(beforeReports).some(r => r.state === 'blocked'), 'blocked report');
        else await sleep(150);
        if (scenario === 'overlay') {
          pty.write('\x1bo');
          await wait(() => records().some(r => r.hidden === true), 'plugin hide');
          await sleep(100);
          if (enabled) assert.equal(reports.at(-1).state, 'blocked', 'hidden unanswered overlay remains blocked');
          assert.equal(records().filter(r => r.result).length, beforeResults);
          pty.write('\x1bo');
          await wait(() => records().some(r => r.hidden === false), 'plugin reopen');
        }
        pty.write(scenario === 'cancel' ? '\x1b' : '\r');
        await wait(() => records().filter(r => r.result).length > beforeResults, 'Ask resolution');
        const result = records().filter(r => r.result).at(-1).result;
        assert.equal(result.details.cancelled, scenario === 'cancel');
        if (scenario !== 'cancel') assert.deepEqual(result.details.response.selections, ['PRIVATE_ANSWER']);
        if (enabled) {
          await wait(() => reports.at(-1)?.state === 'idle', 'native restoration');
          const span = reports.slice(beforeReports);
          assert.deepEqual(span.filter(r => r.state === 'blocked'), [{state: 'blocked', app: 'pi', kind: 'question', msg: blocked.message}]);
          assert(!JSON.stringify(span).includes('PRIVATE_'), 'private question/context/answer leaked into OSC');
          console.log(`PASS bundled CLI PTY ${scenario}: ${JSON.stringify(span)}`);
        }
        await sleep(100);
      }
      if (!enabled) { assert.deepEqual(reports, []); assert(!output.includes('\x1b]7501;')); console.log('PASS bundled CLI PTY PI_PROGRAM_STATUS=0: no OSC 7501 frames'); }
      pty.write('/ask-proof-stop\r');
      await wait(() => exited, 'CLI shutdown');
    } finally {
      try {
        if (!exited) {
          pty.kill('SIGKILL');
          await wait(() => exited, 'forced CLI cleanup');
        }
      } finally { pty.close(); }
    }
  }
} finally { fs.rmSync(scratch, {recursive: true, force: true}); }
