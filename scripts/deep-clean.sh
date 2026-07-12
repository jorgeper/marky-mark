#!/bin/bash
# Removes every trace of Marky Mark so the next install is a true first run:
# app bundle, app data, preferences, WebKit storage, caches, and saved state.
set -uo pipefail

BUNDLE_ID="io.jorgepereira.markymark.app"
APP="/Applications/Marky Mark.app"

echo "Quitting Marky Mark…"
pkill -x marky-mark 2>/dev/null

echo "Removing the app bundle…"
rm -rf "$APP"

echo "Removing app data…"
rm -rf "$HOME/Library/Application Support/$BUNDLE_ID"

echo "Removing preferences…"
defaults delete "$BUNDLE_ID" >/dev/null 2>&1
rm -f "$HOME/Library/Preferences/$BUNDLE_ID.plist"

echo "Removing WebKit storage, caches, and saved state…"
rm -rf "$HOME/Library/WebKit/$BUNDLE_ID" \
       "$HOME/Library/Caches/$BUNDLE_ID" \
       "$HOME/Library/HTTPStorages/$BUNDLE_ID" \
       "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"

echo
echo "Done. Marky Mark is fully removed."
echo "  - Next install (npm run install:app) will be a true first run."
