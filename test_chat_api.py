#!/usr/bin/env python
"""Test chat via API to reproduce the 2-char output issue."""
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
        "session_id": "test-debug-session"
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Agent-Id": "default",
    }
    
    print(f"Sending chat request to {url}...")
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            print(f"Status: {resp.status_code}")
            
            full_text = ""
            thinking_text = ""
            event_count = 0
            
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                
                event_count += 1
                
                # Parse SSE format
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                        
                        # Check for text content
                        if data.get("type") == "text" or data.get("type") == "content":
                            if isinstance(data.get("text"), str):
                                if data.get("delta"):
                                    full_text += data["text"]
                                elif data.get("text"):
                                    full_text = data["text"]
                        
                        # Check for thinking content
                        if data.get("type") == "thinking":
                            if isinstance(data.get("thinking"), str):
                                if data.get("delta"):
                                    thinking_text += data["thinking"]
                        
                        # Check for message events
                        if data.get("type") == "message" or data.get("status") == "completed":
                            print(f"  [Event {event_count}] type={data.get('type')}, status={data.get('status')}")
                            
                        # Check for error
                        if data.get("type") == "error" or data.get("error"):
                            print(f"  [ERROR] {data}")
                            
                    except json.JSONDecodeError:
                        pass
            
            print(f"\n--- Results ---")
            print(f"Total events: {event_count}")
            print(f"Text length: {len(full_text)} chars")
            print(f"Thinking length: {len(thinking_text)} chars")
            print(f"Text content: {full_text[:500]}")
            if thinking_text:
                print(f"Thinking content (first 200): {thinking_text[:200]}...")


if __name__ == "__main__":
    asyncio.run(test_chat())
