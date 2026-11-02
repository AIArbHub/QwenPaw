# -*- coding: utf-8 -*-
"""ModelScope Skill marketplace plugin."""

from aiarb.market.builtin import BuiltinMarketProvider
from aiarb.market.providers.modelscope import ModelScopeProvider


class HubPlugin:
    def register(self, api):
        api.register_market_provider(
            BuiltinMarketProvider(ModelScopeProvider()),
            priority=20,
        )


plugin = HubPlugin()
