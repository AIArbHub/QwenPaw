# -*- coding: utf-8 -*-
"""PyInstaller entry point for the bundled AIArb CLI."""
from __future__ import annotations

import multiprocessing as mp
import sys


_INTERNAL_MAIL_MCP_ARG = "--internal-mail-mcp"


def main() -> None:
    """Dispatch bundled internal services or the public Click CLI."""
    mp.freeze_support()
    if sys.argv[1:] == [_INTERNAL_MAIL_MCP_ARG]:
        from aiarbmail_mcp.__main__ import main as mail_mcp_main

        mail_mcp_main()
        return

    from aiarb.cli.main import cli

    cli()  # pylint: disable=no-value-for-parameter


if __name__ == "__main__":
    main()
