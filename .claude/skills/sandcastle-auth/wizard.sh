#!/usr/bin/env bash
# Interactive credential wizard for Sandcastle agents.
#
# Prompts for the tokens the harnesses need (Claude Code OAuth token or
# Anthropic API key for claude-code tiers, OpenAI API key for codex tiers,
# GH_TOKEN for GitHub), writes them into .sandcastle/.env, and probes each
# API so a mispasted key fails here instead of mid-run. Secrets are read
# with `read -s` and never echoed, logged, or passed on a command line.
#
# Run it yourself in the Claude Code prompt:  ! bash .claude/skills/sandcastle-auth/wizard.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$REPO_ROOT/.sandcastle/.env"
EXAMPLE_FILE="$REPO_ROOT/.sandcastle/.env.example"

say() { printf '%s\n' "$*"; }

if [ ! -t 0 ]; then
  say "This wizard prompts for secrets, so it needs an interactive terminal."
  say "Run it from the Claude Code prompt as:"
  say "  ! bash .claude/skills/sandcastle-auth/wizard.sh"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE_FILE" ]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    say "Created .sandcastle/.env from .env.example."
  else
    : > "$ENV_FILE"
    say "Created empty .sandcastle/.env."
  fi
fi
chmod 600 "$ENV_FILE"

# A key counts as set only with a non-empty value on an uncommented line.
has_key() { grep -qE "^[[:space:]]*$1[[:space:]]*=[^[:space:]]" "$ENV_FILE"; }

# Replace the key's line (commented placeholder included) or append it.
# The value goes through a temp file + mv so a crash never half-writes .env.
set_key() {
  local name="$1" value="$2" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/sandcastle-env.XXXXXX")"
  grep -vE "^[[:space:]]*#?[[:space:]]*${name}[[:space:]]*=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# Probes return the HTTP status; 000 means the API was unreachable (offline
# is a soft pass — the key is stored, just not verified).
probe() {
  local status="$1" label="$2"
  case "$status" in
    401|403) say "  ✗ $label was rejected by the API ($status) — stored anyway; fix or re-run."; return 1 ;;
    000)     say "  ~ $label stored (API unreachable — could not verify)." ;;
    *)       say "  ✓ $label authenticates against the API." ;;
  esac
}

read_secret() { # read_secret PROMPT -> $SECRET
  SECRET=""
  read -rsp "$1" SECRET
  printf '\n'
  [ -n "$SECRET" ]
}

setup_claude_oauth() {
  if command -v claude >/dev/null 2>&1; then
    read -rp "Run \`claude setup-token\` now to mint a token? (y/N): " run_it
    if [[ "$run_it" =~ ^[Yy] ]]; then
      claude setup-token || say "  (setup-token exited non-zero — you can still paste an existing token)"
    fi
  else
    say "  (\`claude\` CLI not found on PATH — paste a token minted elsewhere)"
  fi
  read_secret "Paste the OAuth token (input hidden): " || { say "  Skipped — empty input."; return; }
  if [[ "$SECRET" != sk-ant-oat01-* ]]; then
    say "  ✗ That does not look like a Claude Code OAuth token (expected sk-ant-oat01-…) — not stored."
    return
  fi
  set_key CLAUDE_CODE_OAUTH_TOKEN "$SECRET"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer $SECRET" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "anthropic-version: 2023-06-01" \
    https://api.anthropic.com/v1/models || printf '000')
  probe "$status" "CLAUDE_CODE_OAUTH_TOKEN" || true
}

setup_anthropic_key() {
  read_secret "Paste the Anthropic API key (input hidden): " || { say "  Skipped — empty input."; return; }
  set_key ANTHROPIC_API_KEY "$SECRET"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "x-api-key: $SECRET" \
    -H "anthropic-version: 2023-06-01" \
    https://api.anthropic.com/v1/models || printf '000')
  probe "$status" "ANTHROPIC_API_KEY" || true
}

setup_openai_key() {
  say "Codex tiers authenticate with an OpenAI API key (platform.openai.com → API keys)."
  read_secret "Paste the OpenAI API key (input hidden): " || { say "  Skipped — empty input."; return; }
  set_key OPENAI_API_KEY "$SECRET"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer $SECRET" \
    https://api.openai.com/v1/models || printf '000')
  probe "$status" "OPENAI_API_KEY" || true
}

setup_gh_token() {
  say "Fine-grained PAT with Contents, Issues and Pull requests (R/W) + Metadata (R)."
  say "Create at: https://github.com/settings/personal-access-tokens/new"
  read_secret "Paste the GitHub token (input hidden): " || { say "  Skipped — empty input."; return; }
  set_key GH_TOKEN "$SECRET"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: token $SECRET" \
    https://api.github.com/user || printf '000')
  probe "$status" "GH_TOKEN" || true
}

show_status() {
  say ""
  say "Credentials in .sandcastle/.env (values never shown):"
  local key
  for key in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY GH_TOKEN; do
    if has_key "$key"; then say "  ✓ $key set"; else say "  · $key not set"; fi
  done
  say ""
}

say "Sandcastle credential wizard — writes .sandcastle/.env, never echoes secrets."
show_status
while true; do
  say "  1) Claude Code OAuth token   (claude-code tiers, subscription auth)"
  say "  2) Anthropic API key         (claude-code tiers, API billing)"
  say "  3) OpenAI API key            (codex tiers)"
  say "  4) GitHub token (GH_TOKEN)   (issue/PR operations from sandboxes)"
  say "  q) done"
  read -rp "Set up which? " choice
  case "$choice" in
    1) setup_claude_oauth ;;
    2) setup_anthropic_key ;;
    3) setup_openai_key ;;
    4) setup_gh_token ;;
    q|Q|"") break ;;
    *) say "  Unrecognized choice." ;;
  esac
  show_status
done

say "Done. \`npm run sandcastle:doctor\` runs the full check-up (scopes, issue access)."
