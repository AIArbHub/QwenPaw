#!/usr/bin/env python
"""Debug script to check model output truncation with complex query."""
import asyncio
import sys
sys.path.insert(0, 'src')


async def test():
    from aiarb.providers.provider_manager import ProviderManager
    from aiarb.framework.message import Msg, TextBlock

    mgr = ProviderManager.get_instance()
    provider = mgr.get_provider('opencode')
    model = provider.get_chat_model_instance('deepseek-v4-flash-free')

    # Test with a complex question that triggers deep thinking
    messages = [
        Msg(name="user", role="user", content=[
            TextBlock(type="text", text="请详细解释量子计算的基本原理，包括量子比特、叠加态和量子纠缠的概念。请用中文回答，至少500字。"),
        ]),
    ]

    print('--- Calling model with complex query ---')
    try:
        res = await model(messages=messages, tools=[], tool_choice=None)

        import inspect
        if inspect.isasyncgen(res):
            final_text = ""
            final_thinking = ""
            chunk_count = 0
            text_chunk_count = 0
            thinking_chunk_count = 0
            async for chunk in res:
                chunk_count += 1
                if chunk.is_last:
                    for block in chunk.content:
                        if hasattr(block, 'text'):
                            final_text = block.text
                        if hasattr(block, 'thinking'):
                            final_thinking = block.thinking
                    if chunk.usage:
                        print(f'Usage: input={chunk.usage.input_tokens}, output={chunk.usage.output_tokens}')
                else:
                    for block in chunk.content:
                        if hasattr(block, 'text') and block.text:
                            text_chunk_count += 1
                        if hasattr(block, 'thinking') and block.thinking:
                            thinking_chunk_count += 1
            print(f'Total chunks: {chunk_count}')
            print(f'Text delta chunks: {text_chunk_count}')
            print(f'Thinking delta chunks: {thinking_chunk_count}')
            print(f'Final text length: {len(final_text)} chars')
            print(f'Final thinking length: {len(final_thinking)} chars')
            print(f'Final text: {final_text[:500]}')
            if len(final_text) > 500:
                print(f'... ({len(final_text)} total chars)')
        else:
            print('Non-streaming response')
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    asyncio.run(test())
