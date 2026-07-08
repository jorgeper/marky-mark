# Welcome to Marky Mark

A lightweight, fast markdown viewer. Double-click any `.md` file to read it here — or press the **Edit** button (⌘E) to change it, and press it again to go back to reading.

## Reading

Marky Mark renders GitHub-flavored markdown: **bold**, *italics*, ~~strikethrough~~, `inline code`, [links](https://example.com), and everything below.

### A table

| Action | Where |
| --- | --- |
| Switch theme | ☰ menu → Settings |
| Comment | Select text in the document |
| Reply | Use the card in the margin |

### Some code

```js
function greet(name) {
  // Themes color this block through the --mm-syn-* variables.
  const message = `Hello, ${name}!`;
  return message.length > 0 ? message : null;
}
```

### A task list

- [x] Install Marky Mark
- [x] Open this welcome file
- [ ] Drop a custom theme into the themes folder

> Blockquotes get a colored bar from the active theme. Try switching to **Monokai** or **Claude** in Settings and watch this whole page change instantly.

## Themes

Open the ☰ menu → **Settings** to switch between the seven built-in themes. Want your own? A theme is a single CSS file — see the `README.md` in your themes folder for the full guide. Drop your file next to it and hit *Reload themes*.

## Comments

Select any sentence in this document and click **💬 Add comment**. Your note is saved to a sidecar file next to the document (`welcome.md.comments.json`), so the markdown itself stays untouched. Comments survive edits to the file, and if their text is deleted they are kept as *orphaned* cards instead of being lost.

---

That's it. Press ⌘E and make this file yours.
