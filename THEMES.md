# Creating Marky Mark themes

A theme is **one `.css` file**. Drop it in the themes folder, hit *Reload themes* in
Settings (⋯ menu → Settings), and it shows up. That's the whole workflow. In the web
version, use *Import theme…* in Settings instead — the file is stored in the browser.

**Where the themes folder is**

- macOS: `~/Library/Application Support/com.markimark.app/themes/`
- Windows: `%APPDATA%\com.markimark.app\themes\`

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
| `--mm-comment-tint` / `--mm-comment-tint-active` | Comment highlights (idle / active) |

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

Every variable has a sensible fallback, so a minimal theme that only sets `--mm-bg`,
`--mm-fg`, and `--mm-accent` already works.

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
  --mm-comment-tint: rgba(255, 214, 102, 0.4);
  --mm-comment-tint-active: rgba(255, 193, 37, 0.6);

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
