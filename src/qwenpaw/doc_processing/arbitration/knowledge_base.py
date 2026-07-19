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
        """从文档文本中提取并导入知识条目"""
        entries_added = []
        
        # 按段落分割
        paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 50]
        
        for i, para in enumerate(paragraphs):
            # 提取标题（第一行或前50个字符）
            lines = para.split("\n")
            title = lines[0][:100] if lines else f"条目{i+1}"
            
            tags = []
            if auto_tag:
                # 简单标签提取
                if "合同" in para:
                    tags.append("合同纠纷")
                if "买卖" in para:
                    tags.append("买卖合同")
                if "租赁" in para:
                    tags.append("租赁合同")
                if "建设工程" in para:
                    tags.append("建设工程")
                if "股权" in para:
                    tags.append("股权转让")
                if "仲裁" in para:
                    tags.append("仲裁程序")
            
            entry_id = await self.add_entry(title, para, doc_type, tags)
            entries_added.append(entry_id)
        
        logger.info(f"从文档导入了 {len(entries_added)} 个知识条目")
        return entries_added
