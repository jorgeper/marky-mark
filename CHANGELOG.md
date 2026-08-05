# Changelog

## v0.5.0-alpha.2

- **Live preview (experimental)** — Markdown now renders inline in the edit pane: inline formatting, headings, links, blockquotes, lists, horizontal rules, and code fences, with the current line revealing its source as you edit. Task-list checkboxes render live and toggle the underlying source when clicked. Tables are left untouched so they keep rendering correctly. Enable it from Settings. (#46–#50, #55)
- **Opening files is now additive** — plain-clicking a file in the sidebar opens it in a new tab instead of replacing the current one, so tabs accumulate. (#64)
- **Launch lands on the splash screen by default** — reopening the last document is now off by default; turn it back on in Settings. (#53)
- **Comments work in plain edit mode** — a comment affordance is available while editing, with a native-menu fallback; fixes comments in the latest Windows build. (#38)
- **Startup and window fixes** — the splash no longer overlays stale document content, an empty workspace shows a pick-a-file hint instead of the splash, and edit mode is guarded behind an open document. (#39, #40, #43)
- **Theming fixes** — the line-number gutter and its border now follow the active theme instead of using hard-coded colors. (#52, #63)
- **More reliable dirty-state tracking** — a single dirty predicate with end-of-line normalization, so documents no longer show as modified when nothing changed. (#42)
- Supersedes the unpublished v0.5.0-alpha.1 tag, whose cut failed in release CI; the macOS test failure behind it is fixed. (#66, #67)

## v0.5.0-alpha.1

- **Live preview (experimental)** — Markdown now renders inline in the edit pane: inline formatting, headings, links, blockquotes, lists, horizontal rules, and code fences, with the current line revealing its source as you edit. Task-list checkboxes render live and toggle the underlying source when clicked. Tables are left untouched so they keep rendering correctly. Enable it from Settings. (#46–#50, #55)
- **Opening files is now additive** — plain-clicking a file in the sidebar opens it in a new tab instead of replacing the current one, so tabs accumulate. (#64)
- **Launch lands on the splash screen by default** — reopening the last document is now off by default; turn it back on in Settings. (#53)
- **Comments work in plain edit mode** — a comment affordance is available while editing, with a native-menu fallback; fixes comments in the latest Windows build. (#38)
- **Startup and window fixes** — the splash no longer overlays stale document content, an empty workspace shows a pick-a-file hint instead of the splash, and edit mode is guarded behind an open document. (#39, #40, #43)
- **Theming fixes** — the line-number gutter and its border now follow the active theme instead of using hard-coded colors. (#52, #63)
- **More reliable dirty-state tracking** — a single dirty predicate with end-of-line normalization, so documents no longer show as modified when nothing changed. (#42)

