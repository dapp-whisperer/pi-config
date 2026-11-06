# Real terminal bundle gate

After installing locked dependencies and building `src/bundle.mjs`, run from any directory:

```sh
python3 tests/bundle-ui/run.py
```

Requires Node on PATH and Python 3 on Linux or macOS. No additional Python packages or model credentials are needed. The fixture imports the retained upstream source or its sibling bundle. Both installed Claude UI entrypoints load in each run.

The gate opens real PTYs and checks new terminal output at each stage: manager, Settings, running fleet, conversation viewer, child bash tool, child completion, parent notification, two-key stop confirmation, stopped notification, and clean `/quit`. Input bindings come from upstream fleet-list and conversation-viewer code. Missing markers, timeouts, modified package files, and nonzero or forced exits fail the command. Assertions check stage-local terminal output, not a full terminal-emulator screen model. Child-tool execution uses only `printf UI_CHILD_TOOL_MARKER`.

Each process has a strict environment allowlist, isolated HOME, agent directory, working directory, and TMPDIR. Only the registered local fixture provider is selected. No inherited provider credentials or Node hooks cross into the process. The fixture uses deterministic events, not HTTP. Each variant has a 100-second deadline; cleanup terminates its process group if normal exit fails.

The command prints a private temporary evidence directory. It retains stage recordings, full ANSI transcripts, tool launch results, version inventory, package integrity results, and the gate summary. Use `--output PATH` for a CI artifact directory (use a fresh directory per run). Do not commit runtime evidence.

Source and bundle use the same installed dependency tree. The test hashes retained tintinweb and Claude UI package files before and after execution; it never modifies upstream source or resource manifests. Startup timing and lifecycle/workflow correctness are separate gates.
