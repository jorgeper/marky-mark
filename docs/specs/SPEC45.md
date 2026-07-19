# SPEC45: Marky Mark v45 — cue-anchored split scrolling

Delta spec on top of SPEC.md–SPEC44.md as implemented. This file wins on
conflict; nothing may regress. Amends ONLY SPEC15's alignment contract.

**What ships:** while the SPEC44 placement cue (the caret's word mark,
else its block tint) sits near the leading pane's viewport, synchronized
split scrolling aligns the panes ON THE CUE — the selected word keeps
the same vertical position on both sides, to the extent scrolling limits
allow (clamped at both ends, ends stay mutually reachable per SPEC15
§1.3). Far from the cue (beyond one viewport above or two below), the
SPEC15 block-anchored line interpolation applies unchanged. Leader/
follower mechanics, the no-feedback-loop suppression, typing-never-syncs,
and rebuild triggers are untouched.

Mechanism: `EditorSyncHandle` gains `headTop()` (caret line's top in CM
content coordinates); the controller compares the leader's cue viewport
offset with the follower's cue content position and writes the follower's
scrollTop directly; no new anchors, no stamping changes.

Tests: E128 — with the caret mid-document in split mode, scrolling
either pane keeps the editor caret line and the preview's `mm-active-word`
mark within a small vertical tolerance of each other; scrolling far away
falls back to interpolation without jumps; both ends still clamp
mutually reachable (E57/E58 stay green). E57/E58 may not be weakened.
