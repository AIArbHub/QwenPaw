# -*- coding: utf-8 -*-
"""Public, versioned memory backend plugin API.

Plugins should import memory contracts from this module rather than from the
internal ``AIARB.agents`` package.
"""

from aiarb.agents.memory.base_memory_manager import (
    AutoMemorySearchOptions,
    BaseMemoryManager,
    MemoryBackendContext,
    MemoryBackendRegistration,
    MemoryBackendRegistry,
    MemoryBackendUnavailableError,
    NO_RELEVANT_MEMORIES,
    get_memory_manager_backend,
    memory_registry,
)

__all__ = [
    "AutoMemorySearchOptions",
    "BaseMemoryManager",
    "MemoryBackendContext",
    "MemoryBackendRegistration",
    "MemoryBackendRegistry",
    "MemoryBackendUnavailableError",
    "NO_RELEVANT_MEMORIES",
    "get_memory_manager_backend",
    "memory_registry",
]
