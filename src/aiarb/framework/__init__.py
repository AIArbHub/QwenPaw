# -*- coding: utf-8 -*-
"""AIArb framework compatibility layer.

This package re-exports the underlying agent framework's public API so
that all application source code imports from ``aiarb.framework`` instead
of the upstream package directly.  This keeps the framework dependency
name out of the application source tree while preserving full runtime
compatibility.
"""
from __future__ import annotations

# -- Message types -------------------------------------------------
from aiarb.framework.message import (  # noqa: F401
    DataBlock,
    Msg,
    TextBlock,
    ThinkingBlock,
    ToolCallBlock,
    ToolCallState,
    ToolResultBlock,
    ToolResultState,
    URLSource,
    UserMsg,
)

# -- Agent classes -------------------------------------------------
from aiarb.framework.agent import (  # noqa: F401
    Agent,
    ContextConfig,
    ReActConfig,
)

# -- Tool types ----------------------------------------------------
from aiarb.framework.tool import (  # noqa: F401
    FunctionTool,
    ToolBase,
    ToolChunk,
    Toolkit,
    ToolResponse,
)

# -- Model classes -------------------------------------------------
from aiarb.framework.model import (  # noqa: F401
    ChatModelBase,
    ChatResponse,
    ChatUsage,
)

# -- Formatter classes ---------------------------------------------
from aiarb.framework.formatter import (  # noqa: F401
    FormatterBase,
    OpenAIChatFormatter,
    OpenAIResponseFormatter,
)

# -- Middleware ----------------------------------------------------
from aiarb.framework.middleware import MiddlewareBase  # noqa: F401

# -- State management ----------------------------------------------
from aiarb.framework.state import AgentState  # noqa: F401

# -- Workspace -----------------------------------------------------
from aiarb.framework.workspace import LocalWorkspace  # noqa: F401
