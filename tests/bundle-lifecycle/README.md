# Bundle lifecycle gate

Run from the repository root:

```sh
python3 tests/bundle-lifecycle/run.py
```

Requirements: Python 3.9+, Node, and the repository's pinned dependencies. The parent build must first install the bundle with `node subagents-bundle.mjs install`. This test never installs or rebuilds dependencies.

The runner compares the installed plugin's `src/index.ts` with `src/bundle.mjs`. Missing files, missing results, false outcome assertions, process errors, and timeouts fail with a nonzero exit code. It does not merely compare tool registration.

## Coverage

Both variants must pass:

- Custom-agent discovery and foreground completion.
- A real child tool call, successful execution, and returned result.
- A thrown child tool error preserved in the model context, followed by recovery.
- Background spawn, completed result retrieval, and mid-stream steering.
- Same-process resume with original and steering context retained.
- Foreground cancellation through the tool AbortSignal.
- Missing-result lookup error response.
- Background completion notification stored in the actual parent session.
- Persisted resume in a second OS process, with original, steering, and same-process resume messages retained.

The restart test closes the first Pi process. It then opens the same persisted parent JSONL session in a new Pi process and resumes the saved child ID. It does not carry child session objects between processes. The new result must contain all prior context markers plus a new restart marker.

## Isolation and evidence

Each run creates a private temporary directory. Each variant gets separate HOME, PI_CODING_AGENT_DIR, XDG_CONFIG_HOME, TMPDIR, working directory, and session files. Environment inheritance uses a small allowlist; provider credentials and NODE_OPTIONS are not inherited. No auth files are copied.

The runner prints the evidence directory and retains it for inspection. It contains result JSON, assertions, stdout, stderr, parent/child sessions, and tool event logs. Each Pi process has a 35-second timeout. Timeout cleanup kills its process group. POSIX process groups support Linux and macOS; this has been run on Linux, not macOS.

`probe.ts` registers a local fake provider through Pi's supported provider API. It emits real tool-call stream events. `safe-tool.ts` loads through the child agent's explicit extension frontmatter and writes only to its variant's evidence directory. Plugin functions are not mocked. A registration proxy captures real tools and forwards registrations and notification sends unchanged.

The parent uses the real Pi extension runtime. Child agent execution uses the plugin's real SDK session path. Parent SessionManager entries prove notification delivery, rather than only proving a send was attempted.

## Limits

This gate tests deterministic fake-provider behavior, not external service protocols, billing, or network cancellation. It does not test background UI stop commands, workflows, UI rendering, malformed streams, or relocated bundles with sibling resources removed. Cancellation coverage is the foreground tool AbortSignal path. The parent test driver directly invokes registered tools with a real ExtensionContext; the child tool calls are model-stream-driven.

The provider captures actual toolResult inputs. Error assertions require the lane-call identity, expected failure text, and `isError === true`. A negative control changes the captured boolean to false and must be rejected. Both resume checks also require completed status.

Notification waiting uses a bounded eight-second predicate loop. It checks the matching completed custom-message entry and parent idle state before closing the first process. Waiting for idle prevents shutdown from interrupting the parent notification turn and its session persistence.

`deny-network.cjs` is preloaded in both Node processes. It blocks common Node TCP, TLS, HTTP, UDP, DNS, and fetch entrypoints. Attempts are logged and fail the gate even if application code catches the exception. This is not an OS network sandbox and does not cover native modules or arbitrary subprocesses.

Latest focused verification: all 15 checks passed for both original and bundle, including persisted process restart/resume and the deliberate negative control. No skips.
