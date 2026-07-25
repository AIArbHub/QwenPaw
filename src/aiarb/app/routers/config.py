# -*- coding: utf-8 -*-

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
)
from fastapi.responses import StreamingResponse

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
                "To enable the sandbox, restart AIArb with administrator "
                "privileges:\n"
                "  - Desktop: right-click the shortcut "
                "\u2192 Run as administrator\n"
                "  - CLI: open an elevated terminal, then run `aiarb app`\n"
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
    # mineru_configured: has API key (cloud) OR local mode (localhost URL)
    _mineru_configured = bool(parser_cfg.mineru_api_key) or (
        "localhost" in parser_cfg.mineru_base_url or "127.0.0.1" in parser_cfg.mineru_base_url
    )
    # Check Tesseract availability
    tesseract_available = False
    tesseract_version = ""
    try:
        from ...parsers.tesseract_parser import TesseractParser
        tp = TesseractParser(langs=parser_cfg.tesseract_langs)
        tesseract_available = tp.available
        tesseract_version = tp.get_diagnostics().get("version", "")
    except Exception:
        pass
    return {
        "default_mode": parser_cfg.default_mode,
        "mineru_api_key": parser_cfg.mineru_api_key,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_backend": parser_cfg.mineru_backend,
        "mineru_effort": parser_cfg.mineru_effort,
        "mineru_configured": _mineru_configured,
        "tesseract_langs": parser_cfg.tesseract_langs,
        "tesseract_available": tesseract_available,
        "tesseract_version": tesseract_version,
    }


@router.get(
    "/documents/parser/ocr-status",
    summary="Check OCR engine status",
    description="Check MinerU configuration and local deployment availability",
)
async def get_ocr_status() -> dict:
    config = load_config()
    parser_cfg = config.documents.parser

    # mineru_configured: has API key (cloud) OR local mode (localhost URL)
    _mineru_configured = bool(parser_cfg.mineru_api_key) or (
        "localhost" in parser_cfg.mineru_base_url or "127.0.0.1" in parser_cfg.mineru_base_url
    )

    local_status: dict = {"reachable": False}
    if parser_cfg.mineru_mode == "local" or parser_cfg.mineru_base_url != "https://mineru.net/api/v4":
        from ...parsers.mineru_parser import MinerUParser
        local_status = await MinerUParser.check_local_deployment(
            parser_cfg.mineru_base_url or "http://localhost:8000/api/v4"
        )

    # Check Tesseract availability
    tesseract_status: dict = {"available": False}
    try:
        from ...parsers.tesseract_parser import TesseractParser
        tp = TesseractParser(langs=parser_cfg.tesseract_langs)
        tesseract_status = tp.get_diagnostics()
    except Exception as e:
        tesseract_status = {"available": False, "error": str(e)}

    # Verify cloud MinerU token validity (quick check)
    cloud_token_valid: bool | None = None
    cloud_token_error: str = ""
    if parser_cfg.mineru_mode == "cloud" and parser_cfg.mineru_api_key:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as c:
                resp = await c.post(
                    parser_cfg.mineru_base_url.rstrip("/") + "/file-urls/batch",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {parser_cfg.mineru_api_key}",
                    },
                    json={"files": [{"name": "test.pdf", "data_id": "t"}], "model_version": "vlm"},
                )
                if resp.status_code == 401:
                    cloud_token_valid = False
                    cloud_token_error = "Token 认证失败，请检查是否为 API 管理页面创建的 Token"
                elif resp.status_code == 200:
                    data = resp.json()
                    if data.get("code") == 0:
                        cloud_token_valid = True
                    else:
                        cloud_token_valid = False
                        cloud_token_error = data.get("msg", "未知错误")
                else:
                    cloud_token_valid = False
                    cloud_token_error = f"HTTP {resp.status_code}"
        except Exception as e:
            cloud_token_valid = False
            cloud_token_error = str(e)

    return {
        "mineru_configured": _mineru_configured,
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "local_mineru": local_status,
        "tesseract": tesseract_status,
        "cloud_token_valid": cloud_token_valid,
        "cloud_token_error": cloud_token_error,
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
        url_val = str(body["mineru_base_url"]).strip().rstrip("/")
        # Auto-fix: user may paste a full endpoint URL instead of base URL
        # e.g. https://mineru.net/api/v4/extract/task -> https://mineru.net/api/v4
        for suffix in ["/extract/task", "/file-urls/batch", "/extract-results/batch", "/tasks"]:
            if url_val.endswith(suffix):
                url_val = url_val[: -len(suffix)]
                break
        parser_cfg.mineru_base_url = url_val

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

    if "tesseract_langs" in body:
        langs_val = str(body["tesseract_langs"]).strip()
        if langs_val:
            parser_cfg.tesseract_langs = langs_val

    save_config(config)

    _mineru_configured = bool(parser_cfg.mineru_api_key) or (
        "localhost" in parser_cfg.mineru_base_url or "127.0.0.1" in parser_cfg.mineru_base_url
    )

    return {
        "default_mode": parser_cfg.default_mode,
        "mineru_api_key": parser_cfg.mineru_api_key,
        "mineru_base_url": parser_cfg.mineru_base_url,
        "mineru_mode": parser_cfg.mineru_mode,
        "mineru_backend": parser_cfg.mineru_backend,
        "mineru_effort": parser_cfg.mineru_effort,
        "mineru_configured": _mineru_configured,
        "tesseract_langs": parser_cfg.tesseract_langs,
        "tesseract_available": True,  # will be re-checked on next GET
        "tesseract_version": "",
    }


# ── MinerU 本地一键部署（异步任务 + SSE 进度推送） ──────────────────────

import logging as _logging
import json as _json
_logger = _logging.getLogger(__name__)

_MINERU_PORT = 8000


class _DeployTask:
    __slots__ = ("task_id", "status", "stage", "progress", "message", "error",
                 "result", "created_at", "updated_at", "_subscribers")

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.status = "pending"
        self.stage = ""
        self.progress = 0
        self.message = ""
        self.error = ""
        self.result: Optional[dict] = None
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self._subscribers: List[asyncio.Queue] = []

    def update(self, *, stage: str = "", progress: int = -1,
               message: str = "", error: str = "", status: str = "",
               result: Optional[dict] = None):
        if stage:
            self.stage = stage
        if progress >= 0:
            self.progress = min(progress, 100)
        if message:
            self.message = message
        if error:
            self.error = error
        if status:
            self.status = status
        if result is not None:
            self.result = result
        self.updated_at = datetime.now(timezone.utc).isoformat()
        for q in self._subscribers:
            try:
                q.put_nowait(self._snapshot())
            except asyncio.QueueFull:
                pass

    def _snapshot(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "result": self.result,
            "updated_at": self.updated_at,
        }

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass


_deploy_tasks: Dict[str, _DeployTask] = {}
_deploy_lock = asyncio.Lock()


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
    "/documents/parser/deploy-local-mineru/precheck",
    summary="Pre-check environment for MinerU local deployment",
    description="Check Python version, disk space, network connectivity, and port availability before deployment.",
)
async def deploy_local_mineru_precheck(body: dict = Body(default={})):
    import os
    import sys
    import shutil

    port = body.get("port", _MINERU_PORT)
    checks: dict = {"python": {}, "disk": {}, "network": {}, "port": {}, "venv": {}, "installed": {}, "gpu": {}, "memory": {}}
    warnings: list = []
    blockers: list = []

    py_ver = sys.version_info
    checks["python"] = {
        "version": f"{py_ver.major}.{py_ver.minor}.{py_ver.micro}",
        "path": sys.executable,
        "ok": py_ver >= (3, 10),
    }
    if py_ver < (3, 10):
        blockers.append(f"Python 版本过低 ({py_ver.major}.{py_ver.minor})，需要 3.10+")
    elif py_ver < (3, 11):
        warnings.append("Python 3.10 可用但建议升级到 3.11+ 以获得更好性能")
    if py_ver > (3, 12):
        blockers.append(f"Python 版本过高 ({py_ver.major}.{py_ver.minor})，MinerU 不支持 3.13+，请使用 3.10~3.12")

    venv_dir = _get_mineru_venv_dir()
    parent_dir = os.path.dirname(venv_dir)
    try:
        usage = shutil.disk_usage(parent_dir)
        free_gb = usage.free / (1024 ** 3)
        checks["disk"] = {
            "free_gb": round(free_gb, 1),
            "ok": free_gb > 5,
        }
        if free_gb < 2:
            blockers.append(f"磁盘空间不足（剩余 {free_gb:.1f} GB），至少需要 2 GB")
        elif free_gb < 5:
            warnings.append(f"磁盘空间较紧张（剩余 {free_gb:.1f} GB），建议预留 5 GB 以上")
    except Exception as e:
        checks["disk"] = {"ok": False, "error": str(e)}
        warnings.append("无法检测磁盘空间")

    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            try:
                await client.head("https://pypi.org/")
                checks["network"] = {"pypi": True, "ok": True}
            except Exception:
                try:
                    await client.head("https://pypi.tuna.tsinghua.edu.cn/")
                    checks["network"] = {"pypi": False, "mirror": True, "ok": True}
                    warnings.append("PyPI 官方源不可达，将使用镜像源")
                except Exception:
                    checks["network"] = {"pypi": False, "mirror": False, "ok": False}
                    blockers.append("网络不可达，无法下载安装包。请检查网络连接")
    except ImportError:
        checks["network"] = {"ok": True, "note": "httpx 未安装，跳过网络检测"}

    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
        checks["port"] = {"port": port, "available": True, "ok": True}
    except OSError:
        checks["port"] = {"port": port, "available": False, "ok": False}
        if _is_mineru_running(port):
            warnings.append(f"端口 {port} 已被 MinerU 服务占用，部署后将复用现有服务")
        else:
            blockers.append(f"端口 {port} 已被其他程序占用，请更换端口或关闭占用程序")
    finally:
        sock.close()

    existing_python = _get_mineru_python()
    checks["venv"] = {
        "exists": existing_python is not None,
        "path": venv_dir,
        "ok": True,
    }

    install_info = _is_mineru_installed()
    checks["installed"] = {
        "installed": install_info.get("installed", False),
        "version": install_info.get("version"),
        "ok": True,
    }
    if install_info.get("installed"):
        warnings.append(f"MinerU 已安装 (v{install_info.get('version', '?')})，将跳过安装步骤")

    try:
        import subprocess
        nvidia_result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if nvidia_result.returncode == 0 and nvidia_result.stdout.strip():
            gpus = []
            for line in nvidia_result.stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2:
                    name = parts[0]
                    try:
                        vram = float(parts[1])
                    except ValueError:
                        vram = 0
                    gpus.append({"name": name, "vram_mb": vram, "vram_gb": round(vram / 1024, 1)})
            if gpus:
                best = max(gpus, key=lambda g: g["vram_mb"])
                checks["gpu"] = {
                    "available": True,
                    "count": len(gpus),
                    "gpus": gpus,
                    "best_name": best["name"],
                    "best_vram_gb": best["vram_gb"],
                    "ok": best["vram_mb"] >= 8192,
                }
                if best["vram_mb"] < 8192:
                    warnings.append(
                        f"GPU 显存不足（{best['name']}: {best['vram_gb']}GB），Hybrid 模式需要 8GB+ 显存。Pipeline 模式可正常使用"
                    )
                else:
                    pass
            else:
                checks["gpu"] = {"available": False, "ok": True, "note": "未检测到 NVIDIA GPU，Pipeline 模式可正常使用"}
                warnings.append("未检测到 NVIDIA GPU，Hybrid 模式不可用。Pipeline 模式可正常使用")
        else:
            checks["gpu"] = {"available": False, "ok": True, "note": "nvidia-smi 不可用，Pipeline 模式可正常使用"}
            warnings.append("未检测到 NVIDIA GPU，Hybrid 模式不可用。Pipeline 模式可正常使用")
    except FileNotFoundError:
        checks["gpu"] = {"available": False, "ok": True, "note": "未安装 NVIDIA 驱动，Pipeline 模式可正常使用"}
        warnings.append("未安装 NVIDIA 驱动，Hybrid 模式不可用。Pipeline 模式可正常使用")
    except Exception as e:
        checks["gpu"] = {"available": False, "ok": True, "error": str(e)}
        warnings.append("GPU 检测失败，Pipeline 模式可正常使用")

    try:
        import psutil
        total_gb = psutil.virtual_memory().total / (1024 ** 3)
        checks["memory"] = {
            "total_gb": round(total_gb, 1),
            "ok": total_gb >= 8,
        }
        if total_gb < 8:
            warnings.append(f"内存不足（{total_gb:.1f} GB），建议 16 GB 以上以获得更好性能")
        elif total_gb < 16:
            warnings.append(f"内存偏小（{total_gb:.1f} GB），建议 16 GB 以上以获得更好性能")
    except ImportError:
        try:
            if sys.platform == "win32":
                import ctypes

                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ("dwLength", ctypes.c_ulong),
                        ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong),
                        ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                    ]

                ms = MEMORYSTATUSEX()
                ms.dwLength = ctypes.sizeof(ms)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))
                total_gb = ms.ullTotalPhys / (1024 ** 3)
            else:
                total_gb = 0
            if total_gb > 0:
                checks["memory"] = {"total_gb": round(total_gb, 1), "ok": total_gb >= 8}
                if total_gb < 8:
                    warnings.append(f"内存不足（{total_gb:.1f} GB），建议 16 GB 以上")
            else:
                checks["memory"] = {"ok": True, "note": "无法检测内存大小"}
        except Exception:
            checks["memory"] = {"ok": True, "note": "无法检测内存大小"}
    except Exception as e:
        checks["memory"] = {"ok": True, "error": str(e)}

    can_deploy = len(blockers) == 0
    return {
        "can_deploy": can_deploy,
        "checks": checks,
        "warnings": warnings,
        "blockers": blockers,
    }


@router.post(
    "/documents/parser/deploy-local-mineru",
    summary="Start async MinerU local deployment",
    description="Start an asynchronous deployment task. Returns task_id for progress tracking via SSE.",
)
async def deploy_local_mineru(body: dict = Body(default={})):
    import subprocess
    import sys
    import os

    async with _deploy_lock:
        for tid, t in _deploy_tasks.items():
            if t.status in ("pending", "running"):
                return {
                    "task_id": tid,
                    "status": t.status,
                    "message": "已有部署任务正在执行中",
                }

        task_id = uuid.uuid4().hex[:12]
        task = _DeployTask(task_id)
        _deploy_tasks[task_id] = task

    port = body.get("port", _MINERU_PORT)
    mirror_url = body.get("mirror_url", "https://pypi.tuna.tsinghua.edu.cn/simple")
    use_mirror = body.get("use_mirror", True)

    asyncio.create_task(_run_deploy(task, port, mirror_url, use_mirror))

    return {
        "task_id": task_id,
        "status": "pending",
        "message": "部署任务已创建，请通过 SSE 监听进度",
    }


async def _run_deploy(task: _DeployTask, port: int, mirror_url: str, use_mirror: bool):
    import subprocess
    import sys
    import os
    import traceback

    venv_dir = _get_mineru_venv_dir()

    try:
        # ── Step 1: Create venv ──────────────────────────────────────
        if not _get_mineru_python():
            task.update(stage="venv", progress=5, message="正在创建虚拟环境...", status="running")

            def _create_venv():
                if os.path.isdir(venv_dir):
                    import shutil
                    shutil.rmtree(venv_dir, ignore_errors=True)
                result = subprocess.run(
                    [sys.executable, "-m", "venv", venv_dir],
                    capture_output=True, text=True, timeout=60,
                )
                if result.returncode != 0:
                    if os.path.isdir(venv_dir):
                        import shutil
                        shutil.rmtree(venv_dir, ignore_errors=True)
                    result = subprocess.run(
                        [sys.executable, "-m", "venv", "--without-pip", venv_dir],
                        capture_output=True, text=True, timeout=60,
                    )
                return result

            try:
                venv_result = await asyncio.get_running_loop().run_in_executor(None, _create_venv)
                if venv_result.returncode != 0:
                    task.update(stage="venv", progress=10, status="failed",
                                error=f"创建虚拟环境失败: {(venv_result.stderr or '')[:300]}")
                    return
            except Exception as e:
                task.update(stage="venv", progress=10, status="failed",
                            error=f"创建虚拟环境异常: {e}")
                return
        else:
            task.update(stage="venv", progress=15, message="虚拟环境已存在，跳过创建")

        mineru_python = _get_mineru_python()
        if not mineru_python:
            task.update(stage="venv", progress=15, status="failed",
                        error="虚拟环境创建后未找到 Python 解释器")
            return

        # ── Step 2: Install mineru[all] ──────────────────────────────
        install_info = _is_mineru_installed()
        if not install_info.get("installed"):
            task.update(stage="install", progress=20, message="正在安装 MinerU 及依赖包（首次约需 5-15 分钟）...", status="running")

            def _pip_install():
                ensurepip_result = subprocess.run(
                    [mineru_python, "-m", "ensurepip", "--upgrade"],
                    capture_output=True, text=True, timeout=60,
                )
                if ensurepip_result.returncode != 0:
                    _logger.warning("ensurepip failed: %s", ensurepip_result.stderr)

                subprocess.run(
                    [mineru_python, "-m", "pip", "install", "--upgrade", "pip"],
                    capture_output=True, text=True, timeout=120,
                )

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

            try:
                task.update(stage="install", progress=25, message="正在下载并安装依赖包...")
                install_result = await asyncio.get_running_loop().run_in_executor(None, _pip_install)
                output = (install_result.stdout or "") + (install_result.stderr or "")
                output_tail = "\n".join(output.strip().splitlines()[-20:])

                if install_result.returncode != 0:
                    task.update(stage="install", progress=30, status="failed",
                                error=f"安装失败 (exit {install_result.returncode})",
                                result={"output": output_tail})
                    return
            except subprocess.TimeoutExpired:
                task.update(stage="install", progress=30, status="failed",
                            error="安装超时（15分钟），网络可能较慢，请重试")
                return
            except Exception as e:
                task.update(stage="install", progress=30, status="failed",
                            error=f"安装异常: {e}")
                return

            task.update(stage="install", progress=60, message="MinerU 安装完成")
        else:
            task.update(stage="install", progress=60, message="MinerU 已安装，跳过安装步骤")

        # ── Step 3: Start API server ─────────────────────────────────
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
            task.update(stage="start", progress=100, status="completed",
                        message="MinerU 本地服务已在运行，已自动配置",
                        result={"success": True, "stage": "already_running", "base_url": base_url})
            return

        task.update(stage="start", progress=70, message="正在启动 MinerU API 服务...")

        api_cmd = _get_mineru_api_cmd()
        if not api_cmd:
            api_cmd = [mineru_python, "-m", "mineru.cli", "api", "--host", "0.0.0.0"]
        api_cmd += ["--port", str(port)]

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

        task.update(stage="start", progress=75, message=f"服务进程已启动 (PID={proc.pid})，等待 API 就绪...")

        from ...parsers.mineru_parser import MinerUParser
        base_url = f"http://localhost:{port}/api/v4"
        for _attempt in range(36):
            await asyncio.sleep(5)
            if proc.poll() is not None:
                with open(log_path) as f:
                    log_content = f.read()[-1000:]
                task.update(stage="start", progress=80, status="failed",
                            error=f"MinerU 进程意外退出 (exit code {proc.returncode})",
                            result={"output": log_content, "log_path": log_path})
                return
            progress = 75 + min(_attempt * 2, 20)
            task.update(stage="start", progress=progress,
                        message=f"等待 API 就绪... ({_attempt * 5}s)")
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
                task.update(stage="start", progress=100, status="completed",
                            message="MinerU 本地部署成功！已自动配置，所有数据在本地处理",
                            result={"success": True, "stage": "started", "base_url": base_url, "pid": proc.pid})
                return

        task.update(stage="start", progress=95, status="failed",
                    error="服务已启动但 API 未就绪（等待超时 3 分钟），请稍后检查服务状态",
                    result={"base_url": base_url, "pid": proc.pid, "log_path": log_path})

    except Exception as e:
        task.update(stage=task.stage or "unknown", progress=task.progress, status="failed",
                    error=f"部署异常: {e}",
                    result={"output": traceback.format_exc()[:500]})


@router.get(
    "/documents/parser/deploy-local-mineru/progress/{task_id}",
    summary="SSE stream for deployment progress",
    description="Server-Sent Events endpoint to receive real-time deployment progress updates.",
)
async def deploy_local_mineru_progress(task_id: str, request: Request):
    task = _deploy_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    queue = task.subscribe()

    async def event_stream():
        try:
            yield f"data: {_json.dumps(task._snapshot())}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    snapshot = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {_json.dumps(snapshot)}\n\n"
                    if snapshot.get("status") in ("completed", "failed"):
                        break
                except asyncio.TimeoutError:
                    yield f": keepalive\n\n"
        finally:
            task.unsubscribe(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/documents/parser/deploy-local-mineru/status/{task_id}",
    summary="Get deployment task status",
    description="Get the current status of an asynchronous deployment task.",
)
async def deploy_local_mineru_task_status(task_id: str):
    task = _deploy_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task._snapshot()


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