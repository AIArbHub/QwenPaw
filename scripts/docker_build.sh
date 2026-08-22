#!/usr/bin/env bash
# Build Docker image (includes console frontend build in multi-stage).
# Run from repo root: bash scripts/docker_build.sh [IMAGE_TAG] [EXTRA_ARGS...]
# Example: bash scripts/docker_build.sh aiarb:latest
#          bash scripts/docker_build.sh myreg/aiarb:v1 --no-cache
#
# By default the Docker image excludes imessage (macOS-only).
# Override via:
#   AIARB_DISABLED_CHANNELS=imessage,voice bash scripts/docker_build.sh
#   AIARB_ENABLED_CHANNELS=discord,telegram  bash scripts/docker_build.sh
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DOCKERFILE="${DOCKERFILE:-$REPO_ROOT/deploy/Dockerfile}"
TAG="${1:-aiarb:latest}"
shift || true

# Channels to exclude from the image (default: imessage).
DISABLED_CHANNELS="${AIARB_DISABLED_CHANNELS:-imessage}"
AIARB_VERSION=$(sed -n \
    's/^__version__[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    src/aiarb/__version__.py)
if [ -z "$AIARB_VERSION" ]; then
    echo "[docker_build] Failed to read src/aiarb/__version__.py" >&2
    exit 1
fi

echo "[docker_build] Building image: $TAG (Dockerfile: $DOCKERFILE)"
docker build -f "$DOCKERFILE" \
    --build-arg AIARB_DISABLED_CHANNELS="$DISABLED_CHANNELS" \
    --build-arg \
    AIARB_VERSION="$AIARB_VERSION" \
    ${AIARB_ENABLED_CHANNELS:+--build-arg AIARB_ENABLED_CHANNELS="$AIARB_ENABLED_CHANNELS"} \
    -t "$TAG" "$@" .
echo "[docker_build] Done."
echo "[docker_build] AIArb app port: 8088 (default). Override with -e AIARB_PORT=<port>."
echo "[docker_build] Run: docker run -p 127.0.0.1:8088:8088 $TAG"
echo "[docker_build] Or:  docker run -e AIARB_PORT=3000 -p 127.0.0.1:3000:3000 $TAG"
