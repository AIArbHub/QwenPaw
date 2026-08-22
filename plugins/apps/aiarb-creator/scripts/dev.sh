#!/usr/bin/env bash
# dev.sh — Single entry point for creator plugin development.
#
# Usage:
#   scripts/dev.sh            # watch mode (default): hot-feedback loop.
#                             # Auto-installs first if not installed yet.
#   scripts/dev.sh install    # (re)install once: full build + clean staged
#                             # copy + `aiarb plugin install --force`.
#                             # Needed after plugin.json / requirements.txt
#                             # changes (they affect the registered manifest
#                             # and pip deps, not just synced files).
#
# Watch mode:
#   - frontend: `vite build --watch` rebuilds ui/dist incrementally; changes
#     are synced into the installed copy — hard-refresh the browser.
#   - backend:  *.py changes are synced and hot-reloaded via the plugins
#     install API — fully automatic, no restart.
#
# Environment:
#   AIARB_BIN          aiarb executable (default: aiarb on PATH)
#   AIARB_PYTHON       Python used by AIArb (default: python3 on PATH)
#   AIARB_WORKING_DIR  working dir of the target instance (default ~/.aiarb)
#   AIARB_PORT         API port for backend hot reload (default 8088)
#
# Why stage instead of installing the plugin dir directly? The dir doubles
# as the frontend dev workspace: after a build it contains ui/node_modules
# (~300MB), and AIArb's installer copies everything with no ignore rules,
# blowing past the CLI's 120s hot-install timeout.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AIARB_BIN="${AIARB_BIN:-aiarb}"
AIARB_PYTHON="${AIARB_PYTHON:-python3}"
WORKING_DIR="${AIARB_WORKING_DIR:-$HOME/.aiarb}"
WORKING_DIR="${WORKING_DIR/#\~/$HOME}"

install_plugin() {
  echo "==> Building creator UI..."
  (cd "$PLUGIN_DIR/ui" && npm run build)

  STAGE_DIR="${TMPDIR:-/tmp}/aiarb-creator-staged"
  echo "==> Staging runtime files to $STAGE_DIR ..."
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR/ui"
  cp "$PLUGIN_DIR/plugin.json" "$STAGE_DIR/"
  cp "$PLUGIN_DIR/requirements.txt" "$STAGE_DIR/"
  [ -f "$PLUGIN_DIR/__init__.py" ] && cp "$PLUGIN_DIR/__init__.py" "$STAGE_DIR/"
  rsync -a --exclude '__pycache__' --exclude '*.pyc' \
    "$PLUGIN_DIR/backend/" "$STAGE_DIR/backend/"
  rsync -a "$PLUGIN_DIR/ui/dist/" "$STAGE_DIR/ui/dist/"
  du -sh "$STAGE_DIR" | awk '{print "==> Staged package size: " $1}'

  echo "==> Installing via aiarb plugin install --force ..."
  "$AIARB_BIN" plugin install "$STAGE_DIR" --force
  echo "==> Ensuring Playwright Chromium is installed for motion overlays ..."
  "$AIARB_PYTHON" -m playwright install chromium

  echo "==> Installing GSAP animation runtime for motion overlays ..."
  INSTALLED_PLUGIN="$WORKING_DIR/plugins/aiarb-creator"
  (cd "$INSTALLED_PLUGIN/backend" && "$AIARB_PYTHON" -m services.media_files.motion_engine fetch)

  echo "==> Clearing segment render cache to force fresh motion composition ..."
  rm -rf "${TMPDIR:-/tmp}/aiarb-segment-cache-v1"

  echo "==> Installed. If a console page is already open, hard-refresh it."
}

watch_plugin() {
  if [ ! -d "$WORKING_DIR/plugins/aiarb-creator" ]; then
    echo "==> Plugin not installed yet — installing first ..."
    install_plugin
  else
    # Verify GSAP is available in the installed plugin (motion overlays require it)
    INSTALLED_VENDOR="$WORKING_DIR/plugins/aiarb-creator/backend/services/media_files/vendor"
    if [ ! -f "$INSTALLED_VENDOR/gsap.min.js" ]; then
      echo "==> WARNING: GSAP animation runtime not found in installed plugin."
      echo "==> Motion overlays will fall back to static templates."
      echo "==> Run '$0 install' to install GSAP and clear segment cache."
    fi
  fi

  echo "==> Starting vite build --watch (ui/) ..."
  (cd "$PLUGIN_DIR/ui" && npx vite build --watch) &
  VITE_PID=$!
  trap 'kill "$VITE_PID" 2>/dev/null || true' EXIT

  python3 -u "$PLUGIN_DIR/scripts/dev_watch.py"
}

case "${1:-watch}" in
  install) install_plugin ;;
  watch)   watch_plugin ;;
  *)
    echo "Usage: $0 [install|watch]" >&2
    exit 1
    ;;
esac
