# -*- coding: utf-8 -*-
"""KB Curator (AI 知识整理) — backend module.

Runs the builtin ``AIArb_KB_Curator_0.1`` agent on user-submitted
materials (text and/or uploaded files) and, when publish is enabled,
publishes the generated structured documents into the global shared
knowledge base (``WORKING_DIR/knowledge_base``).

The agent itself only ever writes inside its own workspace staging area
(``curate/<task_id>/outbox``); publishing into the shared corpus is done
by this backend "publishing bridge", keeping the knowledge base read-only
from the agent's perspective.
"""
