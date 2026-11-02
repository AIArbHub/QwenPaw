# -*- coding: utf-8 -*-
"""Aliyun Skill marketplace plugin."""

from aiarb.market.builtin import BuiltinMarketProvider
from aiarb.market.providers.aliyun import AliyunProvider


class HubPlugin:
    def register(self, api):
        api.register_market_provider(
            BuiltinMarketProvider(AliyunProvider()),
            priority=30,
        )


plugin = HubPlugin()
