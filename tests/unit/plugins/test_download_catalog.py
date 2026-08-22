# -*- coding: utf-8 -*-
"""Unit tests for src/AIARB/plugins/download_catalog.py."""

from __future__ import annotations

import http.client
import json
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from AIARB.plugins.download_catalog import (
    _build_remote_plugin_catalog as build_plugin_catalog,
    _is_entry_compatible,
)


@pytest.mark.parametrize(
    "failure",
    [
        ConnectionResetError("connection reset"),
        http.client.IncompleteRead(b"partial", 10),
    ],
)
def test_main_catalog_transport_failure_returns_fallback(
    failure: Exception,
) -> None:
    with patch(
        "AIARB.plugins.download_catalog._fetch_json",
        side_effect=failure,
    ):
        result = build_plugin_catalog()

    assert not result["plugins"]
    assert result["error"] == "Failed to fetch plugin catalog index"


@pytest.mark.parametrize(
    "failure",
    [
        ConnectionResetError("connection reset"),
        http.client.IncompleteRead(b"partial", 10),
    ],
)
def test_plugins_catalog_transport_failure_returns_fallback(
    failure: Exception,
) -> None:
    main_index = {"products": {"plugins": {"index_url": "/plugins.json"}}}
    with patch(
        "AIARB.plugins.download_catalog._fetch_json",
        side_effect=[main_index, failure],
    ):
        result = build_plugin_catalog()

    assert not result["plugins"]
    assert result["error"] == "Failed to fetch plugins metadata"


def test_build_plugin_catalog_returns_normalized_plugins() -> None:
    main_index = {"products": {"plugins": {"index_url": "/plugins.json"}}}
    plugins_index = {
        "updated_at": "2026-09-14T00:00:00Z",
        "files": {
            "demo-1.0.0": {
                "id": "demo-1.0.0",
                "plugin_id": "demo",
                "name": {"en-US": "Demo"},
                "description": {"en-US": "A demo plugin"},
                "version": "1.0.0",
                "platform": "python",
                "url": "/plugins/demo-1.0.0.zip",
            },
        },
    }
    with (
        patch(
            "AIARB.plugins.download_catalog._fetch_json",
            side_effect=[main_index, plugins_index],
        ),
        patch(
            "AIARB.plugins.download_catalog._installed_plugin_ids",
            return_value={},
        ),
    ):
        result = build_plugin_catalog()

    assert result["error"] is None
    assert result["updated_at"] == "2026-09-14T00:00:00Z"
    assert result["plugins"] == [
        {
            "id": "demo-1.0.0",
            "plugin_id": "demo",
            "name": "Demo",
            "description": "A demo plugin",
            "description_i18n": {"en-US": "A demo plugin"},
            "version": "1.0.0",
            "author": "",
            "kind": "python",
            "size": "",
            "sha256": "",
            "install_url": (
                "https://download.AIARB.agentscope.io"
                "/plugins/demo-1.0.0.zip"
            ),
            "installed": False,
            "installed_version": None,
            "upgrade_available": False,
        },
    ]


def test_bundled_hubs_remain_installable_when_cdn_is_unavailable() -> None:
    from AIARB.plugins.download_catalog import (
        build_plugin_catalog as catalog,
    )

    with (
        patch(
            "AIARB.plugins.download_catalog._fetch_json",
            side_effect=ConnectionResetError("offline"),
        ),
        patch(
            "AIARB.plugins.download_catalog._installed_plugin_ids",
            return_value={"AIARB-hub": "0.9.0"},
        ),
    ):
        result = catalog()

    hubs = {entry["plugin_id"]: entry for entry in result["plugins"]}
    assert set(hubs) == {
        "AIARB-hub",
        "clawhub-hub",
        "modelscope-hub",
        "aliyun-hub",
    }
    assert result["error"] == "Failed to fetch plugin catalog index"
    assert hubs["AIARB-hub"]["installed_version"] == "0.9.0"
    assert hubs["AIARB-hub"]["upgrade_available"] is True
    assert hubs["clawhub-hub"]["installed"] is False
    for entry in hubs.values():
        assert entry["kind"] == "hub"
        assert (Path(entry["install_url"]) / "plugin.json").is_file()


def test_bundled_hubs_replace_same_cdn_version_and_keep_remote_updates(
    tmp_path,
    monkeypatch,
):
    from AIARB.market.builtin import get_builtin_hub_plugins_dir
    from AIARB.plugins.download_catalog import (
        build_plugin_catalog as catalog,
    )

    bundled = tmp_path / "bundled"
    shutil.copytree(get_builtin_hub_plugins_dir(), bundled / "hub")
    tool = bundled / "tool" / "bundled-tool"
    tool.mkdir(parents=True)
    (tool / "plugin.json").write_text(
        json.dumps({"id": "bundled-tool", "version": "1.0.0", "type": "tool"}),
    )
    monkeypatch.setattr(
        "AIARB.plugins.download_catalog.__file__",
        str(tmp_path / "download_catalog.py"),
    )
    versions = ("1.0.0", "1.1.0")
    files = {
        version: {
            "id": f"AIARB-hub-{version}",
            "plugin_id": "AIARB-hub",
            "version": version,
            "name": "AIARB Hub",
            "platform": "hub",
            "url": f"/plugins/AIARB-hub-{version}.zip",
        }
        for version in versions
    }
    with (
        patch(
            "AIARB.plugins.download_catalog._fetch_json",
            side_effect=[
                {"products": {"plugins": {"index_url": "/plugins.json"}}},
                {"files": files},
            ],
        ),
        patch(
            "AIARB.plugins.download_catalog._installed_plugin_ids",
            return_value={"AIARB-hub": "1.0.0"},
        ),
    ):
        result = catalog()

    AIARB = {
        entry["version"]: entry
        for entry in result["plugins"]
        if entry["plugin_id"] == "AIARB-hub"
    }
    assert set(AIARB) == set(versions)
    assert (Path(AIARB["1.0.0"]["install_url"]) / "plugin.json").is_file()
    assert AIARB["1.1.0"]["install_url"].endswith(
        "/plugins/AIARB-hub-1.1.0.zip",
    )
    assert AIARB["1.1.0"]["upgrade_available"] is True
    tool_entry = next(
        entry
        for entry in result["plugins"]
        if entry["plugin_id"] == "bundled-tool"
    )
    assert tool_entry["kind"] == "tool"
    assert Path(tool_entry["install_url"]) == tool


def test_entry_with_AIARB_version_compatible() -> None:
    entry = {
        "id": "demo",
        "version": "1.0.0",
        # Exclusive upper bound: current 2.1.0b1 is treated as 2.1.0.
        "AIARB_version": {"min": "1.1.6", "max": "2.2.0"},
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_AIARB_version_max_ignored() -> None:
    """Declared max must not exclude a newer running AIARB."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "AIARB_version": {"min": "0.1.0", "max": "1.1.0"},
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_only_min_compatible() -> None:
    entry = {
        "id": "demo",
        "version": "1.0.0",
        # Derived exclusive max is 2.2.0 for min 2.1.0.
        "AIARB_version": {"min": "2.1.0"},
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_only_min_incompatible() -> None:
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "AIARB_version": {"min": "3.0.0"},
    }
    assert _is_entry_compatible(entry) is False


def test_entry_without_version_constraints_is_compatible() -> None:
    entry = {
        "id": "demo",
        "version": "1.0.0",
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_malformed_AIARB_version_falls_to_legacy() -> None:
    """Non-dict AIARB_version falls back to min_version/max_version."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "AIARB_version": "not-a-dict",
        "min_version": "1.0.0",
        "max_version": "2.2.0",
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_malformed_AIARB_version_no_legacy() -> None:
    """Non-dict AIARB_version with no legacy fields is compatible."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "AIARB_version": "not-a-dict",
    }
    assert _is_entry_compatible(entry) is True


def test_legacy_min_version_compatible() -> None:
    """Legacy min_version within range is compatible."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "min_version": "2.1.0",
    }
    assert _is_entry_compatible(entry) is True


def test_legacy_min_version_incompatible() -> None:
    """Legacy min_version above current AIARB is incompatible."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "min_version": "3.0.0",
    }
    assert _is_entry_compatible(entry) is False


def test_legacy_min_max_version_compatible() -> None:
    """Legacy min+max still loads when min is satisfied (max ignored)."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "min_version": "1.0.0",
        "max_version": "2.2.0",
    }
    assert _is_entry_compatible(entry) is True


def test_legacy_max_version_ignored() -> None:
    """Legacy max_version alone must not make an entry incompatible."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "min_version": "0.1.0",
        "max_version": "1.0.0",
    }
    assert _is_entry_compatible(entry) is True


def test_entry_with_empty_dict_AIARB_version() -> None:
    """Empty dict AIARB_version triggers compat check with defaults."""
    entry = {
        "id": "demo",
        "version": "1.0.0",
        "AIARB_version": {},
    }
    # Empty dict is isinstance(dict) but has no min/max, should
    # still pass through PluginManifest validation or fallback gracefully
    result = _is_entry_compatible(entry)
    assert isinstance(result, bool)
