#!/usr/bin/env python
"""Test chat via API - dump ALL SSE events."""
import asyncio
import json
import sys
import httpx

async def test_chat():
    url = "http://127.0.0.1:8088/api/console/chat"
    
    payload = {
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "你好，请用中文详细介绍你自己，至少100字。"}
                ]
            }
        ],
        "channel": "console",
        "session_id": "test-debug-session-3"
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Agent-Id": "default",
    }
    
    print(f"Sending chat request to {url}...")
    
    all_events = []
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            print(f"Status: {resp.status_code}")
            
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                        all_events.append(data)
                    except json.JSONDecodeError:
                        pass
    
    print(f"\nTotal events: {len(all_events)}")
    
    # Print last 15 events in detail
    print(f"\n--- Last 15 events ---")
    for i, data in enumerate(all_events[-15:]):
        idx = len(all_events) - 15 + i + 1
        # Truncate long values
        for k, v in data.items():
            if isinstance(v, str) and len(v) > 200:
                data[k] = v[:200] + "..."
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        for k2, v2 in item.items():
                            if isinstance(v2, str) and len(v2) > 200:
                                item[k2] = v2[:200] + "..."
        print(f"  [{idx}] {json.dumps(data, ensure_ascii=False)}")
    
    # Collect all text deltas
    text_deltas = []
    thinking_deltas = []
    for data in all_events:
        if data.get("type") == "text" and data.get("delta"):
            text_deltas.append(data.get("text", ""))
        if data.get("type") == "thinking" and data.get("delta"):
            thinking_deltas.append(data.get("thinking", ""))
    
    full_text = "".join(text_deltas)
    full_thinking = "".join(thinking_deltas)
    
    print(f"\n--- Summary ---")
    print(f"Text delta count: {len(text_deltas)}")
    print(f"Thinking delta count: {len(thinking_deltas)}")
    print(f"Full text ({len(full_text)} chars): {full_text[:500]}")
    if full_thinking:
        print(f"Full thinking ({len(full_thinking)} chars): {full_thinking[:200]}...")
    
    # Check for message type changes
    msg_types = set()
    for data in all_events:
        if data.get("type") in ("reasoning", "message", "assistant"):
            msg_types.add(data.get("type"))
            print(f"\n  Message type event: {json.dumps(data, ensure_ascii=False)[:300]}")
    
    print(f"\nMessage types found: {msg_types}")


if __name__ == "__main__":
    asyncio.run(test_chat())
