# -*- coding: utf-8 -*-
"""Handler for /skills command.

Lists enabled skills for the current channel in a compact format.
"""

from __future__ import annotations

from pathlib import Path

import frontmatter as fm

from ....agents.skill_system import (
    get_workspace_skills_dir,
    reconcile_workspace_manifest,
)
from ....agents.skill_system.registry import (
    get_builtin_skill_language_preference,
    _get_packaged_builtin_registry,
    _select_builtin_variant,
)
from ....agents.skill_system.store import (
    _build_display_name,
    _build_display_description,
    _extract_first_heading,
)
from ....agents.utils.file_handling import (
    read_text_file_with_encoding_fallback,
)

from .base import BaseControlCommandHandler, ControlContext


class SkillsCommandHandler(BaseControlCommandHandler):
    """Handler for /skills command.

    Usage:
        /skills    # List enabled skills for this channel
    """

    command_name = "/skills"
    description = (
        "List chat-available skills and expose explicit skill commands"
    )

    @staticmethod
    def _truncate_description(
        text: str,
        limit: int = 32,
    ) -> str:
        """Return a single-line shortened description for compact lists."""
        normalized = " ".join(text.split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: limit - 3].rstrip()}..."

    @staticmethod
    def _resolve_skill_display(
        folder_name: str,
        local_description: str,
        frontmatter_name: str,
        local_title: str,
    ) -> tuple[str, str]:
        lang = get_builtin_skill_language_preference()
        registry = _get_packaged_builtin_registry()
        cross_desc = ""
        variant = _select_builtin_variant(registry, folder_name, "en")
        if variant is not None and lang != "en":
            cross_desc = variant.description
        display_name = _build_display_name(
            folder_name,
            frontmatter_name,
            local_title,
            user_language=lang,
        )
        display_description = _build_display_description(
            local_description,
            cross_desc,
            user_language=lang,
        )
        return display_name, display_description

    async def handle(self, context: ControlContext) -> str:
        workspace = context.workspace
        workspace_dir: Path | None = getattr(
            workspace,
            "workspace_dir",
            None,
        )
        if workspace_dir is None:
            return "**Error**: Workspace not initialized."

        channel_id = context.channel.channel
        manifest = reconcile_workspace_manifest(workspace_dir)
        skills_dir = get_workspace_skills_dir(workspace_dir)

        lines = []
        found = False
        for folder_name, entry in sorted(
            manifest.get("skills", {}).items(),
        ):
            if not entry.get("enabled", False):
                continue
            channels = entry.get("channels") or ["all"]
            if "all" not in channels and channel_id not in channels:
                continue
            skill_dir = skills_dir / folder_name
            if not skill_dir.exists():
                continue
            found = True

            skill_md = skill_dir / "SKILL.md"
            description = (
                entry.get("metadata", {}).get("description")
                or "No description."
            )
            frontmatter_name = ""
            local_title = ""
            if skill_md.exists():
                raw = read_text_file_with_encoding_fallback(skill_md)
                post = fm.loads(raw)
                description = post.get("description") or description
                frontmatter_name = str(post.get("name") or "").strip()
                local_title = _extract_first_heading(
                    post.content if hasattr(post, 'content') else "",
                )

            display_name, display_description = self._resolve_skill_display(
                folder_name,
                description,
                frontmatter_name,
                local_title,
            )

            lines.append(
                f"**{display_name}**: "
                f"{self._truncate_description(display_description)}",
            )

        if not found:
            return "No skills are currently enabled for this channel."
        lines.append(
            "\n---\n"
            "*Use `/<skill_name>` for details, "
            "`/<skill_name> <input>` to invoke. "
            "`/[skill_name]` also works.*",
        )
        return "\n\n".join(lines)
