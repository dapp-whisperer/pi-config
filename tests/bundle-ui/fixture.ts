import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import fs from 'node:fs';

export default async function(pi) {
  const tools = new Map();
  const factory = (await import(process.env.UI_ENTRY!)).default;
  await factory(new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return tool => { tools.set(tool.name, tool); return target.registerTool(tool); };
    return Reflect.get(target, key);
  }}));
  pi.registerProvider('fixture', {
    apiKey: 'fixture', api: 'fixture', baseUrl: 'http://invalid.local',
    models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 32000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const finish = () => {
        const aborted = options?.signal?.aborted;
        const tool = !aborted && !context.messages.some(m => m.role === 'toolResult');
        const message = { role: 'assistant',
          content: tool ? [{ type: 'toolCall', id: 'ui-tool', name: 'bash', arguments: {command: 'printf UI_CHILD_TOOL_MARKER'} }]
            : [{type: 'text', text: 'UI_FIXTURE_COMPLETE'}],
          api: model.api, provider: model.provider, model: model.id,
          usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
          stopReason: aborted ? 'aborted' : tool ? 'toolUse' : 'stop', timestamp: Date.now() };
        stream.push({type: 'start', partial: message});
        stream.push(aborted ? {type: 'error', reason: 'aborted', error: message}
          : {type: 'done', reason: message.stopReason, message});
        stream.end();
      };
      const timer = setTimeout(finish, 8000);
      options?.signal?.addEventListener('abort', () => { clearTimeout(timer); finish(); }, {once: true});
      return stream;
    },
  });
  pi.registerCommand('fixture-run', { handler: async (args, ctx) => {
    const result = await tools.get('Agent').execute('fixture-ui', {
      description: args.trim() === 'stop' ? 'UI-STOP' : 'UI-COMPLETE',
      subagent_type: 'ui-fixture', prompt: 'UI_CONVERSATION_MARKER', run_in_background: true,
    }, undefined, undefined, ctx);
    fs.appendFileSync(process.env.UI_RESULT!, JSON.stringify(result) + '\n');
  }});
}
