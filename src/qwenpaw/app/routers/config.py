# -*- coding: utf-8 -*-

import asyncio
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
)
from pydantic import BaseModel, Field

from ..utils import schedule_agent_reload
from ...config import (
    load_config,
    save_config,
    ChannelConfig,
    ChannelConfigUnion,
    get_available_channels,
    ToolGuardConfig,
    ToolGuardRuleConfig,
)
from ..channels.registry import BUILTIN_CHANNEL_KEYS
from ...config.timezone import normalize_tz
from ...config.config import (
    AgentsLLMRoutingConfig,
    ConsoleConfig,
    DingTalkConfig,
    DiscordConfig,
    FeishuConfig,
    HeartbeatConfig,
    IMessageChannelConfig,
    MatrixConfig,
    MattermostConfig,
    MQTTConfig,
    QQConfig,
    SIPChannelConfig,
    SkillScannerConfig,
    SkillScannerWhitelistEntry,
    TelegramConfig,
    VoiceChannelConfig,
    WecomConfig,
)
from ...agents.acp.core import ACPConfig, ACPAgentConfig
from ...agents.acp.node_runtime import (
    ACPNodeRuntimeStatus,
    get_node_runtime_status,
    resolve_node_runtime,
)

from .schemas_config import (
    ChannelHealthResponse,
    ChannelRestartResponse,
    HeartbeatBody,
)
from ..channels.qrcode_auth_handler import (
    QRCODE_AUTH_HANDLERS,
    generate_qrcode_image,
)

router = APIRouter(prefix="/config", tags=["config"])


_CHANNEL_CONFIG_CLASS_MAP = {
    "telegram": TelegramConfig,
    "dingtalk": DingTalkConfig,
    "discord": DiscordConfig,
    "feishu": FeishuConfig,
    "qq": QQConfig,
    "imessage": IMessageChannelConfig,
    "console": ConsoleConfig,
    "voice": VoiceChannelConfig,
    "sip": SIPChannelConfig,
    "mattermost": MattermostConfig,
    "mqtt": MQTTConfig,
    "matrix": MatrixConfig,
    "wecom": WecomConfig,
}
_ALLOWED_ACP_TOOL_PARSE_MODES = {
    "call_title",
    "update_detail",
    "call_detail",
}


class ACPNodeRuntimeUpdate(BaseModel):
    node_path: str = ""


@router.get(
    "/channels",
    summary="List all channels",
    description="Retrieve configuration for all available channels",
)
async def list_channels(request: Request) -> dict:
    """List all channel configs (filtered by available channels)."""
    from ..agent_context import get_agent_for_request

    agent = await get_agent_for_request(request)
    agent_config = agent.config
    available = get_available_channels()

    # Get channel configs from agent's config (with fallback to empty)
    channels_config = agent_config.channels
    if channels_config is None:
        # No channels config yet, use empty defaults
        all_configs = {}
    else:
        all_configs = channels_config.model_dump()
        extra = getattr(channels_config, "__pydantic_extra__", None) or {}
        all_configs.update(extra)

    # Return all available channels (use default config if not saved)
    result = {}
    for key in available:
        if key in all_configs:
            channel_data = (
                dict(all_configs[key])
                if isinstance(all_configs[key], dict)
                else all_configs[key]
            )
        else:
            # Channel registered but no config saved yet, use empty default
            channel_data = {"enabled": False, "bot_prefix": ""}
        if isinstance(channel_data, dict):
            channel_data["isBuiltin"] = key in BUILTIN_CHANNEL_KEYS
        result[key] = channel_data

    return result


@router.get(
    "/channels/types",
    summary="List channel types",
    description="Return all available channel type identifiers",
)
async def list_channel_types() -> List[str]:
    """Return available channel type identifiers (env-filtered)."""
    return list(get_available_channels())


@router.get(
    "/channels/schemas",
    summary="Get plugin channel config schemas",
    description=(
        "Return config_fields metadata for plugin-registered channels "
        "so the frontend can render dynamic forms."
    ),
)
async def list_channel_schemas() -> dict:
    """Return plugin channel schemas for frontend form rendering."""
    from ...plugins.registry import PluginRegistry

    registry = PluginRegistry()
    result: dict = {}
    for key, reg in registry.get_registered_channels().items():
        result[key] = {
            "label": reg.label,
            "description": reg.description,
            "plugin_id": reg.plugin_id,
            "config_fields": reg.config_fields,
            "icon": reg.icon,
            "doc_url": reg.doc_url,
        }
    return result


@router.put(
    "/channels",
    response_model=ChannelConfig,
    summary="Update all channels",
    description="Update configuration for all channels at once",
)
async def put_channels(
    request: Request,
    channels_config: ChannelConfig = Body(
        ...,
        description="Complete channel configuration",
    ),
) -> ChannelConfig:
    """Update all channel configs."""
    from ..agent_context import get_agent_for_request
    from ...config.config import save_agent_config

    agent = await get_agent_for_request(request)
    agent.config.channels = channels_config
    save_agent_config(agent.agent_id, agent.config)

    # Hot reload config (async, non-blocking)
    schedule_agent_reload(request, agent.agent_id)

    return channels_config


# ── Channel health check & restart ─────────────────────────────────────────


async def _resolve_channel_manager(
    request: Request,
    channel_name: str = Path(
        ...,
        description="Name of the channel",
        min_length=1,
    ),
):
    """Shared dependency: validate channel name and return channel_manager."""
    from ..agent_context import get_agent_for_request

    available = get_available_channels()
    if channel_name not in available:
        raise HTTPException(
            status_code=404,
            detail=f"Channel '{channel_name}' not available",
        )

    agent = await get_agent_for_request(request)
    channel_manager = agent.channel_manager
    if channel_manager is None:
        raise HTTPException(
            status_code=503,
            detail="Channel manager not initialized",
        )
    return channel_manager


@router.get(
    "/channels/{channel_name}/health",
    response_model=ChannelHealthResponse,
    summary="Health check for a channel",
    description="Return the runtime health status of a specific channel",
)
async def get_channel_health(
    channel_name: str = Path(
        ...,
        description="Name of the channel to check",
        min_length=1,
    ),
    channel_manager=Depends(_resolve_channel_manager),
) -> ChannelHealthResponse:
    """Return health status for a specific channel."""
    try:
        return await channel_manager.get_channel_health(
            channel_name,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Channel '{channel_name}' is not running."
                " It may be disabled or not configured."
            ),
        ) from exc


@router.post(
    "/channels/{channel_name}/restart",
    response_model=ChannelRestartResponse,
    summary="Restart a channel",
    description=(
        "Stop and re-start a specific channel" " without restarting the agent"
    ),
)
async def restart_channel(
    channel_name: str = Path(
        ...,
        description="Name of the channel to restart",
        min_length=1,
    ),
    channel_manager=Depends(_resolve_channel_manager),
) -> ChannelRestartResponse:
    """Restart a specific channel."""
    try:
        return await channel_manager.restart_channel(
            channel_name,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Channel '{channel_name}' is not running."
                " It may be disabled or not configured."
            ),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(f"Failed to restart channel" f" '{channel_name}': {exc}"),
        ) from exc


# ── Unified QR code endpoints for all channels ─────────────────────────────


@router.get(
    "/channels/{channel}/qrcode",
    summary="Get channel authorization QR code",
    description=(
        "Fetch a QR code image (base64 PNG) for the given channel. "
        "Supported channels: " + ", ".join(QRCODE_AUTH_HANDLERS.keys())
    ),
)
async def get_channel_qrcode(request: Request, channel: str) -> dict:
    """Return {qrcode_img, poll_token} for the requested channel."""
    handler = QRCODE_AUTH_HANDLERS.get(channel)
    if handler is None:
        raise HTTPException(
            status_code=404,
            detail=f"QR code not supported for channel: {channel}",
        )

    result = await handler.fetch_qrcode(request)
    qrcode_img = generate_qrcode_image(result.scan_url)
    return {"qrcode_img": qrcode_img, "poll_token": result.poll_token}


@router.get(
    "/channels/{channel}/qrcode/status",
    summary="Poll channel QR code authorization status",
)
async def get_channel_qrcode_status(
    request: Request,
    channel: str,
    token: str,
) -> dict:
    """Return {status, credentials} for the requested channel."""
    handler = QRCODE_AUTH_HANDLERS.get(channel)
    if handler is None:
        raise HTTPException(
            status_code=404,
            detail=f"QR code not supported for channel: {channel}",
        )

    result = await handler.poll_status(token, request)
    return {"status": result.status, "credentials": result.credentials}


@router.get(
    "/channels/{channel_name}",
    response_model=ChannelConfigUnion,
    summary="Get channel config",
    description="Retrieve configuration for a specific channel by name",
)
async def get_channel(
    request: Request,
    channel_name: str = Path(
        ...,
        description="Name of the channel to retrieve",
        min_length=1,
    ),
) -> ChannelConfigUnion:
    """Get a specific channel config by name."""
    from ..agent_context import get_agent_for_request

    available = get_available_channels()
    if channel_name not in available:
        raise HTTPException(
            status_code=404,
            detail=f"Channel '{channel_name}' not found",
        )

    agent = await get_agent_for_request(request)
    channels = agent.config.channels
    if channels is None:
        raise HTTPException(
            status_code=404,
            detail=f"Channel '{channel_name}' not configured",
        )

    single_channel_config = getattr(channels, channel_name, None)
    if single_channel_config is None:
        extra = getattr(channels, "__pydantic_extra__", None) or {}
        single_channel_config = extra.get(channel_name)
    if single_channel_config is None:
        raise HTTPException(
            status_code=404,
            detail=f"Channel '{channel_name}' not found",
        )
    return single_channel_config


@router.put(
    "/channels/{channel_name}",
    response_model=ChannelConfigUnion,
    summary="Update channel config",
    description="Update configuration for a specific channel by name",
)
async def put_channel(
    request: Request,
    channel_name: str = Path(
        ...,
        description="Name of the channel to update",
        min_length=1,
    ),
    single_channel_config: dict = Body(
        ...,
        description="Updated channel configuration",
    ),
) -> ChannelConfigUnion:
    """Update a specific channel config by name."""
    from ..agent_context import get_agent_for_request
    from ...config.config import save_agent_config

    available = get_available_channels()
    if channel_name not in available:
        raise HTTPException(
            status_code=404,
            detail=f"Channel '{channel_name}' not found",
        )

    agent = await get_agent_for_request(request)

    # Initialize channels if not exists
    if agent.config.channels is None:
        agent.config.channels = ChannelConfig()

    config_class = _CHANNEL_CONFIG_CLASS_MAP.get(channel_name)
    if config_class is not None:
        channel_config = config_class(**single_channel_config)
    else:
        # For custom channels, just use the dict
        channel_config = single_channel_config

    # Set channel config in agent's config
    setattr(agent.config.channels, channel_name, channel_config)
    save_agent_config(agent.agent_id, agent.config)

    # Hot reload config (async, non-blocking)
    schedule_agent_reload(request, agent.agent_id)

    return channel_config


@router.get(
    "/acp",
    response_model=ACPConfig,
    summary="Get ACP config",
    description="Retrieve ACP configuration for current agent",
)
async def get_acp_config(request: Request) -> ACPConfig:
    """Return ACP config for the current agent."""
    from ..agent_context import get_agent_for_request

    agent = await get_agent_for_request(request)
    return agent.config.acp or ACPConfig()


@router.put(
    "/acp",
    response_model=ACPConfig,
    summary="Update ACP config",
    description="Update ACP configuration for current agent",
)
async def put_acp_config(
    request: Request,
    acp_config: ACPConfig = Body(
        ...,
        description="Complete ACP configuration",
    ),
) -> ACPConfig:
    """Update ACP config for the current agent."""
    from ..agent_context import get_agent_for_request
    from ...config.config import save_agent_config

    agent = await get_agent_for_request(request)
    agent.config.acp = acp_config
    save_agent_config(agent.agent_id, agent.config)
    schedule_agent_reload(request, agent.agent_id)
    return agent.config.acp


@router.get(
    "/acp/node-runtime",
    response_model=ACPNodeRuntimeStatus,
    summary="Get ACP Node runtime",
    description="Return configured and detected Node runtimes for ACP",
)
async def get_acp_node_runtime() -> ACPNodeRuntimeStatus:
    """Return global ACP Node runtime status."""
    node_path = load_config().acp.node_path
    return await asyncio.to_thread(get_node_runtime_status, node_path)


@router.put(
    "/acp/node-runtime",
    response_model=ACPNodeRuntimeStatus,
    summary="Update ACP Node runtime",
    description="Update the global Node runtime used by ACP subprocesses",
)
async def put_acp_node_runtime(
    body: ACPNodeRuntimeUpdate = Body(...),
) -> ACPNodeRuntimeStatus:
    """Update global ACP Node runtime path."""
    node_path = body.node_path.strip()
    if node_path:
        candidate = await asyncio.to_thread(resolve_node_runtime, node_path)
        if not candidate.available:
            raise HTTPException(
                status_code=400,
                detail={
                    "reason_code": candidate.reason_code,
                    "reason": candidate.reason,
                },
            )

    config = load_config()
    config.acp.node_path = node_path
    save_config(config)
    return await asyncio.to_thread(
        get_node_runtime_status,
        config.acp.node_path,
    )


@router.get(
    "/acp/{agent_name}",
    response_model=ACPAgentConfig,
    summary="Get ACP agent config",
    description="Retrieve ACP configuration for a specific ACP agent",
)
async def get_acp_agent_config(
    request: Request,
    agent_name: str = Path(
        ...,
        description="Name of the ACP agent to retrieve",
        min_length=1,
    ),
) -> ACPAgentConfig:
    """Return config for one ACP agent."""
    from ..agent_context import get_agent_for_request

    agent = await get_agent_for_request(request)
    acp_config = agent.config.acp or ACPConfig()
    acp_agent = acp_config.agents.get(agent_name)
    if acp_agent is None:
        raise HTTPException(
            status_code=404,
            detail=f"ACP agent '{agent_name}' not found",
        )
    return acp_agent


@router.put(
    "/acp/{agent_name}",
    response_model=ACPAgentConfig,
    summary="Update ACP agent config",
    description="Update ACP configuration for a specific ACP agent",
)
async def put_acp_agent_config(
    request: Request,
    agent_name: str = Path(
        ...,
        description="Name of the ACP agent to update",
        min_length=1,
    ),
    acp_agent_config: ACPAgentConfig = Body(
        ...,
        description="Updated ACP agent configuration",
    ),
) -> ACPAgentConfig:
    """Update config for one ACP agent."""
    from ..agent_context import get_agent_for_request
    from ...config.config import save_agent_config

    if acp_agent_config.tool_parse_mode not in _ALLOWED_ACP_TOOL_PARSE_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid tool_parse_mode. Allowed values: "
                + ", ".join(sorted(_ALLOWED_ACP_TOOL_PARSE_MODES))
            ),
        )

    agent = await get_agent_for_request(request)
    if agent.config.acp is None:
        agent.config.acp = ACPConfig()

    agent_name = agent_name.strip()
    if not agent_name:
        raise HTTPException(
            status_code=400,
            detail="ACP agent name cannot be empty",
        )

    agent.config.acp.agents[agent_name] = acp_agent_config
    save_agent_config(agent.agent_id, agent.config)
    schedule_agent_reload(request, agent.agent_id)
    return agent.config.acp.agents[agent_name]


@router.get(
    "/heartbeat",
    summary="Get heartbeat config",
    description="Return current heartbeat config (interval, target, etc.)",
)
async def get_heartbeat(request: Request) -> Any:
    """Return effective heartbeat config (from file or default)."""
    from ..agent_context import get_agent_for_request
    from ...config.config import HeartbeatConfig as HeartbeatConfigModel

    agent = await get_agent_for_request(request)
    hb = agent.config.heartbeat
    if hb is None:
        # Use default if not configured
        hb = HeartbeatConfigModel()
    return hb.model_dump(mode="json", by_alias=True)


@router.put(
    "/heartbeat",
    summary="Update heartbeat config",
    description="Update heartbeat and hot-reload the scheduler",
)
async def put_heartbeat(
    request: Request,
    body: HeartbeatBody = Body(..., description="Heartbeat configuration"),
) -> Any:
    """Update heartbeat config and reschedule the heartbeat job."""
    from ..agent_context import get_agent_for_request
    from ...config.config import save_agent_config

    agent = await get_agent_for_request(request)
    hb = HeartbeatConfig(
        enabled=body.enabled,
        every=body.every,
        target=body.target,
        timeout_seconds=body.timeout_seconds,
        active_hours=body.active_hours,
    )
    agent.config.heartbeat = hb
    save_agent_config(agent.agent_id, agent.config)

    # Reschedule heartbeat (async, non-blocking)
    async def reschedule_in_background():
        try:
            if agent.cron_manager is not None:
                await agent.cron_manager.reschedule_heartbeat()
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                f"Background reschedule failed: {e}",
            )

    asyncio.create_task(reschedule_in_background())

    return hb.model_dump(mode="json", by_alias=True)


@router.post(
    "/heartbeat/run",
    summary="Run heartbeat now",
    description="Trigger one heartbeat execution immediately",
)
async def run_heartbeat_now(request: Request) -> Any:
    """Trigger one heartbeat run in background for quick testing."""
    from ..agent_context import get_agent_for_request
    from ..crons.heartbeat import run_heartbeat_once
    import logging

    workspace = await get_agent_for_request(request)

    async def _run_once_bg() -> None:
        try:
            await run_heartbeat_once(
                workspace=workspace,
                channel_manager=workspace.channel_manager,
                agent_id=workspace.agent_id,
                workspace_dir=workspace.workspace_dir,
            )
        except Exception as e:  # pylint: disable=broad-except
            logging.getLogger(__name__).exception(
                "manual heartbeat run failed: %s",
                e,
            )

    asyncio.create_task(_run_once_bg())
    return {"started": True}


@router.get(
    "/agents/llm-routing",
    response_model=AgentsLLMRoutingConfig,
    summary="Get agent LLM routing settings",
)
async def get_agents_llm_routing() -> AgentsLLMRoutingConfig:
    config = load_config()
    return config.agents.llm_routing


@router.put(
    "/agents/llm-routing",
    response_model=AgentsLLMRoutingConfig,
    summary="Update agent LLM routing settings",
)
async def put_agents_llm_routing(
    body: AgentsLLMRoutingConfig = Body(...),
) -> AgentsLLMRoutingConfig:
    config = load_config()
    config.agents.llm_routing = body
    save_config(config)
    return body


# ── User Timezone ────────────────────────────────────────────────────


@router.get(
    "/user-timezone",
    summary="Get user timezone",
    description="Return the configured user IANA timezone",
)
async def get_user_timezone() -> dict:
    config = load_config()
    return {"timezone": config.user_timezone}


@router.put(
    "/user-timezone",
    summary="Update user timezone",
    description="Set the user IANA timezone",
)
async def put_user_timezone(
    body: dict = Body(..., description="Body with 'timezone' key"),
) -> dict:
    tz = body.get("timezone", "").strip()
    if not tz:
        raise HTTPException(status_code=400, detail="timezone is required")
    resolved = normalize_tz(tz)
    if resolved is None:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid IANA timezone: {tz!r}",
        )
    config = load_config()
    config.user_timezone = resolved
    save_config(config)
    return {"timezone": resolved}


# ── Security / Tool Guard ────────────────────────────────────────────


@router.get(
    "/security/tool-guard",
    response_model=ToolGuardConfig,
    summary="Get tool guard settings",
)
async def get_tool_guard() -> ToolGuardConfig:
    config = load_config()
    return config.security.tool_guard


@router.put(
    "/security/tool-guard",
    response_model=ToolGuardConfig,
    summary="Update tool guard settings",
)
async def put_tool_guard(
    body: ToolGuardConfig = Body(...),
) -> ToolGuardConfig:
    config = load_config()
    config.security.tool_guard = body
    save_config(config)

    from ...security.tool_guard.engine import get_guard_engine

    engine = get_guard_engine()
    engine.enabled = body.enabled
    engine.reload_rules()

    return body


@router.get(
    "/security/tool-guard/builtin-rules",
    response_model=List[ToolGuardRuleConfig],
    summary="List built-in guard rules from YAML files",
)
async def get_builtin_rules() -> List[ToolGuardRuleConfig]:
    from ...security.tool_guard.guardians.rule_guardian import (
        load_rules_from_directory,
    )

    rules = load_rules_from_directory()
    return [
        ToolGuardRuleConfig(
            id=r.id,
            tools=r.tools,
            params=r.params,
            category=r.category.value,
            severity=r.severity.value,
            patterns=r.patterns,
            exclude_patterns=r.exclude_patterns,
            description=r.description,
            remediation=r.remediation,
        )
        for r in rules
    ]


# ── Security / Sandbox ───────────────────────────────────────────────


class SandboxSettingBody(BaseModel):
    """Global governance sandbox switch (``security.sandbox_enabled``)."""

    enabled: bool = Field(
        default=False,
        description=(
            "When True, shell tools with no matching rule run inside the "
            "sandbox without prompting. When False (default), such calls "
            "run directly without the sandbox (no prompt)."
        ),
    )


class SandboxStatusResponse(BaseModel):
    """Sandbox config + runtime effective status."""

    enabled: bool = Field(
        description="The configured value of security.sandbox_enabled.",
    )
    effective: bool = Field(
        description=(
            "Whether the sandbox is actually active this session. "
            "May be False even when enabled=True (e.g. non-admin on Windows)."
        ),
    )
    reason: Optional[str] = Field(
        default=None,
        description=(
            "When effective != enabled, explains why. "
            "None when effective == enabled."
        ),
    )


async def _sandbox_effective_status(
    enabled: bool,
) -> tuple[bool, Optional[str]]:
    """Return (effective, reason) for the sandbox setting.

    Checks both platform-level permissions (admin on Windows) and
    actual sandbox capability availability.

    The capability probe runs in a thread-pool worker via
    ``asyncio.to_thread`` so that the (potentially blocking) first
    call never stalls the async event loop.  Subsequent calls hit
    the ``lru_cache`` and return instantly.
    """
    if not enabled:
        return False, None

    # Check platform-level permissions
    from ...utils.platform import is_windows_admin

    if not is_windows_admin():
        return False, "not_admin"

    # Check if sandbox backend is actually available on this platform.
    # probe_sandbox_support() is lru_cache'd; the first call may block
    # (subprocess.run on Linux), so we offload it to a thread.
    from ...sandbox import probe_sandbox_support

    capability = await asyncio.to_thread(probe_sandbox_support)
    if not capability.supported:
        return False, "unsupported"

    return True, None


@router.get(
    "/security/sandbox",
    response_model=SandboxStatusResponse,
    summary="Get global sandbox switch",
)
async def get_sandbox_setting(
    enabled: Optional[bool] = Query(
        default=None,
        description=(
            "If provided, compute effective/reason for this proposed value "
            "without persisting it. Useful for the frontend to preview the "
            "runtime status before saving."
        ),
    ),
) -> SandboxStatusResponse:
    config = load_config()
    current_enabled = config.security.sandbox_enabled
    # Use the proposed value if provided, otherwise the current config value.
    target_enabled = enabled if enabled is not None else current_enabled
    effective, reason = await _sandbox_effective_status(target_enabled)
    return SandboxStatusResponse(
        enabled=target_enabled,
        effective=effective,
        reason=reason,
    )


@router.put(
    "/security/sandbox",
    response_model=SandboxStatusResponse,
    summary="Update global sandbox switch",
)
async def put_sandbox_setting(
    body: SandboxSettingBody = Body(...),
) -> SandboxStatusResponse:
    config = load_config()
    current_enabled = config.security.sandbox_enabled

    # Idempotent: if the value hasn't changed, return current status
    # without triggering the admin guard. This prevents partial-save
    # issues when the frontend saves other security settings alongside
    # an unchanged sandbox value.
    if body.enabled == current_enabled:
        effective, reason = await _sandbox_effective_status(body.enabled)
        return SandboxStatusResponse(
            enabled=body.enabled,
            effective=effective,
            reason=reason,
        )

    # Guard: enabling sandbox on Windows requires admin privileges.
    # Refuse early with a clear, actionable message rather than letting
    # the user flip the switch and hit cryptic ACL failures later.
    from ...utils.platform import is_windows_admin

    if body.enabled and not is_windows_admin():
        raise HTTPException(
            status_code=403,
            detail=(
                "Sandbox requires administrator privileges on Windows.\n\n"
                "To enable the sandbox, restart QwenPaw with administrator "
                "privileges:\n"
                "  - Desktop: right-click the shortcut "
                "\u2192 Run as administrator\n"
                "  - CLI: open an elevated terminal, then run `qwenpaw app`\n"
                "Then come back to Settings and re-enable the sandbox."
            ),
        )

    config.security.sandbox_enabled = body.enabled
    save_config(config)
    effective, reason = await _sandbox_effective_status(body.enabled)
    return SandboxStatusResponse(
        enabled=body.enabled,
        effective=effective,
        reason=reason,
    )


# ── Security / File Guard ────────────────────────────────────────────


class FileGuardResponse(BaseModel):
    enabled: bool = True
    paths: List[str] = []
    allow_preview_outside_workspace: bool = False


class FileGuardUpdateBody(BaseModel):
    enabled: Optional[bool] = None
    paths: Optional[List[str]] = None
    allow_preview_outside_workspace: Optional[bool] = None


@router.get(
    "/security/file-guard",
    response_model=FileGuardResponse,
    summary="Get file guard settings",
)
async def get_file_guard() -> FileGuardResponse:
    config = load_config()
    fg = config.security.file_guard
    from ...security.tool_guard.guardians.file_guardian import (
        ensure_file_guard_paths,
    )

    paths = ensure_file_guard_paths(fg.sensitive_files or [])
    return FileGuardResponse(
        enabled=fg.enabled,
        paths=paths,
        allow_preview_outside_workspace=fg.allow_preview_outside_workspace,
    )


@router.put(
    "/security/file-guard",
    response_model=FileGuardResponse,
    summary="Update file guard settings",
)
async def put_file_guard(
    body: FileGuardUpdateBody,
) -> FileGuardResponse:
    config = load_config()
    fg = config.security.file_guard

    if body.enabled is not None:
        fg.enabled = body.enabled
    if body.paths is not None:
        from ...security.tool_guard.guardians.file_guardian import (
            ensure_file_guard_paths,
        )

        fg.sensitive_files = ensure_file_guard_paths(body.paths)
    if body.allow_preview_outside_workspace is not None:
        fg.allow_preview_outside_workspace = (
            body.allow_preview_outside_workspace
        )

    save_config(config)

    from ...security.tool_guard.engine import get_guard_engine

    engine = get_guard_engine()
    engine.reload_rules()

    return FileGuardResponse(
        enabled=fg.enabled,
        paths=fg.sensitive_files,
        allow_preview_outside_workspace=fg.allow_preview_outside_workspace,
    )


# ── Security / Skill Scanner ────────────────────────────────────────


@router.get(
    "/security/skill-scanner",
    response_model=SkillScannerConfig,
    summary="Get skill scanner settings",
)
async def get_skill_scanner() -> SkillScannerConfig:
    config = load_config()
    return config.security.skill_scanner


@router.put(
    "/security/skill-scanner",
    response_model=SkillScannerConfig,
    summary="Update skill scanner settings",
)
async def put_skill_scanner(
    body: SkillScannerConfig = Body(...),
) -> SkillScannerConfig:
    config = load_config()
    config.security.skill_scanner = body
    save_config(config)
    return body


@router.get(
    "/security/skill-scanner/blocked-history",
    summary="Get blocked skills history",
)
async def get_blocked_history() -> list:
    from ...security.skill_scanner import get_blocked_history as _get_history

    records = _get_history()
    return [r.to_dict() for r in records]


@router.delete(
    "/security/skill-scanner/blocked-history",
    summary="Clear all blocked skills history",
)
async def delete_blocked_history() -> dict:
    from ...security.skill_scanner import clear_blocked_history

    clear_blocked_history()
    return {"cleared": True}


@router.delete(
    "/security/skill-scanner/blocked-history/{index}",
    summary="Remove a single blocked history entry",
)
async def delete_blocked_entry(
    index: int = Path(..., ge=0),
) -> dict:
    from ...security.skill_scanner import remove_blocked_entry

    ok = remove_blocked_entry(index)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"removed": True}


class WhitelistAddRequest(BaseModel):
    skill_name: str
    content_hash: str = ""


@router.post(
    "/security/skill-scanner/whitelist",
    summary="Add a skill to the whitelist",
)
async def add_to_whitelist(
    body: WhitelistAddRequest = Body(...),
) -> dict:
    skill_name = body.skill_name.strip()
    content_hash = body.content_hash
    if not skill_name:
        raise HTTPException(status_code=400, detail="skill_name is required")

    config = load_config()
    scanner_cfg = config.security.skill_scanner

    for entry in scanner_cfg.whitelist:
        if entry.skill_name == skill_name:
            raise HTTPException(
                status_code=409,
                detail=f"Skill '{skill_name}' is already whitelisted",
            )

    scanner_cfg.whitelist.append(
        SkillScannerWhitelistEntry(
            skill_name=skill_name,
            content_hash=content_hash,
            added_at=datetime.now(timezone.utc).isoformat(),
        ),
    )
    save_config(config)
    return {"whitelisted": True, "skill_name": skill_name}


@router.delete(
    "/security/skill-scanner/whitelist/{skill_name}",
    summary="Remove a skill from the whitelist",
)
async def remove_from_whitelist(
    skill_name: str = Path(..., min_length=1),
) -> dict:
    config = load_config()
    scanner_cfg = config.security.skill_scanner
    original_len = len(scanner_cfg.whitelist)
    scanner_cfg.whitelist = [
        e for e in scanner_cfg.whitelist if e.skill_name != skill_name
    ]
    if len(scanner_cfg.whitelist) == original_len:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_name}' not found in whitelist",
        )
    save_config(config)
    return {"removed": True, "skill_name": skill_name}


# ── Security / Allow No Auth Hosts ────────────────────────────────────


class AllowNoAuthHostsResponse(BaseModel):
    """Response model for allow_no_auth_hosts configuration."""

    hosts: List[str] = Field(
        description="List of IP addresses allowed without authentication",
    )


class AllowNoAuthHostsUpdateBody(BaseModel):
    """Request body for updating allow_no_auth_hosts configuration."""

    hosts: List[str] = Field(
        description="List of IP addresses allowed without authentication",
    )


@router.get(
    "/security/allow-no-auth-hosts",
    response_model=AllowNoAuthHostsResponse,
    summary="Get allow no auth hosts configuration",
)
async def get_allow_no_auth_hosts() -> AllowNoAuthHostsResponse:
    """Get the list of IP addresses allowed without authentication."""
    config = load_config()
    return AllowNoAuthHostsResponse(
        hosts=config.security.allow_no_auth_hosts,
    )


@router.put(
    "/security/allow-no-auth-hosts",
    response_model=AllowNoAuthHostsResponse,
    summary="Update allow no auth hosts configuration",
)
async def put_allow_no_auth_hosts(
    body: AllowNoAuthHostsUpdateBody = Body(...),
) -> AllowNoAuthHostsResponse:
    """Update the list of IP addresses allowed without authentication.

    Validates and normalizes each IP address:
    - Strips whitespace
    - Removes empty strings
    - Deduplicates entries
    - Validates as literal IPv4/IPv6 using ipaddress module
    - Returns 400 on invalid IP addresses
    """
    import ipaddress

    # Normalize and validate IP addresses
    normalized_hosts = []
    seen = set()
    invalid_ips = []

    for host in body.hosts:
        # Strip whitespace
        host = host.strip()

        # Skip empty strings
        if not host:
            continue

        # Validate IP address format
        try:
            # This validates and normalizes the IP address
            ip_obj = ipaddress.ip_address(host)
            # Use the compressed string representation
            normalized_ip = str(ip_obj)

            # Deduplicate
            if normalized_ip not in seen:
                seen.add(normalized_ip)
                normalized_hosts.append(normalized_ip)
        except ValueError:
            invalid_ips.append(host)

    # Return 400 if any invalid IP addresses were provided
    if invalid_ips:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid IP address(es): {', '.join(invalid_ips)}. "
                "Only literal IPv4/IPv6 addresses are allowed."
            ),
        )

    config = load_config()
    config.security.allow_no_auth_hosts = normalized_hosts
    save_config(config)
    return AllowNoAuthHostsResponse(hosts=normalized_hosts)


# ── Document Parser / OCR Configuration ─────────────────────────────────


@router.get(
    "/documents/parser",
    summary="Get document parser configuration",
    description="Retrieve parser settings including OCR configuration",
)
async def get_documents_parser() -> dict:
    config = load_config()
    parser_cfg = config.documents.parser
    return {
        "default_mode": parser_cfg.default_mode,
        "mineru_api_key": parser_cfg.mineru_api_key[:8] + "..." if len(parser_cfg.mineru_api_key) > 8 else parser_cfg.mineru_api_key,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_backend": parser_cfg.mineru_backend,
        "mineru_effort": parser_cfg.mineru_effort,
        "mineru_configured": bool(parser_cfg.mineru_api_key),
    }


@router.get(
    "/documents/parser/ocr-status",
    summary="Check OCR engine status",
    description="Check MinerU configuration and local deployment availability",
)
async def get_ocr_status() -> dict:
    config = load_config()
    parser_cfg = config.documents.parser

    local_status: dict = {"reachable": False}
    if parser_cfg.mineru_mode == "local" or parser_cfg.mineru_base_url != "https://mineru.net/api/v4":
        from ...parsers.mineru_parser import MinerUParser
        local_status = await MinerUParser.check_local_deployment(
            parser_cfg.mineru_base_url or "http://localhost:8000/api/v4"
        )

    return {
        "mineru_configured": bool(parser_cfg.mineru_api_key),
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "local_mineru": local_status,
        "default_mode": parser_cfg.default_mode,
    }


@router.put(
    "/documents/parser",
    summary="Update document parser configuration",
    description="Update parser settings including MinerU configuration",
)
async def put_documents_parser(
    body: dict = Body(
        ...,
        description="Parser configuration fields to update",
    ),
) -> dict:
    config = load_config()
    parser_cfg = config.documents.parser

    if "default_mode" in body:
        mode = body["default_mode"]
        if mode not in ("auto", "cloud_ocr", "local_only"):
            raise HTTPException(status_code=400, detail=f"Invalid default_mode: {mode}")
        parser_cfg.default_mode = mode

    if "mineru_api_key" in body:
        new_key = body["mineru_api_key"]
        if new_key.endswith("..."):
            pass
        else:
            parser_cfg.mineru_api_key = str(new_key)

    if "mineru_base_url" in body:
        parser_cfg.mineru_base_url = str(body["mineru_base_url"])

    if "mineru_mode" in body:
        mode_val = str(body["mineru_mode"])
        if mode_val not in ("cloud", "local"):
            raise HTTPException(status_code=400, detail=f"Invalid mineru_mode: {mode_val}")
        parser_cfg.mineru_mode = mode_val
        if mode_val == "local" and parser_cfg.mineru_base_url == "https://mineru.net/api/v4":
            parser_cfg.mineru_base_url = "http://localhost:8000/api/v4"
        elif mode_val == "cloud" and parser_cfg.mineru_base_url == "http://localhost:8000/api/v4":
            parser_cfg.mineru_base_url = "https://mineru.net/api/v4"

    if "mineru_backend" in body:
        backend_val = str(body["mineru_backend"])
        if backend_val not in ("pipeline", "hybrid", "vlm"):
            raise HTTPException(status_code=400, detail=f"Invalid mineru_backend: {backend_val}")
        parser_cfg.mineru_backend = backend_val

    if "mineru_effort" in body:
        effort_val = str(body["mineru_effort"])
        if effort_val not in ("medium", "high"):
            raise HTTPException(status_code=400, detail=f"Invalid mineru_effort: {effort_val}")
        parser_cfg.mineru_effort = effort_val

    save_config(config)

    try:
        from . import knowledge as _kmod
        _kmod._parser_router = None
    except Exception:
        pass

    return {
        "default_mode": parser_cfg.default_mode,
        "mineru_api_key": parser_cfg.mineru_api_key[:8] + "..." if len(parser_cfg.mineru_api_key) > 8 else parser_cfg.mineru_api_key,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_backend": parser_cfg.mineru_backend,
        "mineru_effort": parser_cfg.mineru_effort,
        "mineru_configured": bool(parser_cfg.mineru_api_key),
    }


# ── MinerU 本地一键部署 ────────────────────────────────────────────────

import logging as _logging
_logger = _logging.getLogger(__name__)

_MINERU_PORT = 8000


def _get_mineru_venv_dir() -> str:
    import os
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    return os.path.join(base, ".mineru-venv")


def _get_mineru_python() -> str | None:
    import os
    import sys
    venv_dir = _get_mineru_venv_dir()
    if sys.platform == "win32":
        python_path = os.path.join(venv_dir, "Scripts", "python.exe")
    else:
        python_path = os.path.join(venv_dir, "bin", "python")
    return python_path if os.path.isfile(python_path) else None


def _get_mineru_api_cmd() -> list[str] | None:
    import os
    import sys
    venv_dir = _get_mineru_venv_dir()
    if sys.platform == "win32":
        api_script = os.path.join(venv_dir, "Scripts", "mineru-api.exe")
    else:
        api_script = os.path.join(venv_dir, "bin", "mineru-api")
    if os.path.isfile(api_script):
        return [api_script, "--host", "0.0.0.0"]
    if sys.platform == "win32":
        api_script = os.path.join(venv_dir, "Scripts", "magic-pdf.exe")
    else:
        api_script = os.path.join(venv_dir, "bin", "magic-pdf")
    if os.path.isfile(api_script):
        return [api_script, "api", "--host", "0.0.0.0"]
    return None


def _is_mineru_installed() -> dict:
    python_path = _get_mineru_python()
    if not python_path:
        return {"installed": False}
    import subprocess
    try:
        r = subprocess.run(
            [python_path, "-c", "import mineru; print(mineru.__version__)"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            return {"installed": True, "version": r.stdout.strip(), "python": python_path}
        r = subprocess.run(
            [python_path, "-c", "import magic_pdf; print(magic_pdf.__version__)"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            return {"installed": True, "version": r.stdout.strip(), "python": python_path, "legacy": True}
        return {"installed": False, "python": python_path}
    except Exception:
        return {"installed": False, "python": python_path}


def _is_mineru_running(port: int = _MINERU_PORT) -> bool:
    import httpx
    try:
        r = httpx.get(f"http://localhost:{port}/api/v4/tasks", timeout=3)
        return True
    except Exception:
        pass
    try:
        r = httpx.get(f"http://localhost:{port}/api/v4/file-urls/batch", timeout=3)
        return True
    except Exception:
        return False


@router.get(
    "/documents/parser/local-mineru-status",
    summary="Check local MinerU installation and service status",
)
async def get_local_mineru_status():
    install_info = _is_mineru_installed()
    running = _is_mineru_running()
    return {
        "installed": install_info.get("installed", False),
        "version": install_info.get("version"),
        "python_path": install_info.get("python"),
        "running": running,
        "venv_dir": _get_mineru_venv_dir(),
    }


@router.post(
    "/documents/parser/deploy-local-mineru",
    summary="One-click deploy local MinerU",
    description="Create isolated venv, install magic-pdf[full], start API server. No Docker needed.",
)
async def deploy_local_mineru(body: dict = Body(default={})):
    import subprocess
    import sys
    import asyncio
    import os
    import traceback

    port = body.get("port", _MINERU_PORT)
    mirror_url = body.get("mirror_url", "https://pypi.tuna.tsinghua.edu.cn/simple")
    use_mirror = body.get("use_mirror", True)
    venv_dir = _get_mineru_venv_dir()

    # ── Step 1: Create venv if not exists ────────────────────────────
    if not _get_mineru_python():
        _logger.info("Creating MinerU virtual environment at %s", venv_dir)
        try:
            def _create_venv():
                if os.path.isdir(venv_dir):
                    _logger.info("Removing incomplete venv at %s", venv_dir)
                    import shutil
                    shutil.rmtree(venv_dir, ignore_errors=True)

                result = subprocess.run(
                    [sys.executable, "-m", "venv", venv_dir],
                    capture_output=True, text=True, timeout=60,
                )
                if result.returncode != 0:
                    _logger.warning("venv creation failed, trying --without-pip: %s", result.stderr)
                    if os.path.isdir(venv_dir):
                        import shutil
                        shutil.rmtree(venv_dir, ignore_errors=True)
                    result = subprocess.run(
                        [sys.executable, "-m", "venv", "--without-pip", venv_dir],
                        capture_output=True, text=True, timeout=60,
                    )
                return result

            venv_result = await asyncio.get_running_loop().run_in_executor(None, _create_venv)
            if venv_result.returncode != 0:
                return {
                    "success": False, "stage": "venv",
                    "error": f"创建虚拟环境失败: {(venv_result.stderr or '')[:300]}",
                }
        except Exception as e:
            return {
                "success": False, "stage": "venv",
                "error": f"创建虚拟环境异常: {e}",
            }

    mineru_python = _get_mineru_python()
    if not mineru_python:
        return {"success": False, "stage": "venv", "error": "虚拟环境创建后未找到 Python"}

    # ── Step 2: Install mineru[all] ──────────────────────────────
    install_info = _is_mineru_installed()
    if not install_info.get("installed"):
        _logger.info("Installing mineru[all] into MinerU venv...")
        try:
            def _pip_install():
                ensurepip_result = subprocess.run(
                    [mineru_python, "-m", "ensurepip", "--upgrade"],
                    capture_output=True, text=True, timeout=60,
                )
                if ensurepip_result.returncode != 0:
                    _logger.warning("ensurepip failed: %s", ensurepip_result.stderr)

                cmd = [mineru_python, "-m", "pip", "install", "--upgrade", "pip"]
                subprocess.run(cmd, capture_output=True, text=True, timeout=120)

                try:
                    subprocess.run(
                        [mineru_python, "-m", "pip", "install", "uv"],
                        capture_output=True, text=True, timeout=60,
                    )
                    cmd = [mineru_python, "-m", "uv", "pip", "install", "-U", "mineru[all]"]
                except Exception:
                    cmd = [mineru_python, "-m", "pip", "install", "mineru[all]"]

                if use_mirror:
                    cmd += ["-i", mirror_url, "--trusted-host", "pypi.tuna.tsinghua.edu.cn"]
                return subprocess.run(cmd, capture_output=True, text=True, timeout=900)

            install_result = await asyncio.get_running_loop().run_in_executor(None, _pip_install)
            output = (install_result.stdout or "") + (install_result.stderr or "")
            output_tail = "\n".join(output.strip().splitlines()[-20:])

            if install_result.returncode != 0:
                return {
                    "success": False, "stage": "install",
                    "error": f"pip install 失败 (exit {install_result.returncode})",
                    "output": output_tail,
                }
        except subprocess.TimeoutExpired:
            return {
                "success": False, "stage": "install",
                "error": "pip install 超时（15分钟），网络可能较慢，请重试",
            }
        except Exception as e:
            return {
                "success": False, "stage": "install",
                "error": f"安装异常: {e}",
            }

    # ── Step 3: Start API server ─────────────────────────────────────
    if _is_mineru_running(port):
        base_url = f"http://localhost:{port}/api/v4"
        config = load_config()
        config.documents.parser.mineru_mode = "local"
        config.documents.parser.mineru_base_url = base_url
        if not config.documents.parser.mineru_api_key:
            config.documents.parser.mineru_api_key = "local"
        save_config(config)
        try:
            from . import knowledge as _kmod
            _kmod._parser_router = None
        except Exception:
            pass
        return {
            "success": True, "stage": "already_running", "base_url": base_url,
            "message": "MinerU 本地服务已在运行，已自动配置",
        }

    api_cmd = _get_mineru_api_cmd()
    if not api_cmd:
        api_cmd = [mineru_python, "-m", "mineru.cli", "api", "--host", "0.0.0.0"]

    api_cmd += ["--port", str(port)]

    try:
        log_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
            "logs",
        )
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "mineru-api.log")
        pid_path = os.path.join(log_dir, "mineru-api.pid")

        env = os.environ.copy()
        if use_mirror:
            env["MINERU_MODEL_SOURCE"] = "modelscope"

        with open(log_path, "w") as log_f:
            popen_kwargs = {
                "stdout": log_f,
                "stderr": log_f,
                "stdin": subprocess.DEVNULL,
                "cwd": venv_dir,
                "env": env,
            }
            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["start_new_session"] = True

            proc = subprocess.Popen(api_cmd, **popen_kwargs)

        with open(pid_path, "w") as pid_f:
            pid_f.write(str(proc.pid))

        _logger.info("Started MinerU API server (PID=%d, port=%d, venv=%s)", proc.pid, port, venv_dir)

        # Wait for API to be ready
        from ...parsers.mineru_parser import MinerUParser
        base_url = f"http://localhost:{port}/api/v4"
        for _attempt in range(36):
            await asyncio.sleep(5)
            # Check if process is still alive
            if proc.poll() is not None:
                with open(log_path) as f:
                    log_content = f.read()[-1000:]
                return {
                    "success": False, "stage": "start",
                    "error": f"MinerU 进程意外退出 (exit code {proc.returncode})",
                    "output": log_content,
                    "log_path": log_path,
                }
            status = await MinerUParser.check_local_deployment(base_url)
            if status.get("reachable"):
                config = load_config()
                config.documents.parser.mineru_mode = "local"
                config.documents.parser.mineru_base_url = base_url
                if not config.documents.parser.mineru_api_key:
                    config.documents.parser.mineru_api_key = "local"
                save_config(config)
                try:
                    from . import knowledge as _kmod
                    _kmod._parser_router = None
                except Exception:
                    pass
                return {
                    "success": True, "stage": "started", "base_url": base_url,
                    "pid": proc.pid,
                    "message": "MinerU 本地部署成功！已自动配置，所有数据在本地处理",
                }

        return {
            "success": False, "stage": "health_check",
            "error": "服务已启动但 API 未就绪（等待超时 3 分钟），请稍后手动检测连接",
            "base_url": base_url, "pid": proc.pid, "log_path": log_path,
        }
    except Exception as e:
        return {
            "success": False, "stage": "start",
            "error": f"启动 MinerU API 失败: {e}",
            "output": traceback.format_exc()[:500],
        }


@router.post(
    "/documents/parser/stop-local-mineru",
    summary="Stop local MinerU service",
    description="Stop the MinerU API process and switch to cloud mode",
)
async def stop_local_mineru():
    import os
    import sys
    import subprocess

    results = []

    pid_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "logs", "mineru-api.pid",
    )
    if os.path.exists(pid_file):
        try:
            with open(pid_file) as f:
                pid = int(f.read().strip())
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True, text=True, timeout=10,
                )
            else:
                import signal
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            results.append(f"stopped PID {pid}")
        except Exception as e:
            results.append(f"error: {e}")
        finally:
            try:
                os.remove(pid_file)
            except Exception:
                pass

    config = load_config()
    if config.documents.parser.mineru_mode == "local":
        config.documents.parser.mineru_mode = "cloud"
        config.documents.parser.mineru_base_url = "https://mineru.net/api/v4"
        save_config(config)
        try:
            from . import knowledge as _kmod
            _kmod._parser_router = None
        except Exception:
            pass
        results.append("config: switched to cloud mode")

    return {"success": True, "details": results}