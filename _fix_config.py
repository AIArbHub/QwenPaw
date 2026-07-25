import sys

# Step 1: Add `documents` field to root Config class in config.py
config_path = r"d:\BaiduSyncdisk\Project\AIArb\src\aiarb\config\config.py"
with open(config_path, "r", encoding="utf-8") as f:
    content = f.read()

old = "    acp: ACPConfig = Field(default_factory=ACPConfig)\n    show_tool_details: bool = True"
new = """    acp: ACPConfig = Field(default_factory=ACPConfig)
    documents: DocumentConfig = Field(
        default_factory=DocumentConfig,
        description="Document management configuration (knowledge, cases, output, desensitization, parser)",
    )
    show_tool_details: bool = True"""

if old in content:
    content = content.replace(old, new)
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("OK: Added documents field to Config class")
else:
    print("SKIP: documents field already exists or pattern not found")
    # Check if already added
    if "documents: DocumentConfig" in content.split("class Config")[1].split("\n\n")[0]:
        print("  -> documents field already present in Config class")

# Step 2: Fix _get_parser() in knowledge.py to read from config.documents.parser
knowledge_path = r"d:\BaiduSyncdisk\Project\AIArb\src\aiarb\app\routers\knowledge.py"
with open(knowledge_path, "r", encoding="utf-8") as f:
    content = f.read()

old_parser = '''def _get_parser() -> ParserRouter:
    global _parser_router
    if _parser_router is None:
        try:
            from ...config import load_config
            config = load_config()
            mineru_key = getattr(config, "mineru_api_key", "") or ""
            mineru_url = getattr(config, "mineru_base_url", "https://mineru.net/api/v4") or "https://mineru.net/api/v4"
        except Exception:
            mineru_key = ""
            mineru_url = "https://mineru.net/api/v4"
        _parser_router = ParserRouter(mineru_api_key=mineru_key, mineru_base_url=mineru_url)
    return _parser_router'''

new_parser = '''def _get_parser() -> ParserRouter:
    global _parser_router
    if _parser_router is None:
        try:
            from ...config import load_config
            config = load_config()
            parser_cfg = getattr(config, "documents", None)
            if parser_cfg is not None:
                parser_cfg = getattr(parser_cfg, "parser", None)
            mineru_key = getattr(parser_cfg, "mineru_api_key", "") or "" if parser_cfg else ""
            mineru_url = getattr(parser_cfg, "mineru_base_url", "https://mineru.net/api/v4") or "https://mineru.net/api/v4" if parser_cfg else "https://mineru.net/api/v4"
        except Exception:
            mineru_key = ""
            mineru_url = "https://mineru.net/api/v4"
        _parser_router = ParserRouter(mineru_api_key=mineru_key, mineru_base_url=mineru_url)
    return _parser_router'''

if old_parser in content:
    content = content.replace(old_parser, new_parser)
    with open(knowledge_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("OK: Fixed _get_parser to read from config.documents.parser")
else:
    print("SKIP: _get_parser already updated or pattern not found")

print("\nDone!")