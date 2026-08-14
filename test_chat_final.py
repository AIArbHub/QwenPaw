#!/usr/bin/env python
"""Test chat via API - capture ALL events including errors."""
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
        "session_id": "test-debug-final"
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
                        print(f"  [PARSE ERROR] {data_str[:200]}")
    
    print(f"\nTotal events: {len(all_events)}")
    
    # Print ALL events with sequence numbers
    print(f"\n--- All events ---")
    for i, data in enumerate(all_events):
        # Truncate long values
        compact = {}
        for k, v in data.items():
            if isinstance(v, str) and len(v) > 150:
                compact[k] = v[:150] + f"...({len(v)} chars)"
            elif isinstance(v, list):
                compact[k] = f"[{len(v)} items]"
            else:
                compact[k] = v
        print(f"  [{i+1}] seq={data.get('sequence_number', '?')} {json.dumps(compact, ensure_ascii=False)}")
    
    # Check for response status
    for data in all_events:
        status = data.get("status")
        if status and status not in ("in_progress", "created"):
            print(f"\n  Status event: {json.dumps(data, ensure_ascii=False)[:300]}")
        if data.get("type") == "error" or data.get("error"):
            print(f"\n  ERROR event: {json.dumps(data, ensure_ascii=False)[:500]}")


if __name__ == "__main__":
    asyncio.run(test_chat())
