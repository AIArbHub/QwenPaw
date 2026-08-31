# -*- coding: utf-8 -*-
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env file from project root before reading any env vars
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


def _get_env(key: str, default: str = "") -> str:
    """Look up an environment variable with a default fallback."""
    return os.environ.get(key, default)


class EnvVarLoader:
    """Utility to load and parse environment variables with type safety
    and defaults.  Pass AIARB_* keys.
    """

    @staticmethod
    def get_bool(env_var: str, default: bool = False) -> bool:
        """Get a boolean environment variable,
        interpreting common truthy values."""
        val = _get_env(env_var, str(default)).lower()
        return val in ("true", "1", "yes")

    @staticmethod
    def get_float(
        env_var: str,
        default: float = 0.0,
        min_value: float | None = None,
        max_value: float | None = None,
        allow_inf: bool = False,
    ) -> float:
        """Get a float environment variable with optional bounds
        and infinity handling."""
        try:
            value = float(_get_env(env_var, str(default)))
            if min_value is not None and value < min_value:
                return min_value
            if max_value is not None and value > max_value:
                return max_value
            if not allow_inf and (
                value == float("inf") or value == float("-inf")
            ):
                return default
            return value
        except (TypeError, ValueError):
            return default

    @staticmethod
    def get_int(
        env_var: str,
        default: int = 0,
        min_value: int | None = None,
        max_value: int | None = None,
    ) -> int:
        """Get an integer environment variable with optional bounds."""
        try:
            value = int(_get_env(env_var, str(default)))
            if min_value is not None and value < min_value:
                return min_value
            if max_value is not None and value > max_value:
                return max_value
            return value
        except (TypeError, ValueError):
            return default

    @staticmethod
    def get_str(env_var: str, default: str = "") -> str:
        """Get a string environment variable with a default fallback."""
        return _get_env(env_var, default)


CUSTOM_AGENT_STARTUP_CONCURRENCY_ENV = (
    "AIARB_CUSTOM_AGENT_STARTUP_CONCURRENCY"
)
DEFAULT_CUSTOM_AGENT_STARTUP_CONCURRENCY = 5
CUSTOM_AGENT_STARTUP_CONCURRENCY = EnvVarLoader.get_int(
    CUSTOM_AGENT_STARTUP_CONCURRENCY_ENV,
    default=DEFAULT_CUSTOM_AGENT_STARTUP_CONCURRENCY,
    min_value=1,
)


# WORKING_DIR priority:
# 1. AIARB_WORKING_DIR env var is set → use it
# 2. Default → ~/.aiarb
_explicit_working_dir = _get_env("AIARB_WORKING_DIR")
if _explicit_working_dir:
    WORKING_DIR = Path(_explicit_working_dir).expanduser().resolve()
else:
    WORKING_DIR = Path("~/.aiarb").expanduser().resolve()
# Load user-level .env (e.g. ~/.aiarb/.env) after WORKING_DIR is resolved.
# Repo root .env was loaded at the top of this module; it takes precedence
# over the user-level file because load_dotenv(..., override=False) keeps
# existing values.
_user_env_path = WORKING_DIR / ".env"
if _user_env_path.exists():
    load_dotenv(_user_env_path)

SECRET_DIR = (
    Path(
        EnvVarLoader.get_str(
            "AIARB_SECRET_DIR",
            f"{WORKING_DIR}.secret",
        ),
    )
    .expanduser()
    .resolve()
)

# Env key for overriding the OS keychain account used for the master key.
KEYRING_ACCOUNT_ENV = "AIARB_KEYRING_ACCOUNT"

PROJECT_NAME = "AIArb"

# Message metadata tags shared across agent middleware and memory managers.
AIARB_MESSAGE_TAG_KEY = "aiarb_tag"
AIARB_CLIENT_MESSAGE_ID_KEY = "aiarb_client_message_id"
SCROLL_MEMORY_MESSAGE_TAG = "scroll_memory"
AUTO_MEMORY_SEARCH_BLOCK_IDS_KEY = "auto_memory_search_block_ids"
EXTERNAL_USER_QUERY_MESSAGE_TAG = "external_user_query"
AUTO_CONTINUE_MESSAGE_TAG = "auto_continue"
LOOP_CONTINUATION_MESSAGE_TAG = "loop_continuation"
RUBRIC_EVALUATION_MESSAGE_TAG = "rubric_evaluation"
# User-role messages the runtime injects to keep a turn going. They are NOT
# new requests: the scroll active-turn anchor (live scan + SQL floor) must
# skip them, or the anchor jumps to the stub and the REAL request becomes
# evictable/searchable again (the #5746 failure mode, loop-session flavor).
SYNTHETIC_USER_MESSAGE_TAGS = frozenset(
    {
        AUTO_CONTINUE_MESSAGE_TAG,
        LOOP_CONTINUATION_MESSAGE_TAG,
        RUBRIC_EVALUATION_MESSAGE_TAG,
    },
)
AUTO_MEMORY_SEARCH_TEXT = (
    "I'll check memory for relevant context before answering."
)
AUTO_MEMORY_SEARCH_THINKING_PREFIX = (
    "I should search long-term memory before answering."
)

# Subdirectory name inside each agent's workspace that holds cloned / imported
# coding projects.
# Full path = <workspace_dir> / CODING_PROJECT_SUBDIR / <name>
CODING_PROJECT_SUBDIR = "coding_projects"


def _resolve_docs_dir() -> Path | None:
    """Find AIArb documentation directory across all install methods."""
    _pkg_docs = Path(__file__).resolve().parent / "docs"
    if _pkg_docs.is_dir() and any(_pkg_docs.glob("*.md")):
        return _pkg_docs
    _src_docs = (
        Path(__file__).resolve().parents[2] / "website" / "public" / "docs"
    )
    if _src_docs.is_dir() and any(_src_docs.glob("*.md")):
        return _src_docs
    return None


DOCS_DIR: Path | None = _resolve_docs_dir()

# Default media directory for channels (cross-platform)
DEFAULT_MEDIA_DIR = WORKING_DIR / "media"

# Default local provider directory
DEFAULT_LOCAL_PROVIDER_DIR = WORKING_DIR / "local_models"

JOBS_FILE = EnvVarLoader.get_str("AIARB_JOBS_FILE", "jobs.json")

CHATS_FILE = EnvVarLoader.get_str("AIARB_CHATS_FILE", "chats.json")


# Builtin Q&A helper profile.  agent_id keeps "AIArb" prefix for existing
# workspaces and agent.json; do not rename.
def _discover_agent_languages() -> frozenset[str]:
    md_root = Path(__file__).resolve().parent / "agents" / "md_files"
    if md_root.is_dir():
        langs = {
            d.name
            for d in md_root.iterdir()
            if d.is_dir()
            and not d.name.startswith(".")
            and any(d.glob("*.md"))
        }
        if langs:
            return frozenset(langs)
    return frozenset({"en", "zh", "ru"})


SUPPORTED_AGENT_LANGUAGES: frozenset[str] = _discover_agent_languages()

BUILTIN_QA_AGENT_ID = "AIArb_QA_Agent_0.2"
BUILTIN_QA_AGENT_NAME = "QA Agent"
# Older releases used a "QwenPaw" prefix for the builtin QA agent before it
# was renamed to the "AIArb" prefix.  Persisted configs from those versions
# still carry the legacy id, so it must be merged away on startup to avoid
# two Q&A agents appearing side by side.
LEGACY_QA_AGENT_ID = "QwenPaw_QA_Agent_0.2"
# Default skills when the builtin QA workspace is first created only.
BUILTIN_QA_AGENT_SKILL_NAMES: tuple[str, ...] = (
    "guidance",
    "QA_source_index",
)

# Builtin arbitration role agents (single agents) seeded on first install.
# These are stable identifiers so the builtin mock-arbitration group chat can
# reference them as members.  They carry only persona/skill files, never a
# user's private memory or workspace files.
BUILTIN_ARBITRATOR_AGENT_ID = "builtin_arbitrator"
BUILTIN_CLAIMANT_AGENT_ID = "builtin_claimant"
BUILTIN_RESPONDENT_AGENT_ID = "builtin_respondent"
BUILTIN_SECRETARY_AGENT_ID = "builtin_secretary"
# Builtin group-chat (host) agent that orchestrates the arbitration roles.
BUILTIN_MOCK_ARBITRATION_AGENT_ID = "host_mock_arbitration"
# Default group label applied to the builtin arbitration agents.
BUILTIN_ARBITRATION_GROUP = "内置仲裁角色"

TOKEN_USAGE_FILE = EnvVarLoader.get_str(
    "AIARB_TOKEN_USAGE_FILE",
    "token_usage.json",
)

CONFIG_FILE = EnvVarLoader.get_str("AIARB_CONFIG_FILE", "config.json")

HEARTBEAT_FILE = EnvVarLoader.get_str("AIARB_HEARTBEAT_FILE", "HEARTBEAT.md")
HEARTBEAT_DEFAULT_EVERY = "6h"
HEARTBEAT_DEFAULT_TARGET = "main"
HEARTBEAT_DEFAULT_TIMEOUT_SECONDS = 300
HEARTBEAT_MAX_TIMEOUT_SECONDS = 3600

# Default execution budget for POST /console/chat/task when the request
# omits ``timeout``. Aligned with Xiaoyi channel task_timeout_ms (1 hour).
DEFAULT_STREAM_TASK_TIMEOUT_SECONDS = 3600
# Parent HTTP wait for spawn_subagent foreground (/console/chat).
DEFAULT_SPAWN_FOREGROUND_TIMEOUT_SECONDS = 600
HEARTBEAT_TARGET_LAST = "last"
HEARTBEAT_TARGET_INBOX = "inbox"

# Debug history file for /dump_history and /load_history commands
DEBUG_HISTORY_FILE = EnvVarLoader.get_str(
    "AIARB_DEBUG_HISTORY_FILE",
    "debug_history.jsonl",
)
MAX_LOAD_HISTORY_COUNT = 10000

# Env key for app log level (used by CLI and app load for reload child).
LOG_LEVEL_ENV = "AIARB_LOG_LEVEL"

# Fixed desktop backend port. When set, get_stable_port() uses this port
# instead of auto-assigning.
AIARB_DESKTOP_PORT = _get_env("AIARB_DESKTOP_PORT")

# Env to indicate running inside a container (e.g. Docker). Set to 1/true/yes.
RUNNING_IN_CONTAINER = EnvVarLoader.get_bool(
    "AIARB_RUNNING_IN_CONTAINER",
    False,
)

# Timeout in seconds for checking if a provider is reachable.
MODEL_PROVIDER_CHECK_TIMEOUT = EnvVarLoader.get_float(
    "AIARB_MODEL_PROVIDER_CHECK_TIMEOUT",
    5.0,
    min_value=0,
    allow_inf=False,
)

# Playwright: use system Chromium when set (e.g. in Docker).
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH_ENV = "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"

# When True, expose /docs, /redoc, /openapi.json
# (dev only; keep False in prod).
DOCS_ENABLED = EnvVarLoader.get_bool("AIARB_OPENAPI_DOCS", False)

# Memory directory
MEMORY_DIR = WORKING_DIR / "memory"

# Backup directory
BACKUP_DIR = (
    Path(
        EnvVarLoader.get_str(
            "AIARB_BACKUP_DIR",
            f"{WORKING_DIR}.backups",
        ),
    )
    .expanduser()
    .resolve()
)


# Plugin directory (installed via `aiarb plugin install`)
PLUGINS_DIR = WORKING_DIR / "plugins"

# Local models directory
MODELS_DIR = WORKING_DIR / "models"

MEMORY_COMPACT_KEEP_RECENT = EnvVarLoader.get_int(
    "AIARB_MEMORY_COMPACT_KEEP_RECENT",
    3,
    min_value=0,
)

# Memory compaction configuration
MEMORY_COMPACT_RATIO = EnvVarLoader.get_float(
    "AIARB_MEMORY_COMPACT_RATIO",
    0.7,
    min_value=0,
    allow_inf=False,
)

# CORS configuration — comma-separated list of allowed origins for dev mode.
# Example: AIARB_CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
# When unset, CORS middleware is not applied.
CORS_ORIGINS = EnvVarLoader.get_str("AIARB_CORS_ORIGINS", "").strip()

# Upload size limit (MB).  None = no limit.
UPLOAD_MAX_SIZE_MB: int | None = (
    int(v)
    if (v := EnvVarLoader.get_str("AIARB_UPLOAD_MAX_SIZE_MB", ""))
    .strip()
    .isdigit()
    else None
)

# LLM API retry configuration
LLM_MAX_RETRIES = EnvVarLoader.get_int(
    "AIARB_LLM_MAX_RETRIES",
    3,
    min_value=0,
)

LLM_BACKOFF_BASE = EnvVarLoader.get_float(
    "AIARB_LLM_BACKOFF_BASE",
    1.0,
    min_value=0.1,
)

LLM_BACKOFF_CAP = EnvVarLoader.get_float(
    "AIARB_LLM_BACKOFF_CAP",
    10.0,
    min_value=0.5,
)

# LLM concurrency control
# Maximum number of concurrent in-flight LLM calls; excess requests wait on
# the semaphore.  Tune to your API quota: start conservatively at 3-5 and
# increase (e.g. OpenAI Tier 1 ~500 QPM allows ~25 at 3 s/call average).
LLM_MAX_CONCURRENT = EnvVarLoader.get_int(
    "AIARB_LLM_MAX_CONCURRENT",
    10,
    min_value=1,
)

# Maximum queries per minute (QPM), enforced via a 60-second sliding window.
# New requests that would exceed this limit will wait before being dispatched
# to the API — proactively preventing 429s rather than reacting to them.
# 0 = unlimited (disabled).
# Examples: Anthropic Tier-1 ≈ 50 QPM; OpenAI Tier-1 ≈ 500 QPM.
LLM_MAX_QPM = EnvVarLoader.get_int(
    "AIARB_LLM_MAX_QPM",
    600,
    min_value=0,
)

# Default global pause duration (seconds) applied to all waiters when a 429
# is received.  Overridden by the API's Retry-After header when present.
LLM_RATE_LIMIT_PAUSE = EnvVarLoader.get_float(
    "AIARB_LLM_RATE_LIMIT_PAUSE",
    5.0,
    min_value=1.0,
)

# Random jitter range (seconds) added on top of the pause remaining time so
# concurrent waiters stagger their wake-up and avoid a new burst.
LLM_RATE_LIMIT_JITTER = EnvVarLoader.get_float(
    "AIARB_LLM_RATE_LIMIT_JITTER",
    1.0,
    min_value=0.0,
)

# Maximum time (seconds) a caller will wait for a semaphore slot before
# giving up with a RuntimeError rather than blocking indefinitely.
LLM_ACQUIRE_TIMEOUT = EnvVarLoader.get_float(
    "AIARB_LLM_ACQUIRE_TIMEOUT",
    300.0,
    min_value=10.0,
)

# Maximum upstream wait (seconds) for the first content-bearing stream chunk.
# Set to 0 to disable the first-content timeout.
LLM_STREAM_FIRST_CONTENT_TIMEOUT = EnvVarLoader.get_float(
    "AIARB_LLM_STREAM_FIRST_CONTENT_TIMEOUT",
    30.0,
    min_value=0.0,
)

# Maximum upstream wait (seconds) between later content-bearing stream chunks.
# Set to 0 to disable the steady-state idle timeout.
LLM_STREAM_IDLE_TIMEOUT = EnvVarLoader.get_float(
    "AIARB_LLM_STREAM_IDLE_TIMEOUT",
    30.0,
    min_value=0.0,
)

# Tool guard approval timeout (seconds).
try:
    TOOL_GUARD_APPROVAL_TIMEOUT_SECONDS = max(
        float(
            _get_env("AIARB_TOOL_GUARD_APPROVAL_TIMEOUT_SECONDS", "300"),
        ),
        1.0,
    )
except (TypeError, ValueError):
    TOOL_GUARD_APPROVAL_TIMEOUT_SECONDS = 300.0


# Tool guard approval heartbeat interval (seconds).
# Sends periodic heartbeat messages during approval wait to keep SSE
# connection alive. Should be less than browser/proxy timeout (30-60s).
try:
    TOOL_GUARD_APPROVAL_HEARTBEAT_INTERVAL = max(
        float(
            _get_env("AIARB_TOOL_GUARD_APPROVAL_HEARTBEAT_INTERVAL", "15"),
        ),
        5.0,
    )
except (TypeError, ValueError):
    TOOL_GUARD_APPROVAL_HEARTBEAT_INTERVAL = 15.0

# TTL for learned model capability cache entries (seconds).
# 0 disables expiry. Stale entries from transient upstream failures
# (e.g. a gateway routing a multimodal model to a text-only backend)
# are discarded after this duration.
try:
    CAPABILITY_CACHE_TTL_SECONDS = max(
        float(
            _get_env("AIARB_CAPABILITY_CACHE_TTL_SECONDS", "1800"),
        ),
        0.0,
    )
except (TypeError, ValueError):
    CAPABILITY_CACHE_TTL_SECONDS = 1800.0

# Marker prepended to every truncation notice.
# Format:
#   <<<TRUNCATED>>>
#   The output above was truncated.
#   The full content is saved to the file and contains Z lines in total.
#   This excerpt starts at line X and covers the next N bytes.
#   If the current content is not enough, call `read_file` with
#   file_path=<path> start_line=Y to read more.
#
# Split output on this marker to recover the original (untruncated) portion:
#   original = output.split(TRUNCATION_NOTICE_MARKER)[0]
TRUNCATION_NOTICE_MARKER = "<<<TRUNCATED>>>"

# Placeholder text used when media blocks are stripped from messages
# because the model does not support multimodal content.
MEDIA_UNSUPPORTED_PLACEHOLDER = (
    "[Media content removed - model does not support this media type]"
)
