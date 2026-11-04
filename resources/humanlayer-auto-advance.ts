// humanlayer-auto-advance: run the next HumanLayer RPI phase in pi without a click.
//
// The cloud's auto-advance (riptide-api check-auto-advance.ts) cannot launch pi sessions, so this
// does the same job locally. Every rpi skill ends its final answer with a fenced block naming the
// next skill, for example:
//
//     ```text
//     /rpi:create-research
//     ```
//
// When a run settles, this reads that block from the last assistant message and, if the target
// skill is allowed, sends `/skill:<name>` after a short delay. Like the web app, each phase runs in
// its own pi session by default: the new session joins the same HumanLayer task (through
// HUMANLAYER_TASK, which the extension reads when it binds) and is named after the phase.
//
// Defaults mirror the web app: research and design chain on their own; implementation and the PR
// step are gated. `/hl-auto` shows and changes the gates; they persist in
// <agent dir>/humanlayer-auto-advance.json.
//
// It also keeps HumanLayer mirroring out of pi-subagents children: the extension would otherwise
// bind every child to a brand-new cloud task and point the child's system prompt at that empty
// folder. Headless runs (`pi -p`, `pi --mode json`) do not mirror either unless HUMANLAYER_TASK
// names a task or HUMANLAYER_PI_HEADLESS=1: every ad-hoc print run would otherwise make a task.
//
// While a session works on a HumanLayer task, a system prompt section tells the model how the rpi
// skills' agents map onto pi's `subagent` tool and which phases may touch code, since the skill
// text is written for Claude Code and models otherwise drift (research by hand, edits during the
// outline phase).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Skills this extension may start, and the suffix the cloud appends when it starts them. */
const CHAINABLE: Record<string, string | undefined> = {
	"create-research": undefined,
	"create-design-discussion": undefined,
	"create-prd": undefined,
	"create-tech-design": undefined,
	"create-structure-outline": undefined,
	"implement-outline": "- implement all phases consecutively without pausing between phases, commit after each phase",
	"implement-plan": "- implement all phases consecutively without pausing between phases, commit after each phase",
	"describe-pr": undefined,
};

/** Names the Claude plugin uses that differ from pi's skill copy. */
const ALIASES: Record<string, string> = {
	"create-tdd": "create-tech-design",
};

/** Gated by default: implementation like the web app's plan-to-implementation flags, and
 * describe-pr because it pushes the branch and opens a pull request. */
const GATED_BY_DEFAULT = new Set(["implement-outline", "implement-plan", "describe-pr"]);

const DEFAULT_DELAY_MS = 5000;
const MAX_ADVANCES_PER_PROCESS = 10;

const RPI_AGENTS = [
	"codebase-locator",
	"codebase-analyzer",
	"codebase-pattern-finder",
	"web-search-researcher",
	"implementer-agent",
	"outline-implementer-agent",
	"implementation-reviewer",
];

const DOCUMENT_PHASES = [
	"create-research-questions",
	"create-research",
	"create-design-discussion",
	"create-prd",
	"create-tech-design",
	"create-structure-outline",
	"iterate-*",
];

/** System prompt section for sessions on a HumanLayer task. Written once; stable text keeps the cache. */
const RPI_RUNTIME_SECTION = [
	"This is pi, not Claude Code. The HumanLayer rpi skills in this session were written for Claude Code; apply them here as follows.",
	"",
	`- This public-only installation does not supply the private-derived agents ${RPI_AGENTS.join(", ")}. If a skill requires one, stop and report the unavailable public workflow dependency; do not invent an agent or silently perform its role.`,
	"- When a skill says to spawn, launch or use one of these agents, do it. Do not do that agent's work yourself with bash, grep or read instead; read directly only the files the skill tells you to read directly.",
	"- Every launch needs a complete brief: subagent({ agent, task, cwd }). `task` is required and must hold everything the agent needs (question, paths, what to return); a call without `task` is rejected. Launch independent research agents together with subagent({ workflow: \"parallel\", args: { tasks: [{ agent, task }, ...] } }) and wait for their completion notices before synthesizing.",
	`- Phase boundaries: ${DOCUMENT_PHASES.join(", ")} write documents into the task folder only. During them do not edit repository code, create files outside the task folder, run git commit, or push. Code changes happen only while implement-outline, implement-plan or iterate-implementation runs, and there through the implementer agents the skill names. Only describe-pr may push or open a pull request.`,
	"- End each skill with its final-answer template verbatim, fenced next-step block included: an extension reads that block to start the next phase.",
].join("\n");

// Process-wide handoff between the old and the new extension runtime around a session switch.
const ENV_PENDING = "HL_AUTO_ADVANCE_PENDING"; // JSON { skill, command }
const ENV_TASK_SET = "HL_AUTO_ADVANCE_TASK_SET"; // "1" while HUMANLAYER_TASK is ours to clear
const ENV_COUNT = "HL_AUTO_ADVANCE_COUNT";

interface Config {
	enabled: boolean;
	/** Skills allowed to start on their own. */
	allow: string[];
	delayMs: number;
	/** Start each phase in a new pi session bound to the same HumanLayer task. */
	newSession: boolean;
}

function defaultConfig(): Config {
	return {
		enabled: process.env.HL_AUTO_ADVANCE !== "0",
		allow: Object.keys(CHAINABLE).filter((s) => !GATED_BY_DEFAULT.has(s)),
		delayMs: DEFAULT_DELAY_MS,
		newSession: true,
	};
}

function configPath(): string {
	return join(getAgentDir(), "humanlayer-auto-advance.json");
}

function loadConfig(): Config {
	const base = defaultConfig();
	try {
		if (!existsSync(configPath())) return base;
		const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>;
		return {
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
			allow: Array.isArray(raw.allow) ? raw.allow.filter((s) => s in CHAINABLE) : base.allow,
			delayMs: typeof raw.delayMs === "number" && raw.delayMs >= 0 ? raw.delayMs : base.delayMs,
			newSession: typeof raw.newSession === "boolean" ? raw.newSession : base.newSession,
		};
	} catch {
		return base;
	}
}

function saveConfig(config: Config): void {
	mkdirSync(getAgentDir(), { recursive: true });
	writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/** The last fenced block whose first non-empty line is a `/rpi:x`, `/skill:x` or `/x` command. */
export function parseNextSkill(text: string): { skill: string; args: string } | null {
	const fence = /```[^\n]*\n([\s\S]*?)```/g;
	let found: { skill: string; args: string } | null = null;
	for (const match of text.matchAll(fence)) {
		const line = match[1]
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0);
		if (!line) continue;
		const cmd = /^\/(?:rpi:|skill:)?([a-z][a-z0-9-]*)(?:\s+(.*))?$/.exec(line);
		if (!cmd) continue;
		const skill = ALIASES[cmd[1]] ?? cmd[1];
		found = { skill, args: (cmd[2] ?? "").trim() };
	}
	return found;
}

function lastAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const content = Array.isArray(m.content) ? m.content : [];
		return content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	return "";
}

/** The HumanLayer task slug this pi session is bound to, from the extension's binding file. */
function boundTaskSlug(piSessionId: string | undefined): string | undefined {
	if (!piSessionId) return undefined;
	const home = process.env.HUMANLAYER_RIPTIDE_HOME || join(homedir(), ".humanlayer", "riptide");
	const bindings = join(home, "pi", "bindings");
	try {
		for (const channel of readdirSync(bindings)) {
			const file = join(bindings, channel, `${piSessionId}.json`);
			if (!existsSync(file)) continue;
			const b = JSON.parse(readFileSync(file, "utf8")) as { taskSlug?: string; taskId?: string };
			return b.taskSlug || b.taskId || undefined;
		}
	} catch {
		// no bindings dir: not signed in, or mirroring off
	}
	return undefined;
}

function advanceCount(): number {
	return Number(process.env[ENV_COUNT] ?? "0") || 0;
}

/** `/skill:<name> args` typed or sent by a client, for a chainable skill. */
function parseSkillInput(text: string): { skill: string; args: string } | null {
	const m = /^\/skill:([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!m) return null;
	const skill = ALIASES[m[1]] ?? m[1];
	return skill in CHAINABLE ? { skill, args: (m[2] ?? "").trim() } : null;
}

export default function humanlayerAutoAdvance(pi: ExtensionAPI) {
	// A pi-subagents child: keep HumanLayer mirroring off (the extension reads this at session_start)
	// and do nothing else. Children run in print mode and never auto-advance.
	if (process.env.PI_SUBAGENT_CHILD === "1") {
		if (process.env.HUMANLAYER_PI_DISABLE === undefined) process.env.HUMANLAYER_PI_DISABLE = "1";
		return;
	}

	let config = loadConfig();
	let lastText = "";
	let lastLaunched: string | null = null;
	let pending: { skill: string; timer: ReturnType<typeof setTimeout> } | null = null;
	/** Set once a run in this session is bound to a task or invokes an rpi skill. */
	let rpiContext = false;
	/** True after the first run of this session. */
	let hasRun = false;

	const cancelPending = (ctx: ExtensionContext, reason?: string) => {
		if (!pending) return;
		clearTimeout(pending.timer);
		const skill = pending.skill;
		pending = null;
		ctx.ui.setStatus("hl-auto", undefined);
		if (reason) ctx.ui.notify(`Auto-advance: skipped /skill:${skill} (${reason})`, "info");
	};

	const refreshStatus = (ctx: ExtensionContext) => {
		if (pending) return;
		ctx.ui.setStatus("hl-auto", config.enabled ? "hl-auto" : "hl-auto off");
	};

	const commandFor = (skill: string, args: string) =>
		["/skill:" + skill, args, CHAINABLE[skill]].filter((s) => s && s.length > 0).join(" ");

	/** Start the skill in this session. */
	const launchHere = (ctx: ExtensionContext, skill: string, args: string) => {
		const command = commandFor(skill, args);
		lastLaunched = skill;
		process.env[ENV_COUNT] = String(advanceCount() + 1);
		ctx.ui.notify(`Auto-advance: ${command}`, "info");
		pi.sendUserMessage(command, { expandPromptTemplates: true });
	};

	/** Hand `command` to a new session on task `slug`. `/hl-auto next` does the switch, since only
	 * a command context may replace the session. */
	const hop = (ctx: ExtensionContext, skill: string, command: string, slug: string, why: string) => {
		lastLaunched = skill;
		process.env.HUMANLAYER_TASK = slug;
		process.env[ENV_TASK_SET] = "1";
		process.env[ENV_PENDING] = JSON.stringify({ skill, command });
		ctx.ui.notify(`${why}: new session for /skill:${skill} on task ${slug}`, "info");
		pi.sendUserMessage("/hl-auto next", { expandPromptTemplates: true });
	};

	/** Start the skill: in a new session on the same task when bound, else here. */
	const launch = (ctx: ExtensionContext, skill: string, args: string) => {
		const slug = config.newSession ? boundTaskSlug(ctx.sessionManager.getSessionId()) : undefined;
		if (!slug) {
			if (config.newSession) ctx.ui.notify("Auto-advance: no HumanLayer task bound; continuing in this session", "info");
			launchHere(ctx, skill, args);
			return;
		}
		process.env[ENV_COUNT] = String(advanceCount() + 1);
		hop(ctx, skill, commandFor(skill, args), slug, "Auto-advance");
	};

	pi.on("session_start", (_event, ctx) => {
		config = loadConfig();
		lastLaunched = null;
		rpiContext = false;
		hasRun = false;
		// Headless runs make a task each unless they name one. The HumanLayer extension reads this
		// in its own session_start, which runs after ours while this file loads first.
		if (
			(ctx.mode === "print" || ctx.mode === "json") &&
			!process.env.HUMANLAYER_TASK &&
			process.env.HUMANLAYER_PI_HEADLESS !== "1" &&
			process.env.HUMANLAYER_PI_DISABLE === undefined
		) {
			process.env.HUMANLAYER_PI_DISABLE = "1";
		}
		// The new runtime after a phase switch: name the session after its phase.
		const raw = process.env[ENV_PENDING];
		if (raw) {
			try {
				const { skill } = JSON.parse(raw) as { skill: string };
				pi.setSessionName(skill);
				lastLaunched = skill;
			} catch {
				// ignore a malformed handoff
			}
		}
		refreshStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		cancelPending(ctx);
	});

	// A chainable skill typed into a bound session that already ran gets its own session, as a
	// click in the web app would. The first prompt of a session, and `/hl-auto next` itself, pass.
	pi.on("input", (event, ctx) => {
		if (!config.newSession || !hasRun || !ctx.hasUI) return { action: "continue" };
		const typed = parseSkillInput(event.text);
		if (!typed) return { action: "continue" };
		const slug = boundTaskSlug(ctx.sessionManager.getSessionId());
		if (!slug) return { action: "continue" };
		cancelPending(ctx);
		hop(ctx, typed.skill, event.text.trim(), slug, "Phase");
		return { action: "handled" };
	});

	// Runs started by custom messages count too: pi-subagents wakes the session with one when a
	// background child finishes, and that run is the one that writes the skill's final answer.
	pi.on("before_agent_start", (event, ctx) => {
		lastText = "";
		hasRun = true;
		if (!rpiContext) {
			const invokesSkill = event.messageType === "user" && /<skill name="(create|iterate|implement|describe)-[a-z-]+"/.test(event.prompt);
			rpiContext = invokesSkill || boundTaskSlug(ctx.sessionManager.getSessionId()) !== undefined;
		}
		if (rpiContext) event.systemPromptOptions.sections.humanlayer_rpi_runtime = RPI_RUNTIME_SECTION;
	});

	pi.on("agent_end", (event) => {
		lastText = lastAssistantText(event.messages);
		// The HumanLayer extension binds at the first prompt, which has happened by now.
		if (process.env[ENV_TASK_SET] === "1") {
			delete process.env.HUMANLAYER_TASK;
			delete process.env[ENV_TASK_SET];
		}
		delete process.env[ENV_PENDING];
	});

	pi.on("agent_settled", (event, ctx) => {
		if (!config.enabled || !ctx.hasUI || event.aborted) return;
		const next = parseNextSkill(lastText);
		if (!next) return;
		const { skill, args } = next;

		if (!(skill in CHAINABLE)) return;
		if (!config.allow.includes(skill)) {
			ctx.ui.notify(`Auto-advance: /skill:${skill} is gated. Run it yourself, or /hl-auto allow ${skill}`, "info");
			return;
		}
		if (!pi.getCommands().some((c) => c.source === "skill" && c.name === `skill:${skill}`)) {
			ctx.ui.notify(`Auto-advance: no skill named ${skill} is loaded`, "warning");
			return;
		}
		if (skill === lastLaunched) {
			ctx.ui.notify(`Auto-advance: /skill:${skill} already ran last; stopping to avoid a loop`, "warning");
			return;
		}
		if (advanceCount() >= MAX_ADVANCES_PER_PROCESS) {
			ctx.ui.notify(`Auto-advance: ${MAX_ADVANCES_PER_PROCESS} advances in this pi; stopping`, "warning");
			return;
		}

		cancelPending(ctx);
		if (config.delayMs === 0) {
			launch(ctx, skill, args);
			return;
		}
		const seconds = Math.round(config.delayMs / 1000);
		ctx.ui.setStatus("hl-auto", `→ /skill:${skill} in ${seconds}s · /hl-auto skip`);
		ctx.ui.notify(`Auto-advance: /skill:${skill} in ${seconds}s. /hl-auto skip to stop.`, "info");
		pending = {
			skill,
			timer: setTimeout(() => {
				pending = null;
				refreshStatus(ctx);
				launch(ctx, skill, args);
			}, config.delayMs),
		};
	});

	pi.registerCommand("hl-auto", {
		description:
			"HumanLayer auto-advance: status | on | off | allow <skill|all> | deny <skill> | delay <s> | sessions on|off | skip | reset",
		handler: async (raw, ctx) => {
			const [verb = "status", arg] = raw.trim().split(/\s+/).filter(Boolean);
			switch (verb) {
				case "next": {
					// Internal: the session switch for a pending phase.
					const handoff = process.env[ENV_PENDING];
					if (!handoff) return;
					const { command } = JSON.parse(handoff) as { skill: string; command: string };
					const result = await ctx.newSession({
						withSession: async (c) => {
							c.sendUserMessage(command, { expandPromptTemplates: true });
						},
					});
					if (result.cancelled) {
						delete process.env[ENV_PENDING];
						delete process.env.HUMANLAYER_TASK;
						delete process.env[ENV_TASK_SET];
						ctx.ui.notify("Auto-advance: session switch cancelled; run the skill yourself", "warning");
					}
					return;
				}
				case "on":
				case "off":
					config.enabled = verb === "on";
					saveConfig(config);
					if (!config.enabled) cancelPending(ctx);
					break;
				case "allow":
					if (arg === "all") config.allow = Object.keys(CHAINABLE);
					else if (arg && arg in CHAINABLE && !config.allow.includes(arg)) config.allow.push(arg);
					else if (arg) {
						ctx.ui.notify(`Unknown skill ${arg}. Chainable: ${Object.keys(CHAINABLE).join(", ")}`, "error");
						return;
					}
					saveConfig(config);
					break;
				case "deny":
					if (!arg) break;
					config.allow = config.allow.filter((s) => s !== arg);
					saveConfig(config);
					break;
				case "delay": {
					const seconds = Number(arg);
					if (!Number.isFinite(seconds) || seconds < 0) {
						ctx.ui.notify("Usage: /hl-auto delay <seconds>", "error");
						return;
					}
					config.delayMs = Math.round(seconds * 1000);
					saveConfig(config);
					break;
				}
				case "sessions":
					if (arg !== "on" && arg !== "off") {
						ctx.ui.notify("Usage: /hl-auto sessions on|off", "error");
						return;
					}
					config.newSession = arg === "on";
					saveConfig(config);
					break;
				case "skip":
					cancelPending(ctx, "skipped");
					return;
				case "reset":
					config = defaultConfig();
					saveConfig(config);
					break;
				case "status":
					break;
				default:
					ctx.ui.notify(
						"Usage: /hl-auto [status|on|off|allow <skill|all>|deny <skill>|delay <s>|sessions on|off|skip|reset]",
						"error",
					);
					return;
			}
			refreshStatus(ctx);
			const gated = Object.keys(CHAINABLE).filter((s) => !config.allow.includes(s));
			const slug = boundTaskSlug(ctx.sessionManager.getSessionId());
			ctx.ui.notify(
				[
					`HumanLayer auto-advance: ${config.enabled ? "on" : "off"}`,
					`  auto:  ${config.allow.join(", ") || "(none)"}`,
					`  gated: ${gated.join(", ") || "(none)"}`,
					`  delay: ${config.delayMs / 1000}s · new session per phase: ${config.newSession ? "on" : "off"}`,
					`  task: ${slug ?? "(not bound)"} · advances in this pi: ${advanceCount()}`,
					pending ? `  pending: /skill:${pending.skill}` : "",
					`  config: ${configPath()}`,
				]
					.filter(Boolean)
					.join("\n"),
				"info",
			);
		},
	});
}
