# Fork 维护手册（策略 b+a：本地 patch + 定期 rebase）

上游：`agentscope-ai/QwenPaw`（v2.2.0b5，PR 编号已到 #7438，日更）
本仓库：`AIArbHub/QwenPaw`，工作分支 `arb260901-2`

**策略**：保留直接改底座的灵活性（不抽离成独立包），靠纪律控制 rebase 成本。
核心原则：**能新增就不修改，能回馈就不私藏。**

---

## 1. 本地改动清单（2026-09-07 状态，20 文件 / +707 −48）

### A 类：通用修复 —— **建议回馈上游**（回馈后 rebase 负担归零）

| 文件 | 行数 | 改动内容 | 回馈价值 |
|---|---|---|---|
| `src/aiarb/agents/tools/utils.py` | +106 | 新增 `_try_extract_binary_doc`，用 markitdown 提取 docx/pdf/xlsx/pptx 文本 | 高（通用能力，上游也缺） |
| `src/aiarb/agents/tools/file_io.py` | +6 | `read_file` 文档说明同步 | 随上项一起 |
| `pyproject.toml` | +3 | 加 `markitdown>=0.1.2` 依赖 | 随上项一起 |
| `src/aiarb/runtime/runtime.py` | +10 | `GeneratorExit` 防护，不再误记为 unhandled error | 高（明确的 bug 修复） |
| `src/aiarb/agents/context/scroll/sync.py` | +46 | 群聊/子 agent 会话状态不导入 `history.db` | 高（修复会话污染） |
| `src/aiarb/providers/openai_provider.py` | +29 | `AgnesProvider`，`trust_env=False` 绕过代理导致的 TLS 失败 | 中高 |
| `src/aiarb/providers/provider_catalog.py` | +3 | 注册 AgnesProvider | 随上项一起 |
| `console/src/api/request.ts` | +13 | HTTP 错误对象附带 status/statusText | 中（通用前端改进） |
| `src/aiarb/app/channels/console/channel.py` | +13 | `host_agent_id` 多来源解析 + 日志级别上调 | 中 |

> 这 9 个文件（合计 +229）若全部合入上游，本地 patch 体积直接减少约三分之一。

### B 类：本地专属功能 —— **长期持有，rebase 时重点保护**

| 文件 | 行数 | 改动内容 |
|---|---|---|
| `src/aiarb/app/kb_curator/pipeline.py` | +136 | 模型预检、中文错误提示、prompt 传 workspace |
| `src/aiarb/app/kb_curator/router.py` | +9 | 新增路由 |
| `src/aiarb/app/group_chats/runtime.py` | +104 | 群聊 HITL：双控制点拦截、inject/interrupt/edit |
| `console/src/components/GroupChatControlBar/index.tsx` | +28 | 群聊控制条 |
| `console/src/pages/KnowledgeBase/index.tsx` | +99 | 知识库页面 |
| `console/src/pages/KnowledgeBase/index.module.less` | +104 | 知识库样式 |
| `console/src/pages/Chat/index.tsx` | +18 | 多聊天标签栏 |
| `console/src/layouts/DesignLayout/index.tsx` | +23 | 布局调整 |
| `console/src/locales/{zh,en}.json` | +4 | 文案 |
| `console/src/pages/Settings/Agents/components/AgentCard.module.less` | +1 | 样式 |

### C 类：纯新增文件（rebase 最友好，优先采用这种形式）

已提交：

- `src/aiarb/knowledge_base/**` —— 四库 + SCHEMA/SOURCES/CITATION 规范
- `src/aiarb/app/kb_curator/` —— 策展模块
- `docs/chat-session-tabs.md`、`docs/group-chat-native-runtime.md`

本次新增（未提交）：

- `src/aiarb/agents/skills/arb_award_review-{zh,en}/` 裁决书核阅
- `src/aiarb/agents/skills/arb_case_analysis-{zh,en}/` 案件梳理
- `src/aiarb/agents/skills/arb_document_draft-{zh,en}/` 文书起草
- `src/aiarb/agents/skills/arb_kb_curate-{zh,en}/` 知识库策展
- `docs/competitive-analysis-2026-09.md`、`docs/fork-maintenance.md`

---

## 2. 开发约定（降低 rebase 成本）

1. **能新增文件就不改上游文件。** 新能力优先做成 skill / knowledge_base / docs / 独立模块。
2. **不加新的上游模块依赖。** 新依赖只加在 pyproject 的 local patch 区，并注明原因。
3. **改上游文件时保持最小 diff**，不动无关代码、不改格式、不顺手重构。
4. **法律化内容一律放独立目录**：`knowledge_base/`（数据）、`agents/skills/arb_*`（工作流）、`docs/`（文档）。**不把法律内容硬编码进 agent 主循环或 config**。
5. **通用修复单独一个 commit**，方便直接 cherry-pick 给上游提 PR。
6. 提交信息用中文前缀区分：`[legal]` 本地法律化 / `[fix]` 可回馈修复 / `[feat]` 新功能。

---

## 3. Rebase 操作清单

### rebase 前

- [ ] `git status` 确认工作区干净，未提交改动先 `git stash` 或提交
- [ ] 导出当前 patch：`git diff upstream/main > ../patch-$(date +%Y%m%d).diff`
- [ ] 记录当前本地 commit 列表：`git log --oneline upstream/main..HEAD`
- [ ] 确认 A 类修复是否已提 PR（已合并的从本地 patch 中移除）
- [ ] 前端单独构建一次确认可编译：`cd console && npm run build`

### rebase 中

- [ ] `git fetch upstream && git rebase upstream/main`
- [ ] 冲突按下面第 4 节的优先级处理
- [ ] 每解决一个冲突立刻 `git add`，不要批量

### rebase 后

- [ ] 前端重新构建：`cd console && npm ci && npm run build`
- [ ] 复制产物：`cp -R console/dist/. src/aiarb/console/`
- [ ] 重装：`pip install -e .`
- [ ] 冒烟验证（见第 5 节）
- [ ] 更新本文件的改动清单

---

## 4. 冲突高发文件与处理优先级

| 文件 | 冲突原因 | 处理 |
|---|---|---|
| `src/aiarb/config/config.py`（3,904 行） | 上游高频改动 | **尽量不要改**；确需配置项，改用环境变量或独立配置文件 |
| `src/aiarb/runtime/runtime.py` | 核心运行时，日日变 | 本地改动保持最小；能移到 hook/中间件就移 |
| `src/aiarb/app/channels/*/channel.py`（2,500–3,800 行） | 渠道迭代活跃 | 只做必要的小改，注释标记 `LOCAL PATCH` |
| `src/aiarb/providers/*` | 新模型频繁加入 | 新 provider 用独立文件，不挤 `provider_catalog.py` |
| `src/aiarb/agents/context/scroll/*` | 上下文机制在演进 | 本地改动优先走配置而非改逻辑 |
| `console/src/locales/*.json` | 文案持续增删 | 本地文案放独立 key 前缀（如 `arb.*`），减少行级冲突 |

**冲突处理优先级**：本地法律化功能 > 通用修复 > 格式与风格。
上游改了格式导致冲突时，一律采用上游格式，把自己的逻辑重新套上去。

---

## 5. 冒烟验证清单（rebase 后必跑）

1. `aiarb init --defaults` 能跑通
2. `aiarb app` 启动，Console 可打开（8088）
3. 发一条消息，确认 agent 正常回复
4. 技能列表能看到 `arb_*` 四个技能
5. 知识库检索：`search_knowledge(query="仲裁")` 能命中 `knowledge_base/` 内容
6. 上传一份 DOCX/PDF，`read_file` 能提取文本（验证 A 类 markitdown patch 仍在）
7. 群聊 HITL：发起群聊，确认接管/中断按钮可用

---

## 6. 节奏建议

- **每周**：`git fetch upstream` 看上游变更量，评估是否需要 rebase
- **每月**：做一次 rebase，同时把 A 类修复提 PR 给上游
- **每次上游发版（v2.x.0）**：完整走一遍第 3 节清单 + 第 5 节冒烟
- 上游大版本（v3.0 等）：**先不跟**，等稳定 1–2 个小版本再 rebase

> 判断是否需要立即 rebase 的信号：上游改动触及 `runtime.py`、`scroll/`、`config.py` 时尽早跟；只动渠道和文档时可以拖。
