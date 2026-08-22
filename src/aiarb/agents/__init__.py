# -*- coding: utf-8 -*-
"""AIArb Agents Module.

This module provides the main agent implementation and supporting utilities
for building AI agents with tools, skills, and memory management.

Public API:
- AIArbAgent: Main agent class
- create_model_and_formatter: Factory for creating models and formatters

Example:
    >>> from aiarb.agents import AIArbAgent, create_model_and_formatter
    >>> agent = AIArbAgent()
    >>> # Or with custom model
    >>> model, formatter = create_model_and_formatter()
"""

# AIArbAgent is lazy-loaded so that importing agents.skill_system (e.g.
# from CLI init_cmd/skills_cmd) does not pull react_agent, agentscope, tools.
# pylint: disable=undefined-all-variable
__all__ = ["AIArbAgent", "create_model_and_formatter"]


def __getattr__(name: str):
    """Lazy load heavy imports."""
    if name == "AIArbAgent":
        from .react_agent import AIArbAgent

        return AIArbAgent
    if name == "create_model_and_formatter":
        from .model_factory import create_model_and_formatter

        return create_model_and_formatter
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
