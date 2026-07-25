# -*- coding: utf-8 -*-
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root before reading any env vars
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


def _get_env(key: str, default: str = "") -> str:
    """Look up an env var with automatic COPAW_ legacy fallback.

    Primary key is always used as-is.  When the primary key starts with
    ``AIARB_``, the corresponding ``COPAW_`` variant is transparently
    checked as a fallback so that existing deployments keep working.
    """
    if key in os.environ:
        return os.environ[key]
    if key.startswith("AIARB_"):
        legacy_key = "COPAW_" + key[len("AIARB_") :]
        if legacy_key in os.environ:
            return os.environ[legacy_key]
    return default


class EnvVarLoader:
    """Utility to load and parse environment variables with type safety
    and defaults.  Pass AIARB_* keys; COPAW_* legacy variants are
    checked automatically as a fallback inside _get_env.
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
# 1. AIARB_WORKING_DIR / AIARB_WORKING_DIR env var → use it
# 2. Default → ~/.aiarb (always create and use .aiarb)
# If legacy ~/.aiarb or ~/.copaw exists → migrate data to ~/.aiarb once
# After migration, rewrite all config paths from legacy roots to ~/.aiarb
_aiarb_default_dir = Path("~/.aiarb").expanduser()
_explicit_working_dir = _get_env("AIARB_WORKING_DIR") or _get_env(
    "AIARB_WORKING_DIR",
)
if _explicit_working_dir:
    WORKING_DIR = Path(_explicit_working_dir).expanduser().resolve()
else:
    _legacy_dirs = [
        d
        for d in (Path("~/.aiarb").expanduser(), Path("~/.copaw").expanduser())
        if d.is_dir()
    ]
    _need_migrate_files = _legacy_dirs and not _aiarb_default_dir.is_dir()
    if _need_migrate_files:
        import shutil

        _aiarb_default_dir.mkdir(parents=True, exist_ok=True)
        for _legacy_dir in _legacy_dirs:
            for _item in _legacy_dir.iterdir():
                _dest = _aiarb_default_dir / _item.name
                if _dest.exists():
                    continue
                try:
                    if _item.is_symlink():
                        continue
                    if _item.is_dir():
                        if _item.resolve() == _dest.resolve():
                            continue
                        shutil.copytree(
                            str(_item),
                            str(_dest),
                            symlinks=False,
                            ignore_dangling_symlinks=True,
                        )
                    else:
                        shutil.copy2(str(_item), str(_dest))
                except Exception as exc:
                    print(f"[WORKING_DIR] Failed to migrate {_item.name}: {exc}")

    _need_rewrite_paths = bool(_legacy_dirs)
    if _need_rewrite_paths:
        import json

        _aiarb_default_dir.mkdir(parents=True, exist_ok=True)
        _new_root = str(_aiarb_default_dir.resolve())
        _legacy_root_strs = []
        for _ld in _legacy_dirs:
            _legacy_root_strs.append(str(_ld.resolve()))
        _legacy_root_strs += [
            "~/.aiarb",
            "~/.copaw",
            str(Path("~/.aiarb").expanduser().resolve()),
            str(Path("~/.copaw").expanduser().resolve()),
        ]

        def _rewrite_legacy_paths(obj):
            if isinstance(obj, dict):
                return {k: _rewrite_legacy_paths(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_rewrite_legacy_paths(v) for v in obj]
            if isinstance(obj, str):
                for _old_root in _legacy_root_strs:
                    if obj.startswith(_old_root):
                        return _new_root + obj[len(_old_root) :]
            return obj

        _main_config = _aiarb_default_dir / "config.json"
        if _main_config.is_file():
            try:
                with open(_main_config, "r", encoding="utf-8") as _f:
                    _cfg_data = json.load(_f)
                _cfg_data = _rewrite_legacy_paths(_cfg_data)
                with open(_main_config, "w", encoding="utf-8") as _f:
                    json.dump(_cfg_data, _f, indent=2, ensure_ascii=False)
            except Exception as exc:
                print(f"[WORKING_DIR] Failed to rewrite config.json: {exc}")

        _workspaces_dir = _aiarb_default_dir / "workspaces"
        if _workspaces_dir.is_dir():
            for _agent_cfg in _workspaces_dir.glob("*/agent.json"):
                try:
                    with open(_agent_cfg, "r", encoding="utf-8") as _f:
                        _acfg = json.load(_f)
                    _acfg = _rewrite_legacy_paths(_acfg)
                    with open(_agent_cfg, "w", encoding="utf-8") as _f:
                        json.dump(_acfg, _f, indent=2, ensure_ascii=False)
                except Exception as exc:
                    print(f"[WORKING_DIR] Failed to rewrite {_agent_cfg}: {exc}")

    WORKING_DIR = _aiarb_default_dir.resolve()

WORKING_DIR.mkdir(parents=True, exist_ok=True)
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

PROJECT_NAME = "AI Arb"

# Message metadata tags shared across agent middleware and memory managers.
AIARB_MESSAGE_TAG_KEY = "aiarb_tag"
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

BUILTIN_QA_AGENT_ID = "AI_Arb_QA_Agent_0.2"
BUILTIN_QA_AGENT_NAME = "QA Agent"
# Default skills when the builtin QA workspace is first created only.
BUILTIN_QA_AGENT_SKILL_NAMES: tuple[str, ...] = (
    "guidance",
    "QA_source_index",
)

# CoPaw-era builtin QA; may remain in config.json — disabled when the current
# ``BUILTIN_QA_AGENT_ID`` profile is first created (see ``migration``), not
# every startup, so users can re-enable this id if they want.
LEGACY_QA_AGENT_ID = "CoPaw_QA_Agent_0.1beta1"

# ─── Builtin arbitration agents ──────────────────────────────────────────────
# These agents are auto-created on first startup and appear pre-installed
# for the user. Each has a bundled persona directory under
# ``aiarb.builtins.<agent_id>`` containing PROFILE.md, SOUL.md, AGENTS.md.
BUILTIN_ARBITRATOR_AGENT_ID = "arbitrator"
BUILTIN_ARBITRATOR_AGENT_NAME = "仲裁员"
BUILTIN_ARBITRATOR_AGENT_DESCRIPTION = (
    "AI Arb，资深商事仲裁员智能体。核心使命是作为人类仲裁员、律师及当事人的"
    "**专业辅助伙伴**，提供基于中国法与英美法比较研究的深度分析、文书辅助、"
    "策略建议与实务解答。"
)

BUILTIN_CLAIMANT_AGENT_ID = "claimant"
BUILTIN_CLAIMANT_AGENT_NAME = "申请人"
BUILTIN_CLAIMANT_AGENT_DESCRIPTION = "仲裁申请人智能体，从申请人立场出发提供法律分析和策略建议。"

BUILTIN_RESPONDENT_AGENT_ID = "respondent"
BUILTIN_RESPONDENT_AGENT_NAME = "被申请人"
BUILTIN_RESPONDENT_AGENT_DESCRIPTION = "仲裁被申请人智能体，从被申请人立场出发提供法律分析和防御策略。"

BUILTIN_CASEMANAGER_AGENT_ID = "casemanager"
BUILTIN_CASEMANAGER_AGENT_NAME = "仲裁秘书"
BUILTIN_CASEMANAGER_AGENT_DESCRIPTION = (
    "商事仲裁机构的仲裁秘书，精通仲裁程序管理、仲裁规则、仲裁法、实体法。"
)

# Ordered list of all builtin arbitration agent specs for initialization.
BUILTIN_ARBITRATION_AGENTS: list[tuple[str, str, str]] = [
    # (agent_id, name, description)
    (BUILTIN_ARBITRATOR_AGENT_ID, BUILTIN_ARBITRATOR_AGENT_NAME, BUILTIN_ARBITRATOR_AGENT_DESCRIPTION),
    (BUILTIN_CLAIMANT_AGENT_ID, BUILTIN_CLAIMANT_AGENT_NAME, BUILTIN_CLAIMANT_AGENT_DESCRIPTION),
    (BUILTIN_RESPONDENT_AGENT_ID, BUILTIN_RESPONDENT_AGENT_NAME, BUILTIN_RESPONDENT_AGENT_DESCRIPTION),
    (BUILTIN_CASEMANAGER_AGENT_ID, BUILTIN_CASEMANAGER_AGENT_NAME, BUILTIN_CASEMANAGER_AGENT_DESCRIPTION),
]

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

# Built-in plugins shipped inside the aiarb package.  These load
# automatically alongside user-installed plugins and cannot be uninstalled.
BUILTIN_PLUGINS_DIR = Path(__file__).resolve().parent / "builtin_plugins"

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