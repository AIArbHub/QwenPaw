# 知识库 / 文本 / 模板 调用链路分析

> 分析基于实际源码（2026-09-08），关键文件已核对，非推测。

## 一、总体链路（四层）

```
[打包层] src/aiarb/knowledge_base/          ← 仓库内（随 pip 包分发）
    │  ensure_global_knowledge_base()  首次运行复制到用户目录（只补缺失，不覆盖）
    ▼
[用户层] ~/.aiarb/knowledge_base/           ← 用户可编辑（WORKING_DIR/knowledge_base）
    │  get_knowledge_dirs()  返回有序搜索根
    ▼
[检索层] search_knowledge 工具              ← 正则 grep 全文检索（非向量/语义）
    │  scope: laws | rules | cases | templates
    ▼
[消费层] Agent / Skill                     ← 提示词中要求"先检索再回答，禁凭记忆"
```

## 二、逐层细节（附源码位置）

### 1. 打包层 → 用户层

`src/aiarb/knowledge.py`

- `get_packaged_knowledge_base_dir()` → `src/aiarb/knowledge_base`（包内只读）
- `get_global_knowledge_base_dir()` → `WORKING_DIR/knowledge_base`（默认 `~/.aiarb/knowledge_base`）
- `ensure_global_knowledge_base()`：**内容哈希追踪的自动同步**（2026-09-08 重构）
  - 每次启动/init 自动执行，**用户无需手动跑任何脚本**
  - 状态文件：`~/.aiarb/knowledge_base/.kb_sync_state.json`（记录各内置文件写入时的哈希）
- 前提：`pyproject.toml` 的 `package-data` 必须含 `knowledge_base/**`（已含）

**同步策略（三态判断）**：

| 情况 | 行为 |
|---|---|
| 包内文件在用户端**不存在** | 复制（新装 / 新增内容自动送达）|
| 包内文件**已更新**，用户端**未改过** | **覆盖更新**（升级自动触达用户）|
| 包内文件**已更新**，用户端**已改过** | **保留用户版本**（永不覆盖用户编辑）|
| 仅存在于用户端的文件/目录（`_parsed`、`_desensitized`、`_wiki`、私有笔记…）| **完全不处理** |

"是否改过"的判据：磁盘哈希 ≠ state 记录的哈希 → 视为用户改过，保留。

> 已通过隔离环境测试验证：首次安装自动内置 312 文件；升级改内容能送达；新增文件能送达；用户改过的文件保留；`_parsed` 等私有数据不受影响。

**不再需要 `scripts/sync_kb_scaffold.py`**：该脚本的功能已内建进运行时。
它仅作为**开发态**工具保留（开发时改了仓库内容想立即推到自己本地 `~/.aiarb` 时用），
**用户安装后完全不需要执行**。

### 2. 搜索根的顺序

`get_knowledge_dirs()`：
1. **primary**：用户目录 `~/.aiarb/knowledge_base`（若不存在则回退到包内目录）
2. **additional**：`config.json` 的 `knowledge_paths` 配置的额外根（去重后追加）

→ 若用户同时配置了外部知识库路径，会一并被检索。

### 3. 检索层：search_knowledge

`src/aiarb/agents/tools/search_knowledge.py`

- 工具属性：`tool_type="internal"`、`default_policy="allow"`、`requires_sandbox=("file_read",)`、`async_execution=True`
- 参数：`query`（正则，支持 `a|b` 多选，忽略大小写）、`scope`（laws/rules/cases/templates，缺省全搜）
- 实现：**正则 grep 全文检索**（`_walk_and_grep`），不是向量/语义检索
  - 影响：检索**字面命中**，所以文档中的**关键词、法条号、机构名**必须准确且以文本形式出现，才能被命中
  - 例如搜「第五百八十五条」能命中含该字样的文件；搜"违约金酌减"则依赖文件里是否有这个措辞
- 限制：`_MAX_TOTAL_LINES` 截断、有超时与取消机制

**给内容维护的启示**：
- 法规文件里保留**条号原文**（如"第五百八十五条"）而非只写"民法典585条"，提高可检索性
- 关键概念尽量在正文中出现其常见别称（如"违约金酌增酌减""可得利益""优先受偿权"）

### 4. 消费层：Agent 与 Skill

**工具启用**（`src/aiarb/config/config.py`）：
- `build_arbitration_tools_config()`：为仲裁角色 agent（arbitrator/claimant/respondent/secretary）启用
  `search_knowledge` / `grep_search` / `glob_search` + 文件/对话工具，其余 builtin 关闭
- 即：**仲裁角色默认就有检索能力**

**提示词约束**（`src/aiarb/app/migration.py`，约 1354 行）：
> "涉及具体法条、仲裁规则、机构程序、案例或文书模板时，先调用 `search_knowledge` 检索共享知识库；**严禁凭记忆编造法条或规则条文**。"

- 同一文件 1018-1080 行：为 agent 追加启用共享知识库检索工具集，使"提示词要求"与"实际工具集"一致
- 2740s（`config.py`）：另有工具白名单包含 `search_knowledge`

**Skill 层**：
- 技能目录 `src/aiarb/agents/skills/<name>-zh|en/SKILL.md`，打包需 `agents/skills/**`（已含）
- 内置清单：`src/aiarb/agents/skill_system/arb_defaults.py`
  - `ARB_BUILTIN_SKILLS`：init 时 `download_to_workspace` + `enable_skill`（`cli/init_cmd.py` 约 159 行）
  - 当前含：`arb_award_review` / `arb_case_analysis` / `arb_document_draft` / `arb_kb_curate` / `kb_arbitration` / `legal_ai_disclosure`
- 技能内容中约定：起草前 `search_knowledge(query="<文书类型>", scope="templates")`；引用规范看 `CITATION.md`

## 三、模板如何被调用

```
templates/*.md  ──► 被 Skill 在起草流程中检索
   （arb_document_draft 第三步：search_knowledge(scope="templates")）
       │
       ▼
   套用模板结构 → 起草 → 自检 → 产出（MD/DOCX）
```

- 模板是**被检索消费**的（不是硬编码进代码），所以：
  - 模板文件的**标题与关键词**决定它能否被检索到（如"仲裁申请书"）
  - 新增模板只要放进 `templates/` 并同步到用户目录即可生效，**无需改代码**
- 当前模板：`仲裁申请书-通用模板.md`（T-001）、`仲裁答辩书-通用模板.md`（T-002）、`仲裁裁决书-结构模板.md`（T-003）
  - 编号约定：文件名与文内 `template_no` 对应（T-00N）

## 四、完整调用示例（以"起草一份仲裁答辩书"为例）

1. 用户请求 → agent（如 respondent 角色，已启用 search_knowledge）
2. agent 依提示词/Skill：先 `search_knowledge("答辩书", scope="templates")`
3. 命中 `仲裁答辩书-通用模板.md` → 读取结构
4. 同时 `search_knowledge("<争议法条>", scope="laws")` 核对现行条文
5. 按模板起草 → 按 `CITATION.md` 标注来源 → 自检（格式六项 + 内容四项）
6. 若内容由 AI 生成 → 触发 `legal_ai_disclosure` 核实披露
7. 产出 DOCX / MD

## 五、已知薄弱点与建议

| # | 薄弱点 | 影响 | 建议 |
|---|---|---|---|
| 1 | 检索是**字面 grep**，非语义 | 措辞不匹配就检索不到 | 文档中保留条号原文与常见别称；可为每库加 `INDEX.md` 关键词导航（已有） |
| 2 | packaged→global **只补缺失不覆盖** | 仓库更新不会自动到用户端 | 每次内容更新后必须跑 `sync_kb_scaffold.py`；或在 init 时对规范文件强制覆盖 |
| 3 | `_MAX_TOTAL_LINES` 截断 | 大库检索可能被截断 | 用 `scope` 限定范围，避免全库泛搜 |
| 4 | cases/ 仍为空 | 案例检索无内容 | 优先补入公开案例（最高法公报、CIETAC 案例汇编等） |
| 5 | 模板仅 3 件 | 文书类型覆盖不足 | 补：反请求书、代理词、证据清单/质证意见、调解书、撤裁申请、保全申请等 |
| 6 | 未见向量索引/重排 | 长文档相关性一般 | 若需更强检索，可考虑为知识库建立索引层（当前无） |

## 六、文件路径速查

| 环节 | 文件 |
|---|---|
| 知识库目录解析与种子复制 | `src/aiarb/knowledge.py` |
| 检索工具实现 | `src/aiarb/agents/tools/search_knowledge.py` |
| 工具导出 | `src/aiarb/agents/tools/__init__.py` |
| agent 工具集预设 | `src/aiarb/config/config.py`（`build_arbitration_tools_config`） |
| 提示词约束注入 | `src/aiarb/app/migration.py`（约 1018/1080/1354 行） |
| 内置技能清单 | `src/aiarb/agents/skill_system/arb_defaults.py` |
| init 装载技能 | `src/aiarb/cli/init_cmd.py`（约 159 行） |
| 知识库同步脚本 | `scripts/sync_kb_scaffold.py` |
| 采集器 | `scripts/fetch_kb_sources.py` + `scripts/kb_sources.json` |
| 引用规范 | `knowledge_base/CITATION.md` |
| 文档头规范 | `knowledge_base/SCHEMA.md` |
| 版权边界 | `knowledge_base/SOURCES.md` |
