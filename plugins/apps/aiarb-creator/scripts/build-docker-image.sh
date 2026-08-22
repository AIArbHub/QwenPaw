#!/bin/bash
# Build AIARB Creator Docker image.
#
# This script builds a Creator-specific image on top of the official AIARB
# image, dramatically reducing build time by reusing:
#   - Python toolchain and system dependencies
#   - Chromium and Playwright runtime
#   - AIARB host application and console frontend
#
# The Dockerfile handles Creator UI build internally:
#   Stage 1: creator-ui-builder — builds Creator UI SPA (~3-5 min)
#   Final stage: runtime — adds Creator plugin on official AIARB image (~1-2 min)
#
# Total build time: ~5-10 minutes (vs ~15-25 min for full build from scratch)
#
# Usage:
#   ./scripts/build-docker-image.sh [image_name]
#   NO_CACHE=true ./scripts/build-docker-image.sh   # force full rebuild
#
# Examples:
#   ./scripts/build-docker-image.sh                          # AIARB-creator:latest
#   ./scripts/build-docker-image.sh my-registry/creator:v1   # custom name/tag
#
# Build args (optional, via environment):
#   AIARB_BASE_IMAGE                      - Base AIARB image (default: ACR latest)
#   NODE_IMAGE                              - Node build image (default: pinned official)
#   AIARB_DISABLED_CHANNELS               - Channels to disable (default: "imessage")
#   AIARB_ENABLED_CHANNELS                - Channels whitelist (default: empty)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATOR_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CREATOR_DIR}/../../.." && pwd)"

IMAGE_NAME="${1:-AIARB-creator:latest}"

# Optional build args.
AIARB_BASE_IMAGE="${AIARB_BASE_IMAGE:-agentscope-registry.ap-southeast-1.cr.aliyuncs.com/agentscope/AIARB:latest}"
NODE_IMAGE="${NODE_IMAGE:-node:22.23.4-slim}"

# Read version from source for the runtime boundary label.
AIARB_VERSION=""
if [ -f "${REPO_ROOT}/src/AIARB/__version__.py" ]; then
  AIARB_VERSION=$(sed -n 's/^__version__[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    "${REPO_ROOT}/src/AIARB/__version__.py")
fi

echo "=== Building AIARB Creator Docker image ==="
echo "Image: ${IMAGE_NAME}"
echo "Base image: ${AIARB_BASE_IMAGE}"
echo "Repo root: ${REPO_ROOT}"
if [ -n "${AIARB_VERSION}" ]; then
  echo "Version: ${AIARB_VERSION}"
fi
echo ""

# Build Docker image.
echo "🐳 Building Docker image: ${IMAGE_NAME}"

# Collect optional build args.
BUILD_ARGS=(
  "--build-arg" "AIARB_BASE_IMAGE=${AIARB_BASE_IMAGE}"
  "--build-arg" "NODE_IMAGE=${NODE_IMAGE}"
)

if [ -n "${AIARB_VERSION}" ]; then
  BUILD_ARGS+=("--build-arg" "AIARB_MANAGED_RUNTIME_BOUNDARY_VERSION=${AIARB_VERSION}")
fi

if [ -n "${AIARB_DISABLED_CHANNELS:-}" ]; then
  BUILD_ARGS+=("--build-arg" "AIARB_DISABLED_CHANNELS=${AIARB_DISABLED_CHANNELS}")
fi

if [ -n "${AIARB_ENABLED_CHANNELS:-}" ]; then
  BUILD_ARGS+=("--build-arg" "AIARB_ENABLED_CHANNELS=${AIARB_ENABLED_CHANNELS}")
fi

if [ "${NO_CACHE:-}" = "true" ]; then
  BUILD_ARGS+=("--no-cache")
  echo "  (forcing full rebuild with --no-cache)"
fi

docker build \
  "${BUILD_ARGS[@]}" \
  -f "${CREATOR_DIR}/Dockerfile" \
  -t "${IMAGE_NAME}" \
  "${REPO_ROOT}"

echo ""
echo "✅ Docker image built: ${IMAGE_NAME}"
echo ""
echo "Run with:"
echo "  docker run -p 127.0.0.1:8088:8088 ${IMAGE_NAME}"
echo ""
echo "Or with custom port:"
echo "  docker run -p 127.0.0.1:3000:3000 -e AIARB_PORT=3000 ${IMAGE_NAME}"
