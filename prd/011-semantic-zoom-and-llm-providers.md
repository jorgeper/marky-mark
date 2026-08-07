# PRD 011: Semantic zoom and LLM providers

**Status:** Draft
**Date:** 2026-08-07

## Problem

Long documents are read at exactly one altitude. You can scroll, jump to
a heading, or shrink the font — but nothing lets you step back and see
*what the document says* at a glance. The outline you get from headings
alone is a table of contents, not an understanding: it tells you a
section is called "Rollout plan" and nothing about what the plan is.

The owner wants a **semantic zoom**: a control that zooms out of the
document the way a map zooms out of a city — progressively dropping
detail while keeping structure, replacing section bodies with summaries
and shedding the deepest headings, until the whole document is a
paragraph. Zooming back in returns to the text.

Real summaries need a language model, and Marky Mark has never talked to
one. It has never talked to *anything*: SPEC11 guarantees, in absolute
terms and enforced by CSP plus a build-time bundle scan, that the app
makes no outbound network request. Introducing an LLM is therefore not
an incidental dependency — it is a deliberate, user-configured, opt-in
exception to the product's central privacy claim, and it needs to be
built as one.

It also needs to be built once. The owner plans further LLM-backed
features, so provider configuration — which service, which model, which
key, what it costs — belongs in its own settings area that later
features reuse, not buried inside this one.

## Goals

- A reader can zoom a document out through discrete levels and back in,
  seeing progressively less text and more summary while the document's
  structure stays recognizable.
- The zoom works **without any LLM configured** — degraded to excerpts,
  never absent — so the feature is usable, testable, and honest offline.
- Configuring a provider is a first-class, self-contained settings area
  that future LLM features reuse unchanged.
- A user can tell, before spending anything, which model is a sensible
  choice and roughly what it costs — and afterwards, what it actually
  cost.
- Summaries are paid for once: re-zooming unchanged content never
  re-bills, and on a hosted deployment one member's summarization
  benefits the whole workspace.
- The network exception is narrow, visible, reversible, and off by
  default: no LLM is configured, no request is ever made, and the
  privacy claim stays exactly as strong as it is today for everyone who
  does not opt in.

## Non-goals

- **Editing at zoomed-out levels.** Summaries are not the document and
  cannot round-trip into it. Levels below full are read-only.
- **A general AI assistant, chat, or inline prompting.** This PRD ships
  provider *configuration* and exactly one consumer of it
  (summarization). Chat, rewriting, and completion are later features
  that will reuse the settings area.
- **LLM features in the static web build.** Its CSP (`default-src
  'none'; connect-src 'none'`) is total, and this PRD does not widen it.
  Static web gets structural zoom with excerpts, nothing more.
- **Per-user API keys on hosted deployments.** Hosted uses one
  operator-configured credential for the whole deployment; members never
  see or supply a key.
- **Local/on-device model execution.** Bundling or running a model
  locally is out of scope. (A custom OpenAI-compatible endpoint happens
  to reach a locally-run server, but the app ships no model and manages
  no runtime.)
- **Streaming summaries token by token.** A summary appears when it is
  done.
- **Retrieval, embeddings, semantic search, or any vector store.** The
  only LLM call shape is "summarize this text."
- **Making the zoom level part of the document, workspace, or shared
  state.** It is a view state, and summaries are derived data.
- **Guaranteeing summary quality or determinism.** Output varies by
  model and run; the app does not grade, diff, or pin it.
- **Prompt customization.** Summarization prompts are the app's, not
  user-editable, in this PRD.
- **Replacing or unifying the existing text zoom** (SPEC4 §4), which
  keeps its name, behavior, and `Mod+=` / `Mod+-` / `Mod+0`
  accelerators.
- **Cost enforcement.** The app reports spend; it does not cap it, meter
  quotas, or block requests past a budget.

## Requirements

### Experimental gating

1. Settings gains an **Experimental** section. Features listed there are
   off by default, each with a one-line description of what turning it
   on does, and the section states plainly that these features may
   change or be removed.
2. **Semantic zoom** is an Experimental feature, off by default. With it
   off, no semantic-zoom control, menu item, hotkey, or command exists
   anywhere in the app — the feature is absent, not disabled.
3. Turning the feature off must fully stand it down: no further LLM
   calls, and the user can remove the stored key and delete cached
   summaries in the same place, in one action each.

### LLM provider configuration

4. Settings gains an **LLM providers** area (its own page/tab, not a row
   in an existing one) that is the single home for model configuration
   and is written to serve future LLM features, not just semantic zoom.
5. It supports five provider types: **OpenAI**, **Anthropic**,
   **Google Gemini**, **OpenRouter**, and a **custom OpenAI-compatible
   endpoint** (base URL, key, model name). Exactly one provider is
   active at a time.
6. For each provider the user picks a model — from a short curated list
   of known-good choices plus a free-text field for any model id the
   provider accepts, so a new model never requires an app release.
7. On desktop the user supplies an API key, stored as a normal user-layer
   setting. It is never workspace-scoped and never written into a
   workspace file, so a key cannot be committed or shared by opening a
   workspace. It is masked in the UI and never appears in logs, error
   messages, notices, or crash drafts.
8. On a hosted deployment the key is **operator-configured** at deploy
   time (server environment) and shared by every user of that
   deployment. Members see the provider and model in use, never a key
   field, and cannot change the credential.
9. The settings area reports **availability** and why it is unavailable,
   phrased for the reader: no key configured (desktop), operator has not
   configured one (hosted), or LLM features are unavailable on this
   platform (static web). It never offers a control that cannot work.
10. A **test connection** action verifies the configured provider,
    model, and credential with one cheap request and reports success or
    a specific failure (bad key, unknown model, unreachable host, rate
    limited). On desktop this round-trips through the main window rather
    than the settings window, which holds no capabilities of its own.
11. Provider access is implemented behind one seam with a single
    definition of the request/response shape, so adding a provider later
    is a new implementation of that seam and no change to callers.
    Summarization is one caller of it.

### Where calls run, and the network exception

12. **Desktop**: LLM requests are made from the Rust shell, not the
    webview — following the updater precedent. The webview CSP is not
    widened; `connect-src` keeps allowing only IPC.
13. **Hosted**: the browser calls the app's own server (same origin),
    which forwards to the provider with the operator's credential. No
    new client-side outbound call site, and no provider host is ever
    contacted from the browser.
14. **Static web**: no LLM path at all. Its CSP and the build's
    zero-outbound property are unchanged, and the fetch-allowlist count
    the validation gate enforces stays as it is for that bundle.
15. SPEC11 is amended rather than quietly contradicted: the guarantee
    becomes conditional and precise — no outbound request from documents,
    themes, or dependencies, ever; and no outbound request at all unless
    the user (or, on hosted, the operator) has configured an LLM
    provider and invoked a feature that uses it. The README, the
    architecture doc, and the security assessment are updated to match,
    and the validation gate's committed counters are re-pinned with
    justification.
16. Every LLM request is attributable to a user action. No background,
    speculative, or startup request is made — including no automatic
    "test connection" on launch.

### Semantic zoom behavior

17. Semantic zoom has **five levels**, applying to the rendered
    document view:
    - **L5** — the full document, exactly as today.
    - **L4** — all headings kept; each section's body replaced by a
      short (2–3 sentence) summary.
    - **L3** — headings to depth 2 kept; deeper sections' summaries
      folded into their nearest kept ancestor.
    - **L2** — top-level headings only, one summary each.
    - **L1** — the document's title and a single paragraph summarizing
      the whole document.
18. Levels 1–4 are **read-only**. Entering them from edit mode is
    allowed and leaves the buffer untouched; the document cannot be
    edited until it returns to L5.
19. Clicking a heading or a summary **dives in**: one click moves one
    level toward L5 focused on that section, and reaching L5 scrolls to
    that section in the full document. A direct "back to full document"
    action is available at every level.
20. A document always opens at **L5**. The level is view state: it is
    never stored in the document, a workspace, or a shared file, and it
    does not roam.
21. The control is a **level indicator with + / − and a draggable
    handle**, docked in the document view, showing the current level and
    what it means. It appears whenever the Experimental feature is on —
    including where no LLM is available, since the levels still work on
    excerpts there (Req 22).
22. **Without a configured provider**, all five levels still work: each
    section shows a deterministic excerpt (its opening sentence or first
    lines, truncated) in place of a summary, and the view states plainly
    that these are excerpts, with a link to configure a provider for
    real summaries. This is the only behavior in the static web build.
23. Semantic zoom is a distinct feature from text zoom: its own View
    menu entries, its own commands, and its own accelerators
    (`Mod+Shift+=` / `Mod+Shift+-` / `Mod+Shift+0`). SPEC4 §4 text zoom
    is untouched.
24. Structure comes from a real **source-level section model** — a
    parsed tree of headings and their bodies with source line ranges —
    not from scraping rendered HTML. Existing consumers of rendered
    line anchors (scroll sync, heading palette, comment anchoring)
    continue to work at L5 exactly as before.

### Summarization and caching

25. Summaries are generated **on demand**: entering a zoomed level
    requests only what that level shows, and only for sections not
    already cached. Typing, saving, and opening a document trigger no
    LLM call.
26. While summaries are in flight the view shows the section's structure
    with a pending state, filling in as results arrive, and the
    operation is **cancellable** — leaving the level or closing the
    document abandons outstanding work and never applies a stale result
    to a changed document.
27. Failures are per-section and legible: a section that failed shows
    the reason (rate limited, auth failed, provider unreachable) and can
    be retried, while successfully summarized sections stay displayed.
    One failure never empties the view.
28. Summaries are **cached by section content hash**, so unchanged
    content is never summarized twice — across zoom cycles, document
    reopens, and app restarts. Editing a section invalidates only that
    section.
29. The cache lives in app-side storage, never beside the document and
    never in the user's repository or workspace files. On desktop it is
    a size-capped store in the app config directory with oldest-out
    eviction; on hosted it is server-side and **scoped to the
    workspace**, so members reuse each other's summaries.
30. The cache is inspectable and clearable from the Experimental/LLM
    settings area: the user can see roughly how much it holds and delete
    it outright (Req 3).

### Cost transparency

31. The LLM settings area shows, per provider, a **curated
    recommendation**: a model that is good enough for summarization and
    its price per million input/output tokens, carrying an explicit
    "as of <date>, check the provider for current pricing" caveat.
32. The app shows **measured usage** from the token counts providers
    return: tokens and estimated cost for the most recent
    summarization, plus a running total that the user can reset. When a
    provider returns no usage data, the app says so rather than
    inventing a number.
33. Before the first summarization of a document at a given level, the
    user is told what it will do — roughly how many sections will be
    summarized and the estimated cost — with the option to proceed or
    cancel. This confirmation can be suppressed by the user ("don't ask
    again"), and estimates are always labelled as estimates.

### Verification

34. The section model, the level-to-content mapping (which headings and
    summaries each level shows), the excerpt fallback, cache keying and
    invalidation, and cost estimation are pure, unit-tested functions
    with no network and no DOM.
35. No test may contact a real provider. Provider implementations are
    exercised against a local fake, and e2e coverage exercises: the
    Experimental toggle's presence/absence effect, zooming through all
    five levels with excerpts (no provider configured), zooming with a
    faked provider including a per-section failure and retry, click-to-
    dive back to full, the cache preventing a second call for unchanged
    content, and the settings area's availability states on each
    flavor.

## Open questions

- None.
