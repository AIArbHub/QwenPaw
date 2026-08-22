# -*- coding: utf-8 -*-
"""AIArb terminal chat UI (TUI).

A Textual front-end, bundled into AIArb, that drives the agent over ACP by
spawning ``aiarb acp`` as a subprocess. The UI layer only ever sees the
normalized :class:`~aiarb.cli.tui.transport.base.TuiTransport` interface and
the :mod:`~aiarb.cli.tui.events` event union, so the transport is a swappable
seam: a future in-process transport can replace the ACP subprocess without
touching any widget.

Entry points:

* bare ``aiarb`` (no subcommand) -> :func:`~aiarb.cli.tui.launch.run_tui`
* ``aiarb tui [--agent ... | --resume ...]``

Originally developed as the standalone ``paw`` CLI; relocated here in Phase 1.
"""

from __future__ import annotations

from .__version__ import __version__

__all__ = ["__version__"]
