# -*- coding: utf-8 -*-
"""AIARB service capabilities and request policy."""

from typing import ClassVar

from ..openai_provider import OpenAIProvider
from ..local_decision_model import LocalDecisionProviderMixin


class AIARBProvider(OpenAIProvider):
    """Keep service-specific policy separate from wire protocol support."""

    cache_modes: ClassVar[frozenset[str]] = frozenset([])
    cache_documentation: ClassVar[str | None] = None
