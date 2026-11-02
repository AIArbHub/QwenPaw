# -*- coding: utf-8 -*-
"""ClawHub Skill marketplace plugin."""

from aiarb.market.builtin import BuiltinMarketProvider
from aiarb.market.providers.clawhub import ClawHubProvider


class HubPlugin:
    def register(self, api):
        api.register_market_provider(
            BuiltinMarketProvider(ClawHubProvider()),
            priority=10,
        )


plugin = HubPlugin()
