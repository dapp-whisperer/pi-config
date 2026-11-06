# Ask User native status: accepted preexisting limitation

## R4: overlay attachment can fail before returning a handle

**Disposition:** accepted preexisting limitation; proceeded with the parent-approved narrow status fix. This is not an unresolved defect introduced by this patch or a request to expand its scope.

Pinned `TUI.showOverlay` inserts an overlay into its internal stack before evaluating visibility, focus, or render callbacks. If one of those callbacks throws before the removal handle is returned, the caller cannot remove that partially attached overlay through the handle API. An orphan can remain in the upstream TUI stack.

The status patch registers blocking only after attachment returns. It therefore guarantees **no new blocked source** on this pre-handle failure path. Failures after a handle has been obtained remove the overlay and clear its independent blocked source. The patch does not change upstream TUI attachment rollback.

## Evidence and source context

- Repository: `dapp-whisperer/pi-config`; branch: `fix/ask-user-native-status`.
- Review base and pre-publication HEAD: `ae1092227c971bbbed246ff4fc9be5d3924925b7`. The review covered the then-uncommitted implementation on this branch.
- Approved contract: [Ask User Program Status plan](../plans/2026-11-06-ask-user-program-status-plan.md), R4 and the implementation-time boundary under Assumptions and Risks.
- Regression characterization: `test_ask_user_program_status.mjs`, the real `TuiBase` visibility-callback failure scenario. It verifies no blocked source or blocked report, observes the existing orphan, and explicitly removes it in test cleanup. The orphan assertion documents existing behavior, not desired behavior.
- Fresh review run: `20261106-012723-a2d465ba`, completed `2026-11-06T01:31:58.562775+00:00`; local artifact: `/tmp/compound-engineering-1000/ce-code-review/20261106-012723-a2d465ba/review.json`.
- Review verdict: **Ready to merge**, with no actionable findings within the approved scope. The review states: “Accepted pre-handle TUI orphan boundary is explicitly characterized.” Its fresh isolated bootstrap run passed all 7 tests with no failures or skips.

## Follow-up and durability

Related: Beads `projects-53x` (already tracked by the parent; no external ticket URL is available).

Investigate exception-safe rollback inside upstream `TUI.showOverlay` when attachment callbacks fail before the removal handle is returned. Keep that work separate from this managed pinned-installation status patch.

This committed record is the durable repository fallback for the proceeded-and-flagged R4 scope clarification. No duplicate external issue was created. Beads ownership and any later tracker updates remain with the parent. Local review artifacts provide additional context but are not required to understand this record.
