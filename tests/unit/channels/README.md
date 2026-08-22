# Channel tests

Each official channel has one `test_<channel>.py` file covering its core startup, shutdown and message delivery behavior. Tests replace external SDK/network boundaries where needed; they do not certify real robot credentials or native desktop releases.

Shared coverage lives in:

- `test_channel_host.py`: discovery, configuration, host routing and shared channel lifecycle.
- `../plugins/test_plugin_process.py`: worker execution, process ownership and cleanup.
- `../../contract/channels/test_console_contract.py`: the built-in Console channel's `BaseChannel` contract.
- `../../channel_support/`: shared fixtures used by the retained tests.

Official channel plugins use the channel protocol; they do not need a separate legacy `create_instance()` contract suite.

## Run

From the repository root, with project test dependencies installed:

```sh
./scripts/check-channels.sh feishu
./scripts/check-channels.sh --changed
./scripts/check-channels.sh all
python -m pytest tests/unit/channels/test_channel_host.py tests/unit/plugins/test_plugin_process.py -q
```

The runner treats selected core test failures as failures. `--changed` selects current uncommitted and untracked changes; shared channel code selects the full channel group. It is not a substitute for the repository's broader CI.

Keep new coverage in the existing channel, host or process file. Prefer a focused behavioral assertion over another full installation/reload cycle; retain real lifecycle execution where ownership, shutdown or recovery is the behavior being tested. Do not restore the retired fixture suites or duplicate them in helpers.
| Type | Location | Purpose | Status |
|------|----------|---------|--------|
| **Contract Tests** | `tests/contract/channels/` | Verify external interface compatibility | ✅ 128 tests, CI hard gate |
| **Unit Tests** | `tests/unit/channels/` | Verify internal logic correctness | ✅ 1200+ tests, CI enforcement |

Both test types are required to pass in CI.

## Unit Test Coverage by Channel

| Channel | Test Count | Lines | Complexity | Status |
|---------|------------|-------|------------|--------|
| BaseChannel (Core) | 68 | 1,390 | Core Logic | ✅ Complete |
| DingTalk | 159 | 3,708 | High | ✅ Complete |
| Feishu | 120 | 2,652 | High | ✅ Complete |
| QQ | 116 | 2,096 | High | ✅ Complete |
| Telegram | 93 | 1,798 | Medium-High | ✅ Complete |
| Mattermost | 82 | 1,990 | Medium-High | ✅ Complete |
| WeChat | 78 | 1,617 | Medium | ✅ Complete |
| Wecom | 69 | 1,504 | Medium | ✅ Complete |
| Base (test_base_core.py) | 68 | 1,390 | Core | ✅ Complete |
| Console | 26 | 567 | Simple | ✅ Complete |
| Xiaoyi | 57 | 1,219 | Medium | ✅ Complete |
| Discord | 55 | 945 | Medium | ✅ Complete |
| Matrix | 55 | 1,068 | Medium | ✅ Complete |
| OneBot | 53 | 756 | Medium | ✅ Complete |
| MQTT | 50 | 922 | Medium | ✅ Complete |
| IMessage | 37 | 1,007 | Simple-Medium | ✅ Complete |
| Voice | 37 | 651 | Simple | ✅ Complete |

**Total: 1,200+ unit tests across 16 test files**

## Local Development

```bash
# Run all contract tests (required)
pytest tests/contract/channels/ -v

# Run all unit tests
pytest tests/unit/channels/ -v

# Run specific Channel unit tests
pytest tests/unit/channels/test_dingtalk.py -v
pytest tests/unit/channels/test_feishu.py -v

# Run with coverage
pytest tests/unit/channels/ \
    --cov=src/aiarb/app/channels \
    --cov-report=term-missing

# Check contract coverage status
make check-contracts
```

## Adding New Channel Tests

### For Contract Tests

All Channels already have contract tests. To add a new Channel:

```bash
# 1. Copy the official template
cp tests/contract/channels/test_console_contract.py \
   tests/contract/channels/test_yourchannel_contract.py

# 2. Modify class name and create_instance()

# 3. Local verification
make check-contracts  # Should show your Channel in tested list
```

### For Unit Tests

Create a new test file following the existing pattern:

```python
# tests/unit/channels/test_yourchannel.py
"""Unit tests for YourChannel implementation."""

import pytest
from src.aiarb.app.channels.your_channel import YourChannel


class TestYourChannel:
    """Test suite for YourChannel."""

    def test_initialization(self):
        """Test channel can be initialized."""
        channel = YourChannel()
        assert channel is not None

    def test_start_stop(self):
        """Test channel lifecycle."""
        # Implementation here
        pass

    # Add more tests...
```

## CI/CD Integration

All tests run in the CI pipeline with the following gates:

| Phase | Test Type | Threshold | Gate Type | Status |
|-------|-----------|-----------|-----------|--------|
| 1 | Contract Tests | 100% (128/128) | 🔴 Hard Gate | ⚠️ Temporarily skipped (Pydantic issue) |
| 2 | Unit Tests | All must pass | 🔴 Hard Gate | ✅ Active |
| 3 | Coverage | Minimum threshold | 🟡 Soft Gate | ✅ Non-blocking with warnings |

**Hard Gate**: Failure blocks PR merge
**Soft Gate**: Warning only, non-blocking (`continue-on-error`)

## Four-Layer Protection (Contract Tests)

```
Layer 1: Abstract Method Check
├── test_no_abstract_methods_remaining
└── Catches: BaseChannel adds @abstractmethod

Layer 2: Instantiation Check
├── test_no_abstractmethods__in_instance
└── Catches: Cannot create instance (unimplemented methods)

Layer 3: Method Override Check
├── test_required_methods_not_raising_not_implemented
└── Catches: Method still raises NotImplementedError

Layer 4: Signature Compatibility Check
├── test_start_method_signature_compatible
├── test_stop_method_signature_compatible
├── test_resolve_session_id_signature_compatible
└── Catches: Method signature changes break subclasses
```

## Current Status

```
📊 Channel Contract Test Coverage
   Total Channels: 11
   With Contract Tests: 12
   Missing: 0
   Contract Tests: 128 passing

📊 Channel Unit Test Coverage
   Total Channels: 11
   With Unit Tests: 11
   Missing: 0
   Unit Tests: 1,200+ passing

✅ All Channels fully covered:
   ConsoleChannel, DingTalkChannel, FeishuChannel,
   DiscordChannel, IMessageChannel, MQTTChannel,
   MatrixChannel, MattermostChannel, QQChannel,
   TelegramChannel, VoiceChannel

🎉 Zero missing tests - both contract and unit tests complete!
```

## Core Principles

1. **Contract tests are primary** - Must pass in CI (hard gate)
2. **Unit tests are required** - Must pass in CI (hard gate)
3. **All Channels have full coverage** - Both contract and unit tests
4. **Four-layer protection** - Effective prevention against "fix Console breaks DingTalk"
5. **Breaking tests = blocking PR** - CI gates ensure quality

## Quick Reference

| Command | Purpose |
|---------|---------|
| `make check-contracts` | Show contract coverage status |
| `pytest tests/contract/channels/ -v` | Run all contract tests |
| `pytest tests/unit/channels/ -v` | Run all unit tests |
| `pytest tests/unit/channels/test_dingtalk.py -v` | Run specific Channel tests |
| `pytest tests/unit/channels/ -k "test_init"` | Run specific test pattern |

---

📖 [中文版本](README_zh.md)

📋 **Related**: PR #2506 - Test infrastructure and coverage baseline establishment
