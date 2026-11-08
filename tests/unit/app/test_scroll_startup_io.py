# -*- coding: utf-8 -*-
# pylint: disable=protected-access
"""Regression tests for Scroll's startup-time synchronous I/O."""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import CancelledError
from types import SimpleNamespace

import pytest

from aiarb.agents.context.scroll import sync as scroll_sync
from aiarb.agents.context.scroll.history import HistoryStore


@pytest.mark.asyncio
async def test_agent_migration_cancellation_drains_worker(
    tmp_path,
    monkeypatch,
) -> None:
    """A populated legacy DB may build its date index in a worker thread."""
    monkeypatch.setattr(
        "aiarb.envs.load_envs_into_environ",
        lambda: None,
    )
    app_module = importlib.import_module("aiarb.app._app")
    startup_helper = app_module._sync_scroll_history_on_startup

    db_path = tmp_path / "history.db"
    legacy = HistoryStore(db_path)
    with legacy._conn:  # pylint: disable=protected-access
        legacy._conn.execute("DROP INDEX ch_created_at")
        legacy._conn.executemany(
            "INSERT INTO conversation_history"
            "(session_id, kind, content, created_at) VALUES (?, ?, ?, ?)",
            [
                ("legacy", "model_turn", f"row-{index}", "2024-01-01")
                for index in range(5000)
            ],
        )
    legacy.close()

    started = threading.Event()
    stopped = threading.Event()
    config = SimpleNamespace(history_retention_days=0)
    workspace = SimpleNamespace(
        _manager=None,
        workspace_dir=tmp_path,
        agent_id="test",
        config=SimpleNamespace(
            running=SimpleNamespace(
                light_context_config=SimpleNamespace(scroll_config=config),
            ),
        ),
    )

    def migration(_history, _workspace, _agent, _days, stop):
        started.set()
        try:
            assert stop.wait(3)
            raise CancelledError()
        finally:
            stopped.set()

    monkeypatch.setattr(service_factories, "migrate_agent_history", migration)
    task = asyncio.create_task(
        service_factories.prepare_history_service(workspace, history, None),
    )
    try:
        assert await asyncio.to_thread(started.wait, 3)
        assert not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert stopped.is_set()
        assert not history.migration_complete("test", MIGRATION_KEY)
    finally:
        await history.shutdown()


@pytest.mark.asyncio
async def test_retention_runs_after_startup_and_stops_with_history(tmp_path):
    history = HistoryStore(tmp_path / "history.db")
    history.append(
        session_id="old",
        entry=LogEntry(kind="model_turn", created_at="2000-01-01"),
    )
    history.complete_migration("test", MIGRATION_KEY)
    await history.start_retention(30)
    assert history.count("old") == 1
    try:
        async with asyncio.timeout(5):
            while history.count("old"):
                await asyncio.sleep(0.05)
        assert history.migration_complete("test", MIGRATION_KEY)
    finally:
        await history.shutdown()
    assert history.closed
