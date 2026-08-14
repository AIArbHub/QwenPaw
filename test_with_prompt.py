#!/usr/bin/env python
"""Test model with system prompt and tools to reproduce the issue."""
import asyncio
import sys
sys.path.insert(0, 'src')


async def test():
    from aiarb.providers.provider_manager import ProviderManager
    from aiarb.framework.message import Msg, TextBlock

    mgr = ProviderManager.get_instance()
    provider = mgr.get_provider('opencode')
    model = provider.get_chat_model_instance('deepseek-v4-flash-free')

    # Read system prompt files
    import pathlib
    workspace_dir = pathlib.Path(r"C:\Users\lixin\.aiarb\workspaces\default")
    
    system_parts = []
    for fname in ["AGENTS.md", "SOUL.md", "PROFILE.md"]:
        fpath = workspace_dir / fname
        if fpath.exists():
            system_parts.append(fpath.read_text(encoding="utf-8"))
    
    system_prompt = "\n\n".join(system_parts)
    print(f"System prompt length: {len(system_prompt)} chars")

    # Test WITH system prompt but WITHOUT tools
    messages = [
        Msg(name="system", role="system", content=[
            TextBlock(type="text", text=system_prompt),
        ]),
        Msg(name="user", role="user", content=[
            TextBlock(type="text", text="你好，请用中文详细介绍你自己，至少100字。"),
        ]),
    ]

    print('\n--- Test 1: WITH system prompt, NO tools ---')
    try:
        res = await model(messages=messages, tools=[], tool_choice=None)
        import inspect
        if inspect.isasyncgen(res):
            final_text = ""
            final_thinking = ""
            async for chunk in res:
                if chunk.is_last:
                    for block in chunk.content:
                        if hasattr(block, 'text'):
                            final_text = block.text
                        if hasattr(block, 'thinking'):
                            final_thinking = block.thinking
                    if chunk.usage:
                        print(f'Usage: input={chunk.usage.input_tokens}, output={chunk.usage.output_tokens}')
            print(f'Text ({len(final_text)} chars): {final_text[:300]}')
            print(f'Thinking ({len(final_thinking)} chars): {final_thinking[:200]}...')
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()

    # Test WITH system prompt AND WITH tools
    print('\n--- Test 2: WITH system prompt AND tools ---')
    try:
        # Create a simple tool schema
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_current_time",
                    "description": "Get current date and time",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "web_search",
                    "description": "Search the web for real-time information",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                        },
                        "required": ["query"],
                    },
                },
            },
        ]
        
        res = await model(messages=messages, tools=tools, tool_choice=None)
        if inspect.isasyncgen(res):
            final_text = ""
            final_thinking = ""
            has_tool_calls = False
            async for chunk in res:
                if chunk.is_last:
                    for block in chunk.content:
                        if hasattr(block, 'text'):
                            final_text = block.text
                        if hasattr(block, 'thinking'):
                            final_thinking = block.thinking
                        if hasattr(block, 'name'):
                            has_tool_calls = True
                            print(f'Tool call: {block.name}({block.input[:100] if block.input else ""})')
                    if chunk.usage:
                        print(f'Usage: input={chunk.usage.input_tokens}, output={chunk.usage.output_tokens}')
            print(f'Text ({len(final_text)} chars): {final_text[:300]}')
            print(f'Thinking ({len(final_thinking)} chars): {final_thinking[:200]}...')
            print(f'Has tool calls: {has_tool_calls}')
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    asyncio.run(test())
