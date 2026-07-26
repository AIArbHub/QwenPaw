# 知识库插件 (Knowledge Base Plugin)

## 概述

知识库插件提供文档入库、向量化、检索功能，与 SOP 流程引擎联动。

## 功能

### 1. 文档入库

- **文件入库**：通过文件路径调用 `doc_processing` 解析文档并入库
- **文本入库**：直接输入文本内容入库
- **分块策略**：按字符数分块，支持重叠窗口

### 2. 向量检索

- 基于关键词匹配的检索（当前实现）
- 后续可升级为向量嵌入相似度检索
- 支持知识范围和标签过滤

### 3. SOP 联动

- `runtime.py` 的 `knowledge_query` 节点自动调用知识库检索
- 检索结果注入到 `StepAgent` 的 prompt 中

## API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/kb/ingest` | POST | 文件入库 |
| `/kb/ingest-text` | POST | 文本入库 |
| `/kb/search` | POST | 知识库检索 |
| `/kb/documents` | GET | 列出文档 |
| `/kb/documents/{id}` | GET | 文档详情 |
| `/kb/documents/{id}` | DELETE | 删除文档 |

## Agent 工具

插件注册了 `kb_search` 工具，Agent 可通过该工具检索知识库。

## 存储

- 索引文件：`~/.aiarb/knowledge_base/kb_index.json`
- 文档文件：`~/.aiarb/knowledge_base/documents/{doc_id}.json`
