# -*- coding: utf-8 -*-
"""Market provider registry.

Each module under this package exposes a module-level `provider`
instance implementing `MarketProvider`.
"""

from __future__ import annotations

from .aliyun import provider as _aliyun_provider
from .base import MarketProvider
from .clawhub import provider as _clawhub_provider
from .modelscope import provider as _modelscope_provider
from .aiarb import provider as _aiarb_provider


PROVIDERS: dict[str, MarketProvider] = {
    _aiarb_provider.key: _aiarb_provider,
    _clawhub_provider.key: _clawhub_provider,
    _modelscope_provider.key: _modelscope_provider,
    _aliyun_provider.key: _aliyun_provider,
}


__all__ = [
    "MarketProvider",
    "PROVIDERS",
]
