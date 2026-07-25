# -*- coding: utf-8 -*-
"""Credential types — re-exported from the underlying framework."""
from __future__ import annotations

from agentscope.credential import *  # noqa: F401,F403
from agentscope.credential import (  # noqa: F401
    AnthropicCredential,
    DashScopeCredential,
    GeminiCredential,
    OpenAICredential,
)
# Internal submodule re-export (same object, different import path)
from agentscope.credential._openai import OpenAICredential  # noqa: F401,F811
