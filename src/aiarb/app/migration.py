# -*- coding: utf-8 -*-
"""Configuration migration utilities for multi-agent support.

Handles migration from legacy single-agent config to new multi-agent structure.
"""
import json
import logging
import shutil
from pathlib import Path

from ..agents.templates import (
    ARBITRATION_ROLE_TEMPLATES,
    ARBITRATOR_TEMPLATE,
    CLAIMANT_TEMPLATE,
    DEFAULT_AGENT_TEMPLATE,
    KB_CURATOR_TEMPLATE,
    QA_AGENT_TEMPLATE,
    RESPONDENT_TEMPLATE,
    SECRETARY_TEMPLATE,
    build_agent_template,
)
from ..config.config import (
    AgentProfileConfig,
    AgentProfileRef,
    AgentsConfig,
    AgentsLLMRoutingConfig,
    AgentsRunningConfig,
    ChannelConfig,
    HeartbeatConfig,
    MCPConfig,
    ToolsConfig,
    build_arbitration_tools_config,
    load_agent_config,
    save_agent_config,
)
from ..exceptions import AppBaseException
from ..constant import (
    BUILTIN_ARBITRATION_GROUP,
    BUILTIN_ARBITRATOR_AGENT_ID,
    BUILTIN_CLAIMANT_AGENT_ID,
    BUILTIN_KB_CURATOR_AGENT_ID,
    BUILTIN_MOCK_ARBITRATION_AGENT_ID,
    BUILTIN_QA_AGENT_ID,
    BUILTIN_RESPONDENT_AGENT_ID,
    BUILTIN_SECRETARY_AGENT_ID,
    LEGACY_QA_AGENT_ID,
    WORKING_DIR,
)
from ..config.utils import load_config, mutate_config, save_config

logger = logging.getLogger(__name__)

_DEFAULT_AGENT_NAME = "Default Agent"
_DEFAULT_AGENT_DESCRIPTION = "Default AIArb agent"

# Workspace items to migrate: (name, is_directory)
_WORKSPACE_ITEMS_TO_MIGRATE = [
    # Directories
    ("sessions", True),
    ("memory", True),
    ("active_skills", True),
    ("customized_skills", True),
    # Files
    ("chats.json", False),
    ("jobs.json", False),
    ("feishu_receive_ids.json", False),
    ("dingtalk_session_webhooks.json", False),
]

_WORKSPACE_JSON_DEFAULTS: list[tuple[str, dict]] = [
    ("chats.json", {"version": 1, "chats": []}),
    ("jobs.json", {"version": 1, "jobs": []}),
]


def migrate_legacy_workspace_to_default_agent() -> bool:
    # pylint: disable=too-many-statements
    """Migrate legacy single-agent workspace to default agent workspace.

    This function:
    1. Checks if migration is needed
    2. Creates default agent workspace
    3. Migrates legacy workspace files and directories
    4. Creates agent.json with legacy configuration
    5. Updates root config.json to new structure

    Returns:
        bool: True if migration was performed, False if already migrated
    """
    try:
        return _do_migrate_legacy_workspace()
    except Exception as e:
        logger.error(
            f"Legacy workspace migration failed: {e}. "
            "Please check your configuration. If you have custom skills, "
            "verify that all SKILL.md files have valid YAML frontmatter.",
            exc_info=True,
        )
        return False


def _do_migrate_legacy_workspace() -> bool:
    """Internal implementation of legacy workspace migration."""
    try:
        config = load_config()
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return False

    # Check if already migrated
    # Skip if:
    # 1. Multiple agents already exist (multi-agent config), OR
    # 2. Default agent has agent.json (already migrated)
    if len(config.agents.profiles) > 1:
        logger.debug(
            f"Multi-agent config already exists "
            f"({len(config.agents.profiles)} agents), skipping migration",
        )
        return False

    if "default" in config.agents.profiles:
        agent_ref = config.agents.profiles["default"]
        if isinstance(agent_ref, AgentProfileRef):
            workspace_dir = Path(agent_ref.workspace_dir).expanduser()
            agent_config_path = workspace_dir / "agent.json"
            if agent_config_path.exists():
                logger.debug(
                    "Default agent already migrated, skipping migration",
                )
                return False

    logger.info("=" * 60)
    logger.info("Migrating legacy config to multi-agent structure...")
    logger.info("=" * 60)

    # Extract legacy agent configuration
    legacy_agents = config.agents

    # Create default agent workspace
    default_workspace = Path(f"{WORKING_DIR}/workspaces/default").expanduser()
    default_workspace.mkdir(parents=True, exist_ok=True)
    logger.info(f"Created default agent workspace: {default_workspace}")

    # Build default agent configuration from legacy settings
    default_agent_config = AgentProfileConfig(
        id="default",
        name="Default Agent",
        description="Default AIArb agent (migrated from legacy config)",
        workspace_dir=str(default_workspace),
        channels=config.channels if hasattr(config, "channels") else None,
        mcp=config.mcp if hasattr(config, "mcp") else None,
        heartbeat=(
            legacy_agents.defaults.heartbeat
            if hasattr(legacy_agents, "defaults") and legacy_agents.defaults
            else None
        ),
        running=(
            legacy_agents.running
            if hasattr(legacy_agents, "running") and legacy_agents.running
            else AgentsRunningConfig()
        ),
        llm_routing=(
            legacy_agents.llm_routing
            if hasattr(legacy_agents, "llm_routing")
            and legacy_agents.llm_routing
            else AgentsLLMRoutingConfig()
        ),
        system_prompt_files=(
            legacy_agents.system_prompt_files
            if hasattr(legacy_agents, "system_prompt_files")
            and legacy_agents.system_prompt_files
            else ["AGENTS.md", "SOUL.md", "PROFILE.md"]
        ),
        tools=config.tools if hasattr(config, "tools") else None,
        security=config.security if hasattr(config, "security") else None,
    )

    # Save default agent configuration to workspace/agent.json
    # Use atomic write to prevent corruption
    agent_config_path = default_workspace / "agent.json"
    agent_config_tmp = default_workspace / "agent.json.tmp"

    try:
        with open(agent_config_tmp, "w", encoding="utf-8") as f:
            json.dump(
                default_agent_config.model_dump(exclude_none=True),
                f,
                ensure_ascii=False,
                indent=2,
            )
        # Atomic rename (safer than direct write)
        agent_config_tmp.replace(agent_config_path)
        logger.info(f"Created agent config: {agent_config_path}")
    except Exception as e:
        logger.error(f"Failed to save agent config: {e}")
        # Clean up temp file if it exists
        if agent_config_tmp.exists():
            agent_config_tmp.unlink()
        raise

    migrated_items = []

    for source_dir in [Path(WORKING_DIR).expanduser()]:
        _migrate_workspace_items_from_source(
            source_dir,
            default_workspace,
            migrated_items,
        )

    if migrated_items:
        logger.info(f"Migrated workspace items: {', '.join(migrated_items)}")

    # Update root config.json to new structure
    # CRITICAL: Preserve legacy agent fields in root config for downgrade
    # compatibility. Old versions expect these fields to have valid values.
    config.agents = AgentsConfig(
        active_agent="default",
        profiles={
            "default": AgentProfileRef(
                id="default",
                workspace_dir=str(default_workspace),
            ),
        },
        # Preserve legacy fields with values from migrated agent config
        running=default_agent_config.running,
        llm_routing=default_agent_config.llm_routing,
        language=default_agent_config.language,
        system_prompt_files=default_agent_config.system_prompt_files,
    )

    # IMPORTANT: Keep original config fields in root config.json for
    # backward compatibility. If user downgrades, old version can still
    # use these fields. New version will prioritize agent.json.
    # DO NOT clear: channels, mcp, tools, security fields

    save_config(config)
    logger.info(
        "Updated root config.json to multi-agent structure "
        "(kept original fields for backward compatibility)",
    )

    logger.info("=" * 60)
    logger.info("Migration completed successfully!")
    logger.info(f"  Default agent workspace: {default_workspace}")
    logger.info(f"  Default agent config: {agent_config_path}")
    logger.info("=" * 60)

    return True


def _migrate_workspace_item(
    old_path: Path,
    new_path: Path,
    item_name: str,
    migrated_items: list,
) -> None:
    """Migrate a single workspace item (file or directory).

    Args:
        old_path: Source path
        new_path: Destination path
        item_name: Name for logging
        migrated_items: List to append migrated item names
    """
    if not old_path.exists():
        return

    if new_path.exists():
        logger.debug(f"Skipping {item_name} (already exists in new location)")
        return

    try:
        if old_path.is_dir():
            shutil.copytree(old_path, new_path)
        else:
            new_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(old_path, new_path)

        migrated_items.append(item_name)
        logger.debug(f"Migrated {item_name}")
    except Exception as e:
        logger.warning(f"Failed to migrate {item_name}: {e}")


def _migrate_workspace_items_from_source(
    source_dir: Path,
    target_dir: Path,
    migrated_items: list,
) -> None:
    """Migrate all workspace items from a single source directory.

    Args:
        source_dir: Source directory (e.g., ~/.aiarb or WORKING_DIR)
        target_dir: Target directory (e.g., workspaces/default/)
        migrated_items: List to append migrated item names
    """
    for item_name, _ in _WORKSPACE_ITEMS_TO_MIGRATE:
        _migrate_workspace_item(
            source_dir / item_name,
            target_dir / item_name,
            item_name,
            migrated_items,
        )

    # Migrate all .md files
    if source_dir.exists():
        for md_file in sorted(source_dir.glob("*.md")):
            _migrate_workspace_item(
                md_file,
                target_dir / md_file.name,
                md_file.name,
                migrated_items,
            )


# pylint: disable=too-many-branches,too-many-statements
def migrate_legacy_skills_to_skill_pool() -> bool:
    """Migrate legacy skill layouts into workspace skills/ directories.

    Legacy layout had two flat directories per workspace:
    - ``active_skills/``  — skills the agent was actually using
    - ``customized_skills/`` — user-created or edited skills (may overlap)

    New layout uses ``<workspace>/skills/`` (unified).

    Migration rules:
    1. Legacy ``active_skills`` are copied to ``skills/`` and marked
       enabled.
    2. Legacy ``customized_skills`` are copied to ``skills/`` and marked
       enabled only if the same name also appears in ``active_skills``
       with identical content. Otherwise they remain disabled.
    3. When both directories contain the same name with different
       content, both are preserved with suffixes: ``<name>-customize``
       (disabled) and ``<name>-active`` (enabled).
    4. Channels default to ``["all"]`` when metadata is absent.

    The migration is idempotent and non-destructive: existing new-layout
    skills are never overwritten; ``_copy_if_missing`` skips targets that
    already exist on disk.

    Users can manually upload workspace skills to the shared pool later
    via the UI.

    Returns:
        bool: True if skills were migrated, False otherwise.
    """
    try:
        return _do_migrate_legacy_skills()
    except Exception as e:
        logger.error(
            f"Legacy skill migration failed: {e}. "
            "This may be due to malformed YAML in custom SKILL.md files. "
            "Please check your skills and fix any YAML syntax errors.",
            exc_info=True,
        )
        return False


def _do_migrate_legacy_skills() -> bool:
    """Internal implementation of legacy skills migration."""
    from datetime import datetime, timezone

    from ..agents.skill_system import ensure_skill_pool_initialized
    from ..agents.skill_system.registry import reconcile_workspace_manifest
    from ..agents.skill_system.store import (
        copy_skill_dir,
        default_workspace_manifest,
        get_pool_skill_manifest_path,
        get_workspace_skill_manifest_path,
        get_workspace_skills_dir,
        mutate_json,
    )

    import hashlib

    _ignored = {
        "__pycache__",
        "__MACOSX",
        ".DS_Store",
        "Thumbs.db",
        "desktop.ini",
    }

    def _build_signature(skill_dir: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(p for p in skill_dir.rglob("*") if p.is_file()):
            if _ignored & set(path.relative_to(skill_dir).parts):
                continue
            digest.update(str(path.relative_to(skill_dir)).encode("utf-8"))
            digest.update(path.read_bytes())
        return digest.hexdigest()

    # --- Phase 0: Check if migration already completed ---
    # If skill pool manifest exists, migration has been done
    pool_manifest = get_pool_skill_manifest_path()
    if pool_manifest.exists():
        return False

    def _has_legacy_skill_root(root: Path) -> bool:
        return any(
            (root / name).exists()
            for name in ("active_skills", "customized_skills")
        )

    def _discover_skill_dirs(root: Path) -> dict[str, Path]:
        if not root.exists() or not root.is_dir():
            return {}
        return {
            path.name: path
            for path in sorted(root.iterdir())
            if path.is_dir() and (path / "SKILL.md").exists()
        }

    def _register_workspace(
        workspace_dir: Path,
        workspaces: list[Path],
        seen: set[str],
    ) -> None:
        text = str(workspace_dir.expanduser())
        if text in seen:
            return
        seen.add(text)
        workspaces.append(Path(text))

    def _copy_if_missing(source_dir: Path, target_dir: Path) -> bool:
        if target_dir.exists():
            try:
                if _build_signature(source_dir) == _build_signature(
                    target_dir,
                ):
                    return False
            except Exception:
                pass
            logger.debug(
                (
                    "Skipping legacy skill copy from %s to %s "
                    "because target exists"
                ),
                source_dir,
                target_dir,
            )
            return False
        copy_skill_dir(source_dir, target_dir)
        return True

    # --- Phase 1: Initialize pool ---
    try:
        ensure_skill_pool_initialized()
    except Exception as e:
        logger.warning(
            "Failed to initialize skill pool before migration: %s",
            e,
        )
        return False

    try:
        config = load_config()
    except Exception as e:
        logger.warning("Failed to load config for skill migration: %s", e)
        return False

    default_workspace = Path(
        f"{WORKING_DIR}/workspaces/default",
    ).expanduser()
    default_workspace.mkdir(parents=True, exist_ok=True)

    # --- Phase 1: Discover workspaces ---
    workspace_dirs: list[Path] = []
    seen_workspaces: set[str] = set()
    for profile in config.agents.profiles.values():
        _register_workspace(
            Path(profile.workspace_dir).expanduser(),
            workspace_dirs,
            seen_workspaces,
        )

    workspaces_root = Path(WORKING_DIR) / "workspaces"
    if workspaces_root.exists():
        for workspace_dir in sorted(workspaces_root.iterdir()):
            if workspace_dir.is_dir():
                _register_workspace(
                    workspace_dir.expanduser(),
                    workspace_dirs,
                    seen_workspaces,
                )

    _register_workspace(default_workspace, workspace_dirs, seen_workspaces)

    # --- Phase 2: Build migration sources ---
    migration_sources: list[tuple[Path, Path, str]] = []
    seen_sources: set[tuple[str, str, str]] = set()

    # Track which workspaces already have skills
    workspaces_with_existing_skills: set[str] = set()

    for workspace_dir in workspace_dirs:
        key = (str(workspace_dir), str(workspace_dir), "workspace")
        if key not in seen_sources:
            seen_sources.add(key)
            migration_sources.append(
                (workspace_dir, workspace_dir, "workspace"),
            )
            # Check if workspace already has skills
            ws_skills_dir = get_workspace_skills_dir(workspace_dir)
            if ws_skills_dir.exists() and any(
                p.is_dir() and (p / "SKILL.md").exists()
                for p in ws_skills_dir.iterdir()
            ):
                workspaces_with_existing_skills.add(str(workspace_dir))

    legacy_root = Path(WORKING_DIR).expanduser()
    if (
        legacy_root != default_workspace
        and _has_legacy_skill_root(legacy_root)
        and not _has_legacy_skill_root(default_workspace)
        and str(default_workspace) not in workspaces_with_existing_skills
    ):
        key = (str(legacy_root), str(default_workspace), "legacy_root")
        if key not in seen_sources:
            seen_sources.add(key)
            migration_sources.append(
                (legacy_root, default_workspace, "legacy_root"),
            )

    workspace_active_names: dict[Path, set[str]] = {}
    copied_workspace_skills = 0

    # --- Phase 3: Copy legacy skills into workspace skills/ dir ---
    for source_root, target_workspace, source_kind in migration_sources:
        workspace_skills_dir = get_workspace_skills_dir(target_workspace)
        workspace_skills_dir.mkdir(parents=True, exist_ok=True)

        customized = _discover_skill_dirs(source_root / "customized_skills")
        active = _discover_skill_dirs(source_root / "active_skills")

        if not customized and not active:
            continue

        logger.debug(
            "Found legacy skills in %s (%s): %d customized, %d active",
            source_root,
            source_kind,
            len(customized),
            len(active),
        )

        active_names = workspace_active_names.setdefault(
            target_workspace,
            set(),
        )

        # Intra-workspace conflict: when active/ and customized/ both
        # contain a skill with the same directory name but different file
        # content, we suffix *both* copies ("-customize" and "-active")
        # to avoid silently discarding either version.
        same_name_diff_content: set[str] = set()
        for skill_name in set(customized.keys()) & set(active.keys()):
            custom_sig = _build_signature(customized[skill_name])
            active_sig = _build_signature(active[skill_name])
            if custom_sig != active_sig:
                same_name_diff_content.add(skill_name)

        # Process customized skills
        for skill_name, skill_dir in customized.items():
            if skill_name in same_name_diff_content:
                # Same name but different content: add "-customize" suffix
                target_name = f"{skill_name}-customize"
                if _copy_if_missing(
                    skill_dir,
                    workspace_skills_dir / target_name,
                ):
                    copied_workspace_skills += 1
                # NOT added to active_names, so will be disabled
            else:
                # Normal case: copy without suffix
                if _copy_if_missing(
                    skill_dir,
                    workspace_skills_dir / skill_name,
                ):
                    copied_workspace_skills += 1
                # If also in active with same content, mark as enabled
                if skill_name in active:
                    active_names.add(skill_name)

        # Process active skills
        for skill_name, skill_dir in active.items():
            if skill_name in same_name_diff_content:
                # Same name but different content: add "-active" suffix
                target_name = f"{skill_name}-active"
                if _copy_if_missing(
                    skill_dir,
                    workspace_skills_dir / target_name,
                ):
                    copied_workspace_skills += 1
                active_names.add(target_name)  # Mark as enabled
            elif skill_name not in customized:
                # Different name: copy without suffix
                if _copy_if_missing(
                    skill_dir,
                    workspace_skills_dir / skill_name,
                ):
                    copied_workspace_skills += 1
                active_names.add(skill_name)  # Mark as enabled
            # else: already handled in customized loop

    # --- Phase 4: Reconcile workspace manifests ---
    for workspace_dir in workspace_dirs:
        # reconcile discovers on-disk skills and populates skill.json
        # with correct source, metadata, and signature.
        reconcile_workspace_manifest(workspace_dir)
        active_names = workspace_active_names.get(workspace_dir, set())

        if not active_names:
            continue

        def _update(
            payload: dict,
            active_names: set[str] = active_names,
        ) -> int:
            payload.setdefault("skills", {})
            changed = 0
            for skill_name in sorted(active_names):
                entry = payload["skills"].get(skill_name)
                if entry is None:
                    continue
                if not entry.get("enabled", False):
                    entry["enabled"] = True
                    entry["updated_at"] = (
                        datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z")
                    )
                    changed += 1
            return changed

        mutate_json(
            get_workspace_skill_manifest_path(workspace_dir),
            default_workspace_manifest(),
            _update,
        )

    if copied_workspace_skills > 0:
        logger.info(
            "Legacy skill migration completed: %d workspace copies",
            copied_workspace_skills,
        )

    return copied_workspace_skills > 0


def _ensure_workspace_json_files(
    workspace_dir: Path,
    label: str = "",
) -> None:
    for filename, default in _WORKSPACE_JSON_DEFAULTS:
        filepath = workspace_dir / filename
        if not filepath.exists():
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(default, f, ensure_ascii=False, indent=2)
            if label:
                logger.debug("Created %s for %s", filename, label)


def ensure_default_agent_exists() -> None:
    """Ensure that the default agent exists in config.

    This function is called on startup to verify the default agent
    is properly configured. If not, it will be created.
    Also ensures necessary workspace files exist (chats.json, jobs.json).
    """
    try:
        _do_ensure_default_agent()
    except Exception as e:
        logger.error(
            f"Failed to ensure default agent exists: {e}. "
            "Application may not work correctly.",
            exc_info=True,
        )


def _do_ensure_default_agent() -> None:
    """Internal implementation of default agent initialization."""
    config = load_config()

    # Get or determine default workspace path
    if "default" in config.agents.profiles:
        agent_ref = config.agents.profiles["default"]
        default_workspace = Path(agent_ref.workspace_dir).expanduser()
        agent_existed = True
    else:
        default_workspace = Path(
            f"{WORKING_DIR}/workspaces/default",
        ).expanduser()
        agent_existed = False

    # Ensure workspace directory exists
    default_workspace.mkdir(parents=True, exist_ok=True)

    _ensure_workspace_json_files(default_workspace, "default agent")

    # Only update config if agent didn't exist
    if not agent_existed:
        logger.info("Creating default agent...")
        template_result = build_agent_template(
            DEFAULT_AGENT_TEMPLATE,
            name=_DEFAULT_AGENT_NAME,
            agent_id="default",
            workspace_dir=default_workspace,
            fallback_language=config.agents.language or "zh",
            description=_DEFAULT_AGENT_DESCRIPTION,
        )

        # Add default agent reference to config
        config.agents.profiles["default"] = AgentProfileRef(
            id="default",
            workspace_dir=str(default_workspace),
        )

        # Set as active if no active agent
        if not config.agents.active_agent:
            config.agents.active_agent = "default"

        save_config(config)
        save_agent_config("default", template_result.agent_config)
        logger.info(
            f"Created default agent with workspace: {default_workspace}",
        )


def _other_agent_owns_workspace(
    profiles: dict[str, AgentProfileRef],
    workspace: Path,
    builtin_id: str,
) -> str | None:
    """If another profile's workspace resolves to ``workspace``, return its id.

    Prevents creating the builtin QA profile on the canonical path
    ``workspaces/<builtin_id>/`` when a user already assigned that directory
    to a different agent: ``save_agent_config`` would overwrite their
    ``agent.json``.
    """
    try:
        target = workspace.resolve()
    except OSError:
        target = workspace.expanduser()
    for aid, ref in profiles.items():
        if aid == builtin_id:
            continue
        other = Path(ref.workspace_dir).expanduser()
        try:
            other_res = other.resolve()
        except OSError:
            other_res = other
        if other_res == target:
            return aid
    return None


def ensure_qa_agent_exists() -> None:
    """Ensure the builtin QA agent profile and workspace exist.

    On **first creation** only, ``skills/`` is seeded from
    ``BUILTIN_QA_AGENT_SKILL_NAMES`` (e.g. ``guidance``,
    ``aiarb_source_index``), and built-in tools are restricted (see
    ``build_qa_agent_tools_config``).
    After that, the user may change skills and tools freely; we do not
    overwrite their choices on later startups.

    If the canonical QA workspace path is already used by another agent id,
    builtin creation is **skipped** (with a warning) so that workspace's
    ``agent.json`` is not overwritten.

    Note:
        This function catches all exceptions internally and never raises.
        Errors are logged for graceful degradation.
    """
    try:
        _do_ensure_qa_agent()
    except Exception as e:
        logger.error(
            f"Failed to ensure QA agent exists: {e}. "
            "QA agent will not be available.",
            exc_info=True,
        )


def _merge_legacy_qa_agent(config) -> bool:
    """Merge the legacy ``QwenPaw_QA_Agent_0.2`` profile into the canonical id.

    Older releases persisted the builtin QA agent under a ``QwenPaw`` prefix.
    ``ensure_qa_agent_exists`` keys off the canonical ``AIArb`` id, so a config
    that still carries the legacy id ends up with *two* Q&A agents after a
    restart.  This reconciles them:

    - If only the legacy id exists, rename it to the canonical id (keeping its
      workspace and ``agent.json`` id in sync).
    - If both exist, drop the legacy duplicate and keep the canonical one.

    Returns True when the config was mutated and should be saved.
    """
    if LEGACY_QA_AGENT_ID not in config.agents.profiles:
        return False

    canonical_id = BUILTIN_QA_AGENT_ID
    legacy_ref = config.agents.profiles[LEGACY_QA_AGENT_ID]

    if canonical_id in config.agents.profiles:
        config.agents.profiles.pop(LEGACY_QA_AGENT_ID, None)
        config.agents.agent_order = [
            i for i in config.agents.agent_order if i != LEGACY_QA_AGENT_ID
        ]
        logger.warning(
            "Removed duplicate legacy QA profile %r (canonical %r already "
            "exists)",
            LEGACY_QA_AGENT_ID,
            canonical_id,
        )
        return True

    # Only the legacy id exists: promote it to the canonical id.
    config.agents.profiles.pop(LEGACY_QA_AGENT_ID, None)
    legacy_ref.id = canonical_id
    config.agents.profiles[canonical_id] = legacy_ref
    config.agents.agent_order = [
        canonical_id if i == LEGACY_QA_AGENT_ID else i
        for i in config.agents.agent_order
    ]
    workspace_dir = Path(legacy_ref.workspace_dir).expanduser()
    agent_json = workspace_dir / "agent.json"
    try:
        if agent_json.is_file():
            data = json.loads(agent_json.read_text(encoding="utf-8"))
            data["id"] = canonical_id
            with open(agent_json, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
    except Exception:
        logger.warning(
            "Failed to rewrite legacy QA agent.json id to %r",
            canonical_id,
            exc_info=True,
        )
    logger.info(
        "Promoted legacy QA profile %r -> %r",
        LEGACY_QA_AGENT_ID,
        canonical_id,
    )
    return True


def _do_ensure_qa_agent() -> None:
    """Internal implementation of QA agent initialization."""
    from .routers.agents import _initialize_agent_workspace

    config = load_config()
    if _merge_legacy_qa_agent(config):
        save_config(config)
    qa_id = BUILTIN_QA_AGENT_ID

    if qa_id in config.agents.profiles:
        agent_ref = config.agents.profiles[qa_id]
        qa_workspace = Path(agent_ref.workspace_dir).expanduser()
        agent_existed = True
    else:
        qa_workspace = Path(
            f"{WORKING_DIR}/workspaces/{qa_id}",
        ).expanduser()
        agent_existed = False

    qa_workspace.mkdir(parents=True, exist_ok=True)

    _ensure_workspace_json_files(qa_workspace, "QA agent")

    if agent_existed:
        return

    other_id = _other_agent_owns_workspace(
        config.agents.profiles,
        qa_workspace,
        qa_id,
    )
    if other_id is not None:
        logger.warning(
            "Skipping builtin QA profile %r: workspace %s is already "
            "used by agent %r. Point that agent to another directory "
            "or remove it from config before the builtin QA slot can "
            "be created.",
            qa_id,
            qa_workspace,
            other_id,
        )
        return

    logger.info("Creating builtin QA agent...")
    template_result = build_agent_template(
        QA_AGENT_TEMPLATE,
        agent_id=qa_id,
        workspace_dir=qa_workspace,
        fallback_language=config.agents.language or "zh",
    )

    _initialize_agent_workspace(
        qa_workspace,
        skill_names=list(template_result.initial_skill_names),
        md_template_id=template_result.md_template_id,
    )

    config.agents.profiles[qa_id] = AgentProfileRef(
        id=qa_id,
        workspace_dir=str(qa_workspace),
    )
    save_config(config)
    save_agent_config(qa_id, template_result.agent_config)
    logger.info(
        "Created builtin QA agent with workspace: %s",
        qa_workspace,
    )


def ensure_kb_curator_agent_exists() -> None:
    """Ensure the builtin knowledge-base curator agent profile exists.

    The curator is a fixed, protected agent: users cannot create a profile
    with its id (reserved), and the agent cannot be deleted or disabled.
    On **first creation** only, skills are seeded and tools are restricted to
    the curation set (see ``build_kb_curator_tools_config``).  Later startups
    leave existing profiles and workspaces untouched.
    """
    try:
        _do_ensure_kb_curator_agent()
    except Exception as e:
        logger.error(
            f"Failed to ensure KB curator agent exists: {e}. "
            "KB curator agent will not be available.",
            exc_info=True,
        )


def _do_ensure_kb_curator_agent() -> None:
    """Internal implementation of KB curator agent initialization."""
    from .routers.agents import _initialize_agent_workspace

    config = load_config()
    curator_id = BUILTIN_KB_CURATOR_AGENT_ID

    if curator_id in config.agents.profiles:
        agent_ref = config.agents.profiles[curator_id]
        curator_workspace = Path(agent_ref.workspace_dir).expanduser()
        agent_existed = True
    else:
        curator_workspace = Path(
            f"{WORKING_DIR}/workspaces/{curator_id}",
        ).expanduser()
        agent_existed = False

    curator_workspace.mkdir(parents=True, exist_ok=True)

    _ensure_workspace_json_files(curator_workspace, "KB curator agent")

    if agent_existed:
        return

    other_id = _other_agent_owns_workspace(
        config.agents.profiles,
        curator_workspace,
        curator_id,
    )
    if other_id is not None:
        logger.warning(
            "Skipping builtin KB curator profile %r: workspace %s is already "
            "used by agent %r. Point that agent to another directory "
            "or remove it from config before the builtin curator slot can "
            "be created.",
            curator_id,
            curator_workspace,
            other_id,
        )
        return

    logger.info("Creating builtin KB curator agent...")
    template_result = build_agent_template(
        KB_CURATOR_TEMPLATE,
        agent_id=curator_id,
        workspace_dir=curator_workspace,
        fallback_language=config.agents.language or "zh",
    )

    _initialize_agent_workspace(
        curator_workspace,
        skill_names=list(template_result.initial_skill_names),
        md_template_id=template_result.md_template_id,
    )

    config.agents.profiles[curator_id] = AgentProfileRef(
        id=curator_id,
        workspace_dir=str(curator_workspace),
    )
    save_config(config)
    save_agent_config(curator_id, template_result.agent_config)
    logger.info(
        "Created builtin KB curator agent with workspace: %s",
        curator_workspace,
    )


_BUILTIN_ARBITRATION_ROLE_AGENTS: tuple[tuple[str, str], ...] = (
    (ARBITRATOR_TEMPLATE, BUILTIN_ARBITRATOR_AGENT_ID),
    (CLAIMANT_TEMPLATE, BUILTIN_CLAIMANT_AGENT_ID),
    (RESPONDENT_TEMPLATE, BUILTIN_RESPONDENT_AGENT_ID),
    (SECRETARY_TEMPLATE, BUILTIN_SECRETARY_AGENT_ID),
)

_MOCK_ARBITRATION_NAME = "模拟仲裁智能体"
_MOCK_ARBITRATION_MODE = "round_robin"

# Shared-KB tools the arbitration SOUL.md / kb_arbitration skill expects but
# the local-agent preset (used to seed the mock-arbitration host) omits.
_ARBITRATION_ADDITIONAL_TOOL_NAMES = frozenset(
    {"search_knowledge", "grep_search", "glob_search", "view_image"}
)

# Host + the four role agents all need the arbitration tool preset.
_ARBITRATION_PRESET_AGENT_IDS = tuple(
    agent_id for _, agent_id in _BUILTIN_ARBITRATION_ROLE_AGENTS
) + (BUILTIN_MOCK_ARBITRATION_AGENT_ID,)


def migrate_existing_arbitration_tools() -> list[str]:
    """One-time, idempotent migration for existing builtin arbitration agents.

    Additively enables the shared-KB search tools (``search_knowledge`` /
    ``grep_search`` / ``glob_search`` / ``view_image``) on every builtin
    arbitration agent (仲裁员/申请人/被申请人/仲裁秘书 + 模拟仲裁智能体 host)
    so their actual toolset matches the ``search_knowledge`` instruction in
    their SOUL.md / kb_arbitration skill.  Never disables anything, so any
    user tool customisation on these agents is preserved.

    Returns the list of agent ids that were actually updated.
    """
    config = load_config()
    profiles = config.agents.profiles
    updated: list[str] = []

    for agent_id in _ARBITRATION_PRESET_AGENT_IDS:
        if agent_id not in profiles:
            continue
        try:
            agent_cfg = load_agent_config(agent_id)
        except AppBaseException:
            logger.warning(
                "Skipping arbitration tool migration for %r: config not "
                "available.",
                agent_id,
            )
            continue

        tools = agent_cfg.tools or ToolsConfig()
        builtin_tools = tools.builtin_tools
        changed = False
        for name in _ARBITRATION_ADDITIONAL_TOOL_NAMES:
            tool_cfg = builtin_tools.get(name)
            if tool_cfg is None:
                logger.debug(
                    "Tool %r missing from %r builtin_tools; skipping.",
                    name,
                    agent_id,
                )
                continue
            if not tool_cfg.enabled:
                tool_cfg.enabled = True
                changed = True

        if not changed:
            continue

        agent_cfg.tools = tools
        save_agent_config(agent_id, agent_cfg)
        updated.append(agent_id)
        logger.info(
            "Migrated builtin arbitration agent %r tools: enabled "
            "search_knowledge/grep_search/glob_search/view_image.",
            agent_id,
        )

    return updated


def ensure_builtin_arbitration_agents_exists() -> None:
    """Ensure builtin arbitration agents (single + group chat) exist.

    Seeds the builtin single agents (仲裁员/申请人/被申请人/仲裁秘书)
    and the builtin group chat agent (模拟仲裁智能体) on first creation
    only.  On later startups existing profiles and their workspaces are
    left untouched, so user edits (persona, group, memory, workspace
    files) are never overwritten.
    """
    try:
        _do_ensure_builtin_arbitration_agents()
    except Exception as e:
        logger.error(
            f"Failed to ensure builtin arbitration agents exist: {e}. "
            "Builtin arbitration agents may not be available.",
            exc_info=True,
        )


def _do_ensure_builtin_arbitration_agents() -> None:
    """Internal implementation of builtin arbitration agent seeding."""
    from .routers.agents import _initialize_agent_workspace

    config = load_config()
    language = config.agents.language or "zh"
    changed = False

    # 1) Builtin single agents: 仲裁员/申请人/被申请人/仲裁秘书
    members: list[dict[str, str]] = []
    for template_id, agent_id in _BUILTIN_ARBITRATION_ROLE_AGENTS:
        default_name, _ = ARBITRATION_ROLE_TEMPLATES[template_id]
        members.append({"id": agent_id, "name": default_name})

        if agent_id in config.agents.profiles:
            continue

        workspace = Path(f"{WORKING_DIR}/workspaces/{agent_id}").expanduser()
        workspace.mkdir(parents=True, exist_ok=True)
        _ensure_workspace_json_files(workspace, agent_id)

        other_id = _other_agent_owns_workspace(
            config.agents.profiles,
            workspace,
            agent_id,
        )
        if other_id is not None:
            logger.warning(
                "Skipping builtin arbitration role %r: workspace %s is "
                "already used by agent %r.",
                agent_id,
                workspace,
                other_id,
            )
            continue

        template_result = build_agent_template(
            template_id,
            agent_id=agent_id,
            workspace_dir=workspace,
            fallback_language=language,
        )
        template_result.agent_config.group = BUILTIN_ARBITRATION_GROUP

        _initialize_agent_workspace(
            workspace,
            skill_names=list(template_result.initial_skill_names),
            md_template_id=template_result.md_template_id,
        )

        config.agents.profiles[agent_id] = AgentProfileRef(
            id=agent_id,
            workspace_dir=str(workspace),
        )
        if agent_id not in config.agents.agent_order:
            config.agents.agent_order.append(agent_id)
        # Persist the new profile BEFORE saving the agent config: save_agent_config
        # reloads the root config and fails if the profile is missing on disk.
        save_config(config)
        save_agent_config(agent_id, template_result.agent_config)
        changed = True
        logger.info("Created builtin arbitration role agent: %s", agent_id)

    # 2) Builtin group chat agent: 模拟仲裁智能体 (host agent)
    host_id = BUILTIN_MOCK_ARBITRATION_AGENT_ID
    if host_id not in config.agents.profiles:
        host_workspace = Path(
            f"{WORKING_DIR}/workspaces/{host_id}",
        ).expanduser()
        host_workspace.mkdir(parents=True, exist_ok=True)
        _ensure_workspace_json_files(host_workspace, host_id)

        other_id = _other_agent_owns_workspace(
            config.agents.profiles,
            host_workspace,
            host_id,
        )
        if other_id is not None:
            logger.warning(
                "Skipping builtin mock arbitration host %r: workspace %s "
                "is already used by agent %r.",
                host_id,
                host_workspace,
                other_id,
            )
        else:
            _create_builtin_mock_arbitration_host(
                config,
                host_id,
                host_workspace,
                language,
                members,
            )
            changed = True

    # Group chat hosts must never run bootstrap guidance: the host's job is
    # to organize member discussion, not to onboard the user. Remove any
    # BOOTSTRAP.md left behind by earlier versions — for the builtin host
    # and for every user-created host agent. Hosts also must not exempt
    # chat_with_agent from tool-result pruning: every member reply arrives
    # through that tool, and keeping each historical reply at the recent
    # (50k-byte) limit blows the context window mid-discussion (member
    # speeches get cut off). Prune old replies like any other tool output.
    from .routers.agents import _remove_bootstrap_md as _cleanup_bootstrap

    for profile_id, profile in config.agents.profiles.items():
        is_host = profile_id.startswith("host_")
        if not is_host:
            try:
                profile_desc = load_agent_config(profile_id).description
            except (ValueError, AppBaseException, OSError):
                profile_desc = None
            is_host = bool(profile_desc and "<!-- HOST:" in profile_desc)
        if not is_host:
            continue
        host_workspace = Path(profile.workspace_dir).expanduser()
        _cleanup_bootstrap(host_workspace)
        try:
            host_cfg = load_agent_config(profile_id)
            pruning_cfg = (
                host_cfg.running.light_context_config.tool_result_pruning_config
            )
            exempt = [
                name
                for name in pruning_cfg.exempt_tool_names
                if name != "chat_with_agent"
            ]
            if exempt != pruning_cfg.exempt_tool_names:
                pruning_cfg.exempt_tool_names = exempt
                save_agent_config(profile_id, host_cfg)
                changed = True
        except (ValueError, AppBaseException, OSError) as exc:
            logger.warning(
                "Could not update pruning config for host %s: %s",
                profile_id,
                exc,
            )

    if changed:
        save_config(config)

    # Align existing arbitration agents' toolset with their SOUL.md /
    # kb_arbitration skill instructions (idempotent, additive).
    migrate_existing_arbitration_tools()


def _remove_bootstrap_md(workspace: Path) -> None:
    """Remove BOOTSTRAP.md (and its completion flag) from a workspace."""
    bootstrap = workspace / "BOOTSTRAP.md"
    try:
        if bootstrap.exists():
            bootstrap.unlink()
            logger.info(
                "Removed BOOTSTRAP.md from group chat host workspace %s",
                workspace,
            )
        flag = workspace / ".bootstrap_completed"
        if flag.exists():
            flag.unlink()
    except OSError as e:
        logger.warning("Could not remove BOOTSTRAP.md from %s: %s", workspace, e)


def _create_builtin_mock_arbitration_host(
    config,
    host_id: str,
    host_workspace: Path,
    language: str,
    members: list[dict[str, str]],
) -> None:
    """Create the builtin 模拟仲裁智能体 host (group chat) agent."""
    from .routers.agents import _initialize_agent_workspace

    user_description = (
        "模拟仲裁庭群聊：由仲裁员、申请人、被申请人与仲裁秘书共同参与的"
        "争议解决模拟讨论。"
    )
    host_meta = {"v": 1, "members": members, "mode": _MOCK_ARBITRATION_MODE}
    description = (
        user_description
        + "\n\n<!-- HOST:"
        + json.dumps(host_meta, ensure_ascii=False)
        + " -->"
    )

    agent_config = AgentProfileConfig(
        id=host_id,
        name=_MOCK_ARBITRATION_NAME,
        description=description,
        group=BUILTIN_ARBITRATION_GROUP,
        workspace_dir=str(host_workspace),
        language=language,
        channels=ChannelConfig(),
        mcp=MCPConfig(),
        heartbeat=HeartbeatConfig(),
        tools=build_arbitration_tools_config(),
    )

    _initialize_agent_workspace(
        host_workspace,
        skill_names=[],
        language=language,
        exclude_md_filenames={"BOOTSTRAP.md"},
    )

    (host_workspace / "AGENTS.md").write_text(
        _build_mock_arbitration_agents_md(members),
        encoding="utf-8",
    )
    (host_workspace / "PROFILE.md").write_text(
        _build_mock_arbitration_profile_md(members, user_description),
        encoding="utf-8",
    )

    config.agents.profiles[host_id] = AgentProfileRef(
        id=host_id,
        workspace_dir=str(host_workspace),
    )
    if host_id not in config.agents.agent_order:
        config.agents.agent_order.append(host_id)
    # Persist the new profile before save_agent_config (it reloads root config).
    save_config(config)
    save_agent_config(host_id, agent_config)
    logger.info("Created builtin mock arbitration host agent: %s", host_id)


def _build_mock_arbitration_agents_md(members: list[dict[str, str]]) -> str:
    """Build AGENTS.md for the builtin 模拟仲裁智能体 host."""
    roster = "\n".join(
        f"- 智能体ID「{m['id']}」— {m['name']}" for m in members
    )
    order = " → ".join(m["name"] for m in members)
    return (
        "# 群聊：模拟仲裁 — 主持人 AGENTS.md\n"
        "\n"
        "本文件由内置「模拟仲裁智能体」自动生成。\n"
        "讨论模式：**串行圆桌**\n"
        "\n"
        "## 成员名单（必须使用下面列出的 ID 调用 chat_with_agent 或 submit_to_agent）\n"
        "\n"
        f"{roster}\n"
        "\n"
        "讨论中务必使用成员的真实姓名/头衔来称呼，不要直接显示 ID。\n"
        "\n"
        "## 工具使用说明\n"
        "\n"
        "- 用 `chat_with_agent(to_agent=ID, text=发言内容, timeout=600)` 逐个提问，每位成员的问题里务必附上前一位或几位成员的观点。\n"
        "- 如果预计某成员需要超过 5 分钟才能答复，可以用 `submit_to_agent` + `check_agent_task` 的方式等候。\n"
        "- 涉及具体法条、仲裁规则、机构程序、案例或文书模板时，先调用 `search_knowledge` 检索共享知识库；严禁凭记忆编造法条或规则条文。\n"
        "- 全部成员回答完毕后再输出最终结论。\n"
        "\n"
        "## 讨论流程（串行圆桌）\n"
        "\n"
        f"发言顺序：{order}\n"
        "\n"
        "1. 把用户的原始议题拆成清晰的仲裁程序问题说明，作为主持人的引导。\n"
        "2. 先向「申请人」发问，请其陈述仲裁请求、事实与理由，并提交证据线索。\n"
        "3. 再向「被申请人」发问，附上申请人的观点，请其答辩、抗辩或提出反请求。\n"
        "4. 请「仲裁员」就争议焦点发表独立、专业的裁判意见，认定事实并适用法律与仲裁规则。\n"
        "5. 请「仲裁秘书」就程序性事项（日程、文书、证据交换、记录）给出说明或纪要。\n"
        "6. 所有成员发言后，主持人综合各方意见，形成条理清晰的结论，并明确标注每位成员的核心观点。\n"
        "7. 如果用户继续追问，按同样顺序再次讨论。\n"
        "\n"
        "## 输出风格\n"
        "\n"
        "- 最终回复使用面向 C 端用户的通俗中文（默认简体中文），避免使用技术黑话。\n"
        "- 引用成员发言时使用清晰的小标题（如「[申请人 观点]」）并引用其核心论据。\n"
        "- 每次讨论结束后，给出「📋 本次讨论纪要」章节，包含：议题、各成员观点摘要、共识与分歧、主持人的最终建议或结论。\n"
        "\n"
        "## 身份定位\n"
        "\n"
        "- 你是「模拟仲裁」的主持人（不是普通的个人助手）。\n"
        "- 用户的每一条消息都是一次「发起议题 / 继续讨论」，而不是对你个人的提问。\n"
        "- 你必须通过与成员讨论来回答，不能只凭自己的想法直接给结论。\n"
        "- 如果用户希望单独和某成员对话，请告诉他们切换到该成员的单聊窗口即可。\n"
        "\n"
        "---\n"
        "\n"
        "> 提示：如果用户在对话中修改了成员，你需要提醒其通过「编辑群聊」功能来刷新本文件，以确保成员名单和协议一致。\n"
    )


def _build_mock_arbitration_profile_md(
    members: list[dict[str, str]],
    user_description: str,
) -> str:
    """Build PROFILE.md for the builtin 模拟仲裁智能体 host."""
    member_summary = "\n".join(f"- {m['name']}" for m in members)
    about = user_description.strip() or "模拟仲裁 讨论会。"
    return (
        "# 模拟仲裁 — 群聊主持人\n"
        "\n"
        "## 身份\n"
        "\n"
        "我是 **模拟仲裁** 的专职主持人，负责按照「串行圆桌」流程组织仲裁员、申请人、被申请人与仲裁秘书围绕争议议题展开讨论，并整理讨论纪要。\n"
        "我不会只凭自己的知识直接给出答案，而是会调用参与的成员智能体进行讨论，综合后给出最终结论。\n"
        "\n"
        "## 职责\n"
        "\n"
        "- 正确理解用户的争议议题，并拆成成员可以直接讨论的问题。\n"
        "- 按照既定讨论流程调度成员发言。\n"
        "- 在回复中清晰呈现每位成员的观点，而不是混为一谈。\n"
        "- 讨论结束时输出「📋 本次讨论纪要」章节。\n"
        "\n"
        "## 成员\n"
        "\n"
        f"{member_summary}\n"
        "\n"
        "## 关于\n"
        "\n"
        f"{about}\n"
    )
