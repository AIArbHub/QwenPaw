#!/bin/sh
# Substitute AIARB_PORT in supervisord template and start supervisord.
# Default port 8088; override at runtime with -e AIARB_PORT=3000.
set -e

# Build policy reaches the actual mounted working directory through C6 boot.
# Persisted user choices and uninstall tombstones take precedence there.
export QWENPAW_CHANNEL_PRESET="${QWENPAW_CHANNEL_PRESET:-light}"

is_auth_enabled() {
  flag="${AIARB_AUTH_ENABLED:-}"
  flag="$(printf '%s' "$flag" | tr '[:upper:]' '[:lower:]')"
  # Auth is enabled by default; only disabled when explicitly set to false/0/no
  [ "$flag" != "false" ] && [ "$flag" != "0" ] && [ "$flag" != "no" ]
}

warn_if_auth_off_container_bind() {
  if is_auth_enabled; then
    return
  fi

  cat >&2 <<EOF
============================================================
SECURITY NOTICE: AIArb is running in Docker without authentication.

AIArb cannot verify whether access to the service is limited to a trusted
network. Anyone who can reach the service may access AIArb APIs without login.

Recommended:
  - Restrict access to a trusted network or protected environment.
  - Remove AIARB_AUTH_ENABLED=false or set it to true if untrusted users or
    processes may reach the service.
============================================================
EOF
}

# Auto-initialize if config.json is missing (bind mount with empty directory).
if [ ! -f "${AIARB_WORKING_DIR}/config.json" ]; then
  echo "⚠️  No config.json found in ${AIARB_WORKING_DIR}"
  echo "📦 Running initialization..."
  aiarb init --defaults --accept-security
  echo "✅ Initialization complete!"
else
  echo "✓ Config found in ${AIARB_WORKING_DIR}, skipping initialization."
fi

export AIARB_PORT="${AIARB_PORT:-8088}"
warn_if_auth_off_container_bind
envsubst '${AIARB_PORT}' \
  < /etc/supervisor/conf.d/supervisord.conf.template \
  > /etc/supervisor/conf.d/supervisord.conf
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
