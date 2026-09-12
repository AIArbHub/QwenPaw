#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Test the knowledge base graph builder."""
from aiarb.app.routers.knowledge import _build_graph_snapshot

snap = _build_graph_snapshot()
print(f"Nodes: {len(snap['nodes'])}, Edges: {len(snap['edges'])}")
print("Sample nodes:")
for n in snap["nodes"][:15]:
    print(f"  id={n['id']}, name={n['name']}, virtual={n['virtual']}, indexed={n['indexed']}")
print("Sample edges:")
for e in snap["edges"][:10]:
    print(f"  {e['source']} -> {e['target']}")
