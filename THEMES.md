# Creating Marky Mark themes

A theme is **one `.css` file**. Drop it in the themes folder, hit *Reload themes* in
Settings (⋯ menu → Settings), and it shows up. That's the whole workflow. In the web
version, use *Import theme…* in Settings instead — the file is stored in the browser.

**Where the themes folder is**

- macOS: `~/Library/Application Support/io.jorgepereira.markymark.app/themes/`
- Windows: `%APPDATA%\io.jorgepereira.markymark.app\themes\`

Marky Mark creates this folder (and a copy of this guide) on first run.

## The built-in catalog

**Light**: Crisp (default), Crisp Mono, Claude, Manuscript, Typewriter, Newsprint,
Sepia, Solarized Light, Gruvbox Light, Catppuccin Latte, Ayu Light.
**Dark**: One Dark, Monokai, Dracula, Nord, Solarized Dark, Gruvbox Dark,
Tokyo Night, Catppuccin Mocha, GitHub Dark, Rosé Pine, Everforest Dark,
Night Owl, Zenburn, Phosphor (green CRT), Amber Terminal, Vaporwave.

## Anatomy of a theme

```css
/* @name: Midnight Ocean
   @author: you
   @variant: dark */

.theme-root {
  --mm-bg: #0b1622;
  --mm-fg: #d8e2ec;
  /* …the rest of the contract below… */
}
```

- The **first comment block** carries metadata. `@name` is what the picker shows;
  `@variant` is `light` or `dark`; `@author` is for humans. All three are optional —
  missing metadata falls back to the filename.
- All variables live on the `.theme-root` selector (the app's root element).
- You may add **any extra CSS** below the variables, scoped under `.theme-root`, for
  effects the variables can't express (e.g. `.theme-root h1 { letter-spacing: -0.02em }`).
- **No remote resources.** A theme referencing `url(http…)` is rejected at load time —
  Marky Mark never touches the network. Use system fonts or font stacks.

The easiest starting point: copy a built-in (e.g. `crisp.css` from the app repo's
`themes/` folder or this document's template below), rename it, and start tweaking.

## The variable contract

Layout and typography:

| Variable | Meaning |
|---|---|
| `--mm-content-width` | Max width of the document column (e.g. `46rem`) |
| `--mm-font-body` | Body font stack |
| `--mm-font-heading` | Heading font stack |
| `--mm-font-mono` | Code font stack |
| `--mm-font-size` | Base font size (e.g. `16px`) |
| `--mm-line-height` | Body line height (e.g. `1.7`) |

Core colors:

| Variable | Meaning |
|---|---|
| `--mm-bg` | Page background |
| `--mm-bg-elevated` | Toolbar, cards, popovers, settings |
| `--mm-fg` | Body text |
| `--mm-fg-muted` | Secondary text (timestamps, captions) |
| `--mm-heading` | Heading color |
| `--mm-link` | Links |
| `--mm-accent` | Buttons, focus rings, active states |
| `--mm-border` | Hairlines and dividers |

Markdown elements:

| Variable | Meaning |
|---|---|
| `--mm-code-bg` / `--mm-code-fg` | Code blocks and inline code |
| `--mm-blockquote-border` / `--mm-blockquote-fg` | Blockquote bar and text |
| `--mm-table-border` / `--mm-table-stripe` | Table grid and zebra rows |
| `--mm-hr` | Horizontal rules |
| `--mm-selection` | Text-selection background |
| `--mm-comment-tint` / `--mm-comment-tint-active` | The fixed comment tint (idle / active) — blue, a comment record's one rendering; never aliased to a marker hue (issue #283) |
| `--mm-marker-yellow` / `--mm-marker-green` / `--mm-marker-orange` / `--mm-marker-pink` | Optional marker-highlight hue overrides (opaque colors; the app derives idle/active/ghost strengths) |

Syntax highlighting (fenced code blocks):

| Variable | Colors |
|---|---|
| `--mm-syn-keyword` | keywords, tags |
| `--mm-syn-string` | strings, regex |
| `--mm-syn-comment` | comments, quotes |
| `--mm-syn-number` | numbers |
| `--mm-syn-title` | function/class names |
| `--mm-syn-attr` | attributes, properties |
| `--mm-syn-literal` | true/false/null, builtins |
| `--mm-syn-meta` | meta, annotations |

Every variable has a sensible fallback — the default Crisp theme's value — so a
minimal theme that only sets `--mm-bg`, `--mm-fg`, and `--mm-accent` already works.

## Chrome tokens (optional)

Beyond the contract above, the app's *chrome* (toolbar, buttons, menus, dialogs,
find marks) reads a second token layer, declared in the app stylesheet on the same
`.theme-root` scope. **A theme may override any of them and need not define any**:
every token has a default, and the colour defaults are derived from the contract
variables above, so your theme restyles the chrome automatically.

| Token | Default | Meaning |
|---|---|---|
| `--mm-space-1` … `--mm-space-6` | `4px`, `6px`, `8px`, `10px`, `12px`, `16px` | Spacing scale for chrome gaps and padding |
| `--mm-radius-small` | `6px` | Corner radius for inputs and buttons |
| `--mm-radius-medium` | `10px` | Corner radius for cards, modals, and menus |
| `--mm-radius-pill` | `999px` | Fully rounded badges, pills, and toggles |
| `--mm-card-shadow` | `0 1px 6px rgba(0, 0, 0, 0.09)` | Resting shadow on cards and badges |
| `--mm-panel-shadow` | `0 0 24px 2px rgba(0, 0, 0, 0.14)` | Shadow on floating panels |
| `--mm-text-caption` | `11px` | Smallest chrome text (labels, hints) |
| `--mm-text-small` | `12.5px` | Secondary chrome text |
| `--mm-text-body` | `13px` | Default chrome text |
| `--mm-text-heading` | `14px` | Chrome headings (dialog titles) |
| `--mm-text-icon` | `16px` | Glyph size in square icon buttons |
| `--mm-danger` | `color-mix(in srgb, #cf222e 90%, var(--mm-fg) 10%)` | Destructive text, borders, and fills |
| `--mm-danger-fg` | `var(--mm-bg)` | Text on a danger-filled control |
| `--mm-accent-fg` | `var(--mm-bg)` | Text on an accent-filled control |
| `--mm-hover` | `color-mix(in srgb, var(--mm-accent) 8%, transparent)` | Hover wash on rows and buttons |
| `--mm-muted` | `var(--mm-fg-muted)` | De-emphasised chrome text |
| `--mm-focus-ring` | `color-mix(in srgb, var(--mm-accent) 35%, transparent)` | Keyboard-focus ring |
| `--mm-find` | `#ffdf5d` | Find-match highlight (theme-independent by default, so matches stay legible on any theme) |
| `--mm-find-active` | `#f0883e` | The current find match |
| `--mm-find-fg` | `#1f2328` | Text inside find matches |
| `--mm-fence-ring` | `var(--mm-border)` | Hairline ring around code-fence cards in edit mode |
| `--mm-split` | `50%` | Split-view ratio before the user drags the divider |
| `--mm-folders` | `240px` | Sidebar panel width before the user drags its edge |

The required contract above is unchanged — chrome tokens are extras, not
obligations.

## Starter template

```css
/* @name: My Theme
   @author: me
   @variant: light */

.theme-root {
  --mm-bg: #ffffff;
  --mm-bg-elevated: #f5f5f5;
  --mm-fg: #222222;
  --mm-fg-muted: #777777;
  --mm-heading: #111111;
  --mm-link: #0a66c2;
  --mm-accent: #0a66c2;
  --mm-border: #e0e0e0;

  --mm-content-width: 46rem;
  --mm-font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mm-font-heading: var(--mm-font-body);
  --mm-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --mm-font-size: 16px;
  --mm-line-height: 1.7;

  --mm-code-bg: #f5f5f5;
  --mm-code-fg: #222222;
  --mm-blockquote-border: #e0e0e0;
  --mm-blockquote-fg: #666666;
  --mm-table-border: #e0e0e0;
  --mm-table-stripe: #fafafa;
  --mm-hr: #e0e0e0;
  --mm-selection: rgba(10, 102, 194, 0.18);
  --mm-comment-tint: rgba(121, 192, 255, 0.45);
  --mm-comment-tint-active: rgba(121, 192, 255, 0.7);

  --mm-syn-keyword: #b0257a;
  --mm-syn-string: #1a7f37;
  --mm-syn-comment: #999999;
  --mm-syn-number: #953800;
  --mm-syn-title: #6639ba;
  --mm-syn-attr: #0550ae;
  --mm-syn-literal: #0550ae;
  --mm-syn-meta: #777777;
}
```

## Tips

- A theme's file name becomes its id (`midnight-ocean.css` → `midnight-ocean`), which is
  what the app remembers as your selected theme — renaming a file "changes" the theme.
- Keep contrast ≥ 4.5:1 between `--mm-fg` and `--mm-bg` for comfortable reading.
- Test with the bundled *field-guide* document — it exercises headings, tables, task
  lists, code in several languages, blockquotes, and links.
- The edit-mode editor inherits `--mm-bg`, `--mm-fg`, `--mm-font-mono`, and
  `--mm-selection`, so dark themes automatically get a dark editor.
