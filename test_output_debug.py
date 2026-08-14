#!/usr/bin/env python
"""Debug script to check model output truncation."""
import asyncio
import sys
sys.path.insert(0, 'src')


async def test():
    from aiarb.providers.provider_manager import ProviderManager

    mgr = ProviderManager.get_instance()

    # Get the active model for default agent
    provider = mgr.get_provider('opencode')
    if not provider:
        print('Provider opencode not found')
        return

    model_info = provider.get_model_info('deepseek-v4-flash-free')
    print(f'Model info: max_tokens={model_info.max_tokens}, thinking_enabled={model_info.thinking_enabled}')
    print(f'Model generate_kwargs: {model_info.generate_kwargs}')

    gen_kwargs = provider.get_effective_generate_kwargs('deepseek-v4-flash-free')
    print(f'Effective gen_kwargs: {gen_kwargs}')

    model = provider.get_chat_model_instance('deepseek-v4-flash-free')
    print(f'Model type: {type(model).__name__}')
    print(f'Parameters: max_tokens={model.parameters.max_tokens}')
    print(f'Extra generate kwargs: {model._extra_generate_kwargs}')
    print(f'Output token param: {model._output_token_param}')

    # Now test an actual model call
    from aiarb.framework.message import Msg, TextBlock

    messages = [
        Msg(name="user", role="user", content=[
            TextBlock(type="text", text="你好，请用中文回复：1+1等于几？"),
        ]),
    ]

    print('\n--- Calling model ---')
    try:
        res = await model(messages=messages, tools=[], tool_choice=None)

        # Check if streaming
        import inspect
        if inspect.isasyncgen(res):
            print('Streaming response:')
            final_text = ""
            final_thinking = ""
            chunk_count = 0
            async for chunk in res:
                chunk_count += 1
                if chunk.is_last:
                    print(f'  Final chunk (is_last=True)')
                    for block in chunk.content:
                        if hasattr(block, 'text'):
                            final_text = block.text
                            print(f'  Final text ({len(block.text)} chars): {block.text[:200]}')
                        if hasattr(block, 'thinking'):
                            final_thinking = block.thinking
                            print(f'  Final thinking ({len(block.thinking)} chars): {block.thinking[:200]}...')
                    if chunk.usage:
                        print(f'  Usage: input={chunk.usage.input_tokens}, output={chunk.usage.output_tokens}')
                else:
                    for block in chunk.content:
                        if hasattr(block, 'text') and block.text:
                            pass  # delta text
                        if hasattr(block, 'thinking') and block.thinking:
                            pass  # delta thinking
            print(f'\nTotal chunks: {chunk_count}')
            print(f'Final text length: {len(final_text)}')
            print(f'Final thinking length: {len(final_thinking)}')
        else:
            print('Non-streaming response:')
            for block in res.content:
                if hasattr(block, 'text'):
                    print(f'  Text ({len(block.text)} chars): {block.text[:200]}')
                if hasattr(block, 'thinking'):
                    print(f'  Thinking ({len(block.thinking)} chars): {block.thinking[:200]}...')
            if res.usage:
                print(f'  Usage: input={res.usage.input_tokens}, output={res.usage.output_tokens}')
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    asyncio.run(test())
