# Use the pinned official Node image by default. Override NODE_IMAGE to use
# an ACR mirror where Docker Hub is unavailable.
ARG NODE_IMAGE=node:22.23.4-slim
ARG UV_IMAGE=agentscope-registry.ap-southeast-1.cr.aliyuncs.com/agentscope/uv:0.13.4

# -----------------------------------------------------------------------------
# Stage 1: build console frontend (dist not committed in repo).
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS console-builder
WORKDIR /app
COPY console /app/console
COPY src/AIARB/plugins/frontend /app/src/AIARB/plugins/frontend
RUN cd /app/console && npm ci --include=dev && npm run build

# Alias for uv binary so COPY --from can reference a build-arg image.
FROM ${UV_IMAGE} AS uv-src

# -----------------------------------------------------------------------------
# Stage 2: runtime image with Python, Chromium, and app.
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE}

ARG AIARB_MANAGED_RUNTIME_BOUNDARY_VERSION
LABEL io.AIARB.managed-runtime-boundary.version=\
${AIARB_MANAGED_RUNTIME_BOUNDARY_VERSION}

# Fail the build when NODE_IMAGE does not match the repository runtime pin.
COPY .nvmrc /tmp/AIARB-node-version
RUN expected_version="v$(tr -d '[:space:]' < /tmp/AIARB-node-version)" \
  && actual_version="$(node --version)" \
  && if [ "${actual_version}" != "${expected_version}" ]; then \
       echo "Node version mismatch: expected ${expected_version}, got ${actual_version}" >&2; \
       exit 1; \
     fi \
  && rm /tmp/AIARB-node-version

# ENV variables
ENV NODE_ENV=production
ENV WORKSPACE_DIR=/app
ENV AIARB_WORKING_DIR=/app/working
ENV AIARB_SECRET_DIR=/app/working.secret
ENV AIARB_BACKUP_DIR=/app/working.backups

# Channel filtering: use AIARB_DISABLED_CHANNELS (exclusion, recommended)
# or AIARB_ENABLED_CHANNELS (whitelist). Override at runtime with -e.
ARG AIARB_DISABLED_CHANNELS="imessage"
ENV AIARB_DISABLED_CHANNELS=${AIARB_DISABLED_CHANNELS}
ARG AIARB_ENABLED_CHANNELS=""
ENV AIARB_ENABLED_CHANNELS=${AIARB_ENABLED_CHANNELS}

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --fix-missing \
    ca-certificates \
    curl  \
    python3  \
    python3-venv \
    build-essential  \
    libssl-dev  \
    git  \
    supervisor  \
    vim  \
    gettext-base \
    xfce4 \
    xfce4-terminal \
    xvfb \
    dbus-x11 \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean


RUN apt-get update && apt-get install -y --fix-missing \
    chromium \
    chromium-sandbox \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libglib2.0-0 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    libu2f-udev \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean


RUN sed -i 's/^CHROMIUM_FLAGS=""/CHROMIUM_FLAGS="--no-sandbox"/' /usr/bin/chromium

# Playwright: use system Chromium (already installed above).
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
# Avoid Playwright downloading its own browser when executable_path is used.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Indicate running in container (used e.g. for Chromium --no-sandbox).
ENV AIARB_RUNNING_IN_CONTAINER=1

WORKDIR ${WORKSPACE_DIR}

# Keep Debian's Python for system services; use the desktop runtime for AIARB.
COPY scripts/pack-tauri/stage_python_runtime.py /tmp/stage_python_runtime.py
RUN python3 /tmp/stage_python_runtime.py \
    --dest /opt/AIARB-python --python-version 3.11 \
  && /opt/AIARB-python/python/bin/python3 -m pip install --upgrade "pip>=26.2.2" \
  && /opt/AIARB-python/python/bin/python3 -m pip install --upgrade "certifi>=2026.10.19" \
  && /opt/AIARB-python/python/bin/python3 -m venv /app/venv \
  && /app/venv/bin/python -m pip install --upgrade "pip>=26.2.2" \
  && /app/venv/bin/python -m pip install --upgrade "certifi>=2026.10.19" \
  && rm /tmp/stage_python_runtime.py
ENV PATH="/app/venv/bin:$PATH"

COPY pyproject.toml setup.py MANIFEST.in README.md ./
COPY scripts/pack ./scripts/pack
COPY plugins/channel ./plugins/channel
COPY src ./src
COPY plugins/hub ./plugins/hub
COPY packages/AIARBmail-mcp/src/AIARBmail_mcp ./packages/AIARBmail-mcp/src/AIARBmail_mcp
COPY website/public/docs/ ./src/AIARB/docs/
# Inject console dist from build stage (repo does not commit dist).
COPY --from=console-builder /app/console/dist/ ./src/AIARB/console/
# Speed up Python package installation with uv.
COPY --from=uv-src /uv /bin/uv
# Validate the binary, including when UV_IMAGE points at an internal mirror.
RUN python -c 'import re, subprocess, sys; \
    output = subprocess.check_output(["/bin/uv", "--version"], text=True); \
    match = re.match(r"uv (\d+)\.(\d+)\.(\d+)(?:\s|$)", output); \
    sys.exit(0 if match and tuple(map(int, match.groups())) >= (0, 13, 4) \
    else "uv >= 0.13.4 is required")'
# Pin setuptools <82: lark-oapi still calls pkg_resources.declare_namespace
# at import time. A *fresh* install of setuptools >= 82 removes pkg_resources
# wholesale, so lark-oapi's except-ImportError fallback (pkgutil.extend_path)
# kicks in and the import works. The proven failure mode is an *in-place*
# upgrade of a legacy setuptools (seen on the macOS CI runners, and possible
# in any environment upgrading an existing install): it can leave a
# half-removed pkg_resources (module present, declare_namespace gone), which
# raises an AttributeError the fallback does not catch — crashing the Feishu
# channel. The pin keeps every environment in the known-good state.
RUN uv pip install --python /app/venv/bin/python --no-cache-dir "setuptools<82" wheel -r scripts/pack/channel-contract-requirements.txt \
    && python scripts/pack/validate_channel_contracts.py \
    && python -c 'import setuptools.build_meta as b; b.build_wheel("/tmp/AIARB-wheel")' \
    && set -- /tmp/AIARB-wheel/*.whl \
    && uv pip install --python /app/venv/bin/python --no-cache-dir "$1[channels]" \
    && rm -rf ./build /tmp/AIARB-wheel


# AIARB app port (default 8088). Override at runtime with -e AIARB_PORT=3000.
ENV AIARB_PORT=8088

COPY deploy/config/supervisord.conf.template /etc/supervisor/conf.d/supervisord.conf.template
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

EXPOSE 8088

CMD ["/entrypoint.sh"]
