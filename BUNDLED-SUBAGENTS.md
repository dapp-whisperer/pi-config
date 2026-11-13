# Experimental subagents bundle

Source mode remains the default. This change does not activate bundled mode in existing sessions or change dotfiles pins.

## Trial and rollback

After installing this repository revision, start a separate session:

```sh
PI_SUBAGENTS_MODE=bundled pi
PI_SUBAGENTS_MODE=bundled pi-health
PI_SUBAGENTS_MODE=bundled pi list
```

To roll back, quit that session and use `PI_SUBAGENTS_MODE=source pi`, or unset the variable. Unsupported values fail. There is no automatic fallback.

## Build and update

The runtime installer uses `npm ci --omit=dev --ignore-scripts`. It never compiles the bundle. Development dependencies include exactly esbuild 0.28.2.

When updating the plugin, update its exact version and lockfile first. Then run:

```sh
npm ci --ignore-scripts --legacy-peer-deps
node subagents-bundle.mjs build
node test_bundle.mjs
node subagents-bundle.mjs install
python3 tests/bundle-lifecycle/run.py
node tests/bundle-workflows/run.mjs
python3 tests/bundle-ui/run.py
node tests.mjs
```

Review and ship both files under `bundles/` with the lockfile and recipe. CI checks a locked rebuild on Linux and macOS. Provenance covers upstream package files, plugin version, lockfile, build recipe and artifact. The installer verifies these inputs before copying the prebuilt artifact into the original plugin's `src/bundle.mjs`. The complete npm package, resources and license remain installed. External packages resolve from the same staged dependency tree. Release integrity inventory covers the artifact, provenance and installed copy.

## Gate status

Local Linux root gates passed: deterministic rebuild; upstream source and artifact tamper refusal; fully fresh omit-dev install and provenance validation; installed launcher source/bundled command and tool-definition/schema parity; mode reporting through health/list; invalid selector refusal; explicit bundled failure without source fallback; tar-packed runtime relocation with actual RPC invocations and integrity checks in both modes. The full bootstrap suite passed with these added checks. Installed releases retain the original lockfile and do not contain esbuild.

Lane owners report passing Linux lifecycle tests, including a second-process persisted child resume, workflow/journal tests, and real PTY Claude UI tests in both modes. The lifecycle owner reports 15 checks per mode after tightening assertions for explicit tool errors, completed persisted resume and bounded notifications. These reports are separate from root test evidence; root integration did not rerun lane tests concurrently.

CI runs the artifact, lifecycle, workflow, UI and full bootstrap checks on Ubuntu 24.04, macOS 15 and macOS 15 Intel with Node 24.15.0. It installs the verified bundle before running lane tests. macOS execution remains unverified until CI runs. The root installed test reports five alternating warm samples per mode, timed through the real launcher until its RPC commands response. The bundled integrity guard is included. On the local Linux run, source median was 2308 ms (range 2284–2467 ms); bundled median was 1453 ms (1426–1465 ms), a 37.0% median reduction. A separate 20-sample integrity read/parse/hash probe measured 34.5 ms median (27.3–47.8 ms). These are local observations, not cross-platform promises. CI reports samples and uses a generous relative three-times-source regression ceiling, not a fixed time limit. Source remains the default; passing Linux tests does not authorize default activation.
