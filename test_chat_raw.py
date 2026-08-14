#!/usr/bin/env python
"""Test chat via API - dump raw SSE events."""
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
        "session_id": "test-debug-session-2"
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Agent-Id": "default",
    }
    
    print(f"Sending chat request to {url}...")
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            print(f"Status: {resp.status_code}")
            
            event_count = 0
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                
                if line.startswith("data: "):
                    data_str = line[6:]
                    event_count += 1
                    
                    # Print first 20 events in detail
                    if event_count <= 20:
                        try:
                            data = json.loads(data_str)
                            # Truncate long values
                            for k, v in data.items():
                                if isinstance(v, str) and len(v) > 100:
                                    data[k] = v[:100] + "..."
                                elif isinstance(v, list):
                                    for item in v:
                                        if isinstance(item, dict):
                                            for k2, v2 in item.items():
                                                if isinstance(v2, str) and len(v2) > 100:
                                                    item[k2] = v2[:100] + "..."
                            print(f"  [{event_count}] {json.dumps(data, ensure_ascii=False)}")
                        except json.JSONDecodeError:
                            print(f"  [{event_count}] (raw) {data_str[:200]}")
                    elif event_count == 21:
                        print(f"  ... (suppressing further events)")
            
            print(f"\nTotal events: {event_count}")


if __name__ == "__main__":
    asyncio.run(test_chat())
