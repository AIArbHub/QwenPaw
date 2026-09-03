# -*- coding: utf-8 -*-
"""Multi-agent management API.

Provides RESTful API for managing multiple agent instances.
"""

import json
import logging
import re
import shutil
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile
from fastapi import Path as PathParam
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from aiarb.exceptions import (
    AppBaseException,
)

from ...agents.memory.reme_embedding import (
    EmbeddingReindexUnavailableError,
)
from ...agents.utils.file_handling import read_text_file_with_encoding_fallback
from ..mail.driver_config import (
    ENTERPRISE_MAIL_PROVIDERS as _ENTERPRISE_MAIL_PROVIDERS,
    build_aiarbmail_env as _build_aiarbmail_env,
    generate_aiarbmail_driver_card as _generate_aiarbmail_driver_card,
    resolve_aiarbmail_command as _resolve_aiarbmail_command,
    sync_aiarbmail_driver_card as _sync_aiarbmail_driver_card,
)
from ..utils import safe_join, schedule_agent_reload
from ...config.config import (
    AgentMailConfig,
    AgentProfileConfig,
    AgentProfileRef,
    EmbeddingModelConfig,
    FallbackPolicyConfig,
    ModelSlotConfig,
    load_agent_config,
    mutate_agent_config,
    save_agent_mail_credentials,
    save_agent_config,
    update_agent_config_async,
    generate_short_agent_id,
    sanitize_agent_id,
    validate_agent_id,
)
from ...config.utils import load_config, mutate_config
from ...agents.utils import (
    copy_workspace_md_files,
    ensure_workspace_md_file,
    normalize_agent_language,
)
from ...agents.skill_system import SkillPoolService, get_workspace_skills_dir
from ...agents.templates import DEFAULT_KNOWLEDGE_SKILL_NAMES
from ...harnesses.registry import ProviderCatalogItem, get_provider
from ..agent_startup import AgentStartupStatus
from ..multi_agent_manager import MultiAgentManager
from ...constant import (
    BUILTIN_KB_CURATOR_AGENT_ID,
    BUILTIN_QA_AGENT_ID,
    WORKING_DIR,
)
from ...utils.io_utils import run_sync_io, write_json_atomic
from ...utils.logging import sanitize_log_value

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

# Builtin agents that can never be deleted nor disabled.  The "default" agent
# is the user's personal assistant; the builtin QA and KB curator agents are
# fixed system agents.  ``BUILTIN_QA_AGENT_ID`` is included defensively — the
# reserved-id guard already prevents creating a duplicate profile, but the
# delete/toggle guards stay consistent with the other builtins.
_PROTECTED_AGENT_IDS = frozenset(
    {
        "default",
        BUILTIN_QA_AGENT_ID,
        BUILTIN_KB_CURATOR_AGENT_ID,
    },
)


class AgentSummary(BaseModel):
    """Agent summary information."""

    id: str
    name: str
    description: str
    group: str = ""
    workspace_dir: str
    enabled: bool
    pinned: bool
    startup_status: AgentStartupStatus
    backend: str = "aiarb"
    backend_capabilities: dict[str, Any] = Field(default_factory=dict)
    backend_model: str | None = None
    backend_reasoning_effort: str | None = None
    active_model: ModelSlotConfig | None = None
    avatar: str | None = None
    managed_by_app: str | None = None
    available_in_chat: bool = True


class AgentListResponse(BaseModel):
    """Response for listing agents."""

    agents: list[AgentSummary]


class MemoryGraphNode(BaseModel):
    """One category root, indexed memory file, or unresolved target."""

    id: str
    path: str
    name: str = ""
    description: str = ""
    indexed: bool
    virtual: bool = False
    section: Literal["daily", "digest"] | None = None
    relative_path: str | None = None


class MemoryGraphEdge(BaseModel):
    """One directed wikilink in the memory graph."""

    source: str
    target: str
    target_anchor: str | None = None


class MemoryGraphSnapshot(BaseModel):
    """Complete graph snapshot returned by embedded ReMe."""

    version: Literal[1] = 1
    nodes: list[MemoryGraphNode]
    edges: list[MemoryGraphEdge]


class ReorderAgentsRequest(BaseModel):
    """Request model for persisting agent order."""

    agent_ids: list[str]


class BackendSettingsRequest(BaseModel):
    """Provider-owned settings updated from Chat controls."""

    model: str | None = None
    reasoning_effort: str | None = None


class AgentModelSettingsPatch(BaseModel):
    """Model-routing fields editable from the Chat model selector."""

    fallback_models: list[ModelSlotConfig] | None = None
    fallback_policy: FallbackPolicyConfig | None = None
    subagent_model: ModelSlotConfig | None = None
    thinking_level: (
        Literal[
            "inherit",
            "off",
            "low",
            "medium",
            "high",
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def reject_null_non_nullable_fields(self):
        """Reject explicit null for non-null agent model settings."""
        non_nullable_fields = (
            "fallback_models",
            "fallback_policy",
            "thinking_level",
        )
        null_fields = [
            field
            for field in non_nullable_fields
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_fields:
            fields = ", ".join(null_fields)
            raise ValueError(f"Fields cannot be null: {fields}")
        return self


class ReMeComponentMemoryUsage(BaseModel):
    """Estimated memory owned by one ReMe component."""

    bytes: int
    human: str


class MemoryWorkerRuntimeStatus(BaseModel):
    """Sanitized state of the background memory worker."""

    status: Literal["idle", "busy", "stopping", "error"]
    queue_pending: int
    tasks_running: int


class MemoryCaptureTaskStatus(BaseModel):
    """One bounded memory-capture record, newest records returned first.

    Records share the summarize queue used by periodic auto-memory and the
    user-triggered ``/new`` and ``/compact`` commands.
    """

    task_id: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    queued_at: str | None = None
    finished_at: str | None = None
    message_count: int = 0
    result: str | None = None
    error: str | None = None


class AutoMemoryRuntimeStatus(BaseModel):
    """Aggregate auto-memory progress without exposing session identity."""

    enabled: bool
    interval: int


class RecentMemoryRuntimeStatus(BaseModel):
    """Latest bounded error summary."""

    last_error: str | None = None


class MemoryRuntimeStatus(BaseModel):
    """Operational state surfaced to the Console."""

    worker: MemoryWorkerRuntimeStatus
    auto_memory: AutoMemoryRuntimeStatus
    tasks: list[MemoryCaptureTaskStatus] = Field(default_factory=list)
    recent: RecentMemoryRuntimeStatus
    reindexing: bool
    embedding_reindex_required: bool = False
    embedding_reindex_undo_available: bool = False


class ReMeMemoryStatusResponse(BaseModel):
    """Structured memory information returned by ReMe's status job."""

    components: dict[str, dict[str, ReMeComponentMemoryUsage]]
    components_total: str
    process_rss: str
    runtime: MemoryRuntimeStatus


class CreateAgentRequest(BaseModel):
    """Request model for creating a new agent.

    The ``id`` field is optional.  When provided the server uses it as
    the agent identifier (after sanitization); when omitted a random
    short UUID is generated automatically.
    """

    id: str | None = None
    name: str
    description: str = ""
    group: str = ""
    workspace_dir: str | None = None
    language: str | None = None
    skill_names: list[str] | None = None
    active_model: ModelSlotConfig | None = None
    mail: AgentMailConfig | None = None
    backend: str = "aiarb"
    backend_settings: dict[str, Any] = Field(default_factory=dict)
    initial_md_files: dict[str, str] | None = Field(
        default=None,
        description=(
            "Optional map of filename -> markdown content to write into "
            "the new agent's workspace after the default templates have "
            "been applied. Files with names matching existing MD files "
            "(e.g. AGENTS.md, PROFILE.md, SOUL.md) will overwrite the "
            "default template contents."
        ),
    )

    @field_validator("id", mode="before")
    @classmethod
    def sanitize_id(cls, value: str | None) -> str | None:
        """Strip whitespace from the custom ID."""
        if value is None:
            return None
        if isinstance(value, str):
            sanitized = sanitize_agent_id(value)
            return sanitized if sanitized else None
        return value

    @field_validator("workspace_dir", mode="before")
    @classmethod
    def strip_workspace_dir(cls, value: str | None) -> str | None:
        """Strip accidental whitespace"""
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped if stripped else None
        return value

    @field_validator("initial_md_files", mode="before")
    @classmethod
    def validate_initial_md_files(
        cls, value: Any
    ) -> dict[str, str] | None:
        """Validate that initial_md_files is a flat dict of strings."""
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("initial_md_files must be a dict of filename->content")
        cleaned: dict[str, str] = {}
        for raw_name, raw_content in value.items():
            if not isinstance(raw_name, str):
                raise ValueError("initial_md_files filename must be a string")
            name = raw_name.strip().lstrip("/").lstrip("\\")
            if not name:
                continue
            # Prevent path traversal outside workspace
            if (
                ".." in Path(name).parts
                or name.startswith(".")
                or Path(name).is_absolute()
            ):
                raise ValueError(f"Illegal initial_md_files filename: {raw_name}")
            # Only allow a small fixed set of workspace config files
            allowed = {
                "AGENTS.md",
                "PROFILE.md",
                "SOUL.md",
                "CONTACTS.md",
                "MAIL_TRIAGE.md",
                "MEMORY.md",
            }
            if name not in allowed:
                raise ValueError(
                    f"initial_md_files only accepts: {sorted(allowed)}"
                )
            if not isinstance(raw_content, str):
                raise ValueError(f"initial_md_files content for {name} must be string")
            cleaned[name] = raw_content
        return cleaned if cleaned else None


class CopyAgentRequest(BaseModel):
    """Request model for copying an existing agent's configuration files."""

    name: str | None = None
    copy_agent_json: Literal[True] = True
    copy_md_files: bool = True
    copy_skills: bool = False
    copy_jobs: bool = False


_COPYABLE_MD_FILES = (
    "AGENTS.md",
    "SOUL.md",
    "PROFILE.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
)


def _get_available_third_party_provider(
    backend: str,
) -> ProviderCatalogItem:
    """Resolve an available third-party backend for API mutations."""
    try:
        provider = get_provider(backend)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if provider.coming_soon:
        raise HTTPException(
            status_code=409,
            detail=f"{provider.name} is not available yet",
        )
    return provider


def _get_multi_agent_manager(request: Request) -> MultiAgentManager:
    """Get MultiAgentManager from app state."""
    if not hasattr(request.app.state, "multi_agent_manager"):
        raise HTTPException(
            status_code=500,
            detail="MultiAgentManager not initialized",
        )
    return request.app.state.multi_agent_manager


def _normalized_agent_order(config) -> list[str]:
    """Return a deduplicated agent order covering every configured agent."""
    profile_ids = list(config.agents.profiles.keys())
    ordered_ids: list[str] = []

    for agent_id in config.agents.agent_order:
        if agent_id in config.agents.profiles and agent_id not in ordered_ids:
            ordered_ids.append(agent_id)

    for agent_id in profile_ids:
        if agent_id not in ordered_ids:
            ordered_ids.append(agent_id)

    return ordered_ids


def _group_agent_order(config, ordered_ids: list[str]) -> list[str]:
    """Group a complete order by default, pinned, then regular."""
    pinned_ids = [
        agent_id
        for agent_id in ordered_ids
        if agent_id != "default"
        and getattr(config.agents.profiles[agent_id], "pinned", False)
    ]
    regular_ids = [
        agent_id
        for agent_id in ordered_ids
        if agent_id != "default" and agent_id not in pinned_ids
    ]
    default_ids = ["default"] if "default" in ordered_ids else []
    return [*default_ids, *pinned_ids, *regular_ids]


def _display_agent_order(config) -> list[str]:
    """Return stored order grouped by default, pinned, then regular."""
    return _group_agent_order(config, _normalized_agent_order(config))


def _is_valid_display_order(config, agent_ids: list[str]) -> bool:
    """Return whether an order respects default and pinned grouping."""
    return _group_agent_order(config, agent_ids) == agent_ids


def _read_profile_description(workspace_dir: str) -> str:
    """Read description from PROFILE.md if exists."""
    try:
        profile_path = Path(workspace_dir) / "PROFILE.md"
        if not profile_path.exists():
            return ""

        content = read_text_file_with_encoding_fallback(profile_path).strip()
        lines = []
        in_identity = False

        for line in content.split("\n"):
            if line.strip().startswith("## 身份") or line.strip().startswith(
                "## Identity",
            ):
                in_identity = True
                continue
            if in_identity:
                if line.strip().startswith("##"):
                    break
                if line.strip() and not line.strip().startswith("#"):
                    lines.append(line.strip())

        return " ".join(lines)[:200] if lines else ""
    except Exception:  # noqa: E722
        return ""


@router.get(
    "",
    response_model=AgentListResponse,
    summary="List all agents",
    description="Get list of all configured agents",
)
async def list_agents(request: Request = None) -> AgentListResponse:
    """List all configured agents."""
    config = await run_sync_io(load_config)
    manager = (
        _get_multi_agent_manager(request) if request is not None else None
    )
    ordered_agent_ids = _display_agent_order(config)

    agents = []
    for agent_id in ordered_agent_ids:
        agent_ref = config.agents.profiles[agent_id]
        enabled = getattr(agent_ref, "enabled", True)
        pinned = agent_id == "default" or getattr(
            agent_ref,
            "pinned",
            False,
        )
        startup_status = (
            manager.get_agent_startup_status(agent_id, enabled=enabled)
            if manager is not None
            else (
                AgentStartupStatus.PENDING
                if enabled
                else AgentStartupStatus.DISABLED
            )
        )
        try:
            agent_config = await run_sync_io(load_agent_config, agent_id)
            description = agent_config.description or ""

            profile_desc = await run_sync_io(
                _read_profile_description,
                agent_ref.workspace_dir,
            )
            if profile_desc:
                if description.strip():
                    description = f"{description.strip()} | {profile_desc}"
                else:
                    description = profile_desc

            active_model = agent_config.active_model
            template_id = agent_config.template_id or ""
            managed_by_app = (
                template_id.removeprefix("pawapp:")
                if template_id.startswith("pawapp:")
                else None
            )
            if agent_config.backend == "aiarb":
                backend_capabilities = {"workspace_ui": True}
            else:
                try:
                    backend_capabilities = get_provider(
                        agent_config.backend,
                    ).capabilities.model_dump()
                except ValueError:
                    backend_capabilities = {}

            agents.append(
                AgentSummary(
                    id=agent_id,
                    name=agent_config.name,
                    description=description,
                    group=getattr(agent_config, "group", "") or "",
                    workspace_dir=agent_ref.workspace_dir,
                    enabled=enabled,
                    pinned=pinned,
                    startup_status=startup_status,
                    backend=agent_config.backend,
                    backend_capabilities=backend_capabilities,
                    backend_model=agent_config.backend_settings.get("model"),
                    backend_reasoning_effort=(
                        agent_config.backend_settings.get(
                            "reasoning_effort",
                        )
                    ),
                    active_model=active_model,
                    avatar=getattr(agent_config, "avatar", None),
                    managed_by_app=managed_by_app,
                    available_in_chat=managed_by_app is None,
                ),
            )
        except Exception:  # noqa: E722
            agents.append(
                AgentSummary(
                    id=agent_id,
                    name=agent_id.title(),
                    description="",
                    workspace_dir=agent_ref.workspace_dir,
                    enabled=enabled,
                    pinned=pinned,
                    startup_status=startup_status,
                ),
            )

    return AgentListResponse(agents=agents)


@router.put(
    "/order",
    summary="Persist agent order",
    description="Save the full ordered list of configured agent IDs",
)
async def reorder_agents(
    reorder_request: ReorderAgentsRequest = Body(...),
) -> dict:
    """Persist the full ordered list of agent IDs."""

    def apply_order(config: Any) -> None:
        configured_ids = list(config.agents.profiles.keys())
        agent_ids = reorder_request.agent_ids
        if len(agent_ids) != len(set(agent_ids)):
            raise HTTPException(
                status_code=400,
                detail="Each configured agent ID must appear exactly once.",
            )
        if set(agent_ids) != set(configured_ids):
            raise HTTPException(
                status_code=400,
                detail="Each configured agent ID must appear exactly once.",
            )
        if not _is_valid_display_order(config, agent_ids):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Agent order must keep default first and pinned agents "
                    "before unpinned agents."
                ),
            )
        config.agents.agent_order = list(agent_ids)

    config = await run_sync_io(mutate_config, apply_order)

    return {"success": True, "agent_ids": config.agents.agent_order}


@router.patch(
    "/{agentId}/pin",
    summary="Pin or unpin an agent",
    description="Persist an agent's pinned state in agent selectors",
)
async def set_agent_pinned(
    agentId: str = PathParam(...),
    pinned: bool = Body(..., embed=True),
) -> dict:
    """Persist an agent's pinned state without changing enabled state."""

    def apply_pinned(config: Any) -> None:
        if agentId not in config.agents.profiles:
            raise HTTPException(
                status_code=404,
                detail=f"Agent '{agentId}' not found",
            )
        if agentId == "default" and not pinned:
            raise HTTPException(
                status_code=400,
                detail="Cannot unpin the default agent",
            )
        if agentId != "default":
            config.agents.profiles[agentId].pinned = pinned
            config.agents.agent_order = _display_agent_order(config)

    await run_sync_io(mutate_config, apply_pinned)

    return {
        "success": True,
        "agent_id": agentId,
        "pinned": True if agentId == "default" else pinned,
    }


class AgentGroupPatch(BaseModel):
    """Request model for updating an agent's group label."""

    group: str = ""


@router.patch(
    "/{agentId}/group",
    response_model=AgentProfileConfig,
    summary="Update agent group label",
    description="Persist an agent's category/group label",
)
async def set_agent_group(
    agentId: str = PathParam(...),
    body: AgentGroupPatch = Body(...),
) -> AgentProfileConfig:
    """Persist an agent's group label without changing other settings."""

    def apply_group(existing_config: AgentProfileConfig) -> None:
        existing_config.group = body.group

    try:
        return await run_sync_io(
            mutate_agent_config,
            agentId,
            apply_group,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/{agentId}",
    response_model=AgentProfileConfig,
    summary="Get agent details",
    description="Get complete configuration for a specific agent",
)
async def get_agent(agentId: str = PathParam(...)) -> AgentProfileConfig:
    """Get agent configuration."""
    try:
        agent_config = await run_sync_io(load_agent_config, agentId)
        return agent_config
    except (ValueError, AppBaseException) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch(
    "/{agentId}/backend-settings",
    response_model=AgentProfileConfig,
    summary="Update third-party backend Chat settings",
)
async def update_backend_settings(
    body: BackendSettingsRequest,
    agentId: str = PathParam(...),
) -> AgentProfileConfig:
    """Persist model controls owned by a third-party agent backend."""
    # PATCH semantics: only fields the caller actually sent may change;
    # a field absent from the request body must survive untouched, and
    # an explicit null clears it.
    values = {field: getattr(body, field) for field in body.model_fields_set}

    def apply_settings(agent_config: AgentProfileConfig) -> None:
        if agent_config.backend == "aiarb":
            raise HTTPException(
                status_code=409,
                detail="AIArb models use the native model configuration",
            )
        provider = _get_available_third_party_provider(agent_config.backend)
        settings = dict(agent_config.backend_settings)
        if provider.capabilities.model_selection and "model" in values:
            if values["model"]:
                settings["model"] = values["model"]
            else:
                settings.pop("model", None)
        if (
            provider.capabilities.reasoning_effort
            and "reasoning_effort" in values
        ):
            if values["reasoning_effort"]:
                settings["reasoning_effort"] = values["reasoning_effort"]
            else:
                settings.pop("reasoning_effort", None)
        agent_config.backend_settings = settings

    try:
        return await run_sync_io(
            mutate_agent_config,
            agentId,
            apply_settings,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _resolve_custom_workspace_dir(raw_workspace_dir: str) -> Path:
    """Resolve a caller-supplied workspace directory safely.

    Guards against path traversal (the CodeQL uncontrolled-path
    finding): the raw value must not smuggle ``..`` segments, and a
    relative value is anchored to the AIArb working directory rather
    than the process CWD.  Any explicit absolute directory is otherwise
    legal -- deployments routinely keep workspaces on /data, /opt, or
    other non-home mounts, so a home/WORKING_DIR whitelist would reject
    previously valid setups.

    Raises:
        HTTPException(400): empty input or traversal segments.
    """
    raw = raw_workspace_dir.strip()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="workspace_dir must not be empty",
        )
    raw_path = Path(raw)
    if ".." in raw_path.parts:
        raise HTTPException(
            status_code=400,
            detail="workspace_dir must not contain '..' path segments",
        )
    candidate = raw_path.expanduser()
    if not candidate.is_absolute():
        candidate = Path(WORKING_DIR).expanduser() / candidate
    return candidate.resolve()


def _generate_unique_id(existing_ids: set[str]) -> str:
    """Generate a unique random short agent ID.

    Raises:
        HTTPException: If a unique ID could not be generated.
    """
    max_attempts = 10
    for _ in range(max_attempts):
        candidate_id = generate_short_agent_id()
        if candidate_id not in existing_ids:
            return candidate_id
    raise HTTPException(
        status_code=500,
        detail="Failed to generate unique agent ID after 10 attempts",
    )


async def _require_aiarbmail_driver_card(
    workspace_dir: Path,
    mail: AgentMailConfig,
    operation: str,
) -> None:
    """Generate a usable card before an agent create/copy is committed."""
    try:
        synced = await run_sync_io(
            _sync_aiarbmail_driver_card,
            workspace_dir,
            mail,
            "aiarb",
            force_rewrite=True,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning(
            "Failed to prepare aiarbmail driver during agent %s: %s",
            sanitize_log_value(operation),
            sanitize_log_value(exc),
        )
        synced = False
    if not synced:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Agent {operation} was not committed because the "
                "aiarbmail driver card could not be generated. Check "
                "workspace permissions and retry."
            ),
        )


async def _rollback_aiarbmail_update(
    agent_id: str,
    previous_config: AgentProfileConfig,
    workspace_dir: Path,
) -> tuple[bool, bool]:
    """Restore the config/card pair after a failed driver publication."""
    config_restored = True
    driver_restored = True
    try:
        await run_sync_io(save_agent_config, agent_id, previous_config)
    except Exception:  # pylint: disable=broad-except
        config_restored = False
        logger.exception(
            "Failed to roll back agent config after driver sync failure "
            "for %s",
            sanitize_log_value(agent_id),
        )

    if config_restored:
        try:
            driver_restored = await run_sync_io(
                _sync_aiarbmail_driver_card,
                workspace_dir,
                previous_config.mail,
                previous_config.backend or "aiarb",
                force_rewrite=previous_config.mail is not None,
            )
        except Exception:  # pylint: disable=broad-except
            driver_restored = False
            logger.exception(
                "Failed to restore aiarbmail driver for agent %s",
                sanitize_log_value(agent_id),
            )
    return config_restored, driver_restored


@router.post(
    "",
    response_model=AgentProfileRef,
    status_code=201,
    summary="Create new agent",
    description="Create a new agent with optional custom ID",
)
async def create_agent(
    request: CreateAgentRequest = Body(...),
    http_request: Request = None,
) -> AgentProfileRef:
    """Create a new agent.

    When ``request.id`` is provided, it is used as the agent identifier
    (validated for URL-safe characters, length, reserved words, and
    uniqueness).  Otherwise a random short UUID is generated.
    """
    _validate_mail_backend_compatibility(request.backend, request.mail)
    if request.backend != "aiarb":
        _get_available_third_party_provider(request.backend)

    config = await run_sync_io(load_config)
    existing_ids = set(config.agents.profiles.keys())

    if request.mail is not None:
        _validate_mail_config(request.mail)

    if request.id:
        try:
            validate_agent_id(request.id, existing_ids)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e
        new_id = request.id
    else:
        new_id = _generate_unique_id(existing_ids)

    if request.workspace_dir:
        workspace_dir = await run_sync_io(
            _resolve_custom_workspace_dir,
            request.workspace_dir,
        )
    else:
        workspace_dir = await run_sync_io(
            safe_join,
            Path(f"{WORKING_DIR}/workspaces").expanduser(),
            new_id,
        )
    await run_sync_io(workspace_dir.mkdir, parents=True, exist_ok=True)

    from ...config.config import (
        ChannelConfig,
        MCPConfig,
        HeartbeatConfig,
        ToolsConfig,
    )

    language = normalize_agent_language(
        request.language or config.agents.language or "en",
    )

    active_model = (
        request.active_model if request.backend == "aiarb" else None
    )
    if request.backend == "aiarb" and (
        not active_model or not active_model.provider_id
    ):
        try:
            from ...providers import ProviderManager

            global_model = ProviderManager.get_instance().get_active_model()
            if global_model and global_model.provider_id:
                active_model = global_model
        except Exception:
            pass

    agent_config = AgentProfileConfig(
        id=new_id,
        name=request.name,
        description=request.description,
        group=request.group,
        workspace_dir=str(workspace_dir),
        backend=request.backend,
        backend_settings=request.backend_settings,
        language=language,
        channels=ChannelConfig(),
        mcp=MCPConfig(),
        heartbeat=HeartbeatConfig(),
        tools=ToolsConfig(),
        active_model=active_model,
        mail=request.mail,
    )

    # Group chat host agents are orchestrators, not personal assistants:
    # skip the first-interaction BOOTSTRAP.md guidance so a freshly created
    # group chat opens directly into the discussion instead of onboarding.
    is_group_host = bool(
        request.description and "<!-- HOST:" in request.description
    )

    if is_group_host:
        # Every member's reply arrives via chat_with_agent. Keeping every
        # historical reply at the recent (50k-byte) limit lets the context
        # balloon past the model window mid-discussion (members' speeches
        # then get cut off). Prune old replies to the old-result limit like
        # any other tool output — only the live exchange stays recent.
        pruning_cfg = (
            agent_config.running.light_context_config.tool_result_pruning_config
        )
        exempt = [n for n in pruning_cfg.exempt_tool_names if n != "chat_with_agent"]
        if exempt != pruning_cfg.exempt_tool_names:
            pruning_cfg.exempt_tool_names = exempt

    await run_sync_io(
        _initialize_agent_workspace,
        workspace_dir,
        skill_names=(
            request.skill_names
            if request.skill_names is not None
            else list(DEFAULT_KNOWLEDGE_SKILL_NAMES)
        ),
        language=language,
        exclude_md_filenames={"BOOTSTRAP.md"} if is_group_host else None,
    )
    if is_group_host:
        _remove_bootstrap_md(workspace_dir)

    # Write any caller-supplied initial MD files (overwrite defaults)
    if request.initial_md_files:
        for md_name, md_content in request.initial_md_files.items():
            target_file = workspace_dir / md_name
            try:
                target_file.write_text(md_content, encoding="utf-8")
            except OSError as exc:
                logger.warning(
                    "Failed to write initial_md_files[%s] for new agent %s: %s",
                    md_name,
                    sanitize_log_value(new_id),
                    exc,
                )

    if request.mail is not None:
        await _require_aiarbmail_driver_card(
            workspace_dir,
            request.mail,
            "creation",
        )
        await run_sync_io(_ensure_contacts_file, workspace_dir, language)
        await run_sync_io(_ensure_mail_triage_file, workspace_dir, language)

    agent_ref = AgentProfileRef(
        id=new_id,
        workspace_dir=str(workspace_dir),
        enabled=True,
    )

    await run_sync_io(
        _persist_created_agent,
        new_id,
        agent_ref,
        agent_config,
    )

    logger.info(
        f"Created new agent: {sanitize_log_value(new_id)} "
        f"(name={sanitize_log_value(request.name)})",
    )

    if http_request is not None:
        manager = _get_multi_agent_manager(http_request)
        manager.schedule_agent_startup(new_id)

    return agent_ref


def _build_copied_agent_config(
    *,
    source_config: AgentProfileConfig,
    new_id: str,
    new_name: str,
    workspace_dir: Path,
) -> AgentProfileConfig:
    """Derive a new agent config from the parsed source profile."""
    from ...config.config import ChannelConfig

    agent_config = source_config.model_copy(deep=True)
    agent_config.id = new_id
    agent_config.name = new_name
    agent_config.workspace_dir = str(workspace_dir)
    agent_config.channels = ChannelConfig()
    # Mail is only supported for the aiarb backend; silently drop it so
    # copies of legacy "third-party backend + mail" profiles stay valid
    # and no aiarbmail driver card is generated for the new agent.
    if agent_config.backend != "aiarb":
        agent_config.mail = None
    return agent_config


def _copy_selected_workspace_files(
    *,
    request: CopyAgentRequest,
    source_workspace: Path,
    workspace_dir: Path,
) -> None:
    """Copy selected whitelist files from source workspace to the new one."""
    if not source_workspace.is_dir():
        return

    if request.copy_md_files:
        for md_name in _COPYABLE_MD_FILES:
            src = source_workspace / md_name
            if src.is_file():
                shutil.copy2(src, workspace_dir / md_name)

    if request.copy_skills:
        src_skills = get_workspace_skills_dir(source_workspace)
        dst_skills = get_workspace_skills_dir(workspace_dir)
        if src_skills.is_dir():
            # Dest may already exist when create_skills_dir scaffolding ran.
            shutil.copytree(src_skills, dst_skills, dirs_exist_ok=True)
        src_manifest = source_workspace / "skill.json"
        if src_manifest.is_file():
            shutil.copy2(src_manifest, workspace_dir / "skill.json")

    if request.copy_jobs:
        src_jobs = source_workspace / "jobs.json"
        if src_jobs.is_file():
            shutil.copy2(src_jobs, workspace_dir / "jobs.json")


def _prepare_copied_workspace(
    request: CopyAgentRequest,
    source_workspace: Path,
    workspace_dir: Path,
    language: str,
) -> None:
    """Initialize and copy a new agent workspace synchronously."""
    _initialize_agent_workspace(
        workspace_dir,
        skill_names=[],
        language=language,
        apply_md_templates=request.copy_md_files,
        create_skills_dir=request.copy_skills,
        create_jobs_file=request.copy_jobs,
    )
    _copy_selected_workspace_files(
        request=request,
        source_workspace=source_workspace,
        workspace_dir=workspace_dir,
    )


def _persist_created_agent(
    agent_id: str,
    agent_ref: AgentProfileRef,
    agent_config: AgentProfileConfig,
) -> None:
    """Register a new agent under the root-config transaction lock."""

    def register_agent(config: Any) -> None:
        if agent_id in config.agents.profiles:
            raise HTTPException(
                status_code=400,
                detail=f"Agent ID '{agent_id}' already exists",
            )
        agent_path = Path(agent_ref.workspace_dir).expanduser() / "agent.json"
        if agent_config.mail is not None:
            save_agent_mail_credentials(agent_path.parent, agent_config.mail)
        write_json_atomic(
            agent_path,
            agent_config.model_dump(exclude_none=True),
        )
        config.agents.profiles[agent_id] = agent_ref
        config.agents.agent_order = _normalized_agent_order(config)

    mutate_config(register_agent)


@router.post(
    "/{agentId}/copy",
    response_model=AgentProfileRef,
    status_code=201,
    summary="Copy agent configuration",
    description=(
        "Copy selected configuration files from an existing agent into a new "
        "agent. Does not copy sessions, chats, media, or other runtime assets."
    ),
)
async def copy_agent(
    agentId: str = PathParam(...),
    request: CopyAgentRequest = Body(...),
    http_request: Request = None,
) -> AgentProfileRef:
    """Copy selected agent config files into a newly created agent."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    try:
        source_config = await run_sync_io(load_agent_config, agentId)
    except (ValueError, AppBaseException) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    source_workspace = Path(
        config.agents.profiles[agentId].workspace_dir,
    ).expanduser()

    existing_ids = set(config.agents.profiles.keys())
    new_id = _generate_unique_id(existing_ids)
    new_name = (request.name or "").strip() or f"{source_config.name} Copy"
    workspace_dir = Path(f"{WORKING_DIR}/workspaces/{new_id}").expanduser()
    await run_sync_io(workspace_dir.mkdir, parents=True, exist_ok=True)

    language = normalize_agent_language(
        source_config.language or config.agents.language or "en",
    )

    agent_config = _build_copied_agent_config(
        source_config=source_config,
        new_id=new_id,
        new_name=new_name,
        workspace_dir=workspace_dir,
    )

    await run_sync_io(
        _prepare_copied_workspace,
        request,
        source_workspace,
        workspace_dir,
        language,
    )

    if agent_config.mail is not None:
        await _require_aiarbmail_driver_card(
            workspace_dir,
            agent_config.mail,
            "copy",
        )
        await run_sync_io(_ensure_contacts_file, workspace_dir, language)
        await run_sync_io(_ensure_mail_triage_file, workspace_dir, language)

    agent_ref = AgentProfileRef(
        id=new_id,
        workspace_dir=str(workspace_dir),
        enabled=True,
    )

    await run_sync_io(
        _persist_created_agent,
        new_id,
        agent_ref,
        agent_config,
    )

    logger.info(
        "Copied agent %s -> %s "
        "(name=%s, agent_json=%s, md=%s, skills=%s, jobs=%s)",
        sanitize_log_value(agentId),
        sanitize_log_value(new_id),
        sanitize_log_value(new_name),
        request.copy_agent_json,
        request.copy_md_files,
        request.copy_skills,
        request.copy_jobs,
    )

    if http_request is not None:
        manager = _get_multi_agent_manager(http_request)
        manager.schedule_agent_startup(new_id)

    return agent_ref


@router.put(
    "/{agentId}",
    response_model=AgentProfileConfig,
    summary="Update agent",
    description="Update agent configuration and trigger reload",
)
async def update_agent(  # pylint: disable=too-many-statements
    agentId: str = PathParam(...),
    agent_config: AgentProfileConfig = Body(...),
    request: Request = None,
) -> AgentProfileConfig:
    """Update agent configuration."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    # The root profile is the canonical workspace location.  Updating an
    # agent does not move its workspace, so request-body workspace_dir must
    # never redirect driver-card or template writes to another path.
    workspace_dir = Path(
        config.agents.profiles[agentId].workspace_dir,
    ).expanduser()
    canonical_workspace_dir = str(workspace_dir)

    existing_config_snap = deepcopy(
        await run_sync_io(load_agent_config, agentId),
    )
    # Older versions allowed the request body to drift from the registered
    # workspace. Keep rollback snapshots on the canonical path too.
    existing_config_snap.workspace_dir = canonical_workspace_dir

    effective_backend = (
        agent_config.backend
        if "backend" in agent_config.model_fields_set
        else getattr(existing_config_snap, "backend", "aiarb")
    ) or "aiarb"
    mail_was_set = "mail" in agent_config.model_fields_set
    existing_mail_snap = getattr(existing_config_snap, "mail", None)
    effective_mail = (
        _merge_unchanged_mail_secrets(
            agent_config.mail,
            existing_mail_snap,
        )
        if mail_was_set and agent_config.mail is not None
        else (None if mail_was_set else existing_mail_snap)
    )
    _validate_mail_backend_compatibility(
        effective_backend,
        effective_mail,
    )

    if effective_mail is not None:
        _validate_mail_config(effective_mail)

    update_data = agent_config.model_dump(exclude_unset=True)
    previous_config = existing_config_snap

    def apply_update(existing_config: AgentProfileConfig) -> None:
        nonlocal previous_config
        previous_config = deepcopy(existing_config)
        previous_config.workspace_dir = canonical_workspace_dir

        requested = AgentProfileConfig.model_validate(
            {**existing_config.model_dump(), **update_data},
        )
        if mail_was_set:
            requested.mail = (
                _merge_unchanged_mail_secrets(
                    agent_config.mail,
                    existing_config.mail,
                )
                if agent_config.mail is not None
                else None
            )
        else:
            # Secret fields are intentionally excluded from model_dump(), so
            # restore the authoritative in-memory mail model after validating
            # the ordinary merged fields.
            requested.mail = deepcopy(existing_config.mail)
        # Re-check the backend/mail exclusivity on the merged config
        # inside the file lock: a concurrent update may have switched
        # the persisted backend after the unlocked snapshot check.
        _validate_mail_backend_compatibility(
            requested.backend,
            requested.mail,
        )
        if requested.mail is not None:
            _validate_mail_config(requested.mail)
        old_memory = existing_config.running.reme_light_memory_config
        old_embedding = old_memory.embedding_model_config
        requested_running = update_data.get("running")
        if requested_running is not None:
            new_memory = requested.running.reme_light_memory_config
            new_embedding = new_memory.embedding_model_config
            if old_embedding != new_embedding:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Embedding configuration must be updated through "
                        "/workspace/running-config so the live ReMe runtime "
                        "can be changed transactionally"
                    ),
                )
        for key in update_data:
            if key not in {"id", "workspace_dir"}:
                setattr(existing_config, key, getattr(requested, key))
        existing_config.id = agentId
        existing_config.workspace_dir = canonical_workspace_dir

    try:
        updated_config = await update_agent_config_async(
            agentId,
            apply_update,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Keep the secret-free DriverCard and encrypted credential in lockstep with
    # *persisted* final configuration.  In particular, an explicit mail=null
    # or a backend switch must revoke the old MCP capability before reload.
    try:
        driver_card_synced = await run_sync_io(
            _sync_aiarbmail_driver_card,
            workspace_dir,
            updated_config.mail,
            updated_config.backend,
            force_rewrite=mail_was_set,
        )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to synchronize aiarbmail driver for agent %s",
            sanitize_log_value(agentId),
            exc_info=True,
        )
        driver_card_synced = False

    if not driver_card_synced:
        # The runtime has not been reloaded yet, so restoring the previous
        # config keeps its live state coherent. The failed sync already
        # revokes a card containing superseded credentials; regenerate the
        # previous card only after the old config is durable again.
        (
            rollback_configured,
            rollback_driver,
        ) = await _rollback_aiarbmail_update(
            agentId,
            previous_config,
            workspace_dir,
        )

        rollback_detail = (
            "The previous mail configuration was restored."
            if rollback_configured and rollback_driver
            else "Rollback was incomplete; the driver was left disabled."
        )
        raise HTTPException(
            status_code=500,
            detail=(
                "The aiarbmail driver card could not be synchronized. "
                f"{rollback_detail} Check workspace permissions and retry."
            ),
        )

    if updated_config.mail is not None and updated_config.backend == "aiarb":
        await run_sync_io(
            _ensure_contacts_file,
            workspace_dir,
            updated_config.language or config.agents.language or "en",
        )
        await run_sync_io(
            _ensure_mail_triage_file,
            workspace_dir,
            updated_config.language or config.agents.language or "en",
        )

    schedule_agent_reload(request, agentId)

    return updated_config


@router.patch(
    "/{agentId}/model-settings",
    response_model=AgentProfileConfig,
    summary="Update agent model settings",
    description="Update only model-routing settings and trigger reload",
)
async def update_agent_model_settings(
    agentId: str = PathParam(...),
    body: AgentModelSettingsPatch = Body(...),
    request: Request = None,
) -> AgentProfileConfig:
    """Patch model-routing fields without overwriting other settings."""
    values = {field: getattr(body, field) for field in body.model_fields_set}

    def apply_settings(existing_config: AgentProfileConfig) -> None:
        for key, value in values.items():
            setattr(existing_config, key, value)

    try:
        updated = await run_sync_io(
            mutate_agent_config,
            agentId,
            apply_settings,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    schedule_agent_reload(request, agentId)
    return updated


@router.post(
    "/{agentId}/memory/reindex",
    summary="Rebuild agent memory index",
    description="Clear and rebuild the ReMe search index for an agent",
)
async def rebuild_agent_memory_index(
    agentId: str = PathParam(...),
    scope: Literal["all", "bm25", "embedding"] = "all",
    request: Request = None,
) -> dict[str, str]:
    """Run the expensive ReMe reindex job as an explicit maintenance task."""
    config = await run_sync_io(load_config)
    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    agent_config = await run_sync_io(load_agent_config, agentId)
    if agent_config.running.memory_manager_backend != "remelight":
        raise HTTPException(
            status_code=400,
            detail="Memory index rebuild is only supported by ReMe Light",
        )

    manager = _get_multi_agent_manager(request)
    workspace = await manager.get_agent(agentId)
    memory_manager = workspace.memory_manager
    if memory_manager is None:
        raise HTTPException(
            status_code=503,
            detail="Memory manager is not available",
        )

    try:
        response = await memory_manager.rebuild_index(scope)
    except EmbeddingReindexUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        if str(exc) == "Memory index rebuild is already running":
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise

    if response is None:
        raise HTTPException(
            status_code=503,
            detail="ReMe is not started or the reindex job failed",
        )
    if not response.success:
        raise HTTPException(status_code=500, detail=str(response.answer))

    return {"status": "completed", "scope": scope}


@router.post(
    "/{agentId}/memory/reindex/undo",
    response_model=EmbeddingModelConfig,
    summary="Undo a pending embedding index rebuild",
    description="Restore the last indexed embedding configuration",
)
async def undo_agent_memory_reindex(
    agentId: str = PathParam(...),
    request: Request = None,
) -> EmbeddingModelConfig:
    """Restore the provider configuration matching the still-valid vectors."""
    agent_config = await run_sync_io(load_agent_config, agentId)
    if agent_config.running.memory_manager_backend != "remelight":
        raise HTTPException(
            status_code=400,
            detail="Embedding index undo is only supported by ReMe Light",
        )
    manager = _get_multi_agent_manager(request)
    workspace = await manager.get_agent(agentId)
    memory_manager = workspace.memory_manager
    if memory_manager is None:
        raise HTTPException(
            status_code=503,
            detail="Memory manager is not available",
        )

    try:
        restored = await memory_manager.undo_embedding_reindex()
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        if str(exc) == "Memory index rebuild is already running":
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return restored


@router.get(
    "/{agentId}/memory/runtime-status",
    response_model=MemoryRuntimeStatus,
    summary="Get agent memory runtime state",
    description="Return in-memory ReMe lifecycle state without a ReMe lease",
)
async def get_agent_memory_runtime_status(
    agentId: str = PathParam(...),
    request: Request = None,
) -> MemoryRuntimeStatus:
    """Return immediately even while an exclusive lifecycle job is active."""
    config = await run_sync_io(load_config)
    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    agent_config = await run_sync_io(load_agent_config, agentId)
    if agent_config.running.memory_manager_backend != "remelight":
        raise HTTPException(
            status_code=400,
            detail="Memory status is only supported by ReMe Light",
        )

    manager = _get_multi_agent_manager(request)
    workspace = manager.get_loaded_agent(agentId)
    if workspace is None or workspace.memory_manager is None:
        raise HTTPException(status_code=503, detail="Agent is not running")
    memory_config = agent_config.running.reme_light_memory_config
    runtime_status = workspace.memory_manager.get_runtime_status(
        auto_memory_interval=memory_config.auto_memory_interval,
    )
    runtime_status["embedding_reindex_required"] = bool(
        memory_config.needs_reindex,
    )
    runtime_status["embedding_reindex_undo_available"] = bool(
        memory_config.needs_reindex
        and memory_config.pending_reindex_embedding_config is not None,
    )
    return MemoryRuntimeStatus.model_validate(
        runtime_status,
    )


@router.get(
    "/{agentId}/memory/status",
    response_model=ReMeMemoryStatusResponse,
    summary="Get agent ReMe memory status",
    description="Return ReMe component memory estimates and process RSS",
)
async def get_agent_memory_status(
    agentId: str = PathParam(...),
    request: Request = None,
) -> ReMeMemoryStatusResponse:
    """Inspect the currently running ReMe instance without reloading it."""
    config = await run_sync_io(load_config)
    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    agent_config = await run_sync_io(load_agent_config, agentId)
    if agent_config.running.memory_manager_backend != "remelight":
        raise HTTPException(
            status_code=400,
            detail="Memory status is only supported by ReMe Light",
        )

    manager = _get_multi_agent_manager(request)
    workspace = manager.get_loaded_agent(agentId)
    if workspace is None:
        raise HTTPException(
            status_code=503,
            detail="Agent is not running",
        )
    memory_manager = workspace.memory_manager
    if memory_manager is None:
        raise HTTPException(
            status_code=503,
            detail="Memory manager is not available",
        )

    response = await memory_manager.reme_status()
    if response is None:
        raise HTTPException(
            status_code=503,
            detail="ReMe is not started or status reporting is unavailable",
        )
    if not response.success:
        raise HTTPException(status_code=500, detail=str(response.answer))

    metadata = getattr(response, "metadata", None) or {}
    memory = metadata.get("status", {}).get("memory")
    if not isinstance(memory, dict):
        raise HTTPException(
            status_code=500,
            detail="ReMe returned an invalid memory status payload",
        )
    memory_config = agent_config.running.reme_light_memory_config
    runtime_status = memory_manager.get_runtime_status(
        auto_memory_interval=memory_config.auto_memory_interval,
    )
    runtime_status["embedding_reindex_required"] = bool(
        memory_config.needs_reindex,
    )
    runtime_status["embedding_reindex_undo_available"] = bool(
        memory_config.needs_reindex
        and memory_config.pending_reindex_embedding_config is not None,
    )
    try:
        return ReMeMemoryStatusResponse.model_validate(
            {
                **memory,
                "runtime": runtime_status,
            },
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail="ReMe returned an invalid memory status payload",
        ) from exc


@router.get(
    "/{agentId}/memory/graph",
    response_model=MemoryGraphSnapshot,
    summary="Get agent memory graph",
    description="Return the category-rooted ReMe wikilink graph",
)
async def get_agent_memory_graph(
    agentId: str = PathParam(...),
    request: Request = None,
) -> MemoryGraphSnapshot:
    """Return a frontend-ready graph snapshot from embedded ReMe."""

    def load_memory_configs() -> AgentProfileConfig:
        config = load_config()
        if agentId not in config.agents.profiles:
            raise HTTPException(
                status_code=404,
                detail=f"Agent '{agentId}' not found",
            )
        return load_agent_config(agentId)

    agent_config = await run_sync_io(load_memory_configs)
    if agent_config.running.memory_manager_backend != "remelight":
        raise HTTPException(
            status_code=400,
            detail="Memory graph is only supported by ReMe Light",
        )

    manager = _get_multi_agent_manager(request)
    workspace = await manager.get_agent(agentId)
    memory_manager = workspace.memory_manager
    if memory_manager is None:
        raise HTTPException(
            status_code=503,
            detail="Memory manager is not available",
        )

    response = await memory_manager.graph_snapshot()
    if response is None:
        raise HTTPException(
            status_code=503,
            detail="ReMe is not started or the graph snapshot job failed",
        )
    if not response.success:
        raise HTTPException(status_code=500, detail=str(response.answer))

    snapshot = MemoryGraphSnapshot.model_validate(response.answer)
    reme_config = agent_config.running.reme_light_memory_config
    roots = sorted(
        (
            ("daily", reme_config.daily_dir),
            ("digest", reme_config.digest_dir),
        ),
        key=lambda item: len(item[1].replace("\\", "/").strip("/").split("/")),
        reverse=True,
    )
    for node in snapshot.nodes:
        if not node.indexed or node.virtual:
            continue
        node_path = node.path.replace("\\", "/").strip("/")
        for section, configured_root in roots:
            root = configured_root.replace("\\", "/").strip("/")
            prefix = f"{root}/"
            if root and node_path.startswith(prefix):
                node.section = section
                prefix_length = len(prefix)
                node.relative_path = node_path[prefix_length:]
                break

    return snapshot


@router.delete(
    "/{agentId}",
    summary="Delete agent",
    description="Delete agent and workspace (cannot delete default agent)",
)
async def delete_agent(
    agentId: str = PathParam(...),
    request: Request = None,
) -> dict:
    """Delete an agent."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    if agentId in _PROTECTED_AGENT_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete the protected agent '{agentId}'",
        )

    manager = _get_multi_agent_manager(request)
    if manager.is_agent_startup_in_progress(agentId):
        raise HTTPException(
            status_code=409,
            detail=f"Agent '{agentId}' cannot be deleted while starting",
        )
    await manager.stop_agent(agentId)

    def remove_agent(latest_config: Any) -> None:
        if agentId not in latest_config.agents.profiles:
            raise HTTPException(
                status_code=404,
                detail=f"Agent '{agentId}' not found",
            )
        del latest_config.agents.profiles[agentId]
        latest_config.agents.agent_order = _normalized_agent_order(
            latest_config,
        )

    await run_sync_io(mutate_config, remove_agent)

    return {"success": True, "agent_id": agentId}


@router.patch(
    "/{agentId}/toggle",
    summary="Toggle agent enabled state",
    description="Enable or disable an agent (cannot disable default agent)",
)
async def toggle_agent_enabled(
    agentId: str = PathParam(...),
    enabled: bool = Body(..., embed=True),
    request: Request = None,
) -> dict:
    """Toggle agent enabled state."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    if agentId in _PROTECTED_AGENT_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable the protected agent '{agentId}'",
        )

    agent_ref = config.agents.profiles[agentId]
    manager = _get_multi_agent_manager(request)

    if not enabled and manager.is_agent_startup_in_progress(agentId):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Agent '{agentId}' is still starting and cannot be "
                "disabled yet"
            ),
        )

    if not enabled and getattr(agent_ref, "enabled", True):
        await manager.stop_agent(agentId)

    def apply_enabled(latest_config: Any) -> None:
        if agentId not in latest_config.agents.profiles:
            raise HTTPException(
                status_code=404,
                detail=f"Agent '{agentId}' not found",
            )
        latest_config.agents.profiles[agentId].enabled = enabled

    await run_sync_io(mutate_config, apply_enabled)

    if enabled:
        manager.schedule_agent_startup(agentId)

    return {
        "success": True,
        "agent_id": agentId,
        "enabled": enabled,
    }


def _apply_workspace_md_templates(
    workspace_dir: Path,
    language: str,
    *,
    md_template_id: str | None,
    exclude_md_filenames: set[str] | None = None,
) -> None:
    """Copy common and template-specific markdown files for a workspace."""
    copy_workspace_md_files(
        language,
        workspace_dir,
        md_template_id=md_template_id,
        exclude_filenames=exclude_md_filenames,
    )


def _ensure_heartbeat_file(workspace_dir: Path, language: str) -> None:
    """Create the default HEARTBEAT.md if it is missing."""
    heartbeat_file = workspace_dir / "HEARTBEAT.md"
    if heartbeat_file.exists():
        return

    default_heartbeat_mds = {
        "zh": """# Heartbeat checklist
- 扫描收件箱紧急邮件
- 查看未来 2h 的日历
- 检查待办是否卡住
- 若安静超过 8h，轻量 check-in
""",
        "en": """# Heartbeat checklist
- Scan inbox for urgent email
- Check calendar for next 2h
- Check tasks for blockers
- Light check-in if quiet for 8h
""",
        "ru": """# Heartbeat checklist
- Проверить входящие на срочные письма
- Просмотреть календарь на ближайшие 2 часа
- Проверить задачи на наличие блокировок
- Лёгкая проверка при отсутствии активности более 8 часов
""",
    }
    heartbeat_content = default_heartbeat_mds.get(
        language,
        default_heartbeat_mds["en"],
    )
    with open(heartbeat_file, "w", encoding="utf-8") as file:
        file.write(heartbeat_content.strip())


def _install_initial_skills(
    workspace_dir: Path,
    skill_names: list[str] | None,
) -> None:
    """Install requested initial skills from the skill pool."""
    if not skill_names:
        return

    pool_service = SkillPoolService()
    for skill_name in skill_names:
        try:
            result = pool_service.download_to_workspace(
                skill_name=skill_name,
                workspace_dir=workspace_dir,
                overwrite=False,
            )
            if result.get("success"):
                continue
            logger.warning(
                "Failed to install initial skill %s for %s: %s",
                sanitize_log_value(skill_name),
                sanitize_log_value(workspace_dir),
                sanitize_log_value(result.get("reason", "unknown")),
            )
        except Exception as e:
            logger.warning(
                "Failed to install initial skill %s for %s: %s",
                sanitize_log_value(skill_name),
                sanitize_log_value(workspace_dir),
                sanitize_log_value(e),
            )


_ALLOWED_MAIL_DOMAINS = {
    "163.com",
    "126.com",
    "yeah.net",
    "qq.com",
    "foxmail.com",
    "sina.com",
    "sina.cn",
    "aliyun.com",
    "gmail.com",
    "exmail.qq.com",
    "qiye.aliyun.com",
    "qiye.163.com",
}

# Domains whose authorization codes (or app-specific passwords) are
# exactly 16 characters.  Other allowed domains use login passwords
# (or client-specific passwords) of variable length.
_AUTH_CODE_16_CHAR_DOMAINS = frozenset(
    {
        "163.com",
        "126.com",
        "yeah.net",
        "qq.com",
        "foxmail.com",
        "sina.com",
        "sina.cn",
        "gmail.com",
    },
)

# Microsoft disabled basic auth (and app passwords) for personal
# IMAP/SMTP in September 2024; only OAuth2 works now, which this
# version does not support.
_MICROSOFT_MAIL_DOMAINS = {
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "office365.com",
}

# Basic sanity check for custom enterprise-mail domains coming from
# free-form frontend input: labels of alnum/hyphen joined by dots.
_MAIL_DOMAIN_RE = re.compile(
    r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$",
)


def _validate_mail_backend_compatibility(
    backend: str | None,
    mail: AgentMailConfig | None,
) -> None:
    """Reject mailbox configuration on unsupported agent backends."""
    if mail is not None and (backend or "aiarb") != "aiarb":
        raise HTTPException(
            status_code=400,
            detail="Mail configuration is only supported for aiarb backend",
        )


def _merge_unchanged_mail_secrets(
    incoming: AgentMailConfig,
    existing: AgentMailConfig | None,
) -> AgentMailConfig:
    """Treat blank edit-form secrets as "keep existing" for one mailbox.

    GET responses omit secret fields, so the Console submits blanks when a
    user edits unrelated agent settings.  Secrets are inherited only when the
    mailbox mode and public identity are unchanged; changing the account still
    requires fresh credentials and is validated normally.
    """
    merged = incoming.model_copy(deep=True)
    if existing is None:
        return merged

    def identity(mail: AgentMailConfig) -> tuple[bool, str, str, str]:
        credential = mail.credential
        return (
            mail.is_new_account,
            (credential.name or "").strip().lower(),
            (credential.domain or "").strip().lower(),
            (credential.provider or "").strip().lower(),
        )

    if identity(merged) != identity(existing):
        return merged
    for field_name in ("auth_code", "password", "phone_number"):
        if not getattr(merged.credential, field_name):
            setattr(
                merged.credential,
                field_name,
                getattr(existing.credential, field_name),
            )
    return merged


def _validate_mail_config(mail: AgentMailConfig) -> None:
    # pylint: disable=too-many-branches
    """Validate the mailbox management configuration.

    Raises HTTPException(400) when validation fails.
    """
    credential = mail.credential
    provider = (credential.provider or "").strip()
    if provider and provider not in _ENTERPRISE_MAIL_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported mail provider '{provider}', allowed: "
                f"'' (auto-detect) or "
                f"{sorted(_ENTERPRISE_MAIL_PROVIDERS)}"
            ),
        )
    domain = (credential.domain or "").strip().lower()
    if domain in _MICROSOFT_MAIL_DOMAINS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Mail domain '{domain}' is not supported: since "
                "September 2024 Microsoft only allows OAuth2 for "
                "IMAP/SMTP access (basic auth and app passwords are "
                "both disabled). This version does not support "
                "OAuth2 — please use another mailbox."
            ),
        )
    if provider:
        # Well-known domains resolve their IMAP/SMTP hosts automatically;
        # combining them with an explicit enterprise provider would inject
        # mismatched host overrides.
        if domain in _ALLOWED_MAIL_DOMAINS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Mail domain '{domain}' is a well-known domain and "
                    "must not be combined with an enterprise mail "
                    "provider; leave provider empty (auto-detect)"
                ),
            )
        # Enterprise mail with a custom domain: accept any
        # syntactically valid domain instead of the whitelist.
        if not domain or not _MAIL_DOMAIN_RE.match(domain):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid mail domain '{credential.domain}' for "
                    f"enterprise mail provider '{provider}'"
                ),
            )
    elif domain not in _ALLOWED_MAIL_DOMAINS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported mail domain '{credential.domain}', "
                f"allowed: {sorted(_ALLOWED_MAIL_DOMAINS)}"
            ),
        )

    if mail.push is not None:
        if len(mail.push.rules) > 50:
            raise HTTPException(
                status_code=400,
                detail="push.rules supports at most 50 rules",
            )
        for index, rule in enumerate(mail.push.rules):
            if rule.action == "move" and not rule.param.strip():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"push.rules[{index}]: param (target folder) "
                        "is required when action is 'move'"
                    ),
                )

    if mail.is_new_account:
        # Registration secrets are entered directly on the provider page and
        # are no longer part of AIArb's dedicated-mailbox form.  A blank
        # auth_code means registration is still pending; supplying the final
        # provider credential completes provisioning in the same UI.
        credential.password = ""
        credential.phone_number = ""
        if not credential.auth_code:
            return
        mail.is_new_account = False

    if domain in _AUTH_CODE_16_CHAR_DOMAINS:
        if len(credential.auth_code) != 16:
            raise HTTPException(
                status_code=400,
                detail=(
                    "auth_code must be exactly 16 characters "
                    "(authorization code or app-specific password)"
                ),
            )
    elif not credential.auth_code:
        raise HTTPException(
            status_code=400,
            detail=(
                "auth_code (login password or client-specific "
                "password) is required"
            ),
        )
    if not credential.name:
        raise HTTPException(
            status_code=400,
            detail="credential name (mailbox username) is required",
        )


def _ensure_workspace_md_file(
    workspace_dir: Path,
    language: str,
    filename: str,
) -> None:
    """Copy a md_files template into the workspace if missing.

    Thin wrapper over :func:`ensure_workspace_md_file`, kept for the
    router-local call sites.  Idempotent and never raises.
    """
    ensure_workspace_md_file(workspace_dir, language, filename)


def _ensure_contacts_file(workspace_dir: Path, language: str) -> None:
    """Copy the CONTACTS.md template into the workspace if missing."""
    _ensure_workspace_md_file(workspace_dir, language, "CONTACTS.md")


def _ensure_mail_triage_file(workspace_dir: Path, language: str) -> None:
    """Copy the MAIL_TRIAGE.md seed tree into the workspace if missing."""
    _ensure_workspace_md_file(workspace_dir, language, "MAIL_TRIAGE.md")


def _remove_bootstrap_md(workspace_dir: Path) -> None:
    """Remove BOOTSTRAP.md (and its completion flag) from a workspace."""
    bootstrap = workspace_dir / "BOOTSTRAP.md"
    try:
        if bootstrap.exists():
            bootstrap.unlink()
            logger.info(
                "Removed BOOTSTRAP.md from group chat host workspace %s",
                workspace_dir,
            )
        flag = workspace_dir / ".bootstrap_completed"
        if flag.exists():
            flag.unlink()
    except OSError as exc:
        logger.warning(
            "Could not remove BOOTSTRAP.md from %s: %s",
            workspace_dir,
            exc,
        )


def _initialize_agent_workspace(
    workspace_dir: Path,
    skill_names: list[str] | None = None,
    md_template_id: str | None = None,
    language: str | None = None,
    *,
    apply_md_templates: bool = True,
    create_skills_dir: bool = True,
    create_jobs_file: bool = True,
    exclude_md_filenames: set[str] | None = None,
) -> None:
    """Initialize agent workspace with only explicitly requested skills."""
    from ...config import load_config as load_global_config

    (workspace_dir / "sessions").mkdir(exist_ok=True)
    (workspace_dir / "memory").mkdir(exist_ok=True)
    if create_skills_dir:
        get_workspace_skills_dir(workspace_dir).mkdir(exist_ok=True)

    config = load_global_config()
    if not language:
        language = config.agents.language or "zh"

    if apply_md_templates:
        _apply_workspace_md_templates(
            workspace_dir,
            language,
            md_template_id=md_template_id,
            exclude_md_filenames=exclude_md_filenames,
        )
        _ensure_heartbeat_file(workspace_dir, language)
    _install_initial_skills(workspace_dir, skill_names)

    if create_jobs_file:
        jobs_file = workspace_dir / "jobs.json"
        if not jobs_file.exists():
            with open(jobs_file, "w", encoding="utf-8") as file:
                json.dump(
                    {"version": 1, "jobs": []},
                    file,
                    ensure_ascii=False,
                    indent=2,
                )

    chats_file = workspace_dir / "chats.json"
    if not chats_file.exists():
        with open(chats_file, "w", encoding="utf-8") as file:
            json.dump(
                {"version": 1, "chats": []},
                file,
                ensure_ascii=False,
                indent=2,
            )


class MigrateWorkspaceRequest(BaseModel):
    """Request model for migrating an agent's workspace directory."""

    new_workspace_dir: str
    migrate_files: bool = True


class MigrateWorkspaceResponse(BaseModel):
    """Response model for a workspace migration."""

    success: bool
    old_workspace_dir: str
    new_workspace_dir: str
    migrated: bool


@router.post(
    "/{agentId}/migrate-workspace",
    response_model=MigrateWorkspaceResponse,
    summary="Migrate agent workspace",
    description="Change agent workspace directory with optional file migration",
)
async def migrate_workspace(
    agentId: str = PathParam(...),
    body: MigrateWorkspaceRequest = Body(...),
    request: Request = None,
) -> MigrateWorkspaceResponse:
    """Migrate agent workspace to a new directory."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    old_dir = Path(config.agents.profiles[agentId].workspace_dir).expanduser()
    new_dir = Path(body.new_workspace_dir).expanduser()

    if new_dir.resolve() == old_dir.resolve():
        return MigrateWorkspaceResponse(
            success=True,
            old_workspace_dir=str(old_dir),
            new_workspace_dir=str(new_dir),
            migrated=False,
        )

    def migrate_files() -> bool:
        migrated = False
        if body.migrate_files and old_dir.is_dir():
            new_dir.mkdir(parents=True, exist_ok=True)
            for item in old_dir.iterdir():
                dest = new_dir / item.name
                if not dest.exists():
                    try:
                        if item.is_dir():
                            shutil.copytree(str(item), str(dest))
                        else:
                            shutil.copy2(str(item), str(dest))
                    except Exception as exc:
                        logger.warning(
                            "Failed to migrate %s: %s", item.name, exc,
                        )
            migrated = True
        else:
            new_dir.mkdir(parents=True, exist_ok=True)
        return migrated

    migrated = await run_sync_io(migrate_files)

    def apply_migration(latest_config: Any) -> None:
        if agentId not in latest_config.agents.profiles:
            raise HTTPException(
                status_code=404,
                detail=f"Agent '{agentId}' not found",
            )
        latest_config.agents.profiles[agentId].workspace_dir = str(new_dir)

    await run_sync_io(mutate_config, apply_migration)

    def update_agent_workspace() -> None:
        existing_config = load_agent_config(agentId)
        existing_config.workspace_dir = str(new_dir)
        save_agent_config(agentId, existing_config)

    await run_sync_io(update_agent_workspace)

    schedule_agent_reload(request, agentId)

    logger.info(
        "Migrated agent %s workspace: %s -> %s (migrated_files=%s)",
        sanitize_log_value(agentId),
        sanitize_log_value(old_dir),
        sanitize_log_value(new_dir),
        migrated,
    )

    return MigrateWorkspaceResponse(
        success=True,
        old_workspace_dir=str(old_dir),
        new_workspace_dir=str(new_dir),
        migrated=migrated,
    )


_AVATAR_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
_AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024
_AVATARS_DIR_NAME = "avatars"


def _get_avatars_dir() -> Path:
    """Return the global avatars directory under WORKING_DIR."""
    avatars_dir = Path(WORKING_DIR) / _AVATARS_DIR_NAME
    avatars_dir.mkdir(parents=True, exist_ok=True)
    return avatars_dir


@router.post(
    "/{agentId}/avatar",
    summary="Upload agent avatar",
    description="Upload a custom avatar image for an agent",
)
async def upload_agent_avatar(
    agentId: str = PathParam(...),
    file: UploadFile = File(..., description="Avatar image file"),
) -> dict:
    """Upload a custom avatar image for an agent."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No filename provided",
        )

    ext = Path(file.filename).suffix.lower()
    if ext not in _AVATAR_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File extension '{ext}' not allowed. Allowed: "
                f"{', '.join(sorted(_AVATAR_ALLOWED_EXTENSIONS))}"
            ),
        )

    data = await file.read()
    if len(data) > _AVATAR_MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                "File too large. Maximum size: "
                f"{_AVATAR_MAX_SIZE_BYTES // (1024 * 1024)}MB"
            ),
        )

    def write_avatar() -> str:
        avatars_dir = _get_avatars_dir()
        existing_config = load_agent_config(agentId)
        old_avatar = getattr(existing_config, "avatar", None)
        if old_avatar and old_avatar.startswith("/api/agents/avatars/"):
            old_filename = old_avatar.rsplit("/", 1)[-1]
            old_filepath = avatars_dir / old_filename
            if old_filepath.exists():
                try:
                    old_filepath.unlink()
                except OSError:
                    pass
        filename = f"{agentId}_{uuid.uuid4().hex[:8]}{ext}"
        filepath = avatars_dir / filename
        with open(filepath, "wb") as handle:
            handle.write(data)
        avatar_url = f"/api/agents/avatars/{filename}"
        existing_config.avatar = avatar_url
        save_agent_config(agentId, existing_config)
        return avatar_url

    avatar_url = await run_sync_io(write_avatar)

    return {"success": True, "avatar": avatar_url}


@router.get(
    "/avatars/{filename}",
    summary="Get agent avatar file",
    description="Serve an uploaded agent avatar image",
)
async def get_agent_avatar(
    filename: str = PathParam(...),
):
    """Serve an uploaded agent avatar image."""
    avatars_dir = _get_avatars_dir()
    filepath = avatars_dir / filename

    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Avatar not found")

    resolved = filepath.resolve()
    avatars_resolved = avatars_dir.resolve()
    if not resolved.is_relative_to(avatars_resolved):
        raise HTTPException(status_code=403, detail="Access denied")

    return FileResponse(str(filepath))


@router.delete(
    "/{agentId}/avatar",
    summary="Delete agent avatar",
    description="Remove custom avatar and revert to default",
)
async def delete_agent_avatar(
    agentId: str = PathParam(...),
) -> dict:
    """Delete custom avatar for an agent, reverting to default."""
    config = await run_sync_io(load_config)

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    def remove_avatar() -> None:
        existing_config = load_agent_config(agentId)
        old_avatar = getattr(existing_config, "avatar", None)
        if old_avatar and old_avatar.startswith("/api/agents/avatars/"):
            old_filename = old_avatar.rsplit("/", 1)[-1]
            old_filepath = _get_avatars_dir() / old_filename
            if old_filepath.exists():
                try:
                    old_filepath.unlink()
                except OSError:
                    pass
        existing_config.avatar = None
        save_agent_config(agentId, existing_config)

    await run_sync_io(remove_avatar)

    return {"success": True, "avatar": None}
