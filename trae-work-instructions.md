# TRAE Work 实施指示文档：QwenPaw 借鉴 StaffDeck 功能二次开发（v3.0）

> **文档版本**：3.0
> **更新日期**：2026-07-26
> **适用项目**：QwenPaw（moot5 分支）
> **前置条件**：QwenPaw 已完成 SOP 引擎、知识库插件基础版、StaffDeck 设计 token 注入、AgentCard 重设计、Workbench 聚合页

---

## 0. 文档变更说明

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.1 | 2026-07-26 | 移除 doc_processing 依赖，改为内嵌轻量解析器 |
| **3.0** | **2026-07-26** | **基于 QwenPaw 最新代码状态全面重写；确认 SOP/知识库/前端已实现的部分；聚焦真正缺失的 OKF/引用/Router/7维反思/LLM归因/自发现** |

---

## 1. 项目现状确认（2026-07-26 最新代码）

### 1.1 QwenPaw 已实现功能（不需要重做）

| 功能 | 实现路径 | 完成度 |
|------|----------|--------|
| SOP 流程引擎 | `src/aiarb/sop/`（schema + runtime + step_agent + distiller + store + reflection） | 完整 |
| SOP 前端 | `console/src/pages/Settings/Sop/`（GraphEditor + TracePanel + DistillPanel） | 完整 |
| 知识库插件 | `src/aiarb/builtin_plugins/knowledge-base/`（service + vector_store + routes） | 基础可用 |
| StaffDeck 设计 token | `console/src/styles/staffdeck-tokens.css`（58 个 CSS 变量） | 已注入 |
| AgentCard 重设计 | `console/src/pages/Settings/Agents/components/AgentCard.tsx` | 已完成 |
| Workbench 聚合页 | `console/src/pages/Workbench/index.tsx`（Hero + 5 Tab） | 已完成 |
| 菜单系统重构 | `console/src/layouts/registry/builtinMenu.ts`（2026-07-24 redesign） | 已完成 |
| 评分反馈插件 | `src/aiarb/builtin_plugins/agent-feedback/` | 基础可用 |
| 反思引擎骨架 | `src/aiarb/sop/reflection.py` | 骨架 |
| 记忆系统 | `src/aiarb/agents/memory/`（ADBPG + ReMe + proactive） | 完整 |
| 可观测性 | `src/aiarb/hooks/observability/` + Langfuse + governance | 完整 |
| 智能体统计 | `src/aiarb/agent_stats/` | 完整 |
| 插件系统 | `src/aiarb/plugins/`（loader + registry + api + governance） | 完整 |

### 1.2 StaffDeck 可借鉴功能（本次实施目标）

| 功能 | StaffDeck 路径 | QwenPaw 现状 | 优先级 |
|------|---------------|-------------|--------|
| OKF 概念图 | `knowledge/okf.py` | 无 | P0 |
| 知识引用机制 | `knowledge/citations.py` | 无 | P0 |
| 轻量解析器 | `knowledge/parser.py` | 仍依赖 doc_processing | P0 |
| Router 决策层 | `core/router.py` | 无 | P1 |
| 7 维反思 RUBRIC | `skills/skill_reflection.py` | 骨架级 reflection.py | P1 |
| LLM 反馈归因 | `feedback/service.py` | 仅记录 rating | P1 |
| 知识自发现 | `knowledge/service.py` `_discover_from_document` | 无 | P1 |
| SOP 排行榜 | `frontend/.../SkillsPage.tsx` | 无 | P2 |
| 定时任务租约 | `scheduled_tasks/` | 无租约机制 | P2 |
| 前端风格统一 | - | SOP/知识库/反馈页未用 sd-* token | P2 |

### 1.3 不借鉴的功能（QwenPaw 已有或不需要）

| StaffDeck 功能 | 不借鉴原因 |
|---------------|-----------|
| 向量检索（StaffDeck 无向量库） | QwenPaw 已有 vector_store，更优 |
| Span 可观测性 | QwenPaw 已有 Langfuse + governance，更完善 |
| 记忆系统 | QwenPaw 已有 ADBPG + ReMe + proactive，更丰富 |
| 渠道接入 | QwenPaw 已有自己的渠道系统 |
| 通用技能（General Skills） | QwenPaw 已有 skill_system |

---

## 2. 设计原则

### 2.1 增强不替换

- 所有借鉴都落入 QwenPaw 现有目录结构，不新建平行系统
- 知识库增强 `builtin_plugins/knowledge-base/`，不新建模块
- SOP 增强在 `sop/` 内扩展，不新建 `core/` 目录
- 反馈增强在 `builtin_plugins/agent-feedback/` 内扩展

### 2.2 前端统一策略

**所有新/改页面必须引用 `--sd-*` token**，避免之前"复刻功能但风格诡异"的问题。

改造规则（适用于所有新/改页面）：

```css
/* 卡片 */
.sd-card {
  background: var(--sd-surface);
  border-radius: var(--sd-radius-card);  /* 20px */
  box-shadow: var(--sd-shadow-soft);
  border: 1px solid var(--sd-border);
}

/* 主按钮 */
.sd-btn-primary {
  background: var(--sd-accent);
  color: white;
  border-radius: var(--sd-radius-md);  /* 14px */
}

/* 页面间距 */
.sd-page {
  padding: var(--sd-page-px);  /* 48px */
}

/* 卡片间距 */
.sd-card-gap {
  gap: var(--sd-card-gap);  /* 32px */
}

/* 状态圆点 */
.sd-status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--sd-radius-full);  /* 999px */
}
```

### 2.3 功能联动闭环

```
文档入库 -> [自发现] -> SOP 草稿 -> 用户确认 -> SOP 执行
    |                                        |
  [OKF 概念图] <---- [知识引用] <---- [KNOWLEDGE_QUERY]
                                           |
                                    用户反馈 -> [LLM 归因] -> [7 维反思] -> 改进 SkillCard
```

### 2.4 不引入新技术栈

- 后端：继续 FastAPI + Pydantic + aiofiles + orjson
- 前端：继续 Ant Design 5 + Less + sd-* token 叠加
- 不引入 TailwindCSS、shadcn/ui、SQLModel
- 解析器依赖：仅 `pypdf` + `python-docx`（已有降级方案）

---


## 3. 实施阶段

### 阶段 1：知识库升级（OKF + 引用 + 解析器替换）

**目标**：把知识库从"文本仓库"升级为"知识图谱 + 可追溯引用"
**工期**：2-3 周

#### 3.1.1 新增轻量解析器

**创建文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/parser.py`

借鉴 StaffDeck `knowledge/parser.py`（约120行单文件），不依赖 doc_processing：

```python
"""轻量文档解析器 - 借鉴 StaffDeck knowledge/parser.py。

支持 txt/md/html/pdf/docx，有降级策略和编码检测。
不依赖 doc_processing 模块。
"""
from __future__ import annotations
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".html", ".htm", ".pdf", ".docx"}

class KnowledgeParseError(ValueError):
    pass

def extract_text(filename: str, content: bytes) -> tuple[str, str]:
    """提取文档文本。返回 (text, format)。"""
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise KnowledgeParseError(f"暂不支持 {suffix} 文件格式。")
    if suffix in {".txt", ".md", ".markdown"}:
        return _decode_text(content), suffix.lstrip(".")
    if suffix in {".html", ".htm"}:
        return _extract_html(content), "html"
    if suffix == ".pdf":
        return _extract_pdf(content), "pdf"
    if suffix == ".docx":
        return _extract_docx(content), "docx"
    raise KnowledgeParseError(f"暂不支持 {suffix} 文件格式。")

def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")

def _extract_pdf(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise KnowledgeParseError("缺少 pypdf，无法解析 PDF。") from exc
    reader = PdfReader(BytesIO(content))
    pages = []
    for index, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(f"[Page {index + 1}]\n{page_text}")
    return "\n\n".join(pages)

def _extract_docx(content: bytes) -> str:
    try:
        from docx import Document
        document = Document(BytesIO(content))
        rows = [p.text for p in document.paragraphs if p.text.strip()]
        for table in document.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
        return "\n".join(rows)
    except Exception:
        return _extract_docx_with_zip(content)

def _extract_docx_with_zip(content: bytes) -> str:
    with ZipFile(BytesIO(content)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
    parser = _DocxTextExtractor()
    parser.feed(xml)
    return parser.text

def _extract_html(content: bytes) -> str:
    text = _decode_text(content)
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(text, "html.parser")
        for item in soup(["script", "style", "noscript"]):
            item.decompose()
        return soup.get_text("\n")
    except Exception:
        parser = _HTMLTextExtractor()
        parser.feed(text)
        return parser.text

class _HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts = []
    @property
    def text(self):
        return "\n".join(p.strip() for p in self._parts if p.strip())
    def handle_data(self, data):
        if data.strip():
            self._parts.append(data)

class _DocxTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts = []
    @property
    def text(self):
        return "\n".join(p.strip() for p in self._parts if p.strip())
    def handle_data(self, data):
        if data.strip():
            self._parts.append(data)
```

#### 3.1.2 新增 OKF 概念图

**创建文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/okf.py`

借鉴 StaffDeck `knowledge/okf.py`，适配 QwenPaw 的 JSON 文件存储（不用 SQLModel）。

**核心概念**：
- 6 种概念类型：Source Document / Source Section / Topic / Playbook / Business Rule / Query Analysis
- 层级路径 ID：如 `sources/order-doc/sections/cancel-policy`
- 概念间链接关系（有向图边）
- OKF Lint 健康检查：missing_type / broken_link / orphan_concept / duplicate_title

**核心函数**：
- `build_okf_for_document(doc_id, title, sections, buckets) -> list[OKFConcept]` — 为文档构建概念列表
- `search_concepts(concepts, query) -> list[(concept, score)]` — 概念搜索（标题权重6.0，正文权重3.0，完整查询+10）
- `lint_concepts(concepts) -> list[issues]` — 健康检查

**OKFConcept 数据结构**：

```python
@dataclass
class OKFConcept:
    concept_id: str          # 层级路径 ID
    concept_type: str        # 6 种类型之一
    title: str
    description: str = ""
    content_md: str = ""     # 带 YAML frontmatter 的 Markdown
    frontmatter: dict = field(default_factory=dict)
    links: list[dict] = field(default_factory=list)      # 概念间链接
    citations: list[dict] = field(default_factory=list)  # 引用来源
    source_refs: list[dict] = field(default_factory=list)  # 回溯原始文档
    document_id: str = ""
```

**搜索评分规则**（借鉴 StaffDeck okf.py）：
- 标题匹配：权重 6.0
- 类型匹配：权重 2.0
- 正文匹配：权重 3.0
- 完整查询命中描述：额外 +10.0
- 中文 n-gram（2/3/4字）支持无空格匹配
- 最低分阈值：4.0

#### 3.1.3 新增知识引用机制

**创建文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/citations.py`

借鉴 StaffDeck `knowledge/citations.py`：

**核心功能**：
- `knowledge_citations_from_results(results, limit=4) -> list[citation]` — 从检索结果生成引用
- `compact_knowledge_citation_labels(content, citations) -> (content, citations)` — 压缩引用标签

**引用类型**：concept / evidence / okf

**字符限制**：
- `CITATION_EXCERPT_CHAR_LIMIT = 6000`
- `CITATION_SUMMARY_CHAR_LIMIT = 800`
- `CONCEPT_EXCERPT_CHAR_LIMIT = 2400`

**引用结构**：

```python
{
    "label": "[1]",
    "kind": "concept",  # 或 "evidence"
    "title": "文档标题",
    "excerpt": "引用摘录...",
    "source": {"doc_id": "...", "section_id": "..."}
}
```

**压缩逻辑**：按回复中 `[N]` 首次出现顺序重新编号，移除未引用的来源，保持编号连续。

#### 3.1.4 重构 service.py

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/service.py`

**关键改动**：

1. 移除 `from aiarb.doc_processing import DocParser`，改用 `from .parser import extract_text`
2. 入库时构建 OKF 概念图并存储到 `okf_concepts.json`
3. 检索时返回概念 + 证据 + 引用

**入库流程**（改造后）：

```python
async def ingest_document(self, request):
    # Step 1: 轻量解析（不依赖 doc_processing）
    from .parser import extract_text, KnowledgeParseError
    with open(request.file_path, "rb") as f:
        content = f.read()
    text, fmt = extract_text(request.file_path, content)

    # Step 2: 分块（保留现有 vector_store 逻辑）
    chunks = self._split_chunks(text)
    doc_id = hashlib.sha256(text.encode()).hexdigest()[:16]

    # Step 3: 构建 OKF 概念图
    from .okf import build_okf_for_document
    sections = self._build_sections(text)
    buckets = self._build_buckets(sections)
    concepts = build_okf_for_document(doc_id, request.title, sections, buckets)

    # Step 4: 存储到向量库 + OKF 存储
    await self._vector_store.store_chunks(doc_id, chunks)
    await self._store_okf_concepts(doc_id, concepts)
```

**检索流程**（改造后）：

```python
async def search(self, query, top_k=5):
    # 向量检索（保留现有逻辑）
    chunks = await self._vector_store.search(query, top_k=top_k)

    # OKF 概念搜索
    from .okf import search_concepts
    concepts = await self._load_okf_concepts()
    concept_results = search_concepts(concepts, query)

    # 生成引用
    from .citations import knowledge_citations_from_results
    citations = knowledge_citations_from_results([{
        "selected_concepts": [c for c, _ in concept_results[:3]],
        "evidence_pack": chunks[:top_k],
    }])

    return {"chunks": chunks, "concepts": [...], "citations": citations}
```

**OKF 存储方法**：

```python
async def _store_okf_concepts(self, doc_id, concepts):
    """存储 OKF 概念到 JSON 文件。"""
    okf_file = self._storage_dir / "okf_concepts.json"
    # 读取现有 -> 追加 -> 写回
    existing = await self._read_json(okf_file)
    existing[doc_id] = [c.__dict__ for c in concepts]
    await self._write_json(okf_file, existing)
```

#### 3.1.5 SOP runtime 联动改造

**修改文件**：`src/aiarb/sop/runtime.py`

第 160 行已有知识库联动，修改返回值携带 citations：

```python
# 修改前（现有）：
# result = await kb_service.search(query)
# return KnowledgeQueryResult(chunks=result.get("chunks", []))

# 修改后：
result = await kb_service.search(query)
return KnowledgeQueryResult(
    chunks=result.get("chunks", []),
    concepts=result.get("concepts", []),
    citations=result.get("citations", []),
)
```

#### 3.1.6 前端知识库页改造

**修改文件**：`console/src/pages/KnowledgeBase/index.tsx`

- 所有卡片/按钮引用 `var(--sd-*)` token
- 新增 OKF 概念浏览面板（Accordion 折叠）
- 新增引用追溯展示

**验收标准**：
- [ ] `doc_processing` 不再被知识库插件引用
- [ ] 文档入库后可查看 OKF 概念列表
- [ ] 检索结果带 `[N]` 引用编号
- [ ] 前端页面使用 sd-* token

---


### 阶段 2：SOP 增强（Router + 7 维反思）

**目标**：补齐多任务管理和质量评估
**工期**：2-3 周

#### 3.2.1 新增 Router 决策层

**创建文件**：`src/aiarb/sop/router.py`

借鉴 StaffDeck `core/router.py`（9 种决策）：

**9 种决策类型**：

| 决策 | 说明 |
|------|------|
| continue_active | 继续当前任务 |
| switch_to_pending | 切换到待处理任务（需指定 selected_task_id） |
| create_pending | 创建新待处理任务（当前任务挂起） |
| update_pending | 更新待处理任务 |
| complete_task | 完成当前任务 |
| start_new_task | 开始新任务（需指定 target_skill_id） |
| answer_only | 仅回答（无需技能） |
| handoff_human | 转人工 |
| clarify | 需要澄清（需指定 clarification_question） |

**RouterDecision 数据结构**：

```python
class RouterDecision(BaseModel):
    decision: RouterDecisionValue = "answer_only"
    target_skill_id: str = ""
    target_step_id: str = ""
    user_intent: str = ""
    general_intent: str = ""
    clarification_question: str = ""
    selected_task_id: str = ""
    slot_hints: dict[str, str] = Field(default_factory=dict)
    task_frames: list[dict] = Field(default_factory=list)
    pending_tasks: list[dict] = Field(default_factory=list)
    created_tasks: list[dict] = Field(default_factory=list)
```

**Router 核心方法**：
- `decide(user_input, session_state, available_skills, pending_tasks) -> RouterDecision`
- `_normalize_decision(decision, skills, pending_tasks)` — 校正 LLM 输出：
  - target_skill_id 不在可用技能中则清空
  - start_new_task 无有效 skill_id 则降级为 clarify
  - switch_to_pending 无有效 task_id 则降级为 clarify

**Router prompt 要点**：
- 列出可用技能（id + name + description）
- 列出待处理任务（task_id + user_intent + skill_id）
- 要求返回 JSON 格式决策

#### 3.2.2 扩展 schema.py

**修改文件**：`src/aiarb/sop/schema.py`

在 `SkillCard` 中增加字段（借鉴 StaffDeck skill_schema.py）：

```python
# 新增字段
terminal_node_ids: list[str] = Field(default_factory=list, description="终止节点 ID 列表")
trigger_intents: list[str] = Field(default_factory=list, description="触发意图列表")
required_info: list[str] = Field(default_factory=list, description="必填槽位列表")
interruption_policy: dict[str, str] = Field(default_factory=dict, description="中断策略")
response_rules: list[str] = Field(default_factory=list, description="响应规则")
```

在 `SkillGraphNode` 中增加字段：

```python
# 新增字段
expected_user_info: list[str] = Field(default_factory=list, description="期望收集的信息")
allowed_actions: list[str] = Field(default_factory=list, description="允许的动作列表")
retry_policy: dict[str, Any] = Field(default_factory=dict, description="重试策略")
```

#### 3.2.3 重写 7 维反思 RUBRIC

**修改文件**：`src/aiarb/sop/reflection.py`

替换骨架实现，借鉴 StaffDeck `skill_reflection.py`（7 维度 + 最多 3 轮）：

**7 个评分维度**：

| 维度 | key | 说明 |
|------|-----|------|
| 来源一致性 | source_alignment | 回复是否基于知识库/文档 |
| 闭环能力 | closed_loop | 是否有明确的终止条件 |
| 自适应推进 | adaptive_progression | 能否根据用户输入调整流程 |
| 工具依据 | tool_grounding | 工具调用是否有充分理由 |
| 工具调用格式 | tool_call_format | 参数是否正确 |
| 副作用确认 | side_effect_confirmation | 有副作用的操作是否确认 |
| 中断恢复 | interruption_and_recovery | 中断后能否恢复 |

**反思流程**：
1. 最多 3 轮反思（`MAX_REFLECTION_ROUNDS = 3`）
2. 每轮 LLM 评估 7 个维度，返回 score(0-1) + issues + suggestion
3. 提取 strengths / weaknesses / suggestions / summary
4. 如果没有失败项（score < 0.6），提前结束
5. 无 LLM 时用规则评分（闭环率、工具错误率、反馈率）

**ReflectionResult 数据结构**：

```python
@dataclass
class ReflectionResult:
    agent_id: str = ""
    skill_id: str = ""
    summary: str = ""
    strengths: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    rubric_scores: dict[str, dict] = field(default_factory=dict)
    # rubric_scores 示例:
    # {"source_alignment": {"label": "来源一致性", "score": 0.8, "issues": [], "suggestion": ""}}
    metrics: dict[str, Any] = field(default_factory=dict)
    rounds: int = 0
```

**规则评分逻辑**（无 LLM 时）：
- 闭环能力 = completed_sessions / total_sessions
- 工具调用格式 = 1 - tool_errors / tool_calls
- 来源一致性 = positive / (positive + negative)

#### 3.2.4 前端 SOP 页改造

**修改文件**：`console/src/pages/Settings/Sop/index.tsx`

- 所有卡片/按钮引用 `var(--sd-*)` token
- 新增排行榜模式（调用次数/正向/负向排序）
- 新增 7 维反思评分展示（雷达图或进度条）

**验收标准**：
- [ ] Router 能处理多任务场景（挂起/恢复/切换）
- [ ] SkillCard 支持 terminal_node_ids/trigger_intents/allowed_actions
- [ ] 反思引擎输出 7 维评分
- [ ] 前端 SOP 页使用 sd-* token

---


### 阶段 3：评分反馈升级（LLM 归因 + 排行榜）

**目标**：从"记录反馈"升级为"归因 + 统计 + 排行"
**工期**：2 周

#### 3.3.1 新增 LLM 归因

**创建文件**：`src/aiarb/builtin_plugins/agent-feedback/backend/attribution.py`

借鉴 StaffDeck `feedback/service.py`（7 类归因）：

**7 类归因分类**：

| 分类 key | 标签 | 说明 |
|---------|------|------|
| model_issue | 模型问题 | 模型理解/推理/回复有问题 |
| skill_issue | 技能问题 | SOP 定义/步骤/槽位有问题 |
| tool_or_system_issue | 工具/系统问题 | 工具未配置/调用失败 |
| user_random_or_unclear | 用户随意或上下文不足 | 用户随意点踩 |
| positive_or_resolved | 正向反馈 | 点赞 |
| needs_model_analysis | 待模型分析 | 无可用模型 |
| unknown | 未知 | 无法分类 |

**归因流程**：
1. 收集反馈上下文：目标消息 + 附近 8 条消息 + 最近 30 条 AgentEvent
2. 调用 LLM 生成 JSON 分析（bucket, confidence, reason, summary）
3. 最多重试 3 次，退避延迟递增（2^attempt 秒）
4. 无模型时标记 `needs_model_analysis`

**归因结果结构**：

```python
{
    "analysis_status": "analyzed",  # pending/analyzed/needs_model_analysis/failed
    "analysis_bucket": "model_issue",
    "analysis_reason": "模型未理解用户意图...",
    "analysis_summary": "用户对回复不满意，主要原因是...",
    "analysis_confidence": 0.85,
}
```

#### 3.3.2 扩展反馈模型

**修改文件**：`src/aiarb/builtin_plugins/agent-feedback/backend/models.py`

增加归因字段和技能级反馈（借鉴 StaffDeck MessageFeedback + SkillFeedback）：

```python
class FeedbackModel(BaseModel):
    # ... 保留现有字段 ...

    # 新增归因字段
    analysis_status: str = "pending"
    analysis_bucket: str = ""
    analysis_reason: str = ""
    analysis_summary: str = ""
    analysis_confidence: float = 0.0
    analyzed_at: str = ""

    # 新增技能级反馈字段
    skill_id: str = ""
    skill_version: str = ""
    step_id: str = ""  # 关联到具体 SOP 步骤
```

#### 3.3.3 扩展 service.py

**修改文件**：`src/aiarb/builtin_plugins/agent-feedback/backend/service.py`

增加归因触发和汇总：

**异步归因触发**：
- `add_feedback()` 入库后用 `asyncio.create_task()` 异步触发归因
- 归因不阻塞响应，失败不影响主流程
- 归因完成后更新反馈记录的 analysis_* 字段

**反馈汇总**（借鉴 StaffDeck feedback_summary）：
- `get_summary(agent_id, date_range) -> dict`
- 统计 total/up/down 数量
- 按归因分类计数
- 提取 Top 5 点踩摘要
- 生成总体摘要文本："当前点踩主要集中在「{label}」（{count} 次）"

**汇总返回结构**：

```python
{
    "total": 100,
    "up": 80,
    "down": 20,
    "buckets": {"model_issue": 8, "skill_issue": 7, "tool_or_system_issue": 5},
    "top_down_summaries": [
        {"summary": "...", "bucket": "model_issue"},
        ...
    ],
    "summary_text": "当前点踩主要集中在「模型问题」（8 次）"
}
```

#### 3.3.4 前端反馈页 + SOP 排行榜改造

**修改文件**：
- `console/src/pages/Feedback/index.tsx` — 引用 sd-* token，展示归因分类饼图
- `console/src/pages/Settings/Sop/index.tsx` — 新增排行榜模式

**排行榜模式**（借鉴 StaffDeck SkillsPage）：
- 排序维度：calls（调用次数）、positive（正向）、negative（负向）
- 统计范围：current（当前版本）、total（全版本）
- 需要在 SkillCard 存储中维护 call_count + positive/negative_feedback_count

**验收标准**：
- [ ] 反馈入库后自动触发 LLM 归因
- [ ] 反馈汇总页展示 7 类归因分布
- [ ] SOP 页支持按调用次数/正向/负向排序
- [ ] 前端页面使用 sd-* token

---


### 阶段 4：知识自发现 + 闭环

**目标**：知识入库自动发现 SOP，反馈驱动 SOP 进化
**工期**：2-3 周

#### 3.4.1 新增知识自发现

**创建文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/discovery.py`

借鉴 StaffDeck `knowledge/service.py` `_discover_from_document`：

**发现流程**：
1. 文档入库完成后，将文档 + 知识桶发给 LLM
2. LLM 返回 discoveries 列表（skill/tool/warning 三类建议）
3. skill 建议经过 `_validate_skill_graph` 严格校验（字段完整性 + 图可达性）
4. 存入 JSON 文件，状态为 `pending`
5. 用户可在前端确认或拒绝

**发现结果结构**：

```python
[
    {
        "type": "skill",
        "name": "订单取消流程",
        "description": "处理用户取消订单的请求",
        "skill_card": {"name": "...", "nodes": [...], "edges": [...], ...},
        "status": "pending"
    },
    {
        "type": "tool",
        "name": "订单查询工具",
        "description": "查询订单状态",
        "tool_config": {},
        "status": "pending"
    },
    {
        "type": "warning",
        "message": "该文档包含过时信息，建议更新",
        "status": "pending"
    }
]
```

**技能图校验规则**（借鉴 StaffDeck validate_graph）：
- nodes 非空
- start_node_id 存在
- terminal_node_ids 都存在（可为空）
- 所有边的 source/target 引用已有节点

#### 3.4.2 知识库 service 集成自发现

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/service.py`

在 `ingest_document` 末尾调用自发现：

```python
# Step 5: 知识自发现（不影响入库主流程）
from .discovery import discover_from_document
try:
    from aiarb.model_factory import get_model_factory
    model_factory = get_model_factory()
    discoveries = await discover_from_document(doc_id, request.title, text, model_factory)
    if discoveries:
        await self._store_discoveries(doc_id, discoveries)
except Exception as e:
    logger.warning("知识自发现失败（不影响入库）: %s", e)
```

#### 3.4.3 新增发现建议路由

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/routes.py`

新增 3 个路由：
- `GET /discoveries` — 列出待确认的发现建议
- `POST /discoveries/{id}/confirm` — 确认建议（创建 SOP 或工具）
- `POST /discoveries/{id}/reject` — 拒绝建议

确认 skill 时调用 `sop/store.py` 的创建 API 自动生成 SkillCard。

#### 3.4.4 前端发现确认面板

**修改文件**：`console/src/pages/KnowledgeBase/index.tsx`

新增发现建议面板：
- 待确认列表（pending 状态）
- 确认/拒绝按钮
- 确认 skill 时调用 SOP 创建 API
- 使用 sd-* token 统一风格

#### 3.4.5 定时任务租约机制

**修改文件**：`src/aiarb/app/crons/`（现有定时任务模块）

借鉴 StaffDeck `scheduled_tasks/` 租约机制：

**LeaseGuard 类**：
- `acquire(task_id, ttl_seconds=300) -> bool` — 尝试获取租约
- `release(task_id)` — 释放租约
- 存储到 `cron_leases.json`
- 租约包含 `lease_owner` + `lease_until`（时间戳）
- 获取前检查现有租约是否过期

**在现有 cron executor 中集成**：
```python
# 执行前获取租约
lease = LeaseGuard(storage_dir)
if not await lease.acquire(task_id):
    logger.info("任务 %s 租约被占用，跳过", task_id)
    return
try:
    await execute_task(task_id)
finally:
    await lease.release(task_id)
```

#### 3.4.6 闭环集成

**修改文件**：`src/aiarb/sop/reflection.py`

反思引擎接入反馈归因数据：

```python
# 在 reflect 方法中，从 feedback 参数提取归因分类
if feedback:
    buckets = feedback.get("buckets", {})
    skill_issues = buckets.get("skill_issue", 0)
    tool_issues = buckets.get("tool_or_system_issue", 0)
    model_issues = buckets.get("model_issue", 0)

    # 技能问题 -> 影响 source_alignment 和 adaptive_progression
    # 工具问题 -> 影响 tool_grounding 和 tool_call_format
    # 模型问题 -> 影响 source_alignment
```

**完整闭环**：
```
文档入库 -> [自发现] -> SOP 草稿 -> 用户确认 -> SOP 执行
    |                                        |
  [OKF 概念图] <- [知识引用] <- [KNOWLEDGE_QUERY]
                                         |
                                  用户反馈 -> [LLM 归因] -> [7 维反思] -> 改进 SkillCard -> 重新执行
```

**验收标准**：
- [ ] 文档入库后自动发现 SOP 草稿
- [ ] 前端可确认/拒绝发现建议
- [ ] 确认 skill 时自动创建 SkillCard
- [ ] 定时任务有租约保护
- [ ] 反思引擎接入反馈归因数据

---


## 4. 功能保留对照表

| 功能 | QwenPaw 现状 | 改造后 | 是否保留 |
|------|-------------|--------|---------|
| SOP 图编辑器 | `Sop/GraphEditor.tsx` | 引用 sd-* token | 保留 |
| SOP 执行追踪 | `Sop/TracePanel.tsx` | 引用 sd-* token | 保留 |
| SOP 文档蒸馏 | `Sop/DistillPanel` | 保留，增加 OKF 联动 | 保留 |
| 知识库向量存储 | `vector_store.py` | 保留，增加 OKF 并行 | 保留 |
| AgentCard | 已用 sd-* token | 无需改动 | 保留 |
| Workbench | 已用 sd-* token | 无需改动 | 保留 |
| 记忆系统 | `agents/memory/` | 无需改动 | 保留 |
| 可观测性 | Langfuse + governance | 无需改动 | 保留 |
| 智能体统计 | `agent_stats/` | 无需改动 | 保留 |
| 菜单系统 | 2026-07-24 redesign | 无需改动 | 保留 |
| 日历视图（定时任务） | `Control/CronJobs/` | 增加租约机制 | 保留 |
| 人设编辑（可视化/文本） | AgentConfig | 无需改动 | 保留 |
| 成长时间轴 | `GrowthTimeline/` | 无需改动 | 保留 |
| 收件箱 | `Inbox/` | 无需改动 | 保留 |
| 全局搜索 | `GlobalSearch/` | 无需改动 | 保留 |

---

## 5. 新建文件清单

| 文件路径 | 阶段 | 作用 |
|----------|------|------|
| `src/aiarb/builtin_plugins/knowledge-base/backend/parser.py` | 1 | 轻量文档解析（约120行，借鉴 StaffDeck） |
| `src/aiarb/builtin_plugins/knowledge-base/backend/okf.py` | 1 | OKF 概念图（6种类型 + Lint + 搜索） |
| `src/aiarb/builtin_plugins/knowledge-base/backend/citations.py` | 1 | 知识引用（编号 + 压缩 + 追溯） |
| `src/aiarb/sop/router.py` | 2 | Router 决策层（9种决策） |
| `src/aiarb/builtin_plugins/agent-feedback/backend/attribution.py` | 3 | LLM 反馈归因（7类分类） |
| `src/aiarb/builtin_plugins/knowledge-base/backend/discovery.py` | 4 | 知识自发现（SOP/工具建议） |

## 6. 修改文件清单

| 文件路径 | 阶段 | 改动 |
|----------|------|------|
| `src/aiarb/builtin_plugins/knowledge-base/backend/service.py` | 1 | 移除 doc_processing，接入 parser+OKF+引用 |
| `src/aiarb/sop/runtime.py` | 1 | 检索结果增加 citations |
| `src/aiarb/sop/schema.py` | 2 | 增加 terminal_node_ids/trigger_intents/allowed_actions |
| `src/aiarb/sop/reflection.py` | 2 | 7 维 RUBRIC 替换骨架 |
| `src/aiarb/builtin_plugins/agent-feedback/backend/models.py` | 3 | 增加归因字段+技能级反馈 |
| `src/aiarb/builtin_plugins/agent-feedback/backend/service.py` | 3 | 增加归因触发+汇总 |
| `src/aiarb/builtin_plugins/knowledge-base/backend/routes.py` | 4 | 增加发现建议路由 |
| `console/src/pages/KnowledgeBase/index.tsx` | 1,4 | sd-* token + OKF 浏览 + 发现确认 |
| `console/src/pages/Settings/Sop/index.tsx` | 2,3 | sd-* token + 排行榜 + 7维展示 |
| `console/src/pages/Feedback/index.tsx` | 3 | sd-* token + 归因分布 |
| `src/aiarb/app/crons/` | 4 | 租约机制 |

---

## 7. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| pypdf/python-docx 未安装 | 低 | 中 | parser.py 有降级方案（docx->zip，html->标准库） |
| LLM 归因延迟影响响应 | 中 | 中 | 异步触发，不阻塞反馈入库 |
| OKF 概念图存储膨胀 | 低 | 低 | JSON 文件按 doc_id 分片，定期清理 |
| Router 决策不准确 | 中 | 中 | _normalize_decision 校正 + clarify 兜底 |
| 前端风格不统一 | 中 | 高 | 严格使用 sd-* token，验收检查 |
| 知识自发现产生垃圾建议 | 中 | 低 | _validate_skill_graph 校验 + 用户确认 |

---

## 8. 验收标准（整体）

### 8.1 功能闭环验证

```
1. 上传一份文档到知识库
   -> 解析成功（不依赖 doc_processing）
   -> 生成 OKF 概念图
   -> 自发现 SOP 草稿

2. 确认发现的 SOP 草稿
   -> SkillCard 创建成功
   -> 在 SOP 列表可见

3. 执行 SOP
   -> KNOWLEDGE_QUERY 节点检索知识库
   -> 回复中带 [N] 引用
   -> 引用可追溯原始文档

4. 用户对回复点踩
   -> LLM 自动归因（7 类）
   -> 反馈汇总页展示归因分布

5. 触发反思
   -> 7 维 RUBRIC 评分
   -> 生成改进建议
   -> 建议写入 SkillCard.metadata

6. 定时任务执行
   -> 租约保护防止重复
```

### 8.2 前端风格验证

```
所有新/改页面：
- 卡片使用 var(--sd-radius-card) 和 var(--sd-shadow-soft)
- 按钮使用 var(--sd-accent)
- 间距使用 var(--sd-page-px) 和 var(--sd-card-gap)
- 状态用圆点 + 文字
- 无硬编码颜色值
```

### 8.3 不依赖验证

```
- grep -r "doc_processing" src/aiarb/builtin_plugins/knowledge-base/ -> 无匹配
- grep -r "from aiarb.doc_processing" src/aiarb/ -> 无匹配（除 doc_processing 自身）
- 前端无 TailwindCSS/shadcn 依赖
- 后端无 SQLModel 依赖
```

---

## 9. 注意事项

1. **不使用 doc_processing**：该模块是 vibecoding 产物（过度设计、空实现、从未运行）。知识库插件内嵌轻量解析器 `parser.py`（约120行，借鉴 StaffDeck），只需 `pypdf` + `python-docx` 两个依赖。

2. **保留向量存储**：QwenPaw 已有 `vector_store.py` 基于 ReMe 的向量存储，比 StaffDeck 的纯词法评分更优。OKF 概念搜索作为向量检索的补充，不替换。

3. **前端不换技术栈**：继续用 Ant Design 5 + Less，通过 sd-* token 叠加实现 StaffDeck 视觉风格。不引入 TailwindCSS 或 shadcn/ui。

4. **知识库 JSON 存储**：OKF 概念图用 JSON 文件存储（与现有 vector_store 一致），不引入 SQLModel 或数据库。

5. **异步归因**：LLM 归因异步触发，不阻塞用户反馈入库响应。归因失败不影响主流程。

6. **渐进式改造**：每个阶段独立可验收，不依赖后续阶段。阶段 1 完成后知识库即可独立使用 OKF + 引用。

7. **knowledge/ 遗留目录**：`src/aiarb/knowledge/` 下只有 `.pyc` 文件（无源码），是遗留死代码。实际功能在 `builtin_plugins/knowledge-base/`。清理时应删除该目录。

8. **doc_processing/ 处理**：`src/aiarb/doc_processing/` 有完整源码但从未在 `_app.py` 注册，是 vibecoding 产物。本次改造移除知识库对其的依赖后，可考虑删除或标记为废弃。

---

## 10. 工期估算

| 阶段 | 内容 | 工期 | 优先级 |
|------|------|------|--------|
| 阶段 1 | 知识库升级（OKF + 引用 + 解析器） | 2-3 周 | P0 |
| 阶段 2 | SOP 增强（Router + 7 维反思） | 2-3 周 | P1 |
| 阶段 3 | 评分反馈升级（归因 + 排行榜） | 2 周 | P1 |
| 阶段 4 | 知识自发现 + 闭环 | 2-3 周 | P1 |
| **总计** | | **8-11 周** | |

各阶段可并行推进（阶段 2 和阶段 3 独立），但阶段 4 依赖阶段 1-3 完成。

---

*文档版本：3.0 | 更新日期：2026-07-26 | 适用项目：QwenPaw (moot5 分支)*
*v3.0 变更：基于最新代码状态全面重写；确认已实现功能；聚焦 OKF/引用/Router/7维反思/LLM归因/自发现*
