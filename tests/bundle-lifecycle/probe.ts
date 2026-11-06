import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import fs from "node:fs";
async function stdin_default(pi) {
  const variant = process.env.VARIANT;
  const tools = /* @__PURE__ */ new Map();
  const notifications = [];
  const observedToolResults = [];
  let backgroundStarted;
  const backgroundReady = new Promise((resolve) => {
    backgroundStarted = resolve;
  });
  const factory = (await import(process.env.LIFECYCLE_ENTRY)).default;
  await factory(new Proxy(pi, { get(t, k) {
    if (k === "sendMessage") return (...args) => {
      notifications.push(args);
      return t.sendMessage(...args);
    };
    if (k === "registerTool") return (tool) => {
      tools.set(tool.name, tool);
      return t.registerTool(tool);
    };
    return Reflect.get(t, k);
  } }));
  pi.registerProvider("fixture", { apiKey: "fixture", api: "fixture", baseUrl: "http://invalid.local", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32e3, maxTokens: 1e3 }], streamSimple(model, context, options) {
    if (JSON.stringify(context.messages).includes("BACKGROUND-CONTEXT")) backgroundStarted();
    for (const message of context.messages) {
      if (message.role === "toolResult") {
        observedToolResults.push(JSON.parse(JSON.stringify(message)));
      }
    }
    const s = createAssistantMessageEventStream();
    setTimeout(() => {
      const fixtureText = JSON.stringify(context.messages);
      const invoke = fixtureText.includes("REQUEST_TOOL") && context.messages.at(-1)?.role === "user";
      const fail = fixtureText.includes("REQUEST_TOOL_FAIL");
      const m = { role: "assistant", content: [{ type: "text", text: "fixture-complete " + JSON.stringify(context.messages.filter((x) => x.role === "user" || x.role === "toolResult")) }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: options?.signal?.aborted ? "aborted" : "stop", errorMessage: options?.signal?.aborted ? "fixture aborted" : void 0, timestamp: Date.now() };
      if (invoke) {
        m.content = [{ type: "toolCall", id: "lane-call", name: "lane_fixture", arguments: { fail } }];
        m.stopReason = "toolUse";
      }
      s.push({ type: "start", partial: m });
      if (invoke) {
        s.push({ type: "toolcall_start", contentIndex: 0, partial: m });
        s.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify({ fail }), partial: m });
        s.push({ type: "toolcall_end", contentIndex: 0, toolCall: m.content[0], partial: m });
      }
      s.push(m.stopReason === "aborted" ? { type: "error", reason: "aborted", error: m } : { type: "done", reason: m.stopReason, message: m });
      s.end();
    }, 150);
    return s;
  } });
  pi.on("session_start", async (_, ctx) => {
    const rows = [];
    if (process.env.LIFECYCLE_RESUME) {
      const id2 = JSON.parse(fs.readFileSync(process.env.LIFECYCLE_RESUME, "utf8")).find((x) => x.label === "background").result.details.agentId;
      const result = await tools.get("Agent").execute("restart", { description: "restart", subagent_type: "lane-fixture", prompt: "RESTART-CONTEXT", resume: id2, run_in_background: false }, void 0, void 0, ctx);
      fs.writeFileSync(process.env.LIFECYCLE_RESULT, JSON.stringify([{ label: "restart", result }], null, 2));
      return;
    }
    for (const [label, args] of [["foreground", { description: "fixture", subagent_type: "lane-fixture", prompt: "REQUEST_TOOL", run_in_background: false }], ["tool-failure", { description: "bad", subagent_type: "lane-fixture", prompt: "REQUEST_TOOL_FAIL", run_in_background: false }]]) {
      try {
        rows.push({ label, result: await tools.get("Agent").execute("test-" + label, args, void 0, void 0, ctx) });
      } catch (e) {
        rows.push({ label, error: String(e), stack: e.stack });
      }
    }
    const call = async (n, a) => tools.get(n).execute("test", a, void 0, void 0, ctx);
    const bg = await call("Agent", { description: "background", subagent_type: "lane-fixture", prompt: "BACKGROUND-CONTEXT", run_in_background: true });
    rows.push({ label: "background", result: bg });
    const id = bg.details?.agentId;
    await backgroundReady;
    rows.push({ label: "steer", result: await call("steer_subagent", { agent_id: id, message: "STEER-CONTEXT" }) });
    rows.push({ label: "get", result: await call("get_subagent_result", { agent_id: id, wait: true, verbose: true }) });
    rows.push({ label: "resume", result: await call("Agent", { description: "resume", subagent_type: "lane-fixture", prompt: "RESUME-CONTEXT", resume: id, run_in_background: false }) });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 70);
    rows.push({ label: "cancel", result: await tools.get("Agent").execute("cancel", { description: "cancel", subagent_type: "lane-fixture", prompt: "CANCEL", run_in_background: false }, controller.signal, void 0, ctx) });
    rows.push({ label: "missing-result", result: await call("get_subagent_result", { agent_id: "missing" }) });
    const notifyBg = await call("Agent", { description: "notification", subagent_type: "lane-fixture", prompt: "NOTIFY-FIXTURE", run_in_background: true });
    const notificationId = notifyBg.details.agentId;
    const deadline = Date.now() + 8000;
    const hasNotification = () => ctx.sessionManager.getEntries().some((entry) =>
      entry.type === "custom_message" && entry.customType === "subagent-notification" &&
      entry.details?.id === notificationId && entry.details?.status === "completed");
    while (!hasNotification() || !ctx.isIdle()) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for completed parent notification: " + notificationId);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    rows.push({ label: "observed-tool-results", result: observedToolResults });
    rows.push({ label: "notifications", result: notifications });
    rows.push({ label: "parent-entries", result: ctx.sessionManager.getEntries() });
    fs.writeFileSync(process.env.LIFECYCLE_RESULT, JSON.stringify(rows, null, 2));
  });
}
export {
  stdin_default as default
};
