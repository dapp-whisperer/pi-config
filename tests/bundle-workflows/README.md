# Bundled workflow gate

Run from any directory with Node 22 or newer:

```sh
node tests/bundle-workflows/run.mjs
```

Prerequisites: install the repository dependencies and install the verified bundle with the repository's bundle installer. This suite does not build or install the production bundle. It requires both plugin entrypoints in repo node_modules: `src/index.ts` and `src/bundle.mjs`.

## Actual session integration

`probe.ts` runs inside the real Pi RPC CLI, resolved from the repository host package's declared bin entry. It uses the supported custom-provider API and the actual registered SubagentWorkflow tool, WorkflowHost, AgentManager, worker threads, and child AgentSessions. There is no injected WorkflowHost in these tests.

For both original and installed bundled entrypoints, assertions check:

- Project saved workflow discovery and argument delivery.
- Package-declared workflow discovery from a local package manifest.
- Two parallel child sessions and their exact results.
- A two-stage pipeline, including the exact second-stage prompt containing the first result.
- Actual completion notifications, forwarded unchanged to the parent. Provider context proves the parent consumes the replay notification.
- Public `resumeFromRunId` replay in the same session, with identical results, two replayed calls and zero child tokens.
- Exactly four child-provider prompts across parallel, replay and pipeline. A parent notification turn must not be mistaken for a replayed child call.
- Both original and resumed on-disk run journals contain two successful results.

The harness calls the registered tool directly with the real session context. It does not test model selection of the tool. The deterministic provider returns `E2E-OK` locally and makes no network calls.

## Worker-only checks

`worker.mjs` is a separate, bounded runtime test. It runs the original runtime and a temporary esbuild bundle of that runtime. It asserts literal arguments, phase/log output, invalid JSON-boundary results, syntax errors, and cancellation of an infinite-loop worker. Its host rejects any child spawn. These checks do **not** claim to test child sessions or cancellation through the public workflow tool, which ignores its call's abort signal.

The temporary runtime bundle is distinct from the installed extension artifact. Installed-artifact behavior is covered by the session tests above.

## Isolation and failures

The launcher creates a private temporary directory, sets HOME, PI_CODING_AGENT_DIR and TMPDIR inside it, and passes an allowlisted environment. Provider credentials, NODE_OPTIONS, and inherited Pi configuration are not forwarded. Only repository dependencies and fixtures are loaded. No installed files are written.

Each CLI child has a 40-second timeout; each notification wait has a 10-second deadline. Worker-only execution has a 20-second timeout. Assertion failures, subprocess errors and timeouts produce nonzero exit status. The temporary tree is removed in finally, including on failure. No external credentials, paid provider, browser, scheduling job or network service is required.

## Limits

Not covered: workflow replay after process restart, individual child-agent resume, nested package resources, UI, scheduling, source removal, or dependency provenance validation. The root bundle provenance gate owns the last concern. Linux was exercised locally; paths, environment setup and child-process invocation are portable to macOS, but macOS execution has not been verified here.
