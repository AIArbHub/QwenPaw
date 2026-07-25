# -*- coding: utf-8 -*-
"""The pluggable context-manager interface.

A ``ContextManager`` is an injectable strategy that owns an agent's context
management. :class:`~aiarb.agents.react_agent.AIArbAgent` delegates its two
the framework hooks to it:

* ``_save_to_context`` -> :meth:`on_save` (after the base append)
* ``compress_context`` -> :meth:`compress` (instead of the base compression)

When no manager is injected, the agent keeps its native the framework behavior —
so a strategy is purely additive and fully opt-in.
"""
from __future__ import annotations

from typing import Any, Protocol, Sequence, runtime_checkable


@runtime_checkable
class ContextManager(Protocol):
    """Strategy that drives an agent's context management."""

    async def compress(
        self,
        agent: Any,
        context_config: Any = None,
        instructions: Any = None,
    ) -> None:
        """Compress ``agent.state.context`` when it exceeds the threshold.

        Called from ``AIArbAgent.compress_context`` in place of the native
        the framework compression. ``instructions`` is optional, one-shot
        guidance for a manual compaction and must not be persisted as active
        conversation state.
        """

    def on_save(self, agent: Any, blocks: Sequence[Any]) -> None:
        """React to blocks just appended to ``agent.state.context``.

        Called from ``AIArbAgent._save_to_context`` after the base append,
        so the manager can write them through to durable storage.
        """
