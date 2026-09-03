# -*- coding: utf-8 -*-
"""Shared agent template definitions and builders."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..config.config import (
    AgentProfileConfig,
    ChannelConfig,
    HeartbeatConfig,
    MCPConfig,
    ToolsConfig,
    build_arbitration_tools_config,
    build_kb_curator_tools_config,
    build_local_agent_tools_config,
    build_qa_agent_tools_config,
)
from ..constant import (
    BUILTIN_KB_CURATOR_AGENT_ID,
    BUILTIN_KB_CURATOR_AGENT_NAME,
    BUILTIN_KB_CURATOR_SKILL_NAMES,
    BUILTIN_QA_AGENT_NAME,
    BUILTIN_QA_AGENT_SKILL_NAMES,
)

DEFAULT_AGENT_TEMPLATE = "default"
LOCAL_AGENT_TEMPLATE = "local"
QA_AGENT_TEMPLATE = "qa"
KB_CURATOR_TEMPLATE = "kb_curator"

ARBITRATOR_TEMPLATE = "arbitrator"
CLAIMANT_TEMPLATE = "claimant"
RESPONDENT_TEMPLATE = "respondent"
SECRETARY_TEMPLATE = "secretary"

# Arbitration role templates map a template id to its default display name
# and description.  Each role carries only persona files (PROFILE.md/SOUL.md).
ARBITRATION_ROLE_TEMPLATES: dict[str, tuple[str, str]] = {
    ARBITRATOR_TEMPLATE: (
        "仲裁员",
        "中立、专业的仲裁员，独立公正地审理争议，认定事实并适用法律与仲裁规则。",
    ),
    CLAIMANT_TEMPLATE: (
        "申请人",
        "申请仲裁的一方当事人，负责陈述仲裁请求、事实理由并提交证据。",
    ),
    RESPONDENT_TEMPLATE: (
        "被申请人",
        "被申请仲裁的一方当事人，负责答辩、抗辩与提出反请求并提交证据。",
    ),
    SECRETARY_TEMPLATE: (
        "仲裁秘书",
        "协助仲裁庭处理程序性事务，管理日程、文书、证据交换并记录会议。",
    ),
}

SUPPORTED_AGENT_TEMPLATES = (
    DEFAULT_AGENT_TEMPLATE,
    LOCAL_AGENT_TEMPLATE,
    QA_AGENT_TEMPLATE,
    KB_CURATOR_TEMPLATE,
    *ARBITRATION_ROLE_TEMPLATES,
)

LOCAL_TEMPLATE_SKILL_NAMES = ("make_plan",)
# Guidance skill for arbitration roles: teaches them to search the shared
# knowledge base before answering legal/rule/case/template questions.
ARBITRATION_TEMPLATE_SKILL_NAMES = ("kb_arbitration",)
# Installed by default for every newly created agent (default template + the
# create-agent API/CLI paths) so the shared knowledge base is always part of
# an agent's knowledge without any extra per-agent setup.
DEFAULT_KNOWLEDGE_SKILL_NAMES = ("kb_arbitration",)
QA_TEMPLATE_DESCRIPTION = (
    "Builtin Q&A helper for AIArb setup, local config under "
    "AIARB_WORKING_DIR, and documentation. Prefer reading files "
    "before answering; use absolute paths for code outside this "
    "workspace."
)
KB_CURATOR_TEMPLATE_DESCRIPTION = (
    "内置知识库整理器：接收用户投递的法务素材（法律、规则、案例、文书等），"
    "将其整理为结构化的知识库文档并发布到全局共享知识库。"
)


@dataclass(frozen=True)
class AgentTemplateBuildResult:
    """Materialized result for creating an agent from a builtin template."""

    agent_config: AgentProfileConfig
    initial_skill_names: tuple[str, ...]
    md_template_id: str | None


def list_supported_agent_templates() -> tuple[str, ...]:
    """Return builtin agent template IDs supported by the application."""
    return SUPPORTED_AGENT_TEMPLATES


def get_workspace_md_template_id(template_id: str | None) -> str | None:
    """Map an agent template id to the workspace markdown template id."""
    if template_id in {
        LOCAL_AGENT_TEMPLATE,
        QA_AGENT_TEMPLATE,
        KB_CURATOR_TEMPLATE,
        *ARBITRATION_ROLE_TEMPLATES,
    }:
        return template_id
    return None


def build_agent_template(
    template_id: str,
    *,
    agent_id: str,
    workspace_dir: Path,
    fallback_language: str,
    name: str | None = None,
    description: str | None = None,
    language: str | None = None,
) -> AgentTemplateBuildResult:
    """Build a builtin template into a concrete agent configuration."""
    resolved_language = language or fallback_language or "zh"

    if template_id == DEFAULT_AGENT_TEMPLATE:
        if name is None:
            raise ValueError("Default template requires a name")
        agent_config = AgentProfileConfig(
            id=agent_id,
            name=name,
            description=description or "",
            workspace_dir=str(workspace_dir),
            template_id=template_id,
            language=resolved_language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=ToolsConfig(),
        )
        return AgentTemplateBuildResult(
            agent_config=agent_config,
            initial_skill_names=DEFAULT_KNOWLEDGE_SKILL_NAMES,
            md_template_id=get_workspace_md_template_id(template_id),
        )

    if template_id == LOCAL_AGENT_TEMPLATE:
        agent_config = AgentProfileConfig(
            id=agent_id,
            name=name or "Local Agent",
            description=(
                description or "An agent running on local deployed models."
            ),
            workspace_dir=str(workspace_dir),
            template_id=template_id,
            language=resolved_language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=build_local_agent_tools_config(),
        )
        return AgentTemplateBuildResult(
            agent_config=agent_config,
            initial_skill_names=LOCAL_TEMPLATE_SKILL_NAMES,
            md_template_id=get_workspace_md_template_id(template_id),
        )

    if template_id == QA_AGENT_TEMPLATE:
        agent_config = AgentProfileConfig(
            id=agent_id,
            name=name or BUILTIN_QA_AGENT_NAME,
            description=description or QA_TEMPLATE_DESCRIPTION,
            workspace_dir=str(workspace_dir),
            template_id=template_id,
            language=resolved_language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=build_qa_agent_tools_config(),
        )
        return AgentTemplateBuildResult(
            agent_config=agent_config,
            initial_skill_names=tuple(BUILTIN_QA_AGENT_SKILL_NAMES),
            md_template_id=get_workspace_md_template_id(template_id),
        )

    if template_id == KB_CURATOR_TEMPLATE:
        agent_config = AgentProfileConfig(
            id=agent_id,
            name=name or BUILTIN_KB_CURATOR_AGENT_NAME,
            description=description or KB_CURATOR_TEMPLATE_DESCRIPTION,
            workspace_dir=str(workspace_dir),
            template_id=template_id,
            language=resolved_language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=build_kb_curator_tools_config(),
        )
        return AgentTemplateBuildResult(
            agent_config=agent_config,
            initial_skill_names=tuple(BUILTIN_KB_CURATOR_SKILL_NAMES),
            md_template_id=get_workspace_md_template_id(template_id),
        )

    if template_id in ARBITRATION_ROLE_TEMPLATES:
        default_name, default_description = ARBITRATION_ROLE_TEMPLATES[
            template_id
        ]
        agent_config = AgentProfileConfig(
            id=agent_id,
            name=name or default_name,
            description=description or default_description,
            workspace_dir=str(workspace_dir),
            template_id=template_id,
            language=resolved_language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=build_arbitration_tools_config(),
        )
        return AgentTemplateBuildResult(
            agent_config=agent_config,
            initial_skill_names=ARBITRATION_TEMPLATE_SKILL_NAMES,
            md_template_id=get_workspace_md_template_id(template_id),
        )

    raise ValueError(
        f"Unsupported template: {template_id!r}. "
        f"Expected one of {SUPPORTED_AGENT_TEMPLATES}.",
    )
