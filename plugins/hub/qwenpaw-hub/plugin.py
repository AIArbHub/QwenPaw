# -*- coding: utf-8 -*-
"""QwenPaw Skill marketplace plugin."""

from aiarb.market.builtin import BuiltinMarketProvider
from aiarb.market.providers.qwenpaw import QwenPawProvider


class HubPlugin:
    def register(self, api):
        api.register_market_provider(
            BuiltinMarketProvider(QwenPawProvider()),
            priority=0,
        )


plugin = HubPlugin()
