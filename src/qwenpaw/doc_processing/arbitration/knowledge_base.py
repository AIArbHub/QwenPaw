# -*- coding: utf-8 -*-
"""
仲裁知识库模块
管理仲裁案例、法规、条款的结构化知识
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

from ...utils.logging import logger


class KnowledgeEntry:
    """知识库条目"""
    def __init__(self, entry_id: str, title: str, content: str, entry_type: str = "case"):
        self.entry_id = entry_id
        self.title = title
        self.content = content
        self.entry_type = entry_type  # case, law, clause, precedent
        self.metadata: Dict[str, Any] = {}
        self.created_at = datetime.now().isoformat()
        self.tags: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "title": self.title,
            "content": self.content,
            "entry_type": self.entry_type,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "tags": self.tags
        }


class ArbitrationKnowledgeBase:
    """
    仲裁知识库
    管理商事仲裁相关的案例、法规、条款等知识
    支持检索、关联分析和智能推荐
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir) if storage_dir else Path.home() / ".ai_arb" / "knowledge"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._entries: Dict[str, KnowledgeEntry] = {}
        self._index: Dict[str, List[str]] = {}  # tag -> entry_ids
        self._load_entries()

    def _load_entries(self):
        """从磁盘加载已有条目"""
        index_file = self.storage_dir / "index.json"
        if index_file.exists():
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for entry_data in data.get("entries", []):
                        entry = KnowledgeEntry(
                            entry_data["entry_id"],
                            entry_data["title"],
                            entry_data["content"],
                            entry_data.get("entry_type", "case")
                        )
                        entry.metadata = entry_data.get("metadata", {})
                        entry.tags = entry_data.get("tags", [])
                        entry.created_at = entry_data.get("created_at", entry.created_at)
                        self._entries[entry.entry_id] = entry
                        for tag in entry.tags:
                            if tag not in self._index:
                                self._index[tag] = []
                            self._index[tag].append(entry.entry_id)
                logger.info(f"加载了 {len(self._entries)} 个知识库条目")
            except Exception as e:
                logger.warning(f"加载知识库失败: {e}")

    def _save_index(self):
        """保存索引到磁盘"""
        index_file = self.storage_dir / "index.json"
        try:
            data = {
                "entries": [e.to_dict() for e in self._entries.values()]
            }
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存知识库索引失败: {e}")

    async def add_entry(
        self,
        title: str,
        content: str,
        entry_type: str = "case",
        tags: List[str] = None,
        metadata: Dict[str, Any] = None
    ) -> str:
        """添加知识条目"""
        entry_id = f"kb_{datetime.now().strftime('%Y%m%d%H%M%S')}_{len(self._entries)}"
        
        entry = KnowledgeEntry(entry_id, title, content, entry_type)
        entry.tags = tags or []
        entry.metadata = metadata or {}
        
        self._entries[entry_id] = entry
        for tag in entry.tags:
            if tag not in self._index:
                self._index[tag] = []
            self._index[tag].append(entry_id)
        
        self._save_index()
        logger.info(f"添加知识条目: {entry_id} - {title}")
        return entry_id

    async def search(
        self,
        query: str,
        entry_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """搜索知识库"""
        results = []
        query_lower = query.lower()
        
        for entry in self._entries.values():
            # 类型过滤
            if entry_type and entry.entry_type != entry_type:
                continue
            
            # 标签过滤
            if tags:
                if not any(t in entry.tags for t in tags):
                    continue
            
            # 内容匹配
            score = 0
            if query_lower in entry.title.lower():
                score += 3
            if query_lower in entry.content.lower():
                score += 2
            for tag in entry.tags:
                if query_lower in tag.lower():
                    score += 1
            
            if score > 0:
                results.append({
                    **entry.to_dict(),
                    "relevance_score": score
                })
        
        # 按相关度排序
        results.sort(key=lambda x: x["relevance_score"], reverse=True)
        return results[:limit]

    async def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """获取单个条目"""
        entry = self._entries.get(entry_id)
        return entry.to_dict() if entry else None

    async def update_entry(self, entry_id: str, **kwargs) -> bool:
        """更新条目"""
        entry = self._entries.get(entry_id)
        if not entry:
            return False
        
        if "title" in kwargs:
            entry.title = kwargs["title"]
        if "content" in kwargs:
            entry.content = kwargs["content"]
        if "tags" in kwargs:
            # 更新索引
            for tag in entry.tags:
                if tag in self._index and entry_id in self._index[tag]:
                    self._index[tag].remove(entry_id)
            entry.tags = kwargs["tags"]
            for tag in entry.tags:
                if tag not in self._index:
                    self._index[tag] = []
                self._index[tag].append(entry_id)
        if "metadata" in kwargs:
            entry.metadata.update(kwargs["metadata"])
        
        self._save_index()
        return True

    async def delete_entry(self, entry_id: str) -> bool:
        """删除条目"""
        entry = self._entries.get(entry_id)
        if not entry:
            return False
        
        # 清理索引
        for tag in entry.tags:
            if tag in self._index and entry_id in self._index[tag]:
                self._index[tag].remove(entry_id)
                if not self._index[tag]:
                    del self._index[tag]
        
        del self._entries[entry_id]
        self._save_index()
        return True

    async def get_statistics(self) -> Dict[str, Any]:
        """获取知识库统计"""
        type_counts = {}
        tag_counts = {}
        for entry in self._entries.values():
            type_counts[entry.entry_type] = type_counts.get(entry.entry_type, 0) + 1
            for tag in entry.tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        
        return {
            "total_entries": len(self._entries),
            "by_type": type_counts,
            "top_tags": dict(sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]),
            "storage_dir": str(self.storage_dir)
        }

    async def import_from_document(
        self,
        text: str,
        doc_type: str = "case",
        auto_tag: bool = True
    ) -> List[str]:
        """从文档文本中提取并导入知识条目
        
        当 auto_tag=True 且 LLM 可用时，使用 qwenpaw 智能体
        进行智能标签提取和条目结构化，大幅优于简单关键词匹配。
        如果 LLM 不可用，则回退到基于规则的关键词匹配。
        """
        entries_added = []
        
        # 尝试使用 LLM 进行智能提取
        if auto_tag:
            ai_result = await self._ai_extract_entries(text, doc_type)
            if ai_result:
                for entry_data in ai_result:
                    entry_id = await self.add_entry(
                        title=entry_data.get("title", ""),
                        content=entry_data.get("content", ""),
                        entry_type=doc_type,
                        tags=entry_data.get("tags", []),
                        metadata=entry_data.get("metadata", {}),
                    )
                    entries_added.append(entry_id)
                logger.info(f"AI 提取并导入了 {len(entries_added)} 个知识条目")
                return entries_added
        
        # 回退：规则-based 段落分割
        paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 50]
        
        for i, para in enumerate(paragraphs):
            lines = para.split("\n")
            title = lines[0][:100] if lines else f"条目{i+1}"
            
            tags = []
            if auto_tag:
                tags = self._rule_based_tags(para)
            
            entry_id = await self.add_entry(title, para, doc_type, tags)
            entries_added.append(entry_id)
        
        logger.info(f"从文档导入了 {len(entries_added)} 个知识条目")
        return entries_added

    async def _ai_extract_entries(
        self,
        text: str,
        doc_type: str,
    ) -> Optional[List[Dict[str, Any]]]:
        """使用 LLM 从文档中智能提取知识条目"""
        try:
            from agentscope.message import Msg, TextBlock
            from ...agents.model_factory import create_model_and_formatter
            from ...utils.model_response import consume_model_response

            model, _ = create_model_and_formatter()

            prompt = (
                "你是仲裁知识库管理专家。请从以下文档中提取结构化的知识条目。\n\n"
                "要求：\n"
                "1. 识别文档中的独立知识单元（如案例、法条、裁判规则等）\n"
                "2. 为每个条目生成简洁的标题\n"
                "3. 为每个条目分配 2-5 个相关标签\n"
                "4. 提取关键元数据（如案号、法院、判决日期等）\n\n"
                f"文档内容（前5000字）：\n{text[:5000]}\n\n"
                "请返回JSON数组格式：\n"
                '[{"title": "标题", "content": "内容", '
                '"tags": ["标签1", "标签2"], "metadata": {"key": "value"}}]'
            )

            messages = [
                Msg(
                    name="system",
                    role="system",
                    content=[TextBlock(type="text", text="你是知识库管理专家，只返回JSON数组。")],
                ),
                Msg(
                    name="user",
                    role="user",
                    content=[TextBlock(type="text", text=prompt)],
                ),
            ]

            response = await consume_model_response(model, messages)

            import json
            import re
            # 提取 JSON 数组
            try:
                result = json.loads(response)
            except (json.JSONDecodeError, TypeError):
                json_match = re.search(r'\[[\s\S]*\]', response)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    logger.debug(f"AI 知识提取返回非JSON: {response[:200]}")
                    return None

            if isinstance(result, list) and result:
                return result
            return None

        except Exception as e:
            logger.debug(f"AI 知识提取不可用（回退到规则提取）: {e}")
            return None

    @staticmethod
    def _rule_based_tags(text: str) -> List[str]:
        """基于规则的关键词标签提取（LLM 不可用时的回退方案）"""
        tags = []
        tag_rules = [
            ("合同纠纷", ["合同", "协议", "违约"]),
            ("买卖合同", ["买卖", "购销", "销售"]),
            ("租赁合同", ["租赁", "租金", "承租"]),
            ("建设工程", ["建设工程", "施工", "工程款"]),
            ("股权转让", ["股权", "股份转让", "股东"]),
            ("仲裁程序", ["仲裁", "仲裁庭", "裁决"]),
            ("金融借款", ["借款", "贷款", "利息", "担保"]),
            ("劳动争议", ["劳动", "工资", "解除合同"]),
            ("知识产权", ["商标", "专利", "著作权"]),
            ("房地产", ["房产", "房屋", "土地"]),
        ]
        for tag, keywords in tag_rules:
            if any(kw in text for kw in keywords):
                tags.append(tag)
        return tags
