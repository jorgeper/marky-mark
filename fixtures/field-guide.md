# The MDComments Field Guide

This guide is the long-form sample document for exercising scrolling, alignment, and re-anchoring behavior. It intentionally mixes every block of type the renderer supports, and it is comfortably longer than two thousand words so that margin alignment can be tested far below the fold. See the [project spec](https://example.com/spec) for the authoritative requirements.

## Getting Started

This section covers installation and first steps. The document model treats the rendered text as the single source of truth for positions. Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source.

When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded. The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage.

> Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable.

- First, installation and first steps begins with a careful reading of the section above.
- Second, a debounced autosave writes changes shortly after the last keystroke settles.
- Third, fuzzy matching tolerates small typo-level edits inside the anchored passage itself.

```ts
// Getting Started: illustrative snippet, not executed by the app.
export function gettingstartedExample(input: string): string {
  return input.trim().toLowerCase();
}
```

The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page. Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. For more background, consult the [reference notes](https://example.com/getting-started).

## Core Concepts

This section covers the mental model behind the system. Clicking a highlight brings its card into focus and the reverse works the same way. Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project.

Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions. Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source.

> When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded.

- First, the mental model behind the system begins with a careful reading of the section above.
- Second, the margin panel mirrors the classic word processor layout that reviewers already know.
- Third, highlights stack visually where two or more ranges overlap in the same passage.

```ts
// Core Concepts: illustrative snippet, not executed by the app.
export function coreconceptsExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable. A debounced autosave writes changes shortly after the last keystroke settles. For more background, consult the [reference notes](https://example.com/core-concepts).

## Anchoring Text

This section covers how ranges are located in a document. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself. The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page.

Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way. Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project.

> Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions.

- First, how ranges are located in a document begins with a careful reading of the section above.
- Second, every selection is captured with enough redundancy to survive ordinary editing sessions.
- Third, a reviewer can leave a note without ever touching the underlying markdown source.

```ts
// Anchoring Text: illustrative snippet, not executed by the app.
export function anchoringtextExample(input: string): string {
  return input.trim().toLowerCase();
}
```

When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded. The margin panel mirrors the classic word processor layout that reviewers already know. For more background, consult the [reference notes](https://example.com/anchoring-text).

## The Margin Panel

This section covers aligning cards with their anchors. Highlights stack visually where two or more ranges overlap in the same passage. Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable.

A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself. The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page.

> Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way.

- First, aligning cards with their anchors begins with a careful reading of the section above.
- Second, resolved conversations collapse out of the way but remain one click from revival.
- Third, the plain text coordinate space is documented in the architecture notes for the project.

```ts
// The Margin Panel: illustrative snippet, not executed by the app.
export function themarginpanelExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions. Every selection is captured with enough redundancy to survive ordinary editing sessions. For more background, consult the [reference notes](https://example.com/the-margin-panel).

## Persistence

This section covers sidecar files and diffable JSON. A reviewer can leave a note without ever touching the underlying markdown source. When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded.

The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage. Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable.

> A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself.

- First, sidecar files and diffable JSON begins with a careful reading of the section above.
- Second, the prefix and suffix context disambiguate phrases that appear several times.
- Third, rendering is sanitized, so documents cannot inject executable script into the page.

```ts
// Persistence: illustrative snippet, not executed by the app.
export function persistenceExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way. Resolved conversations collapse out of the way but remain one click from revival. For more background, consult the [reference notes](https://example.com/persistence).

## Surviving Edits

This section covers fuzzy matching and orphaned comments. The plain text coordinate space is documented in the architecture notes for the project. Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions.

Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source. When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded.

> The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage.

- First, fuzzy matching and orphaned comments begins with a careful reading of the section above.
- Second, threaded replies keep long discussions attached to the exact sentence they concern.
- Third, the sidecar file is pretty-printed so that version control diffs stay readable.

```ts
// Surviving Edits: illustrative snippet, not executed by the app.
export function survivingeditsExample(input: string): string {
  return input.trim().toLowerCase();
}
```

A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself. The prefix and suffix context disambiguate phrases that appear several times. For more background, consult the [reference notes](https://example.com/surviving-edits).

## Rendering Pipeline

This section covers from markdown source to sanitized HTML. Rendering is sanitized, so documents cannot inject executable script into the page. Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way.

Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project. Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions.

> Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source.

- First, from markdown source to sanitized HTML begins with a careful reading of the section above.
- Second, when the file changes on disk, each stored anchor is re-evaluated against the fresh text.
- Third, comments that lose their home are preserved as orphans rather than silently discarded.

```ts
// Rendering Pipeline: illustrative snippet, not executed by the app.
export function renderingpipelineExample(input: string): string {
  return input.trim().toLowerCase();
}
```

The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage. Threaded replies keep long discussions attached to the exact sentence they concern. For more background, consult the [reference notes](https://example.com/rendering-pipeline).

## Threads and Replies

This section covers conversations attached to a range. The sidecar file is pretty-printed so that version control diffs stay readable. A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself.

The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page. Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way.

> Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project.

- First, conversations attached to a range begins with a careful reading of the section above.
- Second, large documents stay responsive because re-anchoring runs in a single linear pass.
- Third, the document model treats the rendered text as the single source of truth for positions.

```ts
// Threads and Replies: illustrative snippet, not executed by the app.
export function threadsandrepliesExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source. When the file changes on disk, each stored anchor is re-evaluated against the fresh text. For more background, consult the [reference notes](https://example.com/threads-and-replies).

## Keyboard Interaction

This section covers shortcuts for fast reviewing. Comments that lose their home are preserved as orphans rather than silently discarded. The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage.

Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable. A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself.

> The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page.

- First, shortcuts for fast reviewing begins with a careful reading of the section above.
- Second, task lists, tables, and fenced code blocks follow the github flavored conventions.
- Third, clicking a highlight brings its card into focus and the reverse works the same way.

```ts
// Keyboard Interaction: illustrative snippet, not executed by the app.
export function keyboardinteractionExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project. Large documents stay responsive because re-anchoring runs in a single linear pass. For more background, consult the [reference notes](https://example.com/keyboard-interaction).

## Performance Notes

This section covers keeping large documents responsive. The document model treats the rendered text as the single source of truth for positions. Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source.

When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded. The margin panel mirrors the classic word processor layout that reviewers already know. Highlights stack visually where two or more ranges overlap in the same passage.

> Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable.

- First, keeping large documents responsive begins with a careful reading of the section above.
- Second, a debounced autosave writes changes shortly after the last keystroke settles.
- Third, fuzzy matching tolerates small typo-level edits inside the anchored passage itself.

```ts
// Performance Notes: illustrative snippet, not executed by the app.
export function performancenotesExample(input: string): string {
  return input.trim().toLowerCase();
}
```

The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page. Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. For more background, consult the [reference notes](https://example.com/performance-notes).

## Troubleshooting

This section covers common failure modes and their fixes. Clicking a highlight brings its card into focus and the reverse works the same way. Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project.

Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions. Every selection is captured with enough redundancy to survive ordinary editing sessions. A reviewer can leave a note without ever touching the underlying markdown source.

> When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded.

- First, common failure modes and their fixes begins with a careful reading of the section above.
- Second, the margin panel mirrors the classic word processor layout that reviewers already know.
- Third, highlights stack visually where two or more ranges overlap in the same passage.

```ts
// Troubleshooting: illustrative snippet, not executed by the app.
export function troubleshootingExample(input: string): string {
  return input.trim().toLowerCase();
}
```

Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable. A debounced autosave writes changes shortly after the last keystroke settles. For more background, consult the [reference notes](https://example.com/troubleshooting).

## Design Tradeoffs

This section covers choices made and roads not taken. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself. The prefix and suffix context disambiguate phrases that appear several times. Rendering is sanitized, so documents cannot inject executable script into the page.

Task lists, tables, and fenced code blocks follow the GitHub flavored conventions. Clicking a highlight brings its card into focus and the reverse works the same way. Resolved conversations collapse out of the way but remain one click from revival. The plain text coordinate space is documented in the architecture notes for the project.

> Large documents stay responsive because re-anchoring runs in a single linear pass. The document model treats the rendered text as the single source of truth for positions.

- First, choices made and roads not taken begins with a careful reading of the section above.
- Second, every selection is captured with enough redundancy to survive ordinary editing sessions.
- Third, a reviewer can leave a note without ever touching the underlying markdown source.

```ts
// Design Tradeoffs: illustrative snippet, not executed by the app.
export function designtradeoffsExample(input: string): string {
  return input.trim().toLowerCase();
}
```

When the file changes on disk, each stored anchor is re-evaluated against the fresh text. Comments that lose their home are preserved as orphans rather than silently discarded. The margin panel mirrors the classic word processor layout that reviewers already know. For more background, consult the [reference notes](https://example.com/design-tradeoffs).

## Compatibility Matrix

| Feature | Short docs | Long docs | Notes |
|---------|-----------|-----------|-------|
| Highlights | yes | yes | overlaps darken |
| Re-anchoring | yes | yes | cascade of four steps |
| Orphans | yes | yes | badge in the panel |
| Threads | yes | yes | edit and delete supported |

## Release Checklist

- [x] Render the sample documents without console errors
- [x] Persist comments to the sidecar file
- [ ] Ship the resolved-section keyboard shortcuts
- [ ] Translate the field guide into more languages

## Closing Notes

Highlights stack visually where two or more ranges overlap in the same passage. Threaded replies keep long discussions attached to the exact sentence they concern. The sidecar file is pretty-printed so that version control diffs stay readable. A debounced autosave writes changes shortly after the last keystroke settles. Fuzzy matching tolerates small typo-level edits inside the anchored passage itself. The prefix and suffix context disambiguate phrases that appear several times.

~~This closing line was struck through during the last review.~~
