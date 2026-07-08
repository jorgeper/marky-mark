# Building Markimark for Windows

The app code is fully portable — everything OS-specific sits behind `src/platform/` and
Tauri config. Three ways to get a Windows build:

**A. GitHub Actions (canonical):** `.github/workflows/release.yml` builds the NSIS
installer on `windows-latest` (and the macOS dmg + web single-file) on tag push or
manual dispatch.

**B. Cross-compile from macOS (verified working):**

```bash
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin
brew install nsis llvm
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
# → src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Marky Mark_<ver>_x64-setup.exe
```

The installer is unsigned (signing needs a Windows host or a custom `sign_command`).

**C. Natively on Windows:**

1. Install: Rust (`rustup`, MSVC toolchain), Node 20+, and the WebView2 runtime
   (preinstalled on Windows 11).
2. `npm install && npm run tauri build` — add `"nsis"` (or `"msi"`) to
   `bundle.targets` in `src-tauri/tauri.conf.json`.
3. File associations: the same `bundle.fileAssociations` block already covers Windows —
   the NSIS/MSI installer registers `.md`/`.markdown`. Files opened by double-click
   arrive as CLI arguments, which `src-tauri/src/lib.rs` already queues for the
   frontend (`take_pending_open_files`).
4. Paths: the config dir resolves to `%APPDATA%\com.markimark.app\` automatically via
   `appConfigDir()`; themes live in `themes\` inside it. No code changes needed.

Nothing else is macOS-specific: the `RunEvent::Opened` handler is `#[cfg(target_os =
"macos")]`-gated, and hotkeys use "Mod" (⌘ on macOS, Ctrl on Windows) throughout.
