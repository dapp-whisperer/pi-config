import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.', 'source/node_modules') + '/';
assert.equal(JSON.parse(readFileSync(`${root}@earendil-works/pi-coding-agent/package.json`, 'utf8')).version, '1.5.0');
const require = createRequire(`${root}@earendil-works/pi-coding-agent/package.json`);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: {
  '@earendil-works/pi-coding-agent': `${root}@earendil-works/pi-coding-agent/dist/index.js`,
  '@earendil-works/pi-tui': `${root}@earendil-works/pi-tui/dist/index.js`,
}});
const { initTheme } = await import(`${root}@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js`);
initTheme('dark');
const { FooterComponent } = await jiti.import('@earendil-works/pi-coding-agent');
const { visibleWidth } = await jiti.import('@earendil-works/pi-tui');
const { default: extension } = await jiti.import('./resources/model-first-footer.ts');
const hooks = {};
extension({ on: (name, fn) => hooks[name] = fn });
const model = { id: 'gpt-6-astra', provider: 'openai', reasoning: true, contextWindow: 200000 };
const usage = { input: 1200, output: 40, cacheRead: 800, cacheWrite: 50, cost: { total: .125 } };
const session = {
 state: { model, thinkingLevel: 'low' }, model,
 modelRuntime: { isUsingSubscription: () => false },
 getContextUsage: () => ({ percent: 20, contextWindow: 200000 }),
 sessionManager: { getEntryCount: () => 1, getSessionId: () => 'test', getLeafId: () => 'leaf',
 getEntries: () => [{ type: 'message', message: { role: 'assistant', usage } }],
 getCwd: () => `${homedir()}/dotfiles`, getSessionName: () => undefined },
};
const footer = new FooterComponent(session, { getGitBranch: () => 'remove-cmux', getAvailableProviderCount: () => 1,
 getExtensionStatuses: () => new Map([['agent', 'agent running']]) });
const original = FooterComponent.prototype.render;
const stockPrefix = original.call(footer, 200)[0].match(/^(?:\x1b\[[0-9;]*m)+/)?.[0];
assert(stockPrefix, 'stock footer must provide ANSI color prefix');
hooks.session_start({}, { mode: 'tui' });
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
for (const width of [10, 20, 40, 80, 120, 200]) {
 const lines = footer.render(width);
 assert(lines[0].startsWith(stockPrefix), 'model/provider must inherit stock dim color');
 assert(lines.every(line => visibleWidth(line) <= width));
 const stats = strip(lines.slice(1, -1).join('')).replaceAll(' ', '');
 for (const token of ['↑1.2k', '↓40', 'R800', 'W50', 'CH39.0%', '$0.125', '20.0%/200k', '(auto)']) assert(stats.includes(token), `${width}: missing ${token}`);
 if (width >= 80) assert(strip(lines[0]).includes('(openai) gpt-6-astra · low    ~/dotfiles (remove-cmux)'));
 assert.equal(lines.at(-1), original.call(footer, width).at(-1));
}
hooks.session_shutdown();
assert.equal(FooterComponent.prototype.render, original);
hooks.session_start({}, { mode: 'json' });
assert.equal(FooterComponent.prototype.render, original);
console.log('PASS: extension import/startup, widths 10–200, all usage fields, status preservation, shutdown, non-TUI guard');
