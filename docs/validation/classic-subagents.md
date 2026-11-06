# Classic delegation validation

The backend is classic `pi-subagents` **0.84.0**; presentation compatibility targets
`pi-claude-code-ui` **1.0.109**, with native parent status in Pi **1.5.0**.
These results are local Linux x64 evidence, not macOS CI, real-provider quality,
a graphical Herdr test, or deployment approval.

## Reproduce

```sh
sh bootstrap.sh --checkout "$PWD" --test
npm audit --omit=dev
node generate-bootstrap.mjs --check
# Optional; supply a disposable installation and an existing unmodified Core CLI:
node test_subagents_core.mjs /path/to/disposable/release /path/to/hc
node test_subagents_core.mjs /path/to/disposable/release /path/to/hc --disabled
```

Use private temporary HOME/TMPDIR/XDG directories for bootstrap. The installer
copies its source, so the temporary HOME must not be under the source checkout.
Runtime fixtures construct clean environments, never copy credentials, and deny
Node network connection APIs. Each Core invocation creates a unique private socket,
checks that its server is empty, stops only that server in `finally`, and checks
that the Core and recorded fixture child PIDs have exited.

## Observed checks

- Complete architecture bootstrap: **40 tests passed, zero failed**. Includes
  exact settings-only ownership, preference-byte preservation, single-backend
  discovery, fresh/rerun/add-later installs, skill retention, offline RPC, native
  zigpty, archive/activation/tamper guards, footer, links, goal and HumanLayer tests.
- Pinned staged patch guard suites: dry-run/no writes, all-target preflight,
  idempotence, partial/missing/duplicate/version/module-count refusal.
- Actual bundled classic: deterministic foreground child, background child plus
  terminal-process observation, scripted workflow, stop, invalid-agent refusal.
- Native controlled reporter: state mappings, settled supervisor attention,
  UTF-8 bounds, workflow-key sanitization, active-first 64-record limit, privacy,
  deduplication, SIGCONT resend, disappearance and disposal/disable gates.
- Native root reporter: independently owned overlapping contributions, prior
  idle/done/error restoration, actual parent activity, blocked/compaction precedence,
  stale generation invalidation and repeated disposal.
- Installed renderers and real Pi tool component: classic result renderer survives
  Claude UI interception; source/bundle equivalence, widths 0/1/2/24/40/80/120,
  dark/light/system themes, rich output expansion, Unicode and empty details,
  Fleet selection/inspector/input ownership and subscription cleanup.
- Dependency audit: **zero vulnerabilities**; direct pins other than the backend
  remain unchanged. Added/removed transitive packages belong to the backend graph.
- Browser applicability gate: consulted `ce-test-browser` and pipeline reference;
  changed files expose no web routes or dev server. **Not applicable**, not passed.
  No browser stack or server was installed/started.

## Render fixtures

`test-fixtures/subagents-render.json` is the checked-in deterministic plain-text
snapshot (fixed clock, synthetic names/tasks). The test also checks actual ANSI
width and source/bundle equivalence, rather than treating stripped text as the
only rendering evidence. Representative 24-column output:

```text
Agents worker · backgro…
◦ worker
  ⎿  queued…

Agents worker · backgro…
✗ worker · 0ms
  ⎿  Rejected
```

The rejected case first failed with `Done`, despite its error glyph. The guarded
render-only patch now labels it `Rejected`, including nested widget text. No
backend state, result data, or native reporter mapping was changed for that fix.

Actual Core PTY capture with the bundled classic + Claude UI (synthetic test only):

```text
❯ Run fixture
● Called Subagent ×2 (ctrl+o to toggle)
● FIXTURE_RUNTIME_FINISHED
✻ Turn took 0s (Total time 0s · 1 turn)
⠧ Async agents · background
├─ ⠙ fixture-worker · 0ms
│     ⎿  active now
└─ ⠴ fixture-worker · 0ms
      ⎿  active now
```

This is visual evidence only. Tests obtain lifecycle/state from actual structured
classic results and Core records, never from this screen text.

## Unmodified Core observations

| Scenario | Native root | Native classic child records |
|---|---|---|
| Startup, native capability negotiation (no forced enable) | idle | none |
| Parent response finished, two actual background children | working | working + working |
| Native selector waiting | blocked/question | working + working |
| Native selector answered | working | working + working |
| First child completed | working | done + working |
| Last child completed | done | done + done |
| `/new` | idle | none |
| Separate fresh instance, `PI_PROGRAM_STATUS=0`, actual children | no native Pi root record | none |

Only Pi's existing terminal writes root status. Classic's existing reporter writes
child records. The fixture registers a deterministic provider and a native selector
command, not an OSC writer. The Ask status fix and closed Herdr GUI PR are absent.

## Limits

The implementation worker did not publish a PR or run remote CI. A subsequent
independent report-only review found no actionable defects or settled-decision
conflicts. It reran the production patch and guard suites, installed rendering,
parent/child reporting, deterministic runtime, enabled/disabled isolated Core,
ownership, audit, syntax, and generated-drift checks after simplification. The
full bootstrap result above predates the behavior-preserving simplification;
neither simplification nor independent review reran that full suite. Remote
Linux/macOS results must be read from the own-fork PR checks, not inferred from
these local results.

The fixture uses a deterministic provider, not external model services. Real Core
proves `/new`; other replacement reasons and stale ownership are covered at
reporter/component seams, not exhaustive interactive resume/fork/reload menus.
The Core fixture does not delegate again after `/new`. Approval/trust and every
disabled-feature refusal are retained upstream, not individually driven by new
end-to-end tests.

Rendering evidence covers simple widget states, single-result rich expansion,
Fleet lifecycle, and optional/empty parallel/workflow details. It is not the
full nonempty workflow/nested/management, artifact-reference, long-name, or
embedded-control presentation matrix proposed in the plan. Complex topology
and inspector controls retain native code. These are coverage limits, not
review findings or demonstrated defects; no follow-up defect ticket was invented.

Two simplification suggestions were deliberately not applied: suppressing repeated
Working reports could change refresh side effects, and moving fault-injection
suites out of installation could change failure/output ordering. They remain
optional optimization ideas, not shipping blockers.

LFG review follow-up applied no fixes because the actionable finding set was empty.
There were no proceeded-and-flagged conflicts to defer. Beads tracking remains
caller-owned; this committed document durably records the accepted evidence
limits without creating duplicate tracker issues. The shipping browser gate
rechecked the complete final scope: terminal/bootstrap only, no web routes or
server. No browser driver or server was started. No merge, protected installation
activation, or live Core mutation is authorized by these results.
