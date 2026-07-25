# -*- coding: utf-8 -*-
"""API routers."""

from fastapi import APIRouter

from .agents import router as agents_router
from .config import router as config_router
from .local_models import router as local_models_router
from .providers import router as providers_router
from .market import router as market_router
from .skills import router as skills_router
from .skills_stream import router as skills_stream_router
from .workspace import router as workspace_router
from .envs import router as envs_router
from .mcp import router as mcp_router
from .mcp_oauth import router as mcp_oauth_router
from .provider_oauth import router as provider_oauth_router
from .tools import router as tools_router
from ..crons.api import router as cron_router
from ..chats.api import router as runner_router
from .console import router as console_router
from .fork import router as fork_router
from .token_usage import router as token_usage_router
from .agent_stats import router as agent_stats_router
from .auth import router as auth_router
from .messages import router as messages_router
from .files import router as files_router
from .settings import router as settings_router
from .plugins import router as plugins_router
from .frontend_plugin import router as frontend_plugin_router
from .backup import router as backup_router
from .cloud_backup import router as cloud_backup_router
from .git import router as git_router
from .coding_project import router as coding_project_router
from .access_control import router as access_control_router
from .moot import router as moot_router
from .moot_award import router as moot_award_router
from .knowledge import router as knowledge_router
from .cases import router as cases_router
from .wiki import router as wiki_router
try:
    from .pet import router as pet_router
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aiarb").warning(f"pet router load failed: {_e}")
    pet_router = None
try:
    from .sop import router as sop_router
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aiarb").warning(f"sop router load failed: {_e}")
    sop_router = None
try:
    from .okf import router as okf_router
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aiarb").warning(f"okf router load failed: {_e}")
    okf_router = None
from .text_selection import router as text_selection_router
from .provider_oauth import router as provider_oauth_router
from .pawapps import router as pawapps_router
from .utils import router as utils_router
from .kb import build_router as build_kb_router
from .review import build_router as build_review_router

try:
    kb_router = build_kb_router()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aiarb").warning(f"kb router load failed: {_e}")
    kb_router = None
try:
    review_router = build_review_router()
except Exception as _e:
    import logging as _logging
    _logging.getLogger("aiarb").warning(f"review router load failed: {_e}")
    review_router = None

# 文档处理路由
try:
    from ...doc_processing.api import create_doc_processing_router
    doc_processing_router = create_doc_processing_router()
except Exception as e:
    import logging
    logging.getLogger("aiarb").warning(f"文档处理路由加载失败: {e}")
    doc_processing_router = None

router = APIRouter()

router.include_router(agents_router)
router.include_router(config_router)
router.include_router(console_router)
router.include_router(fork_router)
router.include_router(cron_router)
router.include_router(local_models_router)
router.include_router(mcp_oauth_router)
router.include_router(mcp_router)
router.include_router(messages_router)
router.include_router(providers_router)
router.include_router(provider_oauth_router)
router.include_router(runner_router)
router.include_router(market_router)
router.include_router(skills_router)
router.include_router(skills_stream_router)
router.include_router(tools_router)
router.include_router(workspace_router)
router.include_router(envs_router)
router.include_router(token_usage_router)
router.include_router(agent_stats_router)
router.include_router(auth_router)
router.include_router(files_router)
router.include_router(settings_router)
router.include_router(plugins_router)
router.include_router(frontend_plugin_router)
router.include_router(backup_router)
router.include_router(cloud_backup_router)
router.include_router(git_router)
router.include_router(coding_project_router)
router.include_router(access_control_router)
router.include_router(moot_award_router)
router.include_router(moot_router)
router.include_router(knowledge_router)
router.include_router(cases_router)
router.include_router(wiki_router)
if pet_router:
    router.include_router(pet_router)
if sop_router:
    router.include_router(sop_router)
if okf_router:
    router.include_router(okf_router)
router.include_router(text_selection_router)
router.include_router(provider_oauth_router)
router.include_router(pawapps_router)
router.include_router(utils_router)
if kb_router:
    router.include_router(kb_router)
if review_router:
    router.include_router(review_router)

# 文档处理路由
if doc_processing_router:
    router.include_router(doc_processing_router)

# 前端资源路由
try:
    from ...doc_processing.frontend import create_frontend_router
    frontend_router = create_frontend_router()
    if frontend_router:
        router.include_router(frontend_router)
except Exception as e:
    import logging
    logging.getLogger("aiarb").warning(f"前端资源路由加载失败: {e}")


def create_agent_scoped_router() -> APIRouter:
    """Create agent-scoped router that wraps existing routers.

    Returns:
        APIRouter with all routers mounted under /agents/{agentId}/
    """
    from .agent_scoped import create_agent_scoped_router as _create

    return _create()


__all__ = ["router", "create_agent_scoped_router"]